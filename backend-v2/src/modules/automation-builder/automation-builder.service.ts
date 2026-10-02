import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';
import { RagService } from '../rag/rag.service';
import { advanceAutomationStatus } from '../../common/automation-status.util';
import { GoldenRulePolicyService } from '../../common/golden-rule-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { runCodexExec, parseCodexJson } from '../../common/codex-cli.util';
import { CreateFlowDto } from './dto/create-flow.dto';
import { STEP_PALETTE } from './palette';

interface GraphNode {
  id: string;
  data?: {
    stepType?: string;
    objectId?: string | null;
    testDataItemId?: string | null;
    inlineValue?: string | null;
    config?: Record<string, unknown> | null;
  };
}

interface AiGeneratedStep {
  stepType?: string;
  objectId?: string | null;
  testDataItemId?: string | null;
  inlineValue?: string | null;
  // A literal value the AI proposes for a data-requiring step ("rbala",
  // "SAP", "2024-01-01"...). Deterministic code turns this into a real,
  // reusable TestDataItem rather than asking a small local model to
  // reliably copy an existing item's id out of a long lookup list — that
  // proved unreliable in practice (it kept coming back null even when an
  // exact-matching item existed).
  suggestedValue?: string | null;
}

// The local 3B model occasionally emits the literal 4-character string
// "null" (or "undefined", or whitespace) instead of a real JSON null when it
// wants a field empty — treated as truthy by a plain `??` chain, so it was
// ending up stored as an actual step value (e.g. an OPEN_URL/CLICK step's
// inlineValue literally reading "null", or worse, a test data item created
// with value "null"). Normalize it to real null wherever an AI-supplied
// string is used.
//
// Deliberately does NOT trim or reject a blank/whitespace-only value
// otherwise — a suggestedValue is what a negative test case deliberately
// asked for (blank input, whitespace-only input, leading/trailing
// whitespace padding), and needs to reach the compiled script exactly as
// suggested. This used to trim every value unconditionally, which silently
// erased the one characteristic a whitespace-focused test case existed to
// check (confirmed in practice: a generated script's "with leading/
// trailing whitespace" scenario compiled with a plain, unpadded value).
function cleanAiValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (/^(null|undefined)$/i.test(value.trim())) return null;
  return value;
}

// Test case authors write the exact on-screen label in quotes far more
// reliably than any other part of a test case — this is what lets exact
// object matching happen deterministically instead of leaving every binding
// to the model's own judgment call.
function extractQuotedPhrases(text: string): string[] {
  const matches = text.match(/["']([^"']{2,60})["']/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1, -1).trim()).filter(Boolean))];
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

@Injectable()
export class AutomationBuilderService {
  private readonly logger = new Logger(AutomationBuilderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly goldenRule: GoldenRulePolicyService,
    private readonly ragService: RagService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
  ) {}

  getPalette() {
    return STEP_PALETTE;
  }

