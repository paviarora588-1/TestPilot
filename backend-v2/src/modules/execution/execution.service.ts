import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { advanceAutomationStatus } from '../../common/automation-status.util';
import { GoldenRulePolicyService } from '../../common/golden-rule-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';
import { RagService } from '../rag/rag.service';
import { BugReportsService } from '../bug-reports/bug-reports.service';
import { ScriptGeneratorService } from '../script-generator/script-generator.service';
import {
  analyzePlaywrightFailure,
  analyzeSapGuiFailure,
  analyzeSeleniumFailure,
  CONFIDENT_DETERMINISTIC_CATEGORIES,
  type DeterministicFailureAnalysis,
} from './failure-analysis.util';
import { verifyLocatorLive } from './locator-health.util';
import { runPlaywrightSpec, type PlaywrightStepResult } from './playwright-runner';
import { runSapGuiSpec, runSapGuiVbsSpec } from './sap-gui-runner';
import { runSeleniumSpec } from './selenium-runner';

// Caps how many objects one nightly quality-watch run checks per
// application — bounded the same way ai-engineering's scheduled scan bounds
// itself, for the same reason: this must never be the thing that floods a
// review queue or hammers a fragile local dev database with an unbounded
// sequential loop.
const DEFAULT_QUALITY_WATCH_MAX_OBJECTS = 25;

// Which SAP GUI runner to use is inferred from the generated spec file's own
// extension, not a schema field — .vbs came from sap-gui-vbscript-compiler.ts
// and needs cscript.exe, .ps1 came from sap-gui-compiler.ts and needs
// powershell.exe. Keeps GeneratedScript.framework as the single 'SAP_VBSCRIPT'
// value it already is for both, and needs no migration.
function pickSapGuiRunner(fileName: string) {
  return fileName.toLowerCase().endsWith('.vbs') ? runSapGuiVbsSpec : runSapGuiSpec;
}

const PROJECT_DIR = path.join(process.cwd(), 'runner', 'playwright_project');
const SELENIUM_PROJECT_DIR = path.join(process.cwd(), 'runner', 'selenium_project');
const SAP_GUI_PROJECT_DIR = path.join(process.cwd(), 'runner', 'sap_gui_project');
const EVIDENCE_ROOT = path.join(process.cwd(), 'storage', 'executions');
// Comfortable for the local demo app (localhost, no external network), but a
// real external site's page loads/searches can genuinely take longer than
// 90s end-to-end — confirmed on a run whose screenshots proved every step
// had actually completed successfully, yet still got force-killed by this
// timeout before Playwright could report that result.
//
// Must stay comfortably above playwright_project/playwright.config.ts's own
// internal `timeout` (currently 240s) — this is an OUTER hard-kill of the
// whole process tree, so if it's shorter than Playwright's own timeout, it
// always wins first, and every failure of this kind looks like a generic
// "Execution timed out" with every step SKIPPED, instead of Playwright's own
// specific step-level error. Confirmed live: after raising the inner config
// to 240s but not this one, a real run against a slow SAP dashboard got
// killed by THIS timeout at 150s with zero steps reported, even though the
// inner timeout (had it been reached) would have named the exact stuck step.
const EXECUTION_TIMEOUT_MS = 270_000;
const SELENIUM_TIMEOUT_MS = 180_000; // Maven's own JVM/dependency-resolution startup is slower than Playwright's.
const SAP_GUI_TIMEOUT_MS = 60_000;
// Every per-framework timeout above already bounds the child process itself
// (playwright-runner.ts/selenium-runner.ts/sap-gui-runner.ts kill their own
// spawned process on it) — this is a SEPARATE, outer backstop for whatever
// isn't the child process itself: a stuck Node-side promise that never
// resolves even after the process it's waiting on has exited (a real,
// reproduced failure mode on this platform), a hang in step-result
// bookkeeping, etc. Without this, a run stuck in ANY of that has no way to
// ever leave "RUNNING" — the fire-and-forget .catch() below only logs, it
// never touches the database.
const WATCHDOG_GRACE_MS = 45_000;

type ScriptWithFlow = Awaited<ReturnType<ExecutionService['loadScriptWithFlow']>>;

