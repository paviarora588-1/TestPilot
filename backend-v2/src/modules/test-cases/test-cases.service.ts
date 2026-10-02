import { ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';
import { RagService } from '../rag/rag.service';
import { AutomationBuilderService } from '../automation-builder/automation-builder.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { runCodexExec, parseCodexJson } from '../../common/codex-cli.util';
import { CreateTestCaseDto } from './dto/create-test-case.dto';
import { GenerateTestCasesDto } from './dto/generate-test-cases.dto';
import { GenerateWithCodexDto } from './dto/generate-with-codex.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { DataRequirementValueDto } from './dto/save-data-requirements.dto';
import { analyzeStepsAgainstObjects } from './test-case-analysis.util';
import { buildDataRequirementGroups, dataItemKeyFor } from './data-requirements.util';
import { parseTestCasesCsv, parseTestCasesExcel, type ParsedTestCaseRow } from './test-case-import.util';

const VALID_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_TEST_TYPES = new Set(['POSITIVE', 'NEGATIVE', 'BOUNDARY', 'UI', 'INTEGRATION', 'REGRESSION', 'SMOKE']);

// Alternates every Codex generation call between a narrow, single-behavior
// test case and a full multi-step journey — directly addresses "test cases
// should be pure functionality AND other test cases full end-to-end/full
// depth testing as a senior QA" rather than relying on the test-type
// rotation alone (which varies WHAT is tested, not how deep).
const GENERATION_SCOPES = [
  {
    key: 'FUNCTIONAL',
    instruction:
      'a PURE FUNCTIONALITY test case: narrowly scoped to ONE specific behavior, field, or validation rule. Minimal ' +
      'setup, few steps — a focused check of a single unit of behavior, not a journey across multiple screens.',
  },
  {
    key: 'END_TO_END',
    instruction:
      'a FULL END-TO-END test case, written the way a thorough senior QA engineer would test a complete workflow: a ' +
      'realistic multi-step user journey spanning the relevant screens from start to finish, including setup, the ' +
      'core action(s), and full verification of the outcome — not a single isolated check.',
  },
] as const;

// Exact-match title dedup missed near-identical titles that differ by only a
// filler word (confirmed in practice: "Register a new user account with
// valid System..." vs "...with a valid System..." were treated as distinct).
// Stripping articles/punctuation before comparing catches that class of
// near-duplicate without needing a real fuzzy-matching library.
function normalizeForDedupe(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['a', 'an', 'the'].includes(w))
    .join(' ')
    .trim();
}

interface AiGeneratedTestCase {
  title?: string;
  moduleName?: string;
  featureName?: string;
  priority?: string;
  preconditions?: string;
  expectedResult?: string;
  steps?: { instruction?: string; expectedResult?: string }[];
}

interface AiGeneratedCodexTestCase extends AiGeneratedTestCase {
  testType?: string;
}

interface StoryAnalysisShape {
  impactedModules?: string[];
  riskAreas?: string[];
}

@Injectable()
export class TestCasesService {
  private readonly logger = new Logger(TestCasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
    private readonly automationBuilderService: AutomationBuilderService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly pipelineService: PipelineService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
  ) {}

  // Folds this application's own existing test cases into the Knowledge Base
  // so AI generation is grounded in real prior test coverage (style, module
  // breakdown, what's already tested) in addition to scanned objects and any
  // uploaded docs — not just deduped against by title as before. Runs the
  // real ingestion pipeline (chunk + embed + AI-summarize) exactly once per
  // application: skipped whenever a PROCESSED source with this exact
  // fileName already exists, so repeated generation calls don't re-pay the
  // AI-summarization cost every time. To force a refresh after adding many
  // new test cases, delete that Knowledge Base entry from the UI — the next
  // generation call will recreate it from the current test case set.
  private readonly EXISTING_TEST_CASES_KB_FILENAME = 'Existing Test Cases (auto-analyzed).txt';