  list(applicationId: string) {
    return this.prisma.automationFlow.findMany({
      where: { applicationId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(id: string) {
    const flow = await this.prisma.automationFlow.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' }, include: { object: true, testDataItem: true } },
      },
    });
    if (!flow) {
      throw new NotFoundException(`Automation flow ${id} not found`);
    }
    return flow;
  }

  create(applicationId: string, dto: CreateFlowDto) {
    return this.prisma.automationFlow.create({
      data: {
        applicationId,
        name: dto.name,
        description: dto.description,
        testCaseId: dto.testCaseId,
        framework: dto.framework,
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.automationFlow.delete({ where: { id } });
    return { success: true };
  }

  async updateGraph(id: string, graphJson: Record<string, unknown>) {
    const flow = await this.get(id);
    await this.prisma.automationFlowStep.deleteMany({ where: { automationFlowId: id } });

    const nodes = Array.isArray(graphJson?.nodes) ? (graphJson.nodes as GraphNode[]) : [];
    const paletteByType = new Map(STEP_PALETTE.map((p) => [p.stepType, p]));
    let stepOrder = 1;
    // A step's data requirement is satisfied by EITHER a test data item or a
    // literal inline value (same either/or the Step Inspector offers) —
    // only the object requirement needs the object id specifically.
    let fullyMapped = nodes.length > 0;
    for (const node of nodes) {
      const data = node.data ?? {};
      if (!data.stepType) continue;
      const palette = paletteByType.get(data.stepType as never);
      if (palette?.requiresObject && !data.objectId) fullyMapped = false;
      if (palette?.requiresData && !data.testDataItemId && !data.inlineValue) fullyMapped = false;
      await this.prisma.automationFlowStep.create({
        data: {
          automationFlowId: id,
          nodeId: node.id,
          stepOrder: stepOrder++,
          stepType: data.stepType as never,
          objectId: data.objectId || undefined,
          testDataItemId: data.testDataItemId || undefined,
          inlineValue: data.inlineValue || undefined,
          config: (data.config ?? undefined) as never,
        },
      });
    }

    await this.prisma.automationFlow.update({
      where: { id },
      data: { graphJson: graphJson as never, status: 'DRAFT' },
    });
    await this.refreshObjectUsageCounts(flow.applicationId);

    // Only claim "mapped" once every step that needs an object/data actually
    // has one bound — otherwise a compiled script would have nothing to act
    // on, so the test case's pipeline marker should stay at NOT_STARTED
    // rather than advertise readiness that isn't there yet.
    if (fullyMapped) {
      await advanceAutomationStatus(this.prisma, flow.testCaseId, 'MAPPED');
    }

    return this.get(id);
  }

  // AutomationFlowStep rows are fully rebuilt (delete + recreate) on every
  // graph save, so usageCount is recomputed fresh rather than incremented —
  // an increment-on-create would over-count every time the same flow is
  // resaved, and never decrease when an object is removed from a flow.
  private async refreshObjectUsageCounts(applicationId: string) {
    const objects = await this.prisma.objectRepository.findMany({
      where: { applicationId },
      select: { id: true },
    });
    // Filtered via the relation (object.applicationId) rather than an
    // explicit id-in-list — an application with a large Object Library
    // (thousands of scanned objects) can exceed SQLite's per-query bound-
    // parameter limit when every id is passed as its own IN(...) parameter
    // (confirmed in practice: a large enough scan blocked every flow save
    // for that application with "the query parameter limit... is
    // exceeded"). The relation filter lets the database do the join
    // instead of enumerating ids client-side.
    const counts = await this.prisma.automationFlowStep.groupBy({
      by: ['objectId'],
      where: { object: { applicationId } },
      _count: { objectId: true },
    });
    const countMap = new Map(counts.map((c) => [c.objectId, c._count.objectId]));
    // Sequential, not Promise.all — firing every update concurrently worked
    // fine against SQLite (a single synchronous connection under the hood),
    // but against a real connection-pooled Postgres server this overwhelmed
    // the pool and surfaced as "Connection terminated unexpectedly" on an
    // application with a large-enough Object Library (confirmed in
    // practice). Each update is a single indexed-PK write, so sequential is
    // still fast in absolute terms.
    for (const o of objects) {
      const usageCount = countMap.get(o.id) ?? 0;
      await this.prisma.objectRepository.update({ where: { id: o.id }, data: { usageCount } });
    }
  }

  async validate(id: string) {
    const result = await this.goldenRule.checkFlowGenerationBlockers(id);
    await this.prisma.automationFlow.update({
      where: { id },
      data: { status: result.blocked ? 'DRAFT' : 'VALID' },
    });
    return result;
  }

  // "Everything should be automatically generated" — this is the primary
  // path: AI reads the test case + the Object Library + Test Data + any
  // Knowledge Base context and drafts the flow itself. Manual drag-and-drop
  // (create + updateGraph above) stays available as a fallback/override,
  // since AI can still misjudge a step or an object match.
  async generateFromTestCase(applicationId: string, testCaseId: string) {
    const ctx = await this.gatherFlowGenerationContext(applicationId, testCaseId);
    const { testCase, application, objects, testDataItems, stepsText, objectsText, dataText, paletteText, ragContext, exactMatchText, unmatchedReferences } = ctx;

    let aiSteps: AiGeneratedStep[];
    try {
      aiSteps = await this.aiProvider.generateJson<AiGeneratedStep[]>(
        `Test case: ${testCase.title}\nSteps:\n${stepsText}\n\n` +
          `Available Object Library entries for this application:\n${objectsText}\n\n` +
          `Existing Test Data (for realistic values already used elsewhere — reuse the same value for the same kind of field where sensible):\n${dataText}${ragContext}${exactMatchText}`,
        {
          system:
            'You are a QA automation engineer converting a manual test case into an automation flow for a drag-and-drop builder. ' +
            `Valid step types:\n${paletteText}\n\n` +
            'Return ONLY a JSON array (no wrapper object), one entry per automation step, in execution order, each with: ' +
            'stepType (must be one of the valid step types above), objectId (the exact id string of the best-matching object above, or null if none apply), ' +
            'suggestedValue (for any step that needs a value — ENTER_TEXT, SELECT_DROPDOWN, VERIFY_TEXT, etc. — a realistic literal value to type/verify, e.g. a plausible username, date, or message text; null for steps that need no value). ' +
            "When the test case's own step instruction describes a specific edge-case characteristic for that value — blank, whitespace-only, leading/trailing whitespace, an excessively long string, an unregistered/nonexistent id, script/HTML-like text, etc. — suggestedValue MUST literally embody that exact characteristic (e.g. actual leading/trailing spaces, an actual empty or whitespace-only string) rather than a generic realistic value; a value that doesn't actually exhibit what the step describes doesn't test anything. " +
            'Start with OPEN_URL if the test case implies navigating to the application, and include a verification step matching the test case\'s expected result. ' +
            'Always fill in suggestedValue for every step whose type needs a value — never leave it null for those. ' +
            'Each object lists which screen it lives on — if a step needs an object from a different screen than the ' +
            'previous step\'s object, add a CLICK step for that screen\'s own tab/nav object first (matched by name) ' +
            'before the step that needs it. ' +
            'If the prompt includes a list of exact UI references already matched to object ids, those matches are ' +
            'confirmed correct — use that exact id for any step describing that reference rather than picking a ' +
            'different object from the general list.',
        },
      );
    } catch (err) {
      this.logger.warn(`AI flow generation unavailable for test case ${testCaseId}: ${(err as Error).message}`);
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`AI flow generation is unavailable right now: ${(err as Error).message}`],
        nextActions: ['Build this flow manually in the Automation Builder instead.'],
      });
    }

    if (!Array.isArray(aiSteps) || aiSteps.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['The AI did not return any usable steps for this test case.'],
        nextActions: ['Build this flow manually in the Automation Builder instead.'],
      });
    }

