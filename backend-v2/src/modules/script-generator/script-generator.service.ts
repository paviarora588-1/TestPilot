import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { RagService } from '../rag/rag.service';
import { advanceAutomationStatus } from '../../common/automation-status.util';
import { runCodexExecJson } from '../../common/codex-cli.util';
import { GoldenRulePolicyService } from '../../common/golden-rule-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { compileFlowToPlaywright } from './playwright-compiler';
import { compileFlowToSeleniumJava } from './selenium-java-compiler';
import { compileFlowToSapGui, type CompilerStep as SapCompilerStep } from './sap-gui-compiler';
import { compileFlowToSapGuiVbs } from './sap-gui-vbscript-compiler';
import { SapScriptLanguage } from './dto/generate-script.dto';

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'generated-scripts');

type Driver = 'WEB' | 'SAP_GUI';

interface FlowSegment<T> {
  driver: Driver;
  steps: T[];
}

// Splits a flow's ordered steps into contiguous runs by which driver can
// execute them — inferred purely from each step's bound object locator type,
// never from a manual per-flow toggle, so a flow that mixes objects scanned
// from a web app and a SAP GUI transaction "just works" without the user
// having to configure anything. Steps with no bound object (WAIT, OPEN_URL,
// ACCEPT_ALERT, API_CALL, ...) join whichever segment is already open rather
// than forcing a new one, defaulting to WEB if they're the very first step —
// EXCEPT SAP_*-prefixed step types (SAP_START_TRANSACTION, SAP_SEND_VKEY,
// ...), which are unambiguously SAP GUI actions by their own step type alone
// and never have (or need) a bound object. Without this exception, a flow
// that starts with SAP_START_TRANSACTION got a pointless WEB segment ahead
// of the real SAP GUI segment — a whole Playwright run that just opened
// about:blank and did nothing (confirmed in practice against a real
// generated script).
export function segmentSteps<T extends { object: { locatorStrategy: string } | null; stepType: string }>(
  steps: T[],
): FlowSegment<T>[] {
  const segments: FlowSegment<T>[] = [];
  for (const step of steps) {
    const forcedDriver: Driver | null = step.object
      ? null
      : step.stepType.startsWith('SAP_')
        ? 'SAP_GUI'
        : null;

    if (!step.object) {
      const last = segments[segments.length - 1];
      if (last && (!forcedDriver || last.driver === forcedDriver)) {
        last.steps.push(step);
      } else {
        segments.push({ driver: forcedDriver ?? 'WEB', steps: [step] });
      }
      continue;
    }
    const driver: Driver = step.object.locatorStrategy === 'SAP_GUI_ID' ? 'SAP_GUI' : 'WEB';
    const last = segments[segments.length - 1];
    if (last && last.driver === driver) {
      last.steps.push(step);
    } else {
      segments.push({ driver, steps: [step] });
    }
  }
  return segments;
}

@Injectable()
export class ScriptGeneratorService {
  private readonly logger = new Logger(ScriptGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly goldenRule: GoldenRulePolicyService,
    private readonly ragService: RagService,
  ) {}