  private async ensureExistingTestCasesKnowledgeBase(applicationId: string) {
    const alreadyAnalyzed = await this.prisma.knowledgeSource.findFirst({
      where: { applicationId, fileName: this.EXISTING_TEST_CASES_KB_FILENAME, status: 'PROCESSED' },
      select: { id: true },
    });
    if (alreadyAnalyzed) return;

    const testCases = await this.prisma.testCase.findMany({
      where: { applicationId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    if (testCases.length === 0) return;

    const text = testCases
      .map((tc, i) => {
        const stepsText = tc.steps
          .map((s, j) => `    ${j + 1}. ${s.instruction}${s.expectedResult ? ` (expected: ${s.expectedResult})` : ''}`)
          .join('\n');
        return (
          `Test Case ${i + 1}: ${tc.title}\n` +
          `  Module: ${tc.moduleName ?? 'n/a'} / Feature: ${tc.featureName ?? 'n/a'}\n` +
          `  Priority: ${tc.priority}\n` +
          `  Preconditions: ${tc.preconditions ?? 'n/a'}\n` +
          `  Expected result: ${tc.expectedResult ?? 'n/a'}\n` +
          `  Steps:\n${stepsText || '    (no steps recorded)'}`
        );
      })
      .join('\n\n');

    // Stale (existing, unprocessed/failed) attempts under the same filename
    // would otherwise collide on retry — clear them first so this stays a
    // single canonical source per application, not a growing pile of dupes.
    await this.prisma.knowledgeSource.deleteMany({
      where: { applicationId, fileName: this.EXISTING_TEST_CASES_KB_FILENAME, status: { not: 'PROCESSED' } },
    });

    try {
      await this.knowledgeBaseService.ingestText(applicationId, this.EXISTING_TEST_CASES_KB_FILENAME, text);
    } catch (err) {
      // Grounding in existing test cases is an enhancement, not a
      // precondition — generation should still proceed on its own if this
      // one-time analysis fails (e.g. AI provider unreachable).
      this.logger.warn(`Existing-test-case knowledge analysis failed for application ${applicationId}: ${(err as Error).message}`);
    }
  }

  list(applicationId: string) {
    return this.prisma.testCase.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const testCase = await this.prisma.testCase.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!testCase) throw new NotFoundException(`Test case ${id} not found`);
    return testCase;
  }

  async create(applicationId: string, dto: CreateTestCaseDto) {
    return this.prisma.testCase.create({
      data: {
        applicationId,
        title: dto.title,
        moduleName: dto.moduleName,
        featureName: dto.featureName,
        priority: dto.priority,
        preconditions: dto.preconditions,
        expectedResult: dto.expectedResult,
        source: 'MANUAL',
        steps: dto.steps
          ? {
              create: dto.steps.map((step, index) => ({
                stepOrder: index + 1,
                instruction: step.instruction,
                expectedResult: step.expectedResult,
              })),
            }
          : undefined,
      },
      include: { steps: true },
    });
  }

  // Steps aren't diffed field-by-field — an edit that touches steps replaces
  // the whole set (same "one per line" shape the create form already uses),
  // which is simpler and matches how the UI presents them. Wrapped in a
  // transaction so a mid-edit crash can't leave the test case stepless.
  async update(id: string, dto: UpdateTestCaseDto) {
    await this.get(id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.steps) {
        await tx.testStep.deleteMany({ where: { testCaseId: id } });
      }
      return tx.testCase.update({
        where: { id },
        data: {
          title: dto.title,
          moduleName: dto.moduleName,
          featureName: dto.featureName,
          // Non-nullable enum field with a schema default: an explicit null
          // (vs. simply omitted) makes Prisma reject the write outright, so
          // only pass it through when a real value is present.
          ...(dto.priority != null && { priority: dto.priority }),
          preconditions: dto.preconditions,
          expectedResult: dto.expectedResult,
          steps: dto.steps
            ? {
                create: dto.steps.map((step, index) => ({
                  stepOrder: index + 1,
                  instruction: step.instruction,
                  expectedResult: step.expectedResult,
                })),
              }
            : undefined,
        },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
    });
  }

  async importRows(applicationId: string, rows: ParsedTestCaseRow[], source: 'CSV' | 'EXCEL') {
    const created: Awaited<ReturnType<typeof this.prisma.testCase.create>>[] = [];
    for (const row of rows) {
      const testCase = await this.prisma.testCase.create({
        data: {
          applicationId,
          externalId: row.externalId,
          title: row.title,
          moduleName: row.moduleName,
          featureName: row.featureName,
          expectedResult: row.expectedResult,
          priority: (row.priority?.toUpperCase() as never) || undefined,
          source,
          steps: {
            create: row.steps.map((instruction, index) => ({
              stepOrder: index + 1,
              instruction,
            })),
          },
        },
      });
      created.push(testCase);
    }
    return { imported: created.length, testCases: created };
  }

  async importCsv(applicationId: string, buffer: Buffer) {
    const rows = parseTestCasesCsv(buffer);
    return this.importRows(applicationId, rows, 'CSV');
  }

  async importExcel(applicationId: string, buffer: Buffer) {
    const rows = await parseTestCasesExcel(buffer);
    return this.importRows(applicationId, rows, 'EXCEL');
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.testCase.delete({ where: { id } });
    return { success: true };
  }

  async analyze(id: string) {
    const testCase = await this.get(id);
    const objects = await this.prisma.objectRepository.findMany({
      where: { applicationId: testCase.applicationId },
    });
    const objectNames = objects.map((o) => o.objectName);
    const stepsText = testCase.steps.map((s) => s.instruction).join('\n');

    const deterministic = analyzeStepsAgainstObjects(stepsText, objectNames);

    const rag = await this.ragService.retrieveContext(testCase.applicationId, `${testCase.title}\n${stepsText}`);
    const ragContext = rag.used
      ? `\n\nRelevant knowledge base context:\n${rag.chunks.join('\n---\n')}`
      : '';

    let aiEnrichment: Record<string, unknown> | null = null;
    let aiEnrichmentAvailable = false;
    try {
      aiEnrichment = await this.aiProvider.generateJson(
        `Test case title: ${testCase.title}\nSteps:\n${stepsText}\nExpected result: ${testCase.expectedResult ?? 'n/a'}\nKnown application objects: ${objectNames.join(', ') || 'none'}${ragContext}`,
        {
          system:
            'You are a QA automation analyst. Given a test case and the list of known object-repository entries for the application, ' +
            'return JSON with keys: pageUsed (string), validations (string[] of validations this test case should check), ' +
            'missingTestData (string[] of data values the test case needs but does not specify), gaps (string[] of anything unclear or risky about automating this test case).',
        },
      );
      aiEnrichmentAvailable = true;
    } catch (err) {
      this.logger.warn(`AI enrichment unavailable for test case ${id}: ${(err as Error).message}`);
    }

    const automatable = deterministic.requiredObjects.length > 0 && deterministic.missingObjectMappings.length === 0;
    const readinessScore = automatable ? 1 : deterministic.requiredObjects.length > 0 ? 0.6 : 0.2;

    const analysisResult = {
      pageUsed: aiEnrichment?.pageUsed ?? null,
      requiredObjects: deterministic.requiredObjects,
      missingObjectMappings: deterministic.missingObjectMappings,
      requiredTestData: deterministic.requiredTestDataHints,
      missingTestData: aiEnrichment?.missingTestData ?? [],
      validations: aiEnrichment?.validations ?? [],
      gaps: aiEnrichment?.gaps ?? [],
      automatable,
      aiEnrichmentAvailable,
      ragContextUsed: rag.used,
    };

    return this.prisma.testCase.update({
      where: { id },
      data: {
        analysisResultJson: analysisResult,
        readinessScore,
        automationStatus: automatable ? 'MAPPED' : 'NOT_STARTED',
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
  }

  // Groups this test case's data-entry fields by screen (e.g. "Applicant
  // Details" / "Supervisor Details" / "Role") so Analyze can ask one
  // question per section instead of the flow generator having to guess
  // every value from scratch. Cross-referenced against whatever's already
  // saved so the UI can show "missing" vs. "already has a value".
  async getDataRequirements(id: string) {
    const testCase = await this.get(id);
    const objects = await this.prisma.objectRepository.findMany({ where: { applicationId: testCase.applicationId } });
    const stepsText = testCase.steps.map((s) => s.instruction).join('\n');
    const groups = buildDataRequirementGroups(stepsText, objects);

    const existingItems = await this.prisma.testDataItem.findMany({
      where: { testDataSet: { applicationId: testCase.applicationId } },
      select: { key: true, value: true },
    });
    const existingByKey = new Map(existingItems.map((i) => [i.key.trim().toLowerCase(), i.value]));

    return {
      groups: groups.map((group) => ({
        ...group,
        fields: group.fields.map((field) => ({
          ...field,
          existingValue: existingByKey.get(dataItemKeyFor(field.objectName, field.screenName).trim().toLowerCase()) ?? null,
        })),
      })),
    };
  }

  // Persists confirmed/edited field values as TestDataItems, keyed exactly
  // the way generateFromTestCase (automation-builder.service.ts) looks them
  // up when binding a step to test data — same "AI Generated" set, same
  // `${objectName} - ${screenName}` key — so a value saved here is picked up
  // automatically on the next flow generation instead of being re-guessed.
  async saveDataRequirements(id: string, values: DataRequirementValueDto[]) {
    const testCase = await this.get(id);
    const objects = await this.prisma.objectRepository.findMany({
      where: { applicationId: testCase.applicationId, id: { in: values.map((v) => v.objectId) } },
    });
    const objectById = new Map(objects.map((o) => [o.id, o]));

    const existingSet = await this.prisma.testDataSet.findFirst({
      where: { applicationId: testCase.applicationId, name: 'AI Generated' },
    });
    const set =
      existingSet ??
      (await this.prisma.testDataSet.create({
        data: {
          applicationId: testCase.applicationId,
          name: 'AI Generated',
          description: "Values TestPilot's AI proposed while drafting automation flows — reviewed and edited here as needed.",
        },
      }));

    const existingItems = await this.prisma.testDataItem.findMany({ where: { testDataSetId: set.id } });
    const itemIdByKey = new Map(existingItems.map((i) => [i.key.trim().toLowerCase(), i.id]));

    let saved = 0;
    for (const { objectId, value } of values) {
      const obj = objectById.get(objectId);
      if (!obj || !value.trim()) continue;
      const key = dataItemKeyFor(obj.objectName, obj.screenName);
      const lowerKey = key.trim().toLowerCase();
      const isSensitive = /pass(word)?|secret|token/i.test(key);
      const existingId = itemIdByKey.get(lowerKey);
      if (existingId) {
        await this.prisma.testDataItem.update({ where: { id: existingId }, data: { value, isSensitive } });
      } else {
        const created = await this.prisma.testDataItem.create({
          data: { testDataSetId: set.id, key, value, isSensitive, importedFrom: 'MANUAL' },
        });
        itemIdByKey.set(lowerKey, created.id);
      }
      saved++;
    }
    return { saved, testDataSetId: set.id };
  }

  // The "10% human touch" path: AI reads what the Scanner already discovered
  // (real objects — never invented UI) AND what the Knowledge Base already
  // knows about this application (requirements docs, business rules) and
  // proposes test cases from either or both. Knowledge Base content alone is
  // enough to generate test cases (they just won't automate until objects
  // exist to map them to) — a QA lead can start from a spec doc before the
  // Scanner ever runs. Each test case can optionally be auto-converted into
  // an automation flow in the same call, so a single click can go
  // scan/upload → test cases → flows.
  async generateWithAi(applicationId: string, dto: GenerateTestCasesDto) {
    return this.runGeneration(applicationId, dto);
  }

  // Kicks off generation as a trackable background job instead of one long
  // blocking HTTP request — a local model doing one call per test case (plus
  // a flow-generation attempt per item) genuinely takes minutes, and callers
  // had no way to show real progress or know whether it was still running
  // after the original request was gone. Poll via getGenerationJob(jobId).
  async startGenerationJob(applicationId: string, dto: GenerateTestCasesDto) {
    const count = Math.min(Math.max(dto.count ?? 5, 1), 20);
    const job = await this.prisma.testCaseGenerationJob.create({
      data: { applicationId, status: 'QUEUED', totalCount: count },
    });

    // Returns false once the job has been cancelled, so runGeneration's loops
    // can stop starting further AI calls instead of racing a "cancelled"
    // status update with the next call's own progress write (which would
    // otherwise silently flip it back to RUNNING).
    const onProgress = async (completed: number, currentStep: string) => {
      const current = await this.prisma.testCaseGenerationJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (current?.status === 'FAILED') return false;
      await this.prisma.testCaseGenerationJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', completedCount: completed, currentStep },
      });
      return true;
    };

    this.runGeneration(applicationId, dto, onProgress)
      .then(async (result) => {
        const current = await this.prisma.testCaseGenerationJob.findUnique({ where: { id: job.id }, select: { status: true } });
        if (current?.status === 'FAILED') return; // cancelled while the last call was in flight
        await this.prisma.testCaseGenerationJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', completedCount: result.created, resultJson: result as never, currentStep: null },
        });
      })
      .catch(async (err) => {
        const current = await this.prisma.testCaseGenerationJob.findUnique({ where: { id: job.id }, select: { status: true } });
        if (current?.status === 'FAILED') return; // already marked cancelled
        await this.prisma.testCaseGenerationJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: this.extractJobErrorMessage(err), currentStep: null },
        });
      });

    return job;
  }

  // HttpException.message is just the generic status phrase ("Conflict
  // Exception") when the exception was constructed with an object payload —
  // runGeneration's own ConflictExceptions carry the real explanation in
  // getResponse().reasons, which was otherwise silently discarded, leaving
  // the user with an unhelpful, non-actionable error in the job record.
  private extractJobErrorMessage(err: unknown): string {
    if (err instanceof HttpException) {
      const response = err.getResponse();
      if (response && typeof response === 'object') {
        const reasons = (response as { reasons?: unknown }).reasons;
        if (Array.isArray(reasons) && reasons.length > 0) return reasons.join(' ');
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.join(' ');
      }
    }
    return err instanceof Error ? err.message : String(err);
  }

  getGenerationJob(jobId: string) {
    return this.prisma.testCaseGenerationJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  // Doesn't interrupt whatever AI call is already in flight (the AI provider
  // interface has no cancellation signal today) — but guarantees no FURTHER
  // AI calls or DB writes happen for this job once cancelled, and the status
  // sticks instead of being overwritten by a late-arriving progress update.
  async cancelGenerationJob(jobId: string) {
    const result = await this.prisma.testCaseGenerationJob.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', errorMessage: 'Cancelled by user.', currentStep: null },
    });
    if (result.count === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This job is not running (already finished, failed, or cancelled).'],
        nextActions: [],
      });
    }
    return this.getGenerationJob(jobId);
  }

  // Source-aware generation via Codex CLI instead of the local model — every
  // source (Knowledge Base, a linked Jira story, existing Zephyr test cases,
  // scanned objects, a free-text user prompt) is independently optional and
  // combinable; none of them is required on its own. Reuses the exact same
  // TestCaseGenerationJob/onProgress polling mechanism as the local-AI path
  // above so the frontend's existing job-polling UI works for either.
  async startCodexGenerationJob(applicationId: string, dto: GenerateWithCodexDto, createdById?: string) {
    const count = Math.min(Math.max(dto.count ?? 6, 1), 20);
    const job = await this.prisma.testCaseGenerationJob.create({
      data: { applicationId, status: 'QUEUED', totalCount: count },
    });

    const onProgress = async (completed: number, currentStep: string) => {
      const current = await this.prisma.testCaseGenerationJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (current?.status === 'FAILED') return false;
      await this.prisma.testCaseGenerationJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', completedCount: completed, currentStep },
      });
      return true;
    };

    this.runCodexGeneration(applicationId, dto, job.id, createdById, onProgress)
      .then(async (result) => {
        const current = await this.prisma.testCaseGenerationJob.findUnique({ where: { id: job.id }, select: { status: true } });
        if (current?.status === 'FAILED') return;
        await this.prisma.testCaseGenerationJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', completedCount: result.created, resultJson: result as never, currentStep: null },
        });
      })
      .catch(async (err) => {
        const current = await this.prisma.testCaseGenerationJob.findUnique({ where: { id: job.id }, select: { status: true } });
        if (current?.status === 'FAILED') return;
        await this.prisma.testCaseGenerationJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: this.extractJobErrorMessage(err), currentStep: null },
        });
      });

    return job;
  }

  // Every prompt actually sent to Codex (and its raw response) for a given
  // job — the visibility this whole path exists to provide, not hidden
  // behind just a final result.
  getCodexGenerationPrompts(jobId: string) {
    return this.prisma.codexGenerationPrompt.findMany({
      where: { testCaseGenerationJobId: jobId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async runGeneration(
    applicationId: string,
    dto: GenerateTestCasesDto,
    // Returns false to signal "stop — this job was cancelled"; the two loops
    // below check it after each report and break rather than starting
    // another (slow) AI call.
    onProgress?: (completed: number, currentStep: string) => Promise<boolean | void>,
  ) {
    await onProgress?.(0, 'Analyzing existing test cases for this application…');
    await this.ensureExistingTestCasesKnowledgeBase(applicationId);

    const objects = await this.prisma.objectRepository.findMany({ where: { applicationId } });

    const knowledgeSummaries = await this.prisma.knowledgeSummary.findMany({
      where: { knowledgeSource: { applicationId, status: 'PROCESSED' } },
      include: { knowledgeSource: { select: { fileName: true } } },
    });

    if (objects.length === 0 && knowledgeSummaries.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['No scanned objects and no processed Knowledge Base documents for this application.'],
        nextActions: [
          'Run the Scanner against a live page, or upload a requirements document to the Knowledge Base, then generate test cases.',
        ],
      });
    }

    const existing = await this.prisma.testCase.findMany({
      where: { applicationId },
      select: { title: true },
    });

    // A well-populated Object Library (every button/field/label the scanner
    // found, across every screen) makes this prompt too large for the local
    // model to process quickly — confirmed in practice: a 112-object prompt
    // (7 screens) pushed Ollama's own token-generation rate down to ~1.5
    // tokens/sec and blew past a 10-minute timeout. Two cuts bring that down
    // a lot with no real loss of grounding: (1) tabs/nav controls repeat
    // identically on every screen (the same nav bar on every page), so list
    // them ONCE globally instead of once per screen; (2) cap how many other
    // objects are shown per screen, preferring named ones over blank/generic
    // ones, noting how many were omitted so the model knows more exist.
    const PER_SCREEN_OBJECT_CAP = 8;
    const uniqueTabObjects = [
      ...new Map(objects.filter((o) => /tab|nav/i.test(o.objectType)).map((o) => [o.objectName.trim().toLowerCase(), o])).values(),
    ];
    const tabsText =
      uniqueTabObjects.length > 0
        ? `Navigation available from every screen (tabs): ${uniqueTabObjects.map((o) => `"${o.objectName}"`).join(', ')}\n\n`
        : '';

    const screens = new Map<string, typeof objects>();
    for (const obj of objects) {
      if (/tab|nav/i.test(obj.objectType)) continue;
      const key = obj.screenName || 'Unspecified screen';
      screens.set(key, [...(screens.get(key) ?? []), obj]);
    }
    const objectsText =
      objects.length > 0
        ? tabsText +
          [...screens.entries()]
            .map(([screen, objs]) => {
              const named = objs.filter((o) => o.objectName?.trim());
              const unnamed = objs.filter((o) => !o.objectName?.trim());
              const shown = [...named, ...unnamed].slice(0, PER_SCREEN_OBJECT_CAP);
              const omitted = objs.length - shown.length;
              const lines = shown.map((o) => `  - "${o.objectName || '(unnamed)'}" (type: ${o.objectType})`).join('\n');
              return `Screen "${screen}":\n${lines}${omitted > 0 ? `\n  …and ${omitted} more object(s) on this screen not shown` : ''}`;
            })
            .join('\n\n')
        : 'none scanned yet';

    const count = Math.min(Math.max(dto.count ?? 5, 1), 20);

    // The model writes a plausible-looking step list but has repeatedly
    // proven unwilling to actually enumerate every item when the focus area
    // asks it to cover "all" of something (observed in practice: asked to
    // navigate all tabs on a 6-tab app, it wrote steps for only 3 and
    // stopped). Rather than trust it to notice how many there are on its
    // own, ground the requirement in the real, counted list when the focus
    // text implies exhaustive tab coverage.
    const wantsAllTabs = !!dto.focus && /\btab/i.test(dto.focus) && /\ball\b|\bevery\b|\beach\b/i.test(dto.focus);
    const tabCoverageText =
      wantsAllTabs && uniqueTabObjects.length > 1
        ? `\n\nThis application has exactly ${uniqueTabObjects.length} tabs/navigation elements: ${uniqueTabObjects
            .map((o) => `"${o.objectName}"`)
            .join(', ')}. Your steps array MUST include one navigation step per tab listed here — do not stop early or sample only a few.`
        : '';
    const focusText = dto.focus
      ? `\n\nFocus area requested by the user: ${dto.focus}${tabCoverageText}\n\nThe test case's title and steps MUST specifically address this focus area — do not substitute an easier or already-covered scenario just because it appears in the Knowledge Base or existing test cases below.`
      : '';

    // Structured summaries (modules/validations/gaps) come from the upload-time AI
    // extraction and need no embeddings, so they're always available once a
    // document finishes processing — semantic chunk retrieval below is a
    // second, richer layer on top when the embedding model is reachable.
    const summaryText =
      knowledgeSummaries.length > 0
        ? knowledgeSummaries
            .map(
              (s) =>
                `From "${s.knowledgeSource.fileName}":\n` +
                `  Modules/screens: ${((s.modules as string[] | null) ?? []).join(', ') || 'n/a'}\n` +
                `  Validations/business rules: ${((s.validations as string[] | null) ?? []).join(', ') || 'n/a'}`,
            )
            .join('\n\n')
        : null;

    const system =
      'You are a senior QA engineer. Propose ONE realistic, high-value manual test case for this application, using ' +
      'the discovered screens/objects and the Knowledge Base content below (whichever is available — you may rely on ' +
      'only one of them). When a step maps to a real object, only reference objects that are actually listed — never ' +
      'invent UI elements. When grounding a step in Knowledge Base content instead (no matching object yet), phrase it ' +
      "as a business-level action or validation from the documented requirement rather than inventing a UI element. " +
      'The knowledge base excerpts you are given are a semantic-search result and may include content from an ' +
      'unrelated module — if an excerpt does not actually match this test case\'s own title/module, ignore it rather ' +
      'than incorporating it, and never let the steps describe a different feature than the title says. ' +
      'Some Knowledge Base content comes from a source literally named "Existing Test Cases (auto-analyzed)" — this is ' +
      "a record of this application's OWN prior test cases, given to you only as a reference for writing style, " +
      'step-detail level, and structure. Never copy its scenario, steps, or wording into your answer — the test case ' +
      "you propose must cover a genuinely different scenario than anything already listed there, matching the focus " +
      'area requested below when one is given. ' +
      'Return ONLY a single JSON object (no array, no wrapper): { "title": string, "moduleName": string, ' +
      '"featureName": string, "priority": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "preconditions": string, ' +
      '"expectedResult": string, "steps": [{ "instruction": string, "expectedResult": string }] }.';

    // Asked for one test case per AI call rather than a JSON array of `count` —
    // a small local model reliably completes one bounded object but frequently
    // truncates mid-array when asked for several nested objects in one shot.
    // A small model also weights a "don't repeat these titles" list weakly, so
    // each call is additionally assigned a distinct testing angle to force
    // real variety instead of regenerating the same obvious happy-path case.
    const ANGLES = [
      'the primary happy path',
      'an invalid or negative input case',
      'a boundary or edge case (limits, timing, expiry)',
      'a security or access-control validation',
      'an alternate business rule not yet covered',
    ];
    const validTestCases: AiGeneratedTestCase[] = [];
    const titlesSoFar = existing.map((t) => t.title);
    let lastError: string | null = null;
    for (let i = 0; i < count; i++) {
      const shouldContinue = await onProgress?.(i, `Drafting test case ${i + 1} of ${count}…`);
      if (shouldContinue === false) break;
      const dedupeText =
        titlesSoFar.length > 0 ? `\n\nDo not duplicate these existing test cases:\n${titlesSoFar.map((t) => `- ${t}`).join('\n')}` : '';
      const angle = ANGLES[i % ANGLES.length];
      const angleText = `\n\nThis test case must specifically cover: ${angle}.`;

      // Retrieved per-angle (not once for the whole batch) — a single
      // shared retrieval reused across every iteration was handing later
      // iterations knowledge-base chunks about a completely different
      // module just because they scored closest to the overall focus text,
      // producing a test case whose title said one feature but whose steps
      // described another.
      const rag = await this.ragService.retrieveContext(applicationId, `${dto.focus ?? ''} ${angle}`.trim());
      const ragChunksText = rag.used ? `\n\nRelevant knowledge base excerpts:\n${rag.chunks.join('\n---\n')}` : '';
      const knowledgeContext = summaryText ? `\n\nKnowledge Base summary:\n${summaryText}${ragChunksText}` : ragChunksText;

      try {
        const tc = await this.aiProvider.generateJson<AiGeneratedTestCase>(
          `Discovered screens and objects for this application:\n${objectsText}${focusText}${dedupeText}${angleText}${knowledgeContext}`,
          { system },
        );
        const isDuplicate = tc.title && titlesSoFar.some((t) => normalizeForDedupe(t) === normalizeForDedupe(tc.title!));
        if (tc.title && Array.isArray(tc.steps) && tc.steps.length > 0 && !isDuplicate) {
          validTestCases.push(tc);
          titlesSoFar.push(tc.title);
        }
      } catch (err) {
        lastError = (err as Error).message;
        this.logger.warn(`AI test case ${i + 1}/${count} unavailable for application ${applicationId}: ${lastError}`);
      }
    }

    if (validTestCases.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [
          lastError
            ? `AI test case generation is unavailable right now: ${lastError}`
            : 'The AI did not return any usable test cases for this application.',
        ],
        nextActions: ['Try again, narrow the focus area, or create test cases manually.'],
      });
    }

    const created: Array<Awaited<ReturnType<typeof this.get>> & { flowGenerated?: boolean; flowError?: string }> = [];
    let savedCount = 0;
    for (const tc of validTestCases) {
      const shouldContinue = await onProgress?.(
        count,
        `Saving "${tc.title}"${dto.autoGenerateFlows ? ' and drafting its automation flow' : ''} (${savedCount + 1}/${validTestCases.length})…`,
      );
      if (shouldContinue === false) break;
      // `titlesSoFar` was seeded once at the start of this (possibly
      // long-running, AI-call-per-item) request — if another generation call
      // for this same application created a test case with the same title in
      // the meantime, that in-memory snapshot wouldn't know. Re-check against
      // the database right before the actual insert to close that window.
      const currentTitles = await this.prisma.testCase.findMany({ where: { applicationId }, select: { title: true } });
      const alreadyExists = currentTitles.some((t) => normalizeForDedupe(t.title) === normalizeForDedupe(tc.title!));
      if (alreadyExists) continue;

      const testCase = await this.prisma.testCase.create({
        data: {
          applicationId,
          title: tc.title!,
          moduleName: tc.moduleName || undefined,
          featureName: tc.featureName || undefined,
          priority: (VALID_PRIORITIES.has(tc.priority ?? '') ? tc.priority : 'MEDIUM') as never,
          preconditions: tc.preconditions || undefined,
          expectedResult: tc.expectedResult || undefined,
          source: 'AI_GENERATED',
          steps: {
            create: (tc.steps ?? [])
              .filter((s) => s.instruction)
              .map((s, index) => ({
                stepOrder: index + 1,
                instruction: s.instruction!,
                expectedResult: s.expectedResult || undefined,
              })),
          },
        },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });

      let flowGenerated = false;
      let flowError: string | undefined;
      if (dto.autoGenerateFlows) {
        try {
          await this.automationBuilderService.generateFromTestCase(applicationId, testCase.id);
          flowGenerated = true;
        } catch (err) {
          flowError = this.extractJobErrorMessage(err);
          this.logger.warn(`Auto flow generation skipped for AI-generated test case ${testCase.id}: ${flowError}`);
        }
      }

      created.push({ ...testCase, flowGenerated, flowError });
      savedCount++;
    }

    await onProgress?.(count, 'Done');
    return { created: created.length, testCases: created };
  }

  // Gathers whichever sources were actually selected/available, combines
  // them into ONE context block, then asks Codex for one test case at a time
  // (same call-per-item shape jira-codex-import.service.ts's generateTestCases
  // already proved out — a small local model isn't involved here, but one
  // call per item still keeps each generation individually inspectable/
  // retryable and avoids betting a whole batch on one large JSON array
  // completing without truncation). Every source is optional; the only hard
  // requirement is that at least one of them (or the user prompt) resolves
  // to something real.
  private async runCodexGeneration(
    applicationId: string,
    dto: GenerateWithCodexDto,
    jobId: string,
    createdById: string | undefined,
    onProgress?: (completed: number, currentStep: string) => Promise<boolean | void>,
  ) {
    await onProgress?.(0, 'Gathering context from selected sources…');

    const userPrompt = dto.userPrompt?.trim() || undefined;

    let jiraStory: { issueKey: string; rawContent: string; storyAnalysisJson: unknown } | null = null;
    if (dto.jiraStoryImportId) {
      const record = await this.prisma.jiraStoryImport.findUnique({ where: { id: dto.jiraStoryImportId } });
      if (!record || record.applicationId !== applicationId) {
        throw new NotFoundException(`Jira story import ${dto.jiraStoryImportId} not found for this application`);
      }
      jiraStory = record;
    }

    // Full chunk content, not a RAG-retrieved subset or just the AI-extracted
    // summary — the local-AI path caps/retrieves selectively because a small
    // local model degrades badly on a large prompt (see runGeneration's own
    // comment on this), but that tradeoff doesn't apply to Codex, and a
    // partial view risks the AI writing a step that maps to an object it was
    // never shown, or missing a validation rule that lived outside the
    // retrieved chunk. Sending everything trades prompt size for the
    // guarantee that nothing relevant was silently left out.
    const knowledgeChunks = dto.includeKnowledgeBase
      ? await this.prisma.knowledgeChunk.findMany({
          where: { knowledgeSource: { applicationId, status: 'PROCESSED' } },
          include: { knowledgeSource: { select: { fileName: true } } },
          orderBy: [{ knowledgeSourceId: 'asc' }, { chunkIndex: 'asc' }],
        })
      : [];

    const knowledgeSummaries = dto.includeKnowledgeBase
      ? await this.prisma.knowledgeSummary.findMany({
          where: { knowledgeSource: { applicationId, status: 'PROCESSED' } },
          include: { knowledgeSource: { select: { fileName: true } } },
        })
      : [];

    const zephyrCases = dto.includeZephyr
      ? await this.prisma.testCase.findMany({
          where: { applicationId, source: 'ZEPHYR_API' },
          select: { title: true, preconditions: true, expectedResult: true },
        })
      : [];

    const objects = await this.prisma.objectRepository.findMany({ where: { applicationId } });

    if (!userPrompt && !jiraStory && knowledgeChunks.length === 0 && zephyrCases.length === 0 && objects.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['No usable input for generation — write a prompt, select a Jira story, Knowledge Base, or Zephyr, or scan the application first.'],
        nextActions: ['Write a free-text prompt describing what to test, or select at least one other source.'],
      });
    }

    const screens = new Map<string, typeof objects>();
    for (const obj of objects) {
      const key = obj.screenName || 'Unspecified screen';
      screens.set(key, [...(screens.get(key) ?? []), obj]);
    }
    // Every object on every screen, uncapped — a Codex generation call is one
    // test case at a time already (not a whole batch riding on one huge
    // response), and the risk of a step referencing or missing an object
    // that was quietly capped out of the prompt outweighs the extra size.
    const objectsText =
      objects.length > 0
        ? [...screens.entries()]
            .map(([screen, objs]) => {
              const lines = objs.map((o) => `  - "${o.objectName || '(unnamed)'}" (type: ${o.objectType})`).join('\n');
              return `Screen "${screen}":\n${lines}`;
            })
            .join('\n\n')
        : 'none scanned yet';

    const jiraAnalysis = (jiraStory?.storyAnalysisJson ?? null) as StoryAnalysisShape | null;
    const jiraText = jiraStory
      ? `\n\nLinked Jira story ${jiraStory.issueKey}:\n${jiraStory.rawContent}` +
        (jiraAnalysis
          ? `\n\nAnalysis — impacted modules: ${(jiraAnalysis.impactedModules ?? []).join(', ') || 'n/a'}; ` +
            `risk areas: ${(jiraAnalysis.riskAreas ?? []).join(', ') || 'n/a'}.`
          : '')
      : '';

    const chunksBySource = new Map<string, { fileName: string; chunks: typeof knowledgeChunks }>();
    for (const chunk of knowledgeChunks) {
      const entry = chunksBySource.get(chunk.knowledgeSourceId) ?? { fileName: chunk.knowledgeSource.fileName, chunks: [] };
      entry.chunks.push(chunk);
      chunksBySource.set(chunk.knowledgeSourceId, entry);
    }
    const kbFullTextSection =
      chunksBySource.size > 0
        ? '\n\nKnowledge Base — full document content:\n' +
          [...chunksBySource.values()]
            .map((s) => `From "${s.fileName}":\n${s.chunks.map((c) => c.content).join('\n')}`)
            .join('\n\n---\n\n')
        : '';
    const kbSummarySection =
      knowledgeSummaries.length > 0
        ? '\n\nKnowledge Base — extracted summary (for quick reference, the full text above is authoritative):\n' +
          knowledgeSummaries
            .map(
              (s) =>
                `From "${s.knowledgeSource.fileName}":\n` +
                `  Modules/screens: ${((s.modules as string[] | null) ?? []).join(', ') || 'n/a'}\n` +
                `  Validations/business rules: ${((s.validations as string[] | null) ?? []).join(', ') || 'n/a'}`,
            )
            .join('\n\n')
        : '';
    const kbText = kbFullTextSection + kbSummarySection;

    const zephyrText =
      zephyrCases.length > 0
        ? '\n\nExisting Zephyr test cases already covering this application (reference for coverage — do not duplicate these scenarios):\n' +
          zephyrCases.map((tc) => `- ${tc.title}${tc.expectedResult ? `: ${tc.expectedResult}` : ''}`).join('\n')
        : '';

    const userInstructionsText = userPrompt
      ? `\n\nInstructions from the user (highest priority — the generated test cases MUST specifically address this, ` +
        `regardless of what the other sources above say):\n${userPrompt}`
      : '';

    const combinedContext = `Scanned screens/objects:\n${objectsText}${jiraText}${kbText}${zephyrText}${userInstructionsText}`;

    const system =
      'You are a senior QA engineer proposing ONE test case at a time from the combined context you are given — which ' +
      'may include a Jira story, Knowledge Base content, existing Zephyr test cases, scanned screens/objects, and a ' +
      "user-written instruction. Use whichever of these is actually present in the context; never invent a source " +
      "that isn't given to you. When a step maps to a real UI object, only reference objects that are actually " +
      'listed under "Scanned screens/objects" — never invent UI elements; when no matching object exists yet, phrase ' +
      'the step as a business-level action or validation instead. ' +
      'Return ONLY a single JSON object (no array, no wrapper): { "title": string, "moduleName": string, ' +
      '"featureName": string, "testType": "POSITIVE"|"NEGATIVE"|"BOUNDARY"|"UI"|"INTEGRATION"|"REGRESSION"|"SMOKE", ' +
      '"priority": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "preconditions": string, "expectedResult": string, ' +
      '"steps": [{ "instruction": string, "expectedResult": string }] }.';

    const existing = await this.prisma.testCase.findMany({ where: { applicationId }, select: { title: true } });
    const titlesSoFar = existing.map((t) => t.title);
    const count = Math.min(Math.max(dto.count ?? 6, 1), 20);

    const createdTestCaseIds: string[] = [];
    const createdTitles: string[] = [];
    let lastError: string | null = null;

    for (let i = 0; i < count; i++) {
      const shouldContinue = await onProgress?.(i, `Drafting test case ${i + 1} of ${count}…`);
      if (shouldContinue === false) break;

      const scope = GENERATION_SCOPES[i % GENERATION_SCOPES.length];
      const dedupeText =
        titlesSoFar.length > 0 ? `\n\nDo not duplicate these existing test cases:\n${titlesSoFar.map((t) => `- ${t}`).join('\n')}` : '';
      const userPromptForCall = `${combinedContext}${dedupeText}\n\nThis test case must be ${scope.instruction}`;

      const codexResult = await runCodexExec(system, userPromptForCall);

      let tc: AiGeneratedCodexTestCase | undefined;
      if (codexResult.succeeded) {
        try {
          tc = parseCodexJson<AiGeneratedCodexTestCase>(codexResult.content);
        } catch (err) {
          this.logger.warn(`Codex test case JSON parse failed (${scope.key}) for job ${jobId}: ${(err as Error).message}`);
        }
      } else {
        lastError = codexResult.errorMessage ?? null;
        this.logger.warn(`Codex test case call failed (${scope.key}) for job ${jobId}: ${lastError}`);
      }

      await this.prisma.codexGenerationPrompt.create({
        data: {
          testCaseGenerationJobId: jobId,
          stage: 'TEST_CASE',
          label: scope.key,
          systemPrompt: system,
          userPrompt: userPromptForCall,
          rawResponse: codexResult.content || codexResult.errorMessage || null,
          succeeded: !!tc?.title && Array.isArray(tc.steps) && tc.steps.length > 0,
        },
      });

      const isDuplicate = tc?.title && titlesSoFar.some((t) => normalizeForDedupe(t) === normalizeForDedupe(tc!.title!));
      if (tc?.title && Array.isArray(tc.steps) && tc.steps.length > 0 && !isDuplicate) {
        titlesSoFar.push(tc.title);
        const testCase = await this.prisma.testCase.create({
          data: {
            applicationId,
            externalId: jiraStory?.issueKey,
            title: tc.title,
            moduleName: tc.moduleName || undefined,
            featureName: tc.featureName || undefined,
            // Falls back to a real enum value, same reasoning as priority
            // just below — Codex returning something outside the allowed
            // set (confirmed in practice) previously fell through to
            // `undefined`, leaving testType silently NULL on the created
            // row instead of a usable value.
            testType: (VALID_TEST_TYPES.has(tc.testType ?? '') ? tc.testType : 'POSITIVE') as never,
            priority: (VALID_PRIORITIES.has(tc.priority ?? '') ? tc.priority : 'MEDIUM') as never,
            preconditions: tc.preconditions || undefined,
            expectedResult: tc.expectedResult || undefined,
            source: 'CODEX_AI_GENERATED',
            steps: {
              create: tc.steps
                .filter((s) => s.instruction)
                .map((s, index) => ({ stepOrder: index + 1, instruction: s.instruction!, expectedResult: s.expectedResult || undefined })),
            },
          },
        });
        createdTestCaseIds.push(testCase.id);
        createdTitles.push(testCase.title);
      }
    }

    if (createdTestCaseIds.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [lastError ? `Codex generation is unavailable right now: ${lastError}` : 'Codex did not return any usable test cases.'],
        nextActions: ['Try again, adjust the sources/prompt, or create test cases manually.'],
      });
    }

    // Chains straight through Automation Builder -> Script Generation ->
    // Script Review, stopping BEFORE execution — execution still requires a
    // separate, explicit manual trigger (the existing Run button/flow is the
    // approval gate; no new approval UI is introduced here).
    let automationSummary: Awaited<ReturnType<PipelineService['autoAutomate']>> | null = null;
    if (dto.chainAutomation) {
      await onProgress?.(count, 'Building automation flow, script, and review for each test case…');
      automationSummary = await this.pipelineService.autoAutomate(applicationId, createdTestCaseIds, createdById, {
        skipExecution: true,
        engine: 'CODEX',
      });
    }

    await onProgress?.(count, 'Done');
    return { created: createdTestCaseIds.length, testCaseIds: createdTestCaseIds, titles: createdTitles, automationSummary };
  }

  // Rule-based first, AI-assisted second: shared module/feature and shared
  // Object Library usage between automation flows are a much stronger, free
  // signal for "which other test cases does this change affect" than asking
  // a small local model to reason over the whole suite — the AI only adds a
  // risk label on top of a short, already-computed candidate list.
  async getRegressionRecommendation(testCaseId: string) {
    const target = await this.get(testCaseId);

    const targetFlow = await this.prisma.automationFlow.findFirst({
      where: { testCaseId },
      include: { steps: { select: { objectId: true } } },
    });
    const targetObjectIds = new Set(
      (targetFlow?.steps ?? []).map((s) => s.objectId).filter((id): id is string => !!id),
    );

    const otherTestCases = await this.prisma.testCase.findMany({
      where: { applicationId: target.applicationId, id: { not: testCaseId } },
    });

    // Filtered by applicationId + testCaseId != this one directly, not by
    // enumerating otherTestCases' ids into an IN(...) list — an application
    // with enough test cases can exceed SQLite's per-query bound-parameter
    // limit the same way a large Object Library did (see
    // AutomationBuilderService#refreshObjectUsageCounts's fix for the first,
    // confirmed occurrence of this).
    const candidateFlows = await this.prisma.automationFlow.findMany({
      where: { applicationId: target.applicationId, testCaseId: { not: testCaseId } },
      include: { steps: { select: { objectId: true } } },
    });
    const objectIdsByTestCase = new Map<string, Set<string>>();
    for (const flow of candidateFlows) {
      if (!flow.testCaseId) continue;
      objectIdsByTestCase.set(
        flow.testCaseId,
        new Set((flow.steps ?? []).map((s) => s.objectId).filter((id): id is string => !!id)),
      );
    }

    const scored = otherTestCases
      .map((tc) => {
        const sharedObjects = targetObjectIds.size
          ? [...(objectIdsByTestCase.get(tc.id) ?? [])].filter((id) => targetObjectIds.has(id)).length
          : 0;
        const moduleMatch = !!target.moduleName && tc.moduleName === target.moduleName;
        const featureMatch = !!target.featureName && tc.featureName === target.featureName;
        const score = sharedObjects * 2 + (moduleMatch ? 1 : 0) + (featureMatch ? 1 : 0);
        const baselineRisk = tc.priority === 'CRITICAL' || tc.priority === 'HIGH' ? 'HIGH' : tc.priority === 'MEDIUM' ? 'MEDIUM' : 'LOW';
        return { testCase: tc, sharedObjects, moduleMatch, featureMatch, score, riskLevel: baselineRisk as string, reason: moduleMatch ? `Same module (${tc.moduleName})` : featureMatch ? `Same feature (${tc.featureName})` : `Shares ${sharedObjects} automated object(s)` };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    if (scored.length === 0) {
      return { testCaseId, recommended: [] };
    }

    // AI risk relabeling is a best-effort enhancement over the deterministic
    // baseline above, capped to a small candidate slice — a compact bounded
    // JSON array, not a per-item call, since this is supplementary info, not
    // a blocking action.
    const aiCandidates = scored.slice(0, 8);
    try {
      const rag = await this.ragService.retrieveContext(
        target.applicationId,
        `${target.title}\n${target.expectedResult ?? ''}`,
      );
      const ragContext = rag.used ? `\n\nKnowledge base context:\n${rag.chunks.join('\n---\n')}` : '';
      const aiRiskList = await this.aiProvider.generateJson<{ testCaseId?: string; riskLevel?: string; reason?: string }[]>(
        `Changed test case: "${target.title}" (module: ${target.moduleName ?? 'n/a'}, expected result: ${target.expectedResult ?? 'n/a'})${ragContext}\n\n` +
          `Candidate regression test cases:\n${aiCandidates.map((c) => `- id "${c.testCase.id}": "${c.testCase.title}" (module: ${c.testCase.moduleName ?? 'n/a'})`).join('\n')}`,
        {
          system:
            'You are a QA lead prioritizing a regression suite. For each candidate test case, decide if it is HIGH risk ' +
            '(a business-critical validation likely broken by the change) or LOW risk (safe to deprioritize). Return ONLY ' +
            'a JSON array, one entry per candidate: { "testCaseId": string (must match the exact id given), ' +
            '"riskLevel": "HIGH"|"MEDIUM"|"LOW", "reason": string (one short sentence) }.',
        },
      );
      const byId = new Map((Array.isArray(aiRiskList) ? aiRiskList : []).map((r) => [r.testCaseId, r]));
      for (const candidate of aiCandidates) {
        const aiEntry = byId.get(candidate.testCase.id);
        if (aiEntry?.riskLevel) {
          candidate.riskLevel = aiEntry.riskLevel;
          candidate.reason = aiEntry.reason || candidate.reason;
        }
      }
    } catch (err) {
      this.logger.warn(`Regression risk AI enrichment unavailable: ${(err as Error).message}`);
    }

    return {
      testCaseId,
      recommended: scored.map((c) => ({
        testCaseId: c.testCase.id,
        title: c.testCase.title,
        moduleName: c.testCase.moduleName,
        priority: c.testCase.priority,
        sharedObjects: c.sharedObjects,
        riskLevel: c.riskLevel,
        reason: c.reason,
      })),
    };
  }
}