    const flow = await this.buildAndPersistFlow(applicationId, testCaseId, testCase, application, objects, testDataItems, aiSteps);
    return { ...flow, unmatchedReferences };
  }

  // Codex-powered alternative — same context, same deterministic
  // post-processing (buildAndPersistFlow), only the model call differs.
  // Codex is asked for a wrapped { "steps": [...] } object rather than a
  // bare top-level array, since parseCodexJson's brace-matcher looks for an
  // object, not an array.
  async generateFromTestCaseWithCodex(applicationId: string, testCaseId: string) {
    const ctx = await this.gatherFlowGenerationContext(applicationId, testCaseId);
    const { testCase, application, objects, testDataItems, stepsText, objectsText, dataText, paletteText, ragContext, exactMatchText, unmatchedReferences } = ctx;

    const system =
      'You are a QA automation engineer converting a manual test case into an automation flow for a drag-and-drop builder. ' +
      `Valid step types:\n${paletteText}\n\n` +
      'Return ONLY a JSON object: { "steps": [...] }, one array entry per automation step, in execution order, each with: ' +
      'stepType (must be one of the valid step types above), objectId (the exact id string of the best-matching object above, or null if none apply), ' +
      'suggestedValue (for any step that needs a value — ENTER_TEXT, SELECT_DROPDOWN, VERIFY_TEXT, etc. — a realistic literal value to type/verify, e.g. a plausible username, date, or message text; null for steps that need no value). ' +
      'Start with OPEN_URL if the test case implies navigating to the application, and include a verification step matching the test case\'s expected result. ' +
      'Always fill in suggestedValue for every step whose type needs a value — never leave it null for those. ' +
      'Each object lists which screen it lives on — if a step needs an object from a different screen than the ' +
      'previous step\'s object, add a CLICK step for that screen\'s own tab/nav object first (matched by name) ' +
      'before the step that needs it. ' +
      'If the prompt includes a list of exact UI references already matched to object ids, those matches are ' +
      'confirmed correct — use that exact id for any step describing that reference rather than picking a ' +
      'different object from the general list.';
    const userPrompt =
      `Test case: ${testCase.title}\nSteps:\n${stepsText}\n\n` +
      `Available Object Library entries for this application:\n${objectsText}\n\n` +
      `Existing Test Data (for realistic values already used elsewhere — reuse the same value for the same kind of field where sensible):\n${dataText}${ragContext}${exactMatchText}`;

    const codexResult = await runCodexExec(system, userPrompt);
    if (!codexResult.succeeded) {
      this.logger.warn(`Codex flow generation unavailable for test case ${testCaseId}: ${codexResult.errorMessage}`);
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Codex flow generation is unavailable right now: ${codexResult.errorMessage}`],
        nextActions: ['Build this flow manually in the Automation Builder instead.'],
      });
    }

    let aiSteps: AiGeneratedStep[];
    try {
      const parsed = parseCodexJson<{ steps?: AiGeneratedStep[] }>(codexResult.content);
      aiSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    } catch (err) {
      this.logger.warn(`Codex flow generation JSON parse failed for test case ${testCaseId}: ${(err as Error).message}`);
      aiSteps = [];
    }

    if (!Array.isArray(aiSteps) || aiSteps.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['Codex did not return any usable steps for this test case.'],
        nextActions: ['Build this flow manually in the Automation Builder instead.'],
      });
    }

    const flow = await this.buildAndPersistFlow(applicationId, testCaseId, testCase, application, objects, testDataItems, aiSteps);
    return { ...flow, unmatchedReferences };
  }

  private async gatherFlowGenerationContext(applicationId: string, testCaseId: string) {
    const testCase = await this.prisma.testCase.findUnique({
      where: { id: testCaseId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!testCase || testCase.applicationId !== applicationId) {
      throw new NotFoundException(`Test case ${testCaseId} not found for this application`);
    }

    const [application, objects, testDataItems] = await Promise.all([
      this.prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
      this.prisma.objectRepository.findMany({ where: { applicationId }, include: { sourceScanObject: true } }),
      this.prisma.testDataItem.findMany({
        where: { testDataSet: { applicationId } },
        include: { testDataSet: true },
      }),
    ]);

    const stepsText = testCase.steps
      .map((s, i) => `${i + 1}. ${s.instruction}${s.expectedResult ? ` (expected: ${s.expectedResult})` : ''}`)
      .join('\n');

    // A well-populated Object Library makes this prompt too large for the
    // local model — confirmed in practice: listing all ~112 objects across 7
    // screens pushed Ollama's own token-generation rate down to ~1.5
    // tokens/sec and blew past a 10-minute timeout. The test case's own text
    // usually names the screens it's actually about, so narrow to those
    // (plus tabs/nav, always needed to switch screens) first; only fall back
    // to the full list when nothing matches (e.g. a Knowledge-Base-grounded
    // case with no screen names in its steps). A per-screen cap applies
    // either way as a second safety net — `objects`/`objectIds`/`objectById`
    // below stay unrestricted since they validate the AI's response, not
    // what it was shown.
    const testCaseText = `${testCase.title} ${stepsText}`.toLowerCase();
    const screenNames = [...new Set(objects.map((o) => o.screenName).filter((s): s is string => !!s))];
    const mentionedScreens = new Set(screenNames.filter((s) => testCaseText.includes(s.toLowerCase())));
    const candidateObjects =
      mentionedScreens.size > 0
        ? objects.filter((o) => /tab|nav/i.test(o.objectType) || (o.screenName && mentionedScreens.has(o.screenName)))
        : objects;

    const PER_SCREEN_OBJECT_CAP = 12;
    const objectsByScreenForPrompt = new Map<string, typeof objects>();
    for (const obj of candidateObjects) {
      const key = obj.screenName || 'n/a';
      objectsByScreenForPrompt.set(key, [...(objectsByScreenForPrompt.get(key) ?? []), obj]);
    }
    const objectsText =
      [...objectsByScreenForPrompt.entries()]
        .map(([screen, objs]) => {
          const tabs = objs.filter((o) => /tab|nav/i.test(o.objectType));
          const rest = objs.filter((o) => !/tab|nav/i.test(o.objectType));
          const named = rest.filter((o) => o.objectName?.trim());
          const unnamed = rest.filter((o) => !o.objectName?.trim());
          const shown = [...tabs, ...named, ...unnamed].slice(0, tabs.length + PER_SCREEN_OBJECT_CAP);
          const omitted = objs.length - shown.length;
          const lines = shown.map((o) => `- "${o.objectName}" (id: ${o.id}, type: ${o.objectType}, screen: ${screen})`).join('\n');
          return `${lines}${omitted > 0 ? `\n  …and ${omitted} more object(s) on screen "${screen}" not shown` : ''}`;
        })
        .join('\n') || 'none available';
    const dataText =
      testDataItems.map((d) => `- "${d.key}" = ${d.isSensitive ? '(sensitive)' : d.value} (set: ${d.testDataSet.name})`).join('\n') ||
      'none available';
    const paletteText = STEP_PALETTE.map(
      (p) => `${p.stepType} — ${p.description}${p.requiresObject ? ' [needs an object]' : ''}${p.requiresData ? ' [needs a value]' : ''}`,
    ).join('\n');

    const rag = await this.ragService.retrieveContext(applicationId, `${testCase.title}\n${stepsText}`);
    const ragContext = rag.used ? `\n\nRelevant knowledge base context:\n${rag.chunks.join('\n---\n')}` : '';

    // Test case authors overwhelmingly write the EXACT on-screen label in
    // quotes ("select 'SOD User Analysis'", "Enter '...' in 'USERLIST-LOW'")
    // — that's a deterministic, human-authored ground truth for which real
    // object a step means, stronger than asking the model to infer it from
    // a big candidate list. Matched here and handed to the model as an
    // explicit "these ids are already confirmed" hint instead of leaving it
    // to guess every binding itself. Phrases that don't match anything are
    // surfaced back to the caller — most often because the actual screen
    // was never reached by a scan, not because the object doesn't exist.
    const quotedPhrases = extractQuotedPhrases(
      [testCase.title, testCase.preconditions, testCase.expectedResult, ...testCase.steps.map((s) => `${s.instruction} ${s.expectedResult ?? ''}`)]
        .filter(Boolean)
        .join(' '),
    );
    const objectByNormalizedLabel = new Map<string, (typeof objects)[number]>();
    for (const o of objects) {
      for (const label of [o.objectName, o.displayLabel]) {
        const key = label?.trim() ? normalizeForMatch(label) : '';
        if (key && !objectByNormalizedLabel.has(key)) objectByNormalizedLabel.set(key, o);
      }
    }
    const exactMatches: { phrase: string; object: (typeof objects)[number] }[] = [];
    const unmatchedReferences: string[] = [];
    for (const phrase of quotedPhrases) {
      const match = objectByNormalizedLabel.get(normalizeForMatch(phrase));
      if (match) exactMatches.push({ phrase, object: match });
      // Only flag multi-word phrases as "possibly missing from the scan" —
      // a single token is just as likely to be a data value (a username, a
      // transaction code) as a UI label, and flagging those would mostly be
      // noise.
      else if (phrase.trim().includes(' ')) unmatchedReferences.push(phrase);
    }
    const exactMatchText =
      exactMatches.length > 0
        ? '\n\nThese exact UI references from the test case have already been matched to real objects — use ' +
          "these ids directly for any step describing them, don't second-guess or pick a different object:\n" +
          exactMatches.map((m) => `- "${m.phrase}" → id: ${m.object.id} (${m.object.objectType}, screen: ${m.object.screenName ?? 'n/a'})`).join('\n')
        : '';

    return {
      testCase,
      application,
      objects,
      testDataItems,
      stepsText,
      objectsText,
      dataText,
      paletteText,
      ragContext,
      exactMatchText,
      unmatchedReferences,
    };
  }

  // Shared by both the local-AI and Codex generation paths — everything from
  // here on is deterministic, provider-agnostic post-processing of whatever
  // step list the model proposed (hallucinated-id dropping, tab/nav
  // insertion, test data item creation, graph persistence), so it only needs
  // to exist once.
  private async buildAndPersistFlow(
    applicationId: string,
    testCaseId: string,
    testCase: Awaited<ReturnType<AutomationBuilderService['gatherFlowGenerationContext']>>['testCase'],
    application: Awaited<ReturnType<AutomationBuilderService['gatherFlowGenerationContext']>>['application'],
    objects: Awaited<ReturnType<AutomationBuilderService['gatherFlowGenerationContext']>>['objects'],
    testDataItems: Awaited<ReturnType<AutomationBuilderService['gatherFlowGenerationContext']>>['testDataItems'],
    aiSteps: AiGeneratedStep[],
  ) {
    // The AI can hallucinate ids — silently drop any that don't match a real
    // row rather than let a bad id corrupt the flow.
    const objectIds = new Set(objects.map((o) => o.id));
    const validStepTypes = new Set(STEP_PALETTE.map((p) => p.stepType));
    const paletteByType = new Map(STEP_PALETTE.map((p) => [p.stepType, p]));
    const objectById = new Map(objects.map((o) => [o.id, o]));

    let autoDataSetId: string | null = null;
    const getOrCreateAutoDataSetId = async () => {
      if (autoDataSetId) return autoDataSetId;
      const existingSet = await this.prisma.testDataSet.findFirst({ where: { applicationId, name: 'AI Generated' } });
      const set =
        existingSet ??
        (await this.prisma.testDataSet.create({
          data: { applicationId, name: 'AI Generated', description: 'Values TestPilot\'s AI proposed while drafting automation flows — reviewed and edited here as needed.' },
        }));
      autoDataSetId = set.id;
      return set.id;
    };
    // key -> { id, value }, seeded from what already exists and extended as
    // this run creates new items — keeps a second data-requiring step in the
    // same generation call from creating a duplicate for the same key. Holds
    // the value alongside the id so it can be compared against what this
    // step actually needs — see the reuse-vs-disambiguate check below.
    const dataItemByKey = new Map<string, { id: string; value: string }>(
      testDataItems.map((d) => [d.key.trim().toLowerCase(), { id: d.id, value: d.value }]),
    );

    // The AI reliably picks the right OBJECT for a step, but has repeatedly
    // proven unreliable at noticing when that object lives on a different
    // tab/screen than the previous step and needs an explicit click to
    // switch there first (confirmed by a real failed execution: a script
    // tried to type into a "New Password" tab's field while still on the
    // default tab, timing out because nothing ever switched tabs). Rather
    // than trust a small local model with that sequencing, insert the
    // switch deterministically: any object whose own objectType looks like
    // a tab/nav control is a candidate "switch to this screen" action,
    // keyed by its own name — which is also how screens are named on the
    // other objects that live on them.
    const tabObjectByScreenName = new Map<string, string>();
    for (const o of objects) {
      if (/tab|nav/i.test(o.objectType)) {
        tabObjectByScreenName.set(o.objectName.trim().toLowerCase(), o.id);
      }
    }

    // The AI reliably picks the CLICK target for a step, but has repeatedly
    // left assertion steps (VERIFY_TEXT / VERIFY_ELEMENT_VISIBLE) with
    // objectId: null — the test case's expected result is worded as an
    // outcome ("user is redirected to the Registration page…") rather than
    // naming an on-screen element, so the model has nothing concrete to
    // match and gives up. That left every generated verification step
    // permanently blocked (Object Library has no matching id → validate()
    // reports "no object assigned" → flow can never leave DRAFT). Rather
    // than trust the model to invent a target, fall back to a real object on
    // the screen the flow is already on when it leaves one of these two
    // step types unbound — prefer something text/heading-like, else any
    // non-tab element on that screen, so the assertion always has something
    // real to check.
    const objectsByScreen = new Map<string, typeof objects>();
    for (const o of objects) {
      if (/tab|nav/i.test(o.objectType)) continue;
      const screen = o.screenName?.trim().toLowerCase();
      if (!screen) continue;
      objectsByScreen.set(screen, [...(objectsByScreen.get(screen) ?? []), o]);
    }
    // Screen-scoped candidates when we know what screen the flow is on.
    // Assertions get an additional GLOBAL fallback (searching every scanned
    // object, not just the current screen) when the screen is unknown — a
    // wrong assertion target is low-risk, it only reads state, never
    // changes it. ACTION steps (CLICK/ENTER_TEXT/SELECT_DROPDOWN, see below)
    // deliberately do NOT get that same global fallback: confirmed in
    // practice on a real SAP GUI flow that guessing globally produced a
    // technically-real but semantically wrong binding (a CLICK landed on an
    // unrelated toolbar button, an ENTER_TEXT landed on the OK-code/command
    // field with a User ID typed into it) — a script that confidently does
    // the WRONG thing against a live system is worse than one that's
    // honestly blocked pending manual review in the Automation Builder.
    const allNonTabObjects = objects.filter((o) => !/tab|nav/i.test(o.objectType));

    // When a clear name match doesn't exist but there IS a real shortlist of
    // candidates on the right screen, ask Codex to pick the best one instead
    // of guessing with `candidates[0]` — this is what actually fixes the
    // root cause (bad binding), while the script itself keeps being produced
    // by the deterministic compiler untouched (see script-generator
    // module). Bounded per flow generation so one flow with many ambiguous
    // steps can't turn into a dozen extra Codex round trips.
    let codexBindingCallsRemaining = 3;
    const resolveAmbiguousObjectId = async (
      stepType: string,
      suggestedValue: string | null | undefined,
      candidates: (typeof objects)[number][],
    ): Promise<string | null> => {
      if (candidates.length <= 1 || codexBindingCallsRemaining <= 0) return candidates[0]?.id ?? null;
      codexBindingCallsRemaining--;
      const system =
        'You are selecting which real UI object an automation step should act on, from a shortlist of candidates ' +
        'that are already confirmed to exist — you are not inventing anything. Return ONLY a JSON object: ' +
        '{ "objectId": string | null }. Pick the id whose name most plausibly matches what this step is trying to ' +
        'do, given the test case title and the step; return null if genuinely none of the candidates fit rather ' +
        'than guessing.';
      const userPrompt =
        `Test case: ${testCase.title}\nStep type: ${stepType}${suggestedValue ? `\nStep's intended value: ${suggestedValue}` : ''}\n\n` +
        `Candidates:\n${candidates.map((c) => `- id: "${c.id}", name: "${c.objectName}", type: "${c.objectType}"`).join('\n')}`;
      try {
        const result = await runCodexExec(system, userPrompt, 30_000);
        if (!result.succeeded) return candidates[0]?.id ?? null;
        const parsed = parseCodexJson<{ objectId?: string | null }>(result.content);
        return parsed.objectId && candidates.some((c) => c.id === parsed.objectId) ? parsed.objectId : null;
      } catch {
        return candidates[0]?.id ?? null;
      }
    };

    async function fallbackAssertionObject(screen: string | null) {
      const candidates = (screen ? objectsByScreen.get(screen) : undefined) ?? allNonTabObjects;
      if (!candidates.length) return undefined;
      const named = candidates.find((o) => /label|heading|title|header|text/i.test(o.objectType));
      if (named) return named;
      const id = await resolveAmbiguousObjectId('VERIFY_TEXT/VERIFY_ELEMENT_VISIBLE', null, candidates);
      return id ? objectById.get(id) : undefined;
    }

    // Same reasoning as fallbackAssertionObject, for CLICK — a test case
    // step like "submit the form" or "attempt to reset without selecting a
    // System" names an ACTION, not the button's own on-screen label, which
    // gives the model nothing concrete to match even though the real button
    // is right there in the Object Library it was shown. Left unbound, that
    // CLICK step permanently blocks script generation ("no object
    // assigned"), so fall back to the most plausible real button — but ONLY
    // on the screen the flow is already on (see comment above); with no
    // screen context yet, stay unbound rather than click something
    // unrelated.
    async function fallbackClickObject(screen: string | null) {
      if (!screen) return undefined;
      const scoped = objectsByScreen.get(screen)?.filter((o) => /button/i.test(o.objectType));
      if (scoped?.length) {
        const named = scoped.find((o) => /submit|save|confirm|continue|apply|reset|ok\b/i.test(o.objectName ?? ''));
        if (named) return named;
        const id = await resolveAmbiguousObjectId('CLICK', null, scoped);
        return id ? objectById.get(id) : undefined;
      }
      // Nothing scanned under this exact screen name — this happens when a
      // previous click navigated to a different logical screen than the one
      // its own button was scanned under (the scanner records where a
      // control lives, not where clicking it leads to). Widen to every
      // button in the app rather than leaving the step permanently unbound,
      // but skip the regex name-guess above and go straight to Codex's own
      // judgement — "closest name match" is far less reliable once
      // candidates aren't all from the same screen.
      const global = allNonTabObjects.filter((o) => /button/i.test(o.objectType));
      if (!global.length) return undefined;
      const id = await resolveAmbiguousObjectId('CLICK', null, global);
      return id ? objectById.get(id) : undefined;
    }

    // Same reasoning again, for ENTER_TEXT/SELECT_DROPDOWN — matches an
    // input/field-like object on the CURRENT screen only (no global
    // fallback, same rationale as CLICK above). Explicitly excludes SAP's
    // OK-code/command field (GuiOkCodeField) — that control only ever means
    // "type a transaction code here", never a general-purpose data field,
    // so it must never be the fallback target for an arbitrary value like a
    // user ID (confirmed in practice: exactly this happened before this
    // exclusion existed).
    async function fallbackDataEntryObject(screen: string | null, suggestedValue: string | null | undefined) {
      if (!screen) return undefined;
      const isFieldLike = (o: (typeof objects)[number]) =>
        /text|field|input|combo|dropdown/i.test(o.objectType) &&
        !/button|checkbox|radio|okcode/i.test(o.objectType);
      const scoped = objectsByScreen.get(screen)?.filter(isFieldLike);
      // Same screen-transition gap as fallbackClickObject above — a step
      // like "enter the User ID" right after a click that jumped to a new
      // SAP screen has no candidates under the screen name the flow is
      // still tracking, even though the real field is sitting right there
      // in the Object Library under a different screen. Widen to every
      // field-like object in the app (still Codex-disambiguated, still
      // excluding buttons/checkboxes/OK-code) rather than leaving it unbound.
      const candidates = scoped?.length ? scoped : allNonTabObjects.filter(isFieldLike);
      if (!candidates.length) return undefined;
      const id = await resolveAmbiguousObjectId('ENTER_TEXT/SELECT_DROPDOWN', suggestedValue, candidates);
      return id ? objectById.get(id) : undefined;
    }

    // Prefer the element's own real captured text (from the scan that found
    // it) over an AI-invented guess for what a verification step should
    // check — grounds the assertion in what the app actually shows instead
    // of plausible-sounding but unverified text. Trims its own result
    // in-line rather than going through cleanAiValue — this is scanned
    // element text, not an AI-suggested value a negative test case might be
    // deliberately padding with whitespace, so trimming incidental scan
    // whitespace here is still exactly right.
    function realTextFor(obj: (typeof objects)[number] | undefined): string | null {
      const s = obj?.sourceScanObject;
      const raw = s?.buttonText || s?.ariaLabel || s?.nearbyLabelText || s?.label;
      const trimmed = raw?.trim();
      return trimmed || null;
    }

    const nodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      data: {
        stepType: string;
        objectId: string | null;
        testDataItemId: string | null;
        inlineValue: string | null;
        config: Record<string, unknown> | null;
      };
    }> = [];
    let index = 0;
    let currentScreen: string | null = null;
    for (const step of aiSteps) {
      if (!step.stepType || !validStepTypes.has(step.stepType as never)) continue;
      const palette = paletteByType.get(step.stepType as never);
      let objectId = step.objectId && objectIds.has(step.objectId) ? step.objectId : null;

      // Assertion/click steps the AI left unbound get a deterministic real
      // object from the screen the flow is currently on, instead of staying
      // permanently blocked (see fallbackAssertionObject/fallbackClickObject
      // above).
      if (!objectId && palette?.requiresObject && (step.stepType === 'VERIFY_TEXT' || step.stepType === 'VERIFY_ELEMENT_VISIBLE')) {
        objectId = (await fallbackAssertionObject(currentScreen))?.id ?? null;
      } else if (!objectId && palette?.requiresObject && step.stepType === 'CLICK') {
        objectId = (await fallbackClickObject(currentScreen))?.id ?? null;
      } else if (!objectId && palette?.requiresObject && (step.stepType === 'ENTER_TEXT' || step.stepType === 'SELECT_DROPDOWN')) {
        objectId = (await fallbackDataEntryObject(currentScreen, step.suggestedValue))?.id ?? null;
      }

      const targetScreen = objectId ? objectById.get(objectId)?.screenName?.trim().toLowerCase() || null : null;
      if (targetScreen && currentScreen && targetScreen !== currentScreen) {
        const tabObjectId = tabObjectByScreenName.get(targetScreen);
        // A persistent nav tab visible on every screen gets scanned (and
        // promoted) once per screen it appears on, so "the New Password
        // tab" can exist as several distinct ObjectRepository rows sharing
        // the same real technicalPath. Comparing by id alone missed this:
        // the upcoming step could already be bound to one such row while
        // tabObjectByScreenName resolved to a *different* row for the same
        // physical element, injecting a redundant second click on it
        // (confirmed in practice: a compiled script clicked the same "New
        // Password" tab twice in a row). Comparing the real locator instead
        // of the row id is what actually tells them apart.
        const tabObject = tabObjectId ? objectById.get(tabObjectId) : undefined;
        const targetObject = objectId ? objectById.get(objectId) : undefined;
        if (tabObjectId && tabObject && tabObject.technicalPath !== targetObject?.technicalPath) {
          nodes.push({
            id: `ai-node-${index + 1}`,
            type: 'step',
            position: { x: 250, y: index * 120 },
            data: { stepType: 'CLICK', objectId: tabObjectId, testDataItemId: null, inlineValue: null, config: null },
          });
          index++;
        }
      }
      if (targetScreen) currentScreen = targetScreen;

      // Ground a verification step's expected text in what the bound
      // element's own scan actually captured, rather than trust the AI's
      // guess — falls back to the AI's suggestion when the object has no
      // real captured text (e.g. an icon with no accessible name).
      const boundObject = objectId ? objectById.get(objectId) : undefined;
      const isAssertion = step.stepType === 'VERIFY_TEXT' || step.stepType === 'VERIFY_ELEMENT_VISIBLE';
      const finalValue = (isAssertion ? realTextFor(boundObject) : null) ?? cleanAiValue(step.suggestedValue);

      let testDataItemId: string | null = null;
      if (palette?.requiresData && finalValue) {
        // Reuse an existing item with the same key rather than minting a
        // fresh duplicate every time a flow is (re)generated — same value,
        // same real row, still user-editable. Screen is part of the key
        // since apps can reuse the same element name on every screen (e.g.
        // a generic "iconImage" logo button) — without it, three screens'
        // distinct expected values would collide into one shared item.
        const objectName = boundObject?.objectName;
        const key = (
          objectName
            ? `${objectName}${boundObject?.screenName ? ` - ${boundObject.screenName}` : ''}`
            : `${step.stepType.toLowerCase()}Value${index}`
        ).slice(0, 60);
        const normalizedKey = key.trim().toLowerCase();
        const existing = dataItemByKey.get(normalizedKey);
        const existingMatchesThisStep = existing && existing.value.trim().toLowerCase() === finalValue.trim().toLowerCase();
        if (existing && existingMatchesThisStep) {
          testDataItemId = existing.id;
        } else {
          // No existing item, OR this test case needs a genuinely different
          // value for the same field than whatever flow first claimed this
          // key (e.g. a negative test's deliberately blank/whitespace/
          // malformed input vs. a positive test's normal value). Blindly
          // reusing the existing value here silently substituted a valid
          // value where the test case specifically called for an invalid
          // one — confirmed in practice: a "leading/trailing whitespace"
          // test ended up entering a plain random username with no
          // whitespace at all, because a positive test's item already
          // existed under the same object+screen key and this step's own
          // (correct, whitespace-padded) suggested value was discarded in
          // favor of it. Disambiguating with a short numeric suffix keeps
          // both as distinct, still-readable Test Data rows instead.
          let finalKey = key;
          if (existing) {
            let suffix = 2;
            while (dataItemByKey.has(`${key} (${suffix})`.trim().toLowerCase())) suffix++;
            finalKey = `${key} (${suffix})`;
          }
          const setId = await getOrCreateAutoDataSetId();
          const isSensitive = /pass(word)?|secret|token/i.test(finalKey);
          const created = await this.prisma.testDataItem.create({
            data: { testDataSetId: setId, key: finalKey, value: finalValue, isSensitive },
          });
          testDataItemId = created.id;
          dataItemByKey.set(finalKey.trim().toLowerCase(), { id: created.id, value: created.value });
        }
      }

      nodes.push({
        id: `ai-node-${index + 1}`,
        type: 'step',
        position: { x: 250, y: index * 120 },
        data: {
          stepType: step.stepType,
          objectId,
          testDataItemId,
          inlineValue: testDataItemId ? null : finalValue,
          // OPEN_URL always navigates to this application's own entry point
          // — never leave it for the AI to guess (it has no way to know the
          // real URL, and previously this was always null, forcing a manual
          // fix in the inspector every single time a flow was generated).
          config: step.stepType === 'OPEN_URL' ? { url: application.entryUrl ?? undefined } : null,
        },
      });
      index++;
    }

    // A persistent nav tab visible on every screen gets scanned (and
    // promoted) once per screen it's visible on, so "click the New Password
    // tab" can resolve to several distinct ObjectRepository rows that all
    // share the same real technicalPath. Codex's own proposed step list has
    // included two consecutive CLICK steps that each resolved to one of
    // these duplicate rows this way — confirmed in practice: a compiled
    // script clicked #RequestTab twice in a row, doing nothing useful the
    // second time and risking a toggle/double-submit on a control that
    // isn't idempotent. Collapsing a CLICK immediately following a CLICK on
    // the identical technicalPath removes the redundant one regardless of
    // which distinct row either step's object happened to resolve to.
    const deduped = nodes.filter((node, i) => {
      if (node.data.stepType !== 'CLICK' || i === 0) return true;
      const prev = nodes[i - 1];
      if (prev.data.stepType !== 'CLICK') return true;
      const prevPath = prev.data.objectId ? objectById.get(prev.data.objectId)?.technicalPath : undefined;
      const curPath = node.data.objectId ? objectById.get(node.data.objectId)?.technicalPath : undefined;
      return !(prevPath && curPath && prevPath === curPath);
    });
    nodes.length = 0;
    nodes.push(...deduped);

    if (nodes.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['The AI response did not contain any recognized step types.'],
        nextActions: ['Build this flow manually in the Automation Builder instead.'],
      });
    }

    // SAP GUI/HYBRID apps have no URL to open — without an explicit entry
    // transaction code, a generated flow has no deterministic way to get
    // from a blank SAP GUI session into the right transaction (confirmed in
    // practice: a flow silently assumed it was already mid-transaction and
    // never asked to get there). Prepended here rather than trusted to the
    // model, mirroring how entryUrl always gets filled onto an OPEN_URL step
    // below — except this is unconditional, since there's no step type for
    // the model to have proposed on its own that this fills in after the
    // fact.
    if (
      (application.appType === 'SAP_GUI' || application.appType === 'HYBRID') &&
      application.entryTransactionCode &&
      nodes[0]?.data.stepType !== 'SAP_START_TRANSACTION'
    ) {
      nodes.unshift({
        id: 'ai-node-0',
        type: 'step',
        position: { x: 250, y: -120 },
        data: {
          stepType: 'SAP_START_TRANSACTION',
          objectId: null,
          testDataItemId: null,
          inlineValue: application.entryTransactionCode,
          config: null,
        },
      });
    }

    const edges = nodes.slice(0, -1).map((node, i) => ({
      id: `${node.id}->${nodes[i + 1].id}`,
      source: node.id,
      target: nodes[i + 1].id,
    }));
    const graphJson = { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };

    let flow = await this.prisma.automationFlow.findFirst({ where: { applicationId, testCaseId } });
    if (!flow) {
      flow = await this.prisma.automationFlow.create({
        data: {
          applicationId,
          testCaseId,
          name: testCase.title,
          description: `Auto-generated by AI from test case "${testCase.title}".`,
        },
      });
    }

    return this.updateGraph(flow.id, graphJson);
  }
}