  // sapScriptLanguage only affects segments that compile to SAP GUI — a
  // pure-web flow ignores it entirely. Defaults to VBScript: the literal
  // target most SAP customer environments expect (cscript is commonly
  // allowed where PowerShell execution policy is locked down); the existing
  // PowerShell compiler stays reachable via an explicit choice rather than
  // being replaced.
  async generateForFlow(flowId: string, sapScriptLanguage: SapScriptLanguage = SapScriptLanguage.VBSCRIPT) {
    const blockers = await this.goldenRule.checkFlowGenerationBlockers(flowId);
    if (blockers.blocked) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: blockers.reasons,
        nextActions: blockers.nextActions,
      });
    }

    const flow = await this.prisma.automationFlow.findUnique({
      where: { id: flowId },
      include: {
        steps: { orderBy: { stepOrder: 'asc' }, include: { object: true, testDataItem: true } },
        application: true,
      },
    });
    if (!flow) {
      throw new NotFoundException(`Automation flow ${flowId} not found`);
    }

    // Which driver each step needs is inferred from the objects it's bound to
    // (a SAP_GUI_ID-locator object means a SAP GUI action), not from
    // flow.framework alone — this is what lets one flow mix steps from a web
    // app and a SAP GUI transaction and still "just work".
    const webFramework: 'PLAYWRIGHT' | 'SELENIUM' = flow.framework === 'SELENIUM' ? 'SELENIUM' : 'PLAYWRIGHT';
    const entryUrl = flow.application.entryUrl;
    type FlowStep = (typeof flow.steps)[number];
    const segments = segmentSteps(flow.steps);
    const isHybrid = new Set(segments.map((s) => s.driver)).size > 1;

    function compileWebSegment(steps: FlowStep[], flowName: string) {
      return webFramework === 'SELENIUM'
        ? compileFlowToSeleniumJava({ flowName, applicationEntryUrl: entryUrl, steps })
        : compileFlowToPlaywright({ flowName, applicationEntryUrl: entryUrl, steps });
    }

    function compileSapSegment(steps: FlowStep[], flowName: string) {
      return sapScriptLanguage === SapScriptLanguage.POWERSHELL
        ? compileFlowToSapGui({ flowName, steps: steps as unknown as SapCompilerStep[] })
        : compileFlowToSapGuiVbs({ flowName, steps: steps as unknown as SapCompilerStep[] });
    }

    let framework: string;
    let files: { fileName: string; code: string; role: 'SPEC' | 'PAGE_OBJECT' | 'FIXTURE' | 'CONFIG' }[];
    let command: string;
    let hybridSegments: unknown = null;

    if (!isHybrid && segments[0]?.driver === 'SAP_GUI') {
      const compiled = compileSapSegment(flow.steps, flow.name);
      framework = 'SAP_VBSCRIPT';
      files = compiled.files;
      command = compiled.command;
    } else if (!isHybrid) {
      const compiled = compileWebSegment(flow.steps, flow.name);
      framework = webFramework;
      files = compiled.files;
      command = compiled.command;
    } else {
      // Hybrid: compile each contiguous segment with its own compiler. File
      // names are left exactly as each compiler produces them (renaming would
      // break Playwright's cross-file imports and Java's filename/class-name
      // coupling) — hybridSegments below records which files/command belong
      // to which segment so execution.service.ts knows what to write and run,
      // in order, for each leg of the flow.
      const segmentMeta: Array<{
        order: number;
        driver: Driver;
        framework: string;
        fileNames: string[];
        command: string;
        stepOrders: number[];
      }> = [];
      files = [];
      segments.forEach((segment, index) => {
        const segmentLabel = `${flow.name} (segment ${index + 1})`;
        const compiled =
          segment.driver === 'SAP_GUI' ? compileSapSegment(segment.steps, segmentLabel) : compileWebSegment(segment.steps, segmentLabel);
        const segFramework = segment.driver === 'SAP_GUI' ? 'SAP_VBSCRIPT' : webFramework;
        files.push(...compiled.files);
        segmentMeta.push({
          order: index + 1,
          driver: segment.driver,
          framework: segFramework,
          fileNames: compiled.files.map((f) => f.fileName),
          command: compiled.command,
          stepOrders: segment.steps.map((s) => s.stepOrder),
        });
      });
      framework = 'HYBRID';
      command = `${segments.length} segments: ${segmentMeta
        .map((s) => (s.driver === 'SAP_GUI' ? 'SAP GUI' : s.framework === 'SELENIUM' ? 'Selenium' : 'Playwright'))
        .join(' → ')}`;
      hybridSegments = segmentMeta;
    }

    return this.persistGeneratedScript(flow, framework, files, command, hybridSegments);
  }

  // Compiles the flow fresh in validate mode — never persisted as a
  // GeneratedScript, since it's not a script anyone reviews or keeps; it
  // exists only for execution.service.ts#validateScript to run once and
  // discard. No golden-rule blocker check here: a flow with an unbound step
  // just has that one step skipped (same "no equivalent, no result
  // recorded" treatment every compiler already gives a step it can't act
  // on) rather than the whole dry run being refused — the cheaper and more
  // permissive this is, the more useful it is as a pre-Execute sanity check.
  async compileFlowForValidation(flowId: string) {
    const flow = await this.prisma.automationFlow.findUnique({
      where: { id: flowId },
      include: {
        steps: { orderBy: { stepOrder: 'asc' }, include: { object: true, testDataItem: true } },
        application: true,
      },
    });
    if (!flow) {
      throw new NotFoundException(`Automation flow ${flowId} not found`);
    }

    const webFramework: 'PLAYWRIGHT' | 'SELENIUM' = flow.framework === 'SELENIUM' ? 'SELENIUM' : 'PLAYWRIGHT';
    const entryUrl = flow.application.entryUrl;
    type FlowStep = (typeof flow.steps)[number];
    const segments = segmentSteps(flow.steps);
    const isHybrid = new Set(segments.map((s) => s.driver)).size > 1;

    function compileWebSegment(steps: FlowStep[], flowName: string) {
      return webFramework === 'SELENIUM'
        ? compileFlowToSeleniumJava({ flowName, applicationEntryUrl: entryUrl, steps, mode: 'validate' })
        : compileFlowToPlaywright({ flowName, applicationEntryUrl: entryUrl, steps, mode: 'validate' });
    }
    function compileSapSegment(steps: FlowStep[], flowName: string) {
      return compileFlowToSapGuiVbs({ flowName, steps: steps as unknown as SapCompilerStep[], mode: 'validate' });
    }

    let framework: string;
    let files: { fileName: string; code: string; role: 'SPEC' | 'PAGE_OBJECT' | 'FIXTURE' | 'CONFIG' }[];
    let command: string;
    let hybridSegments: unknown = null;

    if (!isHybrid && segments[0]?.driver === 'SAP_GUI') {
      const compiled = compileSapSegment(flow.steps, flow.name);
      framework = 'SAP_VBSCRIPT';
      files = compiled.files;
      command = compiled.command;
    } else if (!isHybrid) {
      const compiled = compileWebSegment(flow.steps, flow.name);
      framework = webFramework;
      files = compiled.files;
      command = compiled.command;
    } else {
      const segmentMeta: Array<{
        order: number;
        driver: Driver;
        framework: string;
        fileNames: string[];
        command: string;
        stepOrders: number[];
      }> = [];
      files = [];
      segments.forEach((segment, index) => {
        const segmentLabel = `${flow.name} (segment ${index + 1})`;
        const compiled = segment.driver === 'SAP_GUI' ? compileSapSegment(segment.steps, segmentLabel) : compileWebSegment(segment.steps, segmentLabel);
        const segFramework = segment.driver === 'SAP_GUI' ? 'SAP_VBSCRIPT' : webFramework;
        files.push(...compiled.files);
        segmentMeta.push({
          order: index + 1,
          driver: segment.driver,
          framework: segFramework,
          fileNames: compiled.files.map((f) => f.fileName),
          command: compiled.command,
          stepOrders: segment.steps.map((s) => s.stepOrder),
        });
      });
      framework = 'HYBRID';
      command = `${segments.length} segments: ${segmentMeta
        .map((s) => (s.driver === 'SAP_GUI' ? 'SAP GUI' : s.framework === 'SELENIUM' ? 'Selenium' : 'Playwright'))
        .join(' → ')}`;
      hybridSegments = segmentMeta;
    }

    return {
      applicationId: flow.applicationId,
      testCaseId: flow.testCaseId,
      framework,
      files,
      command,
      hybridSegments,
    };
  }

  // Codex-powered alternative, opt-in — writes the actual SAP GUI step
  // logic itself (Session.findById/.Press/.Text/etc. per step) instead of
  // the fixed switch in sap-gui-vbscript-compiler.ts, so it can produce
  // something reasonable for a step/situation the deterministic switch has
  // no case for. Everything execution result-tracking depends on (the
  // pipe-delimited LogStep format, connection setup, exit codes) stays the
  // same proven scaffold regardless — only the per-step body lines are
  // Codex's own writing. Web segments (Playwright/Selenium's page-object
  // structure) aren't covered by this yet and still use the deterministic
  // compiler even in this path.
  async generateForFlowWithCodex(flowId: string) {
    const blockers = await this.goldenRule.checkFlowGenerationBlockers(flowId);
    if (blockers.blocked) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: blockers.reasons,
        nextActions: blockers.nextActions,
      });
    }

    const flow = await this.prisma.automationFlow.findUnique({
      where: { id: flowId },
      include: {
        steps: { orderBy: { stepOrder: 'asc' }, include: { object: true, testDataItem: true } },
        application: true,
      },
    });
    if (!flow) {
      throw new NotFoundException(`Automation flow ${flowId} not found`);
    }

    const webFramework: 'PLAYWRIGHT' | 'SELENIUM' = flow.framework === 'SELENIUM' ? 'SELENIUM' : 'PLAYWRIGHT';
    const entryUrl = flow.application.entryUrl;
    type FlowStep = (typeof flow.steps)[number];
    const segments = segmentSteps(flow.steps);
    const isHybrid = new Set(segments.map((s) => s.driver)).size > 1;

    const compileSapSegmentWithCodex = async (steps: FlowStep[], flowName: string) => {
      const sapSteps = steps as unknown as SapCompilerStep[];
      const stepBodyOverride = await this.codexSapGuiStepBodies(sapSteps);
      return compileFlowToSapGuiVbs({ flowName, steps: sapSteps, stepBodyOverride });
    };
    function compileWebSegment(steps: FlowStep[], flowName: string) {
      return webFramework === 'SELENIUM'
        ? compileFlowToSeleniumJava({ flowName, applicationEntryUrl: entryUrl, steps })
        : compileFlowToPlaywright({ flowName, applicationEntryUrl: entryUrl, steps });
    }

    let framework: string;
    let files: { fileName: string; code: string; role: 'SPEC' | 'PAGE_OBJECT' | 'FIXTURE' | 'CONFIG' }[];
    let command: string;
    let hybridSegments: unknown = null;

    if (!isHybrid && segments[0]?.driver === 'SAP_GUI') {
      const compiled = await compileSapSegmentWithCodex(flow.steps, flow.name);
      framework = 'SAP_VBSCRIPT';
      files = compiled.files;
      command = compiled.command;
    } else if (!isHybrid) {
      const compiled = compileWebSegment(flow.steps, flow.name);
      framework = webFramework;
      files = compiled.files;
      command = compiled.command;
    } else {
      const segmentMeta: Array<{
        order: number;
        driver: Driver;
        framework: string;
        fileNames: string[];
        command: string;
        stepOrders: number[];
      }> = [];
      files = [];
      for (const [index, segment] of segments.entries()) {
        const segmentLabel = `${flow.name} (segment ${index + 1})`;
        const compiled =
          segment.driver === 'SAP_GUI'
            ? await compileSapSegmentWithCodex(segment.steps, segmentLabel)
            : compileWebSegment(segment.steps, segmentLabel);
        const segFramework = segment.driver === 'SAP_GUI' ? 'SAP_VBSCRIPT' : webFramework;
        files.push(...compiled.files);
        segmentMeta.push({
          order: index + 1,
          driver: segment.driver,
          framework: segFramework,
          fileNames: compiled.files.map((f) => f.fileName),
          command: compiled.command,
          stepOrders: segment.steps.map((s) => s.stepOrder),
        });
      }
      framework = 'HYBRID';
      command = `${segments.length} segments: ${segmentMeta
        .map((s) => (s.driver === 'SAP_GUI' ? 'SAP GUI' : s.framework === 'SELENIUM' ? 'Selenium' : 'Playwright'))
        .join(' → ')}`;
      hybridSegments = segmentMeta;
    }

    return this.persistGeneratedScript(flow, framework, files, command, hybridSegments);
  }

  // Asks Codex for the actual VBScript body lines per step (Session.findById
  // + .Press/.Text/.Selected/sendVKey/StartTransaction/etc.), rather than
  // reusing the fixed switch in sap-gui-vbscript-compiler.ts. A step this
  // doesn't return an entry for is treated exactly like a deterministic
  // compileStepBody() returning null — "no SAP GUI equivalent for this step
  // type", skipped with no result recorded, not a failure.
  private async codexSapGuiStepBodies(steps: SapCompilerStep[]): Promise<Map<number, string[] | null>> {
    const system =
      'You are writing SAP GUI Scripting (VBScript) automation logic for individual test steps, to be inserted ' +
      "into an existing script scaffold — you are NOT writing the whole file, only each step's own action lines. " +
      'A "Session" object is already connected; use Session.findById("<the exact SAP GUI id given for that step>") ' +
      'to get the element (conventionally into a variable named obj), then call the right method for the step ' +
      '(.Press for buttons, .Select for tabs/menus, .Text = ... for text fields, .Selected = True/False for ' +
      'checkboxes, .sendVKey <code> on wnd[0] for function keys, Session.StartTransaction "..." for a transaction ' +
      'code, grid/table cell methods where relevant, or reading wnd[0]/sbar for status-bar checks). ' +
      'When a step has a value to use, wrap it as ResolvePlaceholders("<the literal value given for that step>") — ' +
      'that function already exists in the surrounding scaffold and resolves tokens like {{timestamp}}. ' +
      'Return ONLY a JSON object: { "steps": [{ "stepOrder": number, "lines": string[] }] } — one entry per step ' +
      "that has a real SAP GUI action; omit a step entirely if its step type genuinely has no SAP GUI equivalent " +
      '(e.g. a generic WAIT/API_CALL/OPEN_URL with nothing to do inside SAP GUI). Do not include error handling — ' +
      "the surrounding scaffold already wraps each step's lines in its own Err.Clear/LogStep check.";

    const stepsText = steps
      .map((s) => {
        const objText = s.object
          ? `bound to SAP GUI id "${s.object.technicalPath}" (name: "${s.object.objectName}", type: ${s.object.objectType})`
          : 'no bound object';
        const value = s.testDataItem?.value ?? s.inlineValue;
        return `Step ${s.stepOrder}: ${s.stepType} — ${objText}${value ? `, value: "${value}"` : ''}`;
      })
      .join('\n');

    let result: { steps?: { stepOrder?: number; lines?: string[] }[] };
    try {
      result = await runCodexExecJson<{ steps?: { stepOrder?: number; lines?: string[] }[] }>(system, stepsText);
    } catch (err) {
      this.logger.warn(`Codex SAP GUI script generation unavailable: ${(err as Error).message}`);
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Codex script generation is unavailable right now: ${(err as Error).message}`],
        nextActions: ['Try again, or generate the script with the deterministic compiler instead.'],
      });
    }

    const map = new Map<number, string[] | null>();
    for (const s of result.steps ?? []) {
      if (typeof s.stepOrder === 'number' && Array.isArray(s.lines) && s.lines.length > 0) {
        map.set(s.stepOrder, s.lines.filter((l): l is string => typeof l === 'string'));
      }
    }
    if (map.size === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['Codex did not return any usable step logic for this flow.'],
        nextActions: ['Try again, or generate the script with the deterministic compiler instead.'],
      });
    }
    return map;
  }

  private async persistGeneratedScript(
    flow: { id: string; applicationId: string; testCaseId: string | null },
    framework: string,
    files: { fileName: string; code: string; role: 'SPEC' | 'PAGE_OBJECT' | 'FIXTURE' | 'CONFIG' }[],
    command: string,
    hybridSegments: unknown,
  ) {
    const scriptDir = path.join(STORAGE_ROOT, flow.id, randomUUID());
    await fs.mkdir(scriptDir, { recursive: true });

    const generatedScript = await this.prisma.generatedScript.create({
      data: {
        applicationId: flow.applicationId,
        automationFlowId: flow.id,
        testCaseId: flow.testCaseId,
        framework: framework as never,
        command,
        hybridSegments: hybridSegments as never,
        status: 'GENERATED',
      },
    });

    for (const file of files) {
      const filePath = path.join(scriptDir, file.fileName);
      await fs.writeFile(filePath, file.code, 'utf-8');
      await this.prisma.generatedScriptFile.create({
        data: {
          generatedScriptId: generatedScript.id,
          role: file.role,
          fileName: file.fileName,
          filePath,
          code: file.code,
        },
      });
    }

    await this.prisma.automationFlow.update({ where: { id: flow.id }, data: { status: 'GENERATED' } });
    await advanceAutomationStatus(this.prisma, flow.testCaseId, 'SCRIPT_GENERATED');

    // Best-effort AI review — same honest-degradation pattern as the Phase 2
    // test case analysis: never blocks on AI, records aiReviewAvailable:false
    // rather than faking output when no local/cloud model is reachable.
    this.reviewScript(generatedScript.id).catch((err) => {
      this.logger.warn(`AI review failed for script ${generatedScript.id}: ${(err as Error).message}`);
    });

    return this.getScript(generatedScript.id);
  }

  async getScript(id: string) {
    const script = await this.prisma.generatedScript.findUnique({
      where: { id },
      include: { files: true },
    });
    if (!script) {
      throw new NotFoundException(`Generated script ${id} not found`);
    }
    return script;
  }

  listForFlow(flowId: string) {
    return this.prisma.generatedScript.findMany({
      where: { automationFlowId: flowId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewScript(id: string) {
    const script = await this.getScript(id);
    const combinedCode = script.files.map((f) => `// ${f.fileName}\n${f.code}`).join('\n\n');

    const rag = await this.ragService.retrieveContext(script.applicationId, combinedCode.slice(0, 500));
    const ragContext = rag.used
      ? `\n\nRelevant knowledge base context (product rules/validations to check the code against):\n${rag.chunks.join('\n---\n')}`
      : '';

    const frameworkLabel = script.framework === 'SELENIUM' ? 'Selenium WebDriver (Java, JUnit 5)' : 'Playwright (TypeScript)';
    const reviewSystem =
      `You are a senior SDET reviewing generated ${frameworkLabel} code. Score EXECUTION SAFETY ONLY — riskScore ` +
      '(0-1, higher is riskier) and findings must be about whether running this code could be harmful or ' +
      'unstable: destructive actions (delete/drop/purge), hardcoded real credentials or secrets, unbounded ' +
      'loops/waits, missing waits that make it flaky, or similarly dangerous patterns. A script that is simply ' +
      'narrow in scope, or does not test every scenario a broader test plan might want, is NOT risky — that ' +
      'goes in coverageSuggestions instead, which never affects the score. Return JSON with keys: ' +
      'riskScore, findings (string[], execution-safety issues only, empty array if none), ' +
      'coverageSuggestions (string[], optional test-scenario gaps — informational only, does not affect riskScore).';
    // 6000 was sized for the local model this call used to run on; Codex
    // handles far more context comfortably, and the old limit was cutting
    // real scripts off mid-statement (confirmed: a 13,453-char real script
    // got truncated at 6000, and Codex correctly flagged the truncation
    // itself as a "finding" — a false alarm about the review process, not
    // the actual script). 40,000 gives generous headroom over that real
    // example without being unbounded.
    const reviewUserPrompt = `Review this generated ${frameworkLabel} test automation code:\n\n${combinedCode.slice(0, 40_000)}${ragContext}`;

    try {
      // Codex, not the local provider — confirmed in practice that the
      // local model's own `approved` boolean was internally inconsistent
      // with its own `findings`/`riskScore` (approved:false alongside an
      // empty findings array and riskScore:0, on every review checked, not
      // occasionally) — a real bug that silently blocked every script from
      // executing via GoldenRulePolicyService's requireAiReviewPass check,
      // regardless of actual risk. `approved` itself is no longer asked for
      // or trusted from the model at all below — it's derived deterministically
      // from findings.length, which the model doesn't need judgment to get
      // right and can't make inconsistent with its own findings anymore.
      const review = await runCodexExecJson<{
        riskScore?: number;
        findings?: string[];
        coverageSuggestions?: string[];
      }>(reviewSystem, reviewUserPrompt);

      const findings = review.findings ?? [];
      const approved = findings.length === 0;
      await this.prisma.generatedScript.update({
        where: { id },
        data: {
          reviewJson: { ...review, findings, approved, aiReviewAvailable: true, ragContextUsed: rag.used, reviewedBy: 'codex' },
          riskScore: review.riskScore ?? null,
          status: 'REVIEWED',
        },
      });
    } catch (err) {
      await this.prisma.generatedScript.update({
        where: { id },
        data: { reviewJson: { aiReviewAvailable: false, reason: (err as Error).message } },
      });
    }

    return this.getScript(id);
  }
}