function watchdogMaxMs(framework: string): number {
  switch (framework) {
    case 'SELENIUM':
      return SELENIUM_TIMEOUT_MS + WATCHDOG_GRACE_MS;
    case 'SAP_VBSCRIPT':
    case 'HYBRID':
      return SAP_GUI_TIMEOUT_MS + WATCHDOG_GRACE_MS;
    default:
      return EXECUTION_TIMEOUT_MS + WATCHDOG_GRACE_MS;
  }
}

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  // A single global lock, same reasoning as the legacy app: the scratch
  // Playwright project's tests/ dir isn't per-run isolated, so only one
  // execution may actually run the `npx playwright test` process at a time.
  private runLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly goldenRule: GoldenRulePolicyService,
    private readonly ragService: RagService,
    private readonly bugReportsService: BugReportsService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
    private readonly scriptGenerator: ScriptGeneratorService,
  ) {}

  // Auto-drafts a bug report the instant a failure is categorized as a real
  // application defect — same DRAFT-only behavior as the existing manual
  // "Report Bug" button (bug-reports.service.ts's separate, approval-gated
  // submit() remains the only path that ever reaches Jira). Skipped if a
  // bug report already exists for this run, since a user may have already
  // clicked "Report Bug" manually before this ran.
  private async maybeAutoDraftBug(
    runId: string,
    status: 'COMPLETED' | 'FAILED',
    failureAnalysisJson: Record<string, unknown> | null | undefined,
  ) {
    if (status !== 'FAILED' || failureAnalysisJson?.category !== 'application_bug') return;
    try {
      const existing = await this.prisma.bugReport.findFirst({ where: { executionId: runId } });
      if (existing) return;
      await this.bugReportsService.generateFromExecution(runId);
    } catch (err) {
      this.logger.warn(`Auto bug-draft failed for run ${runId}: ${(err as Error).message}`);
    }
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.runLock.then(fn, fn);
    this.runLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // Guarantees a run can never stay "RUNNING" forever no matter what hangs
  // downstream — every framework-level timeout only bounds its own spawned
  // child process; this bounds the whole async operation, including any
  // Node-side promise that never settles even after that process exited.
  private async withWatchdog(runId: string, work: Promise<void>, maxMs: number): Promise<void> {
    let timedOut = false;
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, maxMs);
    });
    await Promise.race([work, timeout]);
    if (!timedOut) return;

    const current = await this.prisma.executionRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (current?.status !== 'RUNNING') return; // the real work actually finished right as the watchdog fired
    this.logger.error(`Execution ${runId} exceeded ${maxMs}ms and was force-stopped by the watchdog.`);
    await this.prisma.executionRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        logs: [`Execution exceeded the maximum allowed time (${Math.round(maxMs / 1000)}s) and was force-stopped.`],
      },
    });
    await this.prisma.executionStepResult.updateMany({
      where: { executionId: runId, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'SKIPPED' },
    });
  }

  private async loadScriptWithFlow(scriptId: string) {
    const script = await this.prisma.generatedScript.findUnique({
      where: { id: scriptId },
      include: {
        files: true,
        automationFlow: {
          include: { steps: { orderBy: { stepOrder: 'asc' }, include: { object: true } } },
        },
      },
    });
    if (!script) {
      throw new NotFoundException(`Generated script ${scriptId} not found`);
    }
    return script;
  }

  async listForApplication(applicationId: string) {
    return this.prisma.executionRun.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      include: {
        script: { select: { framework: true, automationFlow: { select: { name: true } } } },
      },
    });
  }

  async getRun(id: string) {
    const run = await this.prisma.executionRun.findUnique({
      where: { id },
      include: {
        stepResults: { orderBy: { stepOrder: 'asc' } },
        autoHealSuggestions: true,
        script: { select: { framework: true, automationFlow: { select: { name: true } } } },
      },
    });
    if (!run) {
      throw new NotFoundException(`Execution run ${id} not found`);
    }
    return run;
  }

  async removeRun(id: string) {
    const run = await this.getRun(id);
    if (run.status === 'RUNNING') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This execution is still running.'],
        nextActions: ['Wait for it to finish (or time out) before deleting it.'],
      });
    }
    // Step results cascade; auto-heal suggestions and bug reports pointing at
    // this run just lose that back-reference (both relations are optional).
    await this.prisma.executionRun.delete({ where: { id } });
    return { success: true };
  }

  async listSuites(applicationId: string) {
    return this.prisma.executionSuiteRun.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSuite(id: string) {
    const suite = await this.prisma.executionSuiteRun.findUnique({
      where: { id },
      include: {
        runs: {
          include: {
            stepResults: true,
            script: { select: { framework: true, automationFlow: { select: { name: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!suite) {
      throw new NotFoundException(`Execution suite ${id} not found`);
    }
    return suite;
  }

  async executeScript(scriptId: string, executedById?: string) {
    const blockers = await this.goldenRule.checkScriptExecutionBlockers(scriptId);
    if (blockers.blocked) {
      throw new ConflictException({ statusCode: 409, ...blockers });
    }

    const script = await this.loadScriptWithFlow(scriptId);
    const run = await this.prisma.executionRun.create({
      data: {
        applicationId: script.applicationId,
        scriptId: script.id,
        status: 'RUNNING',
        command: script.command,
        browser: 'chromium',
        environment: 'local',
        executedById,
      },
    });

    await this.createStepResultRows(run.id, script);

    // Fire-and-forget: caller polls GET /executions/:id, same pattern as the Scanner.
    // Wrapped in a watchdog so a hang anywhere in the chain still resolves
    // to a terminal status instead of leaving the run at RUNNING forever.
    this.withWatchdog(run.id, this.withLock(() => this.runLocked(run.id, script)), watchdogMaxMs(script.framework)).catch(
      (err) => {
        this.logger.error(`Execution ${run.id} crashed`, err);
      },
    );

    return run;
  }

  // The pre-flight "Validate" pass — locates every bound object without
  // clicking/typing/submitting anything (see playwright-compiler.ts's
  // 'validate' mode), so a stale Object Library entry is caught before
  // Execute ever runs a real, potentially data-mutating script. Compiles
  // fresh every time rather than reusing script.files (those are the real,
  // reviewed script) and is never persisted as a GeneratedScript — only the
  // resulting ExecutionRun (tagged VALIDATION) sticks around, through the
  // exact same runner code a real execution uses.
  async validateScript(scriptId: string) {
    const script = await this.loadScriptWithFlow(scriptId);
    if (!script.automationFlowId) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This script has no linked Automation Flow to validate.'],
        nextActions: [],
      });
    }

    const compiled = await this.scriptGenerator.compileFlowForValidation(script.automationFlowId);
    const validationScript: ScriptWithFlow = {
      ...script,
      framework: compiled.framework as never,
      command: compiled.command,
      files: compiled.files as never,
      hybridSegments: compiled.hybridSegments as never,
    };

    const run = await this.prisma.executionRun.create({
      data: {
        applicationId: script.applicationId,
        scriptId: script.id,
        runType: 'VALIDATION',
        status: 'RUNNING',
        command: compiled.command,
        browser: 'chromium',
        environment: 'local',
      },
    });

    await this.createStepResultRows(run.id, script);

    this.withWatchdog(run.id, this.withLock(() => this.runLocked(run.id, validationScript, true)), watchdogMaxMs(compiled.framework)).catch(
      (err) => {
        this.logger.error(`Validation ${run.id} crashed`, err);
      },
    );

    return run;
  }

  async retryRun(runId: string) {
    // Claim the FAILED/BLOCKED -> RUNNING transition atomically so two
    // concurrent retry calls for the same run can't both pass a
    // read-then-write check and race on deleting/recreating step rows.
    const claimed = await this.prisma.executionRun.updateMany({
      where: { id: runId, status: { in: ['FAILED', 'BLOCKED'] } },
      data: {
        status: 'RUNNING',
        logs: [],
        failureAnalysisJson: null as never,
        evidencePath: null,
        attemptNumber: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      const existing = await this.getRun(runId);
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Execution is currently ${existing.status}, not FAILED/BLOCKED, or a retry is already in progress.`],
        nextActions: [],
      });
    }

    const existing = await this.getRun(runId);
    const blockers = await this.goldenRule.checkScriptExecutionBlockers(existing.scriptId);
    if (blockers.blocked) {
      await this.prisma.executionRun.update({ where: { id: runId }, data: { status: 'BLOCKED' } });
      throw new ConflictException({ statusCode: 409, ...blockers });
    }

    const script = await this.loadScriptWithFlow(existing.scriptId);
    await this.prisma.executionStepResult.deleteMany({ where: { executionId: runId } });
    await this.createStepResultRows(runId, script);

    this.withWatchdog(runId, this.withLock(() => this.runLocked(runId, script)), watchdogMaxMs(script.framework)).catch(
      (err) => {
        this.logger.error(`Execution ${runId} crashed`, err);
      },
    );

    return this.getRun(runId);
  }

  async runSuite(applicationId: string, scope: 'SINGLE' | 'SELECTED' | 'MODULE' | 'FULL_REGRESSION', scriptIds: string[], triggeredById?: string) {
    const suite = await this.prisma.executionSuiteRun.create({
      data: {
        applicationId,
        scope,
        status: 'RUNNING',
        totalCount: scriptIds.length,
        triggeredById,
        startedAt: new Date(),
      },
    });

    // Ceiling scales with how many scripts are queued — a per-script
    // watchdog inside runSuiteLocked already keeps one hung script from
    // stalling the rest, this is the outer backstop for the suite as a whole.
    const suiteMaxMs = Math.max(EXECUTION_TIMEOUT_MS, scriptIds.length * (EXECUTION_TIMEOUT_MS + WATCHDOG_GRACE_MS));
    this.withSuiteWatchdog(suite.id, this.runSuiteLocked(suite.id, scriptIds, triggeredById), suiteMaxMs).catch((err) => {
      this.logger.error(`Suite ${suite.id} crashed`, err);
    });

    return suite;
  }

  private async withSuiteWatchdog(suiteId: string, work: Promise<void>, maxMs: number): Promise<void> {
    let timedOut = false;
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, maxMs);
    });
    await Promise.race([work, timeout]);
    if (!timedOut) return;

    const current = await this.prisma.executionSuiteRun.findUnique({ where: { id: suiteId }, select: { status: true } });
    if (current?.status !== 'RUNNING') return;
    this.logger.error(`Suite ${suiteId} exceeded ${maxMs}ms and was force-stopped by the watchdog.`);
    await this.prisma.executionSuiteRun.update({
      where: { id: suiteId },
      data: { status: 'FAILED', finishedAt: new Date() },
    });
    await this.prisma.executionRun.updateMany({
      where: { suiteRunId: suiteId, status: 'RUNNING' },
      data: { status: 'FAILED', logs: ['Suite exceeded its maximum allowed time and was force-stopped.'] },
    });
  }

  private async createStepResultRows(executionId: string, script: ScriptWithFlow) {
    const steps = script.automationFlow?.steps ?? [];
    for (const step of steps) {
      await this.prisma.executionStepResult.create({
        data: {
          executionId,
          stepOrder: step.stepOrder,
          action: step.stepType,
          instruction: step.object?.objectName ?? step.inlineValue ?? undefined,
          status: 'PENDING',
        },
      });
    }
  }

  private async runSuiteLocked(suiteId: string, scriptIds: string[], triggeredById?: string) {
    let pass = 0;
    let fail = 0;
    let skip = 0;
    let error = 0;

    for (const scriptId of scriptIds) {
      try {
        const blockers = await this.goldenRule.checkScriptExecutionBlockers(scriptId);
        if (blockers.blocked) {
          skip++;
          continue;
        }
        const script = await this.loadScriptWithFlow(scriptId);
        const run = await this.prisma.executionRun.create({
          data: {
            applicationId: script.applicationId,
            scriptId,
            suiteRunId: suiteId,
            status: 'RUNNING',
            command: script.command,
            browser: 'chromium',
            environment: 'local',
            executedById: triggeredById,
          },
        });
        await this.createStepResultRows(run.id, script);
        // Suite runs execute sequentially anyway (shared scratch project), so
        // await inline here rather than fire-and-forget per script — this IS
        // what makes "continue after failure" real: the loop always proceeds
        // to the next scriptId regardless of this one's outcome. Watchdog-
        // wrapped so one script hanging can't stall every script after it.
        await this.withWatchdog(run.id, this.withLock(() => this.runLocked(run.id, script)), watchdogMaxMs(script.framework));
        const finished = await this.prisma.executionRun.findUnique({ where: { id: run.id } });
        if (finished?.status === 'COMPLETED') pass++;
        else fail++;
      } catch (err) {
        error++;
        this.logger.error(`Suite ${suiteId} script ${scriptId} crashed`, err);
      }
    }

    await this.prisma.executionSuiteRun.update({
      where: { id: suiteId },
      data: {
        status: 'COMPLETED',
        passCount: pass,
        failCount: fail,
        skipCount: skip,
        errorCount: error,
        finishedAt: new Date(),
      },
    });
  }

  // isValidation: true for a Validate dry run — same runner, same compiled-
  // input shape, but it must never advance a test case's automation status
  // or auto-draft a bug report the way a real execution result does.
  private async runLocked(runId: string, script: ScriptWithFlow, isValidation = false) {
    if (script.framework === 'HYBRID') {
      return this.runHybridLocked(runId, script, isValidation);
    }
    if (script.framework === 'SAP_VBSCRIPT') {
      return this.runSapGuiLocked(runId, script, isValidation);
    }
    if (script.framework === 'SELENIUM') {
      return this.runSeleniumLocked(runId, script, isValidation);
    }
    return this.runPlaywrightLocked(runId, script, isValidation);
  }

  private async runPlaywrightLocked(runId: string, script: ScriptWithFlow, isValidation = false) {
    const testsDir = path.join(PROJECT_DIR, 'tests');
    await fs.mkdir(testsDir, { recursive: true });
    for (const file of script.files) {
      await fs.writeFile(path.join(testsDir, file.fileName), file.code, 'utf-8');
    }
    const specFile = script.files.find((f) => f.role === 'SPEC');
    if (!specFile) {
      await this.prisma.executionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', logs: ['No spec file found for this script.'] },
      });
      return;
    }

    const startedAt = Date.now();
    const result = await runPlaywrightSpec({
      projectDir: PROJECT_DIR,
      specFileName: specFile.fileName,
      timeoutMs: EXECUTION_TIMEOUT_MS,
    }).catch((err: Error) => {
      this.logger.error(`Playwright process failed for run ${runId}`, err);
      return null;
    });
    const durationSeconds = (Date.now() - startedAt) / 1000;

    if (!result) {
      await this.prisma.executionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', durationSeconds, logs: ['Runner process failed to start.'] },
      });
      return;
    }

    const logs = [
      ...result.stdout.split('\n').filter(Boolean),
      ...result.stderr.split('\n').filter(Boolean).map((l) => `STDERR: ${l}`),
      ...(result.timedOut ? [`Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds`] : []),
    ];

    let evidencePath: string | undefined;
    const pwSteps = result.testResult?.steps ?? [];
    if (result.testResult?.attachments?.length) {
      const runEvidenceDir = path.join(EVIDENCE_ROOT, runId);
      await fs.mkdir(runEvidenceDir, { recursive: true });
      for (const [i, attachment] of result.testResult.attachments.entries()) {
        if (!attachment.path) continue;
        const destName = `${i}-${path.basename(attachment.path)}`;
        const ok = await fs
          .copyFile(attachment.path, path.join(runEvidenceDir, destName))
          .then(() => true)
          .catch(() => false);
        if (ok) evidencePath = `/execution-assets/${runId}/${destName}`;
      }
    }

    const steps = await this.prisma.executionStepResult.findMany({
      where: { executionId: runId },
      orderBy: { stepOrder: 'asc' },
    });
    const runEvidenceDir = path.join(EVIDENCE_ROOT, runId);
    let failedStepIndex = -1;
    let domDumpPath: string | undefined;
    for (let i = 0; i < steps.length; i++) {
      const pwStep: PlaywrightStepResult | undefined = pwSteps[i];
      let status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
      let message: string | undefined;
      if (!pwStep) {
        status = 'SKIPPED';
      } else if (pwStep.error) {
        status = 'FAILED';
        message = pwStep.error.message;
        if (failedStepIndex === -1) failedStepIndex = i;
      } else {
        status = 'COMPLETED';
      }

      // Every step gets its own screenshot (see playwright-compiler.ts) for
      // step-by-step review in the Executions UI after the run finishes —
      // on top of the live headed browser window during the run itself
      // (see playwright.config.ts).
      let screenshotPath: string | undefined;
      const sourceScreenshot = path.join(PROJECT_DIR, 'test-results', `step-${steps[i].stepOrder}.png`);
      const destName = `step-${steps[i].stepOrder}.png`;
      const copied = await fs
        .mkdir(runEvidenceDir, { recursive: true })
        .then(() => fs.copyFile(sourceScreenshot, path.join(runEvidenceDir, destName)))
        .then(() => true)
        .catch(() => false);
      if (copied) screenshotPath = `/execution-assets/${runId}/${destName}`;

      // Only a failed step can have one of these (see playwright-compiler.ts's
      // try/catch — it only writes this file when the step's own action
      // throws). Copied out of the shared, non-isolated scratch project dir
      // into this run's own permanent evidence folder before runLock
      // releases for the next queued execution, same reasoning as the
      // screenshot copy just above.
      if (status === 'FAILED') {
        const sourceDomDump = path.join(PROJECT_DIR, 'test-results', `step-${steps[i].stepOrder}-dom.json`);
        const destDomName = `step-${steps[i].stepOrder}-dom.json`;
        const domCopied = await fs
          .copyFile(sourceDomDump, path.join(runEvidenceDir, destDomName))
          .then(() => true)
          .catch(() => false);
        if (domCopied) domDumpPath = path.join(runEvidenceDir, destDomName);
      }

      await this.prisma.executionStepResult.update({
        where: { id: steps[i].id },
        data: { status, message, durationSeconds: (pwStep?.duration ?? 0) / 1000, screenshotPath },
      });
    }

    let failureAnalysisJson: Record<string, unknown> | undefined;
    if (!result.passed) {
      const failedPwStep = pwSteps.find((s) => s.error);
      const errorMessage = failedPwStep?.error?.message ?? result.testResult?.error?.message;
      const deterministic = analyzePlaywrightFailure(errorMessage);
      failureAnalysisJson = await this.refineFailureAnalysis(
        deterministic,
        errorMessage,
        script.applicationId,
        script.automationFlow?.testCaseId ?? null,
        'Playwright',
      );

      if (deterministic.autoHealPossible && failedStepIndex >= 0) {
        await this.suggestAutoHeal(runId, script, steps[failedStepIndex].stepOrder, deterministic.failureMessage, domDumpPath);
      }
    }

    await this.prisma.executionRun.update({
      where: { id: runId },
      data: {
        status: result.passed ? 'COMPLETED' : 'FAILED',
        durationSeconds,
        logs: logs as never,
        evidencePath,
        failureAnalysisJson: (failureAnalysisJson ?? null) as never,
      },
    });
    if (isValidation) {
      // A dry run proves nothing about the real test passing or failing —
      // it must never advance automation status or draft a bug report.
    } else if (result.passed) {
      await advanceAutomationStatus(this.prisma, script.automationFlow?.testCaseId, 'AUTOMATED');
    } else {
      await this.maybeAutoDraftBug(runId, 'FAILED', failureAnalysisJson);
    }
  }

  private async runSeleniumLocked(runId: string, script: ScriptWithFlow, isValidation = false) {
    const javaDir = path.join(SELENIUM_PROJECT_DIR, 'src', 'test', 'java', 'generated');
    await fs.mkdir(javaDir, { recursive: true });
    // Clear previously-generated sources so a shorter flow doesn't leave a
    // stale extra Page Object class sitting in the Maven source tree.
    await fs
      .readdir(javaDir)
      .then((files) => Promise.all(files.filter((f) => f.endsWith('.java')).map((f) => fs.rm(path.join(javaDir, f)))))
      .catch(() => undefined);

    let specFileName: string | undefined;
    for (const file of script.files) {
      if (file.fileName === 'pom.xml') {
        await fs.writeFile(path.join(SELENIUM_PROJECT_DIR, 'pom.xml'), file.code, 'utf-8');
      } else {
        await fs.writeFile(path.join(javaDir, file.fileName), file.code, 'utf-8');
        if (file.role === 'SPEC') specFileName = file.fileName;
      }
    }
    if (!specFileName) {
      await this.prisma.executionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', logs: ['No spec file found for this script.'] },
      });
      return;
    }
    const testClassName = specFileName.replace(/\.java$/, '');

    const result = await runSeleniumSpec({
      projectDir: SELENIUM_PROJECT_DIR,
      testClassName,
      timeoutMs: SELENIUM_TIMEOUT_MS,
    }).catch((err: Error) => {
      this.logger.error(`Selenium process failed for run ${runId}`, err);
      return null;
    });

    if (!result) {
      await this.prisma.executionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', durationSeconds: 0, logs: ['Runner process failed to start.'] },
      });
      return;
    }
    const durationSeconds = result.durationMs / 1000;

    const logs = [
      ...result.stdout.split('\n').filter(Boolean).slice(-200), // Maven's own console output is verbose — keep the tail
      ...result.stderr.split('\n').filter(Boolean).map((l) => `STDERR: ${l}`),
      ...(result.timedOut ? [`Execution timed out after ${SELENIUM_TIMEOUT_MS / 1000} seconds`] : []),
    ];

    const steps = await this.prisma.executionStepResult.findMany({
      where: { executionId: runId },
      orderBy: { stepOrder: 'asc' },
    });
    const runEvidenceDir = path.join(EVIDENCE_ROOT, runId);
    const resultByOrder = new Map(result.steps.map((s) => [s.stepOrder, s]));
    let failedStepIndex = -1;
    for (let i = 0; i < steps.length; i++) {
      const seleniumStep = resultByOrder.get(steps[i].stepOrder);
      let status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
      let message: string | undefined;
      if (!seleniumStep) {
        status = 'SKIPPED';
      } else if (seleniumStep.status === 'FAIL') {
        status = 'FAILED';
        message = seleniumStep.message;
        if (failedStepIndex === -1) failedStepIndex = i;
      } else {
        status = 'COMPLETED';
      }

      // Same per-step screenshot handling as the Playwright path (see
      // selenium-java-compiler.ts's takeScreenshot helper).
      let screenshotPath: string | undefined;
      const sourceScreenshot = path.join(SELENIUM_PROJECT_DIR, 'test-results', `step-${steps[i].stepOrder}.png`);
      const destName = `step-${steps[i].stepOrder}.png`;
      const copied = await fs
        .mkdir(runEvidenceDir, { recursive: true })
        .then(() => fs.copyFile(sourceScreenshot, path.join(runEvidenceDir, destName)))
        .then(() => true)
        .catch(() => false);
      if (copied) screenshotPath = `/execution-assets/${runId}/${destName}`;

      await this.prisma.executionStepResult.update({
        where: { id: steps[i].id },
        data: { status, message, screenshotPath },
      });
    }

    let failureAnalysisJson: Record<string, unknown> | undefined;
    if (!result.passed) {
      const failedStep = result.steps.find((s) => s.status === 'FAIL');
      const errorMessage = failedStep?.message;
      const deterministic = analyzeSeleniumFailure(errorMessage);
      failureAnalysisJson = await this.refineFailureAnalysis(
        deterministic,
        errorMessage,
        script.applicationId,
        script.automationFlow?.testCaseId ?? null,
        'Selenium (Java)',
      );

      if (deterministic.autoHealPossible && failedStepIndex >= 0) {
        await this.suggestAutoHeal(runId, script, steps[failedStepIndex].stepOrder, deterministic.failureMessage);
      }
    }

    await this.prisma.executionRun.update({
      where: { id: runId },
      data: {
        status: result.passed ? 'COMPLETED' : 'FAILED',
        durationSeconds,
        logs: logs as never,
        failureAnalysisJson: (failureAnalysisJson ?? null) as never,
      },
    });
    if (isValidation) {
      // A dry run proves nothing about the real test passing or failing —
      // it must never advance automation status or draft a bug report.
    } else if (result.passed) {
      await advanceAutomationStatus(this.prisma, script.automationFlow?.testCaseId, 'AUTOMATED');
    } else {
      await this.maybeAutoDraftBug(runId, 'FAILED', failureAnalysisJson);
    }
  }

  private async runSapGuiLocked(runId: string, script: ScriptWithFlow, isValidation = false) {
    await fs.mkdir(SAP_GUI_PROJECT_DIR, { recursive: true });
    const specFile = script.files.find((f) => f.role === 'SPEC');
    if (!specFile) {
      await this.prisma.executionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', logs: ['No spec file found for this script.'] },
      });
      return;
    }
    await fs.writeFile(path.join(SAP_GUI_PROJECT_DIR, specFile.fileName), specFile.code, 'utf-8');

    const runSpec = pickSapGuiRunner(specFile.fileName);
    const result = await runSpec({
      projectDir: SAP_GUI_PROJECT_DIR,
      specFileName: specFile.fileName,
      timeoutMs: SAP_GUI_TIMEOUT_MS,
    }).catch((err: Error) => {
      this.logger.error(`SAP GUI process failed for run ${runId}`, err);
      return null;
    });

    if (!result) {
      await this.prisma.executionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', durationSeconds: 0, logs: ['Runner process failed to start.'] },
      });
      return;
    }
    const durationSeconds = result.durationMs / 1000;

    const logs = [
      ...result.stdout.split('\n').filter(Boolean),
      ...result.stderr.split('\n').filter(Boolean).map((l) => `STDERR: ${l}`),
      ...(result.timedOut ? [`Execution timed out after ${SAP_GUI_TIMEOUT_MS / 1000} seconds`] : []),
    ];

    const { failureAnalysisJson } = await this.reconcileStepResults(
      runId,
      script,
      result.steps.map((s) => ({ stepOrder: s.stepOrder, status: s.status, message: s.message })),
      analyzeSapGuiFailure,
      'SAP GUI',
    );

    await this.prisma.executionRun.update({
      where: { id: runId },
      data: {
        status: result.passed ? 'COMPLETED' : 'FAILED',
        durationSeconds,
        logs: logs as never,
        failureAnalysisJson: (failureAnalysisJson ?? null) as never,
      },
    });
    if (isValidation) {
      // A dry run proves nothing about the real test passing or failing —
      // it must never advance automation status or draft a bug report.
    } else if (result.passed) {
      await advanceAutomationStatus(this.prisma, script.automationFlow?.testCaseId, 'AUTOMATED');
    } else {
      await this.maybeAutoDraftBug(runId, 'FAILED', failureAnalysisJson);
    }
  }

  // Shared by runSapGuiLocked and runHybridLocked: reconciles ExecutionStepResult
  // rows against a flat {stepOrder, status, message} result list — a step
  // with no matching result (never reached, e.g. a prior segment failed
  // first) is marked SKIPPED, same convention runPlaywrightLocked/
  // runSeleniumLocked already use. `relevantStepOrders`, when given, scopes
  // this to one hybrid segment's own steps only — without it, a second
  // segment's call would see every OTHER segment's steps as "no matching
  // result" and wrongly reset already-COMPLETED rows back to SKIPPED.
  private async reconcileStepResults(
    runId: string,
    script: ScriptWithFlow,
    driverResults: { stepOrder: number; status: 'PASS' | 'FAIL'; message: string }[],
    analyze: (errorMessage: string | undefined) => DeterministicFailureAnalysis,
    frameworkLabel: string,
    relevantStepOrders?: number[],
  ): Promise<{ failedStepIndex: number; failureAnalysisJson: Record<string, unknown> | undefined }> {
    const steps = await this.prisma.executionStepResult.findMany({
      where: { executionId: runId, ...(relevantStepOrders ? { stepOrder: { in: relevantStepOrders } } : {}) },
      orderBy: { stepOrder: 'asc' },
    });
    const resultByOrder = new Map(driverResults.map((s) => [s.stepOrder, s]));
    let failedStepIndex = -1;
    let failedStepOrder = -1;
    let errorMessage: string | undefined;
    for (let i = 0; i < steps.length; i++) {
      const driverStep = resultByOrder.get(steps[i].stepOrder);
      let status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
      let message: string | undefined;
      if (!driverStep) {
        status = 'SKIPPED';
      } else if (driverStep.status === 'FAIL') {
        status = 'FAILED';
        message = driverStep.message;
        if (failedStepIndex === -1) {
          failedStepIndex = i;
          failedStepOrder = steps[i].stepOrder;
          errorMessage = message;
        }
      } else {
        status = 'COMPLETED';
      }
      await this.prisma.executionStepResult.update({ where: { id: steps[i].id }, data: { status, message } });
    }

    let failureAnalysisJson: Record<string, unknown> | undefined;
    if (failedStepIndex >= 0) {
      const deterministic = analyze(errorMessage);
      failureAnalysisJson = await this.refineFailureAnalysis(
        deterministic,
        errorMessage,
        script.applicationId,
        script.automationFlow?.testCaseId ?? null,
        frameworkLabel,
      );
      if (deterministic.autoHealPossible) {
        await this.suggestAutoHeal(runId, script, failedStepOrder, deterministic.failureMessage);
      }
    }
    return { failedStepIndex, failureAnalysisJson };
  }

  // Runs a flow whose steps were split across web and SAP GUI segments
  // (script-generator.service.ts segmentSteps()) — each segment's own files
  // are written to its own scratch project dir and run through its own
  // driver, in order, with results reconciled into the SAME ExecutionRun's
  // step rows. A failing segment stops the run there; downstream segments'
  // steps stay SKIPPED rather than running against whatever state the
  // failed segment left things in.
  private async runHybridLocked(runId: string, script: ScriptWithFlow, isValidation = false) {
    const segments = (script.hybridSegments ?? []) as Array<{
      order: number;
      driver: 'WEB' | 'SAP_GUI';
      framework: string;
      fileNames: string[];
      command: string;
      stepOrders: number[];
    }>;
    if (segments.length === 0) {
      await this.prisma.executionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', logs: ['This script is marked HYBRID but has no segment metadata.'] },
      });
      return;
    }

    const startedAt = Date.now();
    const logs: string[] = [];
    let overallPassed = true;
    let failureAnalysisJson: Record<string, unknown> | undefined;

    for (const segment of segments) {
      logs.push(`--- Segment ${segment.order}: ${segment.driver === 'SAP_GUI' ? 'SAP GUI' : segment.framework} ---`);
      const segmentFiles = script.files.filter((f) => segment.fileNames.includes(f.fileName));

      if (segment.driver === 'SAP_GUI') {
        await fs.mkdir(SAP_GUI_PROJECT_DIR, { recursive: true });
        const specFile = segmentFiles.find((f) => f.role === 'SPEC');
        if (!specFile) {
          logs.push('No spec file found for this segment.');
          overallPassed = false;
          break;
        }
        await fs.writeFile(path.join(SAP_GUI_PROJECT_DIR, specFile.fileName), specFile.code, 'utf-8');
        const runSpec = pickSapGuiRunner(specFile.fileName);
        const result = await runSpec({
          projectDir: SAP_GUI_PROJECT_DIR,
          specFileName: specFile.fileName,
          timeoutMs: SAP_GUI_TIMEOUT_MS,
        }).catch((err: Error) => {
          this.logger.error(`SAP GUI segment failed for run ${runId}`, err);
          return null;
        });
        if (!result) {
          logs.push('SAP GUI runner process failed to start.');
          overallPassed = false;
          break;
        }
        logs.push(...result.stdout.split('\n').filter(Boolean));
        logs.push(...result.stderr.split('\n').filter(Boolean).map((l) => `STDERR: ${l}`));
        const { failureAnalysisJson: segAnalysis } = await this.reconcileStepResults(
          runId,
          script,
          result.steps.map((s) => ({ stepOrder: s.stepOrder, status: s.status, message: s.message })),
          analyzeSapGuiFailure,
          'SAP GUI',
          segment.stepOrders,
        );
        if (!result.passed) {
          failureAnalysisJson = segAnalysis;
          overallPassed = false;
          break;
        }
      } else {
        const isSelenium = segment.framework === 'SELENIUM';
        if (isSelenium) {
          const javaDir = path.join(SELENIUM_PROJECT_DIR, 'src', 'test', 'java', 'generated');
          await fs.mkdir(javaDir, { recursive: true });
          let specFileName: string | undefined;
          for (const file of segmentFiles) {
            if (file.fileName === 'pom.xml') {
              await fs.writeFile(path.join(SELENIUM_PROJECT_DIR, 'pom.xml'), file.code, 'utf-8');
            } else {
              await fs.writeFile(path.join(javaDir, file.fileName), file.code, 'utf-8');
              if (file.role === 'SPEC') specFileName = file.fileName;
            }
          }
          if (!specFileName) {
            logs.push('No spec file found for this segment.');
            overallPassed = false;
            break;
          }
          const result = await runSeleniumSpec({
            projectDir: SELENIUM_PROJECT_DIR,
            testClassName: specFileName.replace(/\.java$/, ''),
            timeoutMs: SELENIUM_TIMEOUT_MS,
          }).catch((err: Error) => {
            this.logger.error(`Selenium segment failed for run ${runId}`, err);
            return null;
          });
          if (!result) {
            logs.push('Selenium runner process failed to start.');
            overallPassed = false;
            break;
          }
          logs.push(...result.stdout.split('\n').filter(Boolean).slice(-200));
          logs.push(...result.stderr.split('\n').filter(Boolean).map((l) => `STDERR: ${l}`));
          const { failureAnalysisJson: segAnalysis } = await this.reconcileStepResults(
            runId,
            script,
            result.steps.map((s) => ({ stepOrder: s.stepOrder, status: s.status, message: s.message })),
            analyzeSeleniumFailure,
            'Selenium (Java)',
            segment.stepOrders,
          );
          if (!result.passed) {
            failureAnalysisJson = segAnalysis;
            overallPassed = false;
            break;
          }
        } else {
          const testsDir = path.join(PROJECT_DIR, 'tests');
          await fs.mkdir(testsDir, { recursive: true });
          for (const file of segmentFiles) {
            await fs.writeFile(path.join(testsDir, file.fileName), file.code, 'utf-8');
          }
          const specFile = segmentFiles.find((f) => f.role === 'SPEC');
          if (!specFile) {
            logs.push('No spec file found for this segment.');
            overallPassed = false;
            break;
          }
          const result = await runPlaywrightSpec({
            projectDir: PROJECT_DIR,
            specFileName: specFile.fileName,
            timeoutMs: EXECUTION_TIMEOUT_MS,
          }).catch((err: Error) => {
            this.logger.error(`Playwright segment failed for run ${runId}`, err);
            return null;
          });
          if (!result) {
            logs.push('Playwright runner process failed to start.');
            overallPassed = false;
            break;
          }
          logs.push(...result.stdout.split('\n').filter(Boolean));
          logs.push(...result.stderr.split('\n').filter(Boolean).map((l) => `STDERR: ${l}`));
          const pwSteps = result.testResult?.steps ?? [];
          const { failureAnalysisJson: segAnalysis } = await this.reconcileStepResults(
            runId,
            script,
            pwSteps
              .map((s, i) => ({ stepOrder: segment.stepOrders[i], status: (s.error ? 'FAIL' : 'PASS') as 'PASS' | 'FAIL', message: s.error?.message ?? '' }))
              .filter((s) => s.stepOrder !== undefined),
            analyzePlaywrightFailure,
            'Playwright',
            segment.stepOrders,
          );
          if (!result.passed) {
            failureAnalysisJson = segAnalysis;
            overallPassed = false;
            break;
          }
        }
      }
    }

    const durationSeconds = (Date.now() - startedAt) / 1000;
    await this.prisma.executionRun.update({
      where: { id: runId },
      data: {
        status: overallPassed ? 'COMPLETED' : 'FAILED',
        durationSeconds,
        logs: logs as never,
        failureAnalysisJson: (failureAnalysisJson ?? null) as never,
      },
    });
    if (isValidation) {
      // A dry run proves nothing about the real test passing or failing —
      // it must never advance automation status or draft a bug report.
    } else if (overallPassed) {
      await advanceAutomationStatus(this.prisma, script.automationFlow?.testCaseId, 'AUTOMATED');
    } else {
      await this.maybeAutoDraftBug(runId, 'FAILED', failureAnalysisJson);
    }
  }

  // Deterministic matchers are confident for locator/timeout/navigation
  // failures — for the two ambiguous categories (assertion_failed, unknown)
  // this asks the AI to pick the real category from the full taxonomy
  // (could be an actual application bug, stale test data, an environment
  // problem, a requirement that changed, or a genuine script bug), grounded
  // in the test case's expected result and any Knowledge Base context —
  // same retrieval call TestCasesService.analyze already uses.
  private async refineFailureAnalysis(
    deterministic: DeterministicFailureAnalysis,
    errorMessage: string | undefined,
    applicationId: string,
    testCaseId: string | null,
    framework: string,
  ): Promise<Record<string, unknown>> {
    const isAmbiguous = !CONFIDENT_DETERMINISTIC_CATEGORIES.includes(deterministic.category);
    const testCase = testCaseId
      ? await this.prisma.testCase.findUnique({ where: { id: testCaseId }, select: { title: true, expectedResult: true } })
      : null;

    const rag = await this.ragService.retrieveContext(applicationId, `${testCase?.title ?? ''} ${errorMessage ?? ''}`);
    const ragContext = rag.used ? `\n\nRelevant knowledge base context:\n${rag.chunks.join('\n---\n')}` : '';
    const expectedResultText = testCase?.expectedResult ? `\n\nTest case expected result: ${testCase.expectedResult}` : '';

    const prompt =
      `A ${framework} test failed. Error: ${errorMessage ?? 'unknown'}${expectedResultText}${ragContext}\n\n` +
      `Deterministic analysis so far classified this as "${deterministic.category}".`;

    const system = isAmbiguous
      ? 'You are a senior SDET investigating a test failure. Decide the true root cause category and return ONLY a JSON ' +
        'object: { "category": "application_bug"|"test_data_issue"|"environment_issue"|"requirement_mismatch"|' +
        '"automation_script_issue"|"assertion_failed"|"unknown", "rootCause": string, "suggestedFix": string, ' +
        '"suggestedCodeFix": string|null (only if category is automation_script_issue — a corrected code snippet, else null) }.'
      : 'You are a senior SDET investigating a test failure. Return ONLY a JSON object: { "rootCause": string, ' +
        '"suggestedFix": string, "suggestedCodeFix": string|null (only if this looks like a script logic bug, else null) }.';

    const base: Record<string, unknown> = { ...deterministic, aiEnrichmentAvailable: false };
    try {
      const aiEnrichment = await this.aiProvider.generateJson<{
        category?: string;
        rootCause?: string;
        suggestedFix?: string;
        suggestedCodeFix?: string | null;
      }>(prompt, { system });

      return {
        ...base,
        category: isAmbiguous && aiEnrichment.category ? aiEnrichment.category : deterministic.category,
        aiRootCause: aiEnrichment.rootCause,
        aiSuggestedFix: aiEnrichment.suggestedFix,
        aiSuggestedCodeFix: aiEnrichment.suggestedCodeFix ?? null,
        aiEnrichmentAvailable: true,
      };
    } catch {
      // best-effort only, matches the app's existing graceful AI degradation
      return base;
    }
  }

  // Suggests one of the object's OWN backup locators (captured by the
  // scanner alongside its primary one) rather than a different object
  // entirely — a genuine "try this alternate selector for the same
  // element" fix, not a confusing cross-object swap.
  private async suggestAutoHeal(
    executionId: string,
    script: ScriptWithFlow,
    failedStepOrder: number,
    reason: string,
    domDumpPath?: string,
  ) {
    // Looked up by stepOrder, not array position — a hybrid segment's local
    // reconciliation loop only sees that segment's own steps, so its index
    // wouldn't line up with automationFlow.steps' full, unfiltered order.
    const flowStep = script.automationFlow?.steps?.find((s) => s.stepOrder === failedStepOrder);
    const failedObject = flowStep?.object;
    if (!failedObject) return;

    const backupLocators = Array.isArray(failedObject.backupLocators)
      ? (failedObject.backupLocators as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    const suggestedPath = backupLocators.find((loc) => loc && loc !== failedObject.technicalPath);

    if (!suggestedPath) {
      // No recorded backup worked either — fall back to a live AI re-scan of
      // the page at the exact moment of failure (see playwright-compiler.ts's
      // per-step try/catch), rather than giving up entirely. Fire-and-forget
      // on purpose: AiProvider.generateJson can legitimately take up to ~10
      // minutes (and retries up to 3x on non-JSON output) on this local
      // Ollama setup — awaiting it inline would almost always lose the race
      // against this run's own ~315s watchdog, or collide with a human who
      // already retried. The run finishes and reports its own status on its
      // normal schedule regardless of how long this takes to resolve.
      if (domDumpPath) {
        this.attemptAiDomHeal(script.applicationId, executionId, failedObject, domDumpPath, reason).catch((err) => {
          this.logger.warn(`AI DOM-based auto-heal failed for object ${failedObject.id}: ${(err as Error).message}`);
        });
      }
      return;
    }

    await this.prisma.autoHealSuggestion.create({
      data: {
        applicationId: script.applicationId,
        executionId,
        objectId: failedObject.id,
        oldPath: failedObject.technicalPath,
        suggestedPath,
        reason: `${reason} — trying a backup locator captured during the original scan.`,
        confidence: failedObject.confidenceScore ?? undefined,
        status: 'PENDING',
      },
    });
  }

  // Stricter than GoldenRulePolicyService's minimumMappingConfidence (the
  // ordinary "is this mapping good enough" bar, default 0.7) — this decides
  // whether an AI-guessed *replacement* locator gets applied with no human
  // in the loop at all, so it's held to a deliberately higher standard. Below
  // this, the suggestion still gets created (as long as it clears the normal
  // minimumMappingConfidence bar) — it just waits for a human, same as every
  // other auto-heal path.
  private static readonly AI_DOM_HEAL_AUTO_APPLY_CONFIDENCE = 0.9;

  private async attemptAiDomHeal(
    applicationId: string,
    executionId: string,
    failedObject: {
      id: string;
      objectName: string;
      displayLabel: string | null;
      objectType: string;
      moduleName: string | null;
      featureName: string | null;
      screenName: string | null;
      technicalPath: string;
    },
    domDumpPath: string,
    reason: string,
  ): Promise<void> {
    let candidates: Array<{ label: string | null; objectType: string; recommendedLocator: string }>;
    try {
      const raw = await fs.readFile(domDumpPath, 'utf-8');
      const parsed = JSON.parse(raw) as { candidates?: typeof candidates };
      candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    } catch (err) {
      this.logger.warn(`AI DOM-based auto-heal: could not read dump ${domDumpPath}: ${(err as Error).message}`);
      return;
    }
    if (candidates.length === 0) return;

    const identity = [
      `name="${failedObject.objectName}"`,
      failedObject.displayLabel ? `label="${failedObject.displayLabel}"` : null,
      `type="${failedObject.objectType}"`,
      failedObject.moduleName ? `module="${failedObject.moduleName}"` : null,
      failedObject.featureName ? `feature="${failedObject.featureName}"` : null,
      failedObject.screenName ? `screen="${failedObject.screenName}"` : null,
    ]
      .filter(Boolean)
      .join(', ');

    const candidateLines = candidates
      .map((c) => `- label: ${JSON.stringify(c.label ?? '')}, type: ${JSON.stringify(c.objectType)}, locator: ${JSON.stringify(c.recommendedLocator)}`)
      .join('\n');

    const prompt =
      `Failed element: ${identity}. Old locator (no longer resolves): ${failedObject.technicalPath}.\n\n` +
      `Candidates found on the live page immediately after the failure:\n${candidateLines}`;

    const system =
      "You are helping repair a broken UI test locator. An automated test's element no longer resolves. " +
      "Below is the failed element's identity and a list of interactive elements found on the live page " +
      'right after the failure. Decide whether one of them is clearly the same element (renamed, moved, or ' +
      're-rendered). Return ONLY JSON: { "matchedLocator": string|null, "confidence": number (0-1), "rationale": string }. ' +
      'If no candidate is a confident match, matchedLocator must be null — never guess.';

    let aiResult: { matchedLocator?: string | null; confidence?: number; rationale?: string };
    try {
      aiResult = await this.aiProvider.generateJson(prompt, { system });
    } catch (err) {
      this.logger.warn(`AI DOM-based auto-heal: generateJson failed: ${(err as Error).message}`);
      return;
    }
    if (!aiResult.matchedLocator || typeof aiResult.confidence !== 'number') return;

    const policy = await this.goldenRule.getPolicyForApplication(applicationId);
    if (aiResult.confidence < policy.minimumMappingConfidence) return;

    const autoApply = aiResult.confidence >= ExecutionService.AI_DOM_HEAL_AUTO_APPLY_CONFIDENCE;

    if (autoApply) {
      await this.prisma.objectRepository.update({
        where: { id: failedObject.id },
        data: { technicalPath: aiResult.matchedLocator, verificationStatus: 'WORKING', lastValidatedAt: new Date() },
      });
    }

    await this.prisma.autoHealSuggestion.create({
      data: {
        applicationId,
        executionId,
        objectId: failedObject.id,
        oldPath: failedObject.technicalPath,
        suggestedPath: aiResult.matchedLocator,
        reason:
          `${reason} — no backup locator worked; an AI re-scan of the live page at failure time found a plausible replacement` +
          (autoApply ? ' (confidence high enough to apply automatically).' : '.'),
        confidence: aiResult.confidence,
        aiRawResponse: { checkedAt: new Date().toISOString(), candidatesConsidered: candidates.length, rawModelResponse: aiResult } as never,
        status: autoApply ? 'APPROVED' : 'PENDING',
        autoApproved: autoApply,
        decidedAt: autoApply ? new Date() : undefined,
      },
    });
  }

  async listAutoHealSuggestions(applicationId: string) {
    const suggestions = await this.prisma.autoHealSuggestion.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      include: { object: { select: { objectName: true } } },
    });

    // decidedById is a plain string, not a Prisma relation — same convention
    // as every other *ById field in this codebase (e.g. AiEngineeringTask.
    // reviewedById) — so it's resolved to a display name manually here rather
    // than via an include.
    const deciderIds = [...new Set(suggestions.map((s) => s.decidedById).filter((id): id is string => !!id))];
    const deciders = deciderIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: deciderIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(deciders.map((d) => [d.id, d.name]));

    return suggestions.map((s) => ({
      ...s,
      decidedByName: s.decidedById ? (nameById.get(s.decidedById) ?? null) : null,
    }));
  }

  async decideAutoHeal(id: string, approve: boolean, decidedById?: string) {
    const suggestion = await this.prisma.autoHealSuggestion.findUnique({ where: { id } });
    if (!suggestion) {
      throw new NotFoundException(`Auto-heal suggestion ${id} not found`);
    }

    if (approve && suggestion.objectId && suggestion.suggestedPath) {
      await this.prisma.objectRepository.update({
        where: { id: suggestion.objectId },
        data: { technicalPath: suggestion.suggestedPath, verificationStatus: 'WORKING' },
      });
    }

    return this.prisma.autoHealSuggestion.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedAt: new Date(),
        decidedById,
      },
    });
  }

  // Continuous Locator Health Watch — the proactive counterpart to
  // suggestAutoHeal() above. That method only ever fires reactively, after a
  // real execution has already failed, and only ever trusts a backup
  // locator without checking it. This runs on a schedule, for every
  // application that's opted in (AutomationPolicySetting.qualityWatchEnabled
  // — off by default), and actually re-verifies each locator against the
  // live app right now. Same governance guarantee as the reactive path:
  // this never writes ObjectRepository.technicalPath itself — it only ever
  // creates a PENDING AutoHealSuggestion (reusing decideAutoHeal's existing
  // approve/reject funnel unchanged) or flips verificationStatus to BROKEN
  // when no candidate fix exists to propose.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runQualityWatch(): Promise<void> {
    const enabledPolicies = await this.prisma.automationPolicySetting.findMany({
      where: { qualityWatchEnabled: true, applicationId: { not: null } },
    });
    if (enabledPolicies.length === 0) return;

    for (const policy of enabledPolicies) {
      const applicationId = policy.applicationId as string;
      const maxObjects = policy.qualityWatchMaxObjectsPerRun || DEFAULT_QUALITY_WATCH_MAX_OBJECTS;
      await this.runQualityWatchForApplication(applicationId, maxObjects);
      await this.prisma.automationPolicySetting.update({
        where: { id: policy.id },
        data: { qualityWatchLastRunAt: new Date() },
      });
    }
  }

  // On-demand trigger for "I have a regression run coming up right now,
  // don't make me wait for the 3am schedule" — same live re-verification,
  // just scoped to one application and fired immediately. Explicit intent
  // (clicking a button) is enough on its own, so unlike the unattended
  // nightly pass this works even when qualityWatchEnabled is off or no
  // policy row exists yet for this application; it still never writes
  // ObjectRepository.technicalPath directly, same governance guarantee.
  async runQualityWatchNow(applicationId: string): Promise<{ checked: number }> {
    const policy = await this.prisma.automationPolicySetting.findFirst({ where: { applicationId } });
    const maxObjects = policy?.qualityWatchMaxObjectsPerRun || DEFAULT_QUALITY_WATCH_MAX_OBJECTS;
    const checked = await this.runQualityWatchForApplication(applicationId, maxObjects);
    if (policy) {
      await this.prisma.automationPolicySetting.update({
        where: { id: policy.id },
        data: { qualityWatchLastRunAt: new Date() },
      });
    }
    return { checked };
  }

  private async runQualityWatchForApplication(applicationId: string, maxObjects: number): Promise<number> {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) return 0;

    const objects = await this.prisma.objectRepository.findMany({
      where: { applicationId, platform: 'WEB' },
      orderBy: { lastValidatedAt: { sort: 'asc', nulls: 'first' } },
      take: maxObjects,
      include: { sourceScanObject: { include: { scanPage: true } } },
    });

    for (const object of objects) {
      const targetUrl = object.sourceScanObject?.scanPage?.url ?? application.entryUrl;
      if (!targetUrl) {
        this.logger.warn(`Quality watch: object ${object.id} has no source page URL and no application entryUrl — skipped.`);
        continue;
      }

      // Sequential, never Promise.all — concurrent load against this
      // project's local Postgres/PGlite adapter has repeatedly broken it
      // live this session; one browser check at a time is deliberate.
      const primary = await verifyLocatorLive(targetUrl, object.technicalPath, object.locatorStrategy);

      if (primary.resolves) {
        await this.prisma.objectRepository.update({
          where: { id: object.id },
          data: { verificationStatus: 'WORKING', lastValidatedAt: new Date() },
        });
        continue;
      }

      const backupLocators = Array.isArray(object.backupLocators)
        ? (object.backupLocators as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];

      let workingBackup: string | null = null;
      for (const backup of backupLocators) {
        if (!backup || backup === object.technicalPath) continue;
        const backupResult = await verifyLocatorLive(targetUrl, backup, object.locatorStrategy);
        if (backupResult.resolves) {
          workingBackup = backup;
          break;
        }
      }

      if (workingBackup) {
        const alreadyPending = await this.prisma.autoHealSuggestion.findFirst({
          where: { objectId: object.id, status: 'PENDING' },
        });
        if (!alreadyPending) {
          await this.prisma.autoHealSuggestion.create({
            data: {
              applicationId,
              objectId: object.id,
              executionId: null,
              oldPath: object.technicalPath,
              suggestedPath: workingBackup,
              reason: `Continuous quality watch: this locator no longer resolves on ${targetUrl}. A backup locator captured at scan time was just re-verified live and does resolve.`,
              confidence: object.confidenceScore ?? undefined,
              aiRawResponse: {
                checkedAt: new Date().toISOString(),
                targetUrl,
                triedLocators: [object.technicalPath, ...backupLocators],
              },
              status: 'PENDING',
            },
          });
        }
        await this.prisma.objectRepository.update({
          where: { id: object.id },
          data: { lastValidatedAt: new Date() },
        });
      } else {
        await this.prisma.objectRepository.update({
          where: { id: object.id },
          data: { verificationStatus: 'BROKEN', lastValidatedAt: new Date() },
        });
      }
    }

    return objects.length;
  }
}
