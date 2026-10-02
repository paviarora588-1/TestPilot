import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';
import { parseCodexJson, runCodexAgent, runCodexExecJson } from '../../common/codex-cli.util';
import {
  FileDiff,
  VerificationResult,
  applyApprovedChanges,
  buildWorkspace,
  destroyWorkspace,
  diffWorkspace,
  generateSchemaMigrationSql,
  getProjectDir,
  runCommand,
  runFullBackendTestSuite,
  runFullE2ETestSuite,
  runFullFrontendTestSuite,
  runVerification,
  writeDraftMigration,
  WorkspaceArea,
} from './workspace.util';
import { CreateAiTaskDto } from './dto/create-ai-task.dto';
import { Prisma } from '../../../generated/prisma/client';
import type { AiTaskArea, AiTaskSource, BugSeverity } from '../../../generated/prisma/enums';

type SingleArea = 'BACKEND' | 'FRONTEND';

interface TriageResult {
  area: AiTaskArea | null;
  touchesSchema: boolean;
  planSummary: string;
  friendlySummary: string;
  candidateFiles: string[];
  reason?: string;
}

// Caps how much of the repo's own file listing goes into the triage prompt —
// generous enough to cover this codebase's actual module count, bounded so a
// much larger future codebase can't blow up the prompt unnoticed.
const MAX_LISTED_FILES = 400;

// How many extra Codex passes a failing verification gets before we give up
// and just hand the human whatever the last attempt produced. Bounded on
// purpose — each pass is a real codex exec call (money/time), and an
// unbounded retry loop on a fix that's fundamentally wrong would just burn
// both without ever converging.
const MAX_REPAIR_ATTEMPTS = 2;

// Caps how many tasks one nightly scan can create — grounded in real tsc/
// eslint output (never hallucinated), but still bounded so a codebase with a
// lot of pre-existing issues can't flood the review queue overnight.
const MAX_TASKS_PER_SCAN = 3;

async function listSourceFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    if (results.length >= MAX_LISTED_FILES) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_LISTED_FILES) return;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else results.push(path.relative(dir, full).replace(/\\/g, '/'));
    }
  }
  await walk(dir);
  return results;
}

interface ScanFinding {
  area: SingleArea;
  file: string;
  message: string;
}

// tsc's own `file(line,col): error TSxxxx: message` format — deterministic,
// not an LLM guess. Exported for unit testing.
export function parseTscFindings(output: string, area: SingleArea): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lineRe = /^(\S+\.tsx?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
  for (const raw of output.split('\n')) {
    const m = lineRe.exec(raw.trim());
    if (m) findings.push({ area, file: m[1].replace(/\\/g, '/'), message: `${m[4]}: ${m[5]}` });
  }
  return findings;
}

// ESLint's default "stylish" formatter: an absolute file path header line,
// followed by indented `line:col  error  message` lines. Only the header
// line is parsed (never the rule id that normally trails the message) —
// confirmed against real output that some rules (e.g. react-hooks/set-state
// -in-effect) emit a multi-paragraph message with an embedded code frame,
// pushing the rule id many lines later; requiring it on the same line
// silently dropped every one of those real violations. Only `error`
// severity is surfaced (not `warning`) to keep signal high.
// A real file-path header line, never a code-frame line — some rules (see
// above) re-print "file:line:col" mid-message as part of a code frame, and a
// code-frame content line (e.g. `> 29 |     someCode();`) also doesn't start
// with a space, so "doesn't start with a space" alone isn't enough to tell
// them apart. Requiring a source-file extension is: confirmed against a real
// run that without this, a code-frame line got misread as the current file.
const ESLINT_FILE_HEADER_RE = /^\S.*\.(?:tsx?|jsx?)(?::\d+:\d+)?$/;

export function parseEslintFindings(output: string, area: SingleArea, projectDir: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  let currentFile: string | null = null;
  for (const raw of output.split('\n')) {
    // eslint-disable-next-line no-control-regex
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
    if (!line.trim()) continue;
    const trimmed = line.trim();
    if (ESLINT_FILE_HEADER_RE.test(trimmed)) {
      currentFile = path.relative(projectDir, trimmed.replace(/:\d+:\d+$/, '')).replace(/\\/g, '/');
      continue;
    }
    const m = /^\s*\d+:\d+\s+error\s+(.+)$/.exec(line);
    if (m && currentFile) findings.push({ area, file: currentFile, message: m[1].trim() });
  }
  return findings;
}

interface AreaPipelineSuccess {
  success: true;
  workspaceDir: string;
  diffs: FileDiff[];
  verification: VerificationResult;
  repairAttempts: number;
  specialistSummary: string;
  migrationSql?: string;
  aiReviewPassed?: boolean;
  aiReviewSummary?: string;
}
interface AreaPipelineFailure {
  success: false;
  errorMessage: string;
  specialistSummary?: string;
}
type AreaPipelineResult = AreaPipelineSuccess | AreaPipelineFailure;

@Injectable()
export class AiEngineeringService {
  private readonly logger = new Logger(AiEngineeringService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
  ) {}

  list() {
    return this.prisma.aiEngineeringTask.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async get(id: string) {
    const task = await this.prisma.aiEngineeringTask.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException(`AI engineering task ${id} not found`);
    }
    return task;
  }

  // Distinct from the Test Cycle card: that reflects only the AI Engineering
  // pipeline's own verification runs (one per task). This runs the real,
  // full jest suite against the live backend-v2 project right now, so it's
  // always a fresh, rerunnable count — not something cached on a task row.
  getTestSuite() {
    return runFullBackendTestSuite();
  }

  getFrontendTestSuite() {
    return runFullFrontendTestSuite();
  }

  getE2ETestSuite() {
    return runFullE2ETestSuite();
  }

  async createTask(dto: CreateAiTaskDto, createdById?: string, source: AiTaskSource = 'HUMAN_REPORT') {
    const task = await this.prisma.aiEngineeringTask.create({
      data: {
        title: dto.title,
        description: dto.description,
        reproSteps: (dto.reproSteps as never) ?? undefined,
        severity: dto.severity ?? 'MEDIUM',
        createdById,
        source,
        status: 'PENDING',
      },
    });
    // Fire-and-forget, same shape as ScannerService.startScan/TestCasesService's
    // job methods — the caller gets the task row immediately and follows
    // progress by polling GET .../:id.
    this.runPipeline(task.id).catch((err) => {
      this.logger.error(`AI engineering pipeline crashed for task ${task.id}`, err);
    });
    return task;
  }

  // The other two ways a task gets created (createTask/HUMAN_REPORT,
  // runScheduledScan/SCHEDULED_SCAN below) both require someone or
  // something to already know a bug exists — a human noticing it, or a
  // compiler/linter flagging it. Neither ever catches a bug that's
  // "correct" by every static check but produces the wrong OUTPUT when
  // actually run — exactly what the scan-duplication bug was: valid
  // TypeScript, no lint violations, just semantically wrong. This is the
  // first entry point grounded in TestPilot's own real runtime behavior
  // instead: a caller (ScannerService today; ExecutionService or others
  // could follow the same pattern) that just measured something concrete
  // and wrong about its own output calls this directly, with the real
  // numbers already in hand — no LLM ever guesses that a bug exists here,
  // only real measurements do, same evidence-grounded standard
  // runScheduledScan already holds itself to.
  //
  // dedupeKey is deliberately NOT scoped to one application or one scan
  // session — the underlying defect lives in TestPilot's own shared
  // scanning code, so a second application's scan tripping the same
  // anomaly while a fix is already in flight should never file a second,
  // competing task for the same root cause.
  async reportRuntimeAnomaly(params: {
    title: string;
    description: string;
    reproSteps?: string[];
    severity?: BugSeverity;
    dedupeKey: string;
  }) {
    const existingOpenTasks = await this.prisma.aiEngineeringTask.findMany({
      where: { status: { in: ['PENDING', 'PLANNING', 'IN_PROGRESS', 'WAITING_REVIEW'] } },
      select: { description: true },
    });
    if (existingOpenTasks.some((t) => t.description.includes(params.dedupeKey))) {
      this.logger.debug(`Runtime anomaly "${params.dedupeKey}" already has an open task — not filing a duplicate.`);
      return null;
    }
    return this.createTask(
      {
        title: params.title,
        description: `${params.description}\n\n[dedupe:${params.dedupeKey}]`,
        reproSteps: params.reproSteps,
        severity: params.severity ?? 'MEDIUM',
      },
      undefined,
      'RUNTIME_ANOMALY',
    );
  }

  // For a task left FAILED by the startup reconciliation sweep (interrupted
  // mid-pipeline by a server restart, never actually finished), any other
  // FAILED task a human wants to give another shot, or a task still showing
  // PLANNING/IN_PROGRESS that the reconciliation sweep never got to reconcile
  // (that sweep is itself a best-effort query against a database that has
  // repeatedly dropped connections right at boot — see
  // StartupReconciliationService — so it can legitimately miss one). Nothing
  // can trust an in-memory pipeline promise to still be running after any
  // restart regardless of what the sweep managed to update, so a human
  // retrying from any of these three states is always safe: re-triages from
  // scratch off the same title/description — runPipeline already re-fetches
  // the task and starts from triage, so this only needs to reset the row to
  // a clean slate and re-kick the same fire-and-forget call createTask uses.
  async retry(taskId: string) {
    const task = await this.get(taskId);
    const retriableStatuses: typeof task.status[] = ['FAILED', 'PLANNING', 'IN_PROGRESS'];
    if (!retriableStatuses.includes(task.status)) {
      throw new ConflictException(`Task ${taskId} is ${task.status} — nothing to retry.`);
    }
    await destroyWorkspace(taskId);
    await this.prisma.aiEngineeringTask.update({
      where: { id: taskId },
      data: {
        status: 'PENDING',
        errorMessage: null,
        area: null,
        touchesSchema: false,
        migrationSql: null,
        friendlySummary: null,
        planSummary: null,
        specialistSummary: null,
        diffSummary: Prisma.JsonNull,
        verificationJson: Prisma.JsonNull,
        repairAttempts: 0,
        aiReviewPassed: null,
        aiReviewSummary: null,
        secondaryDiffSummary: Prisma.JsonNull,
        secondaryVerificationJson: Prisma.JsonNull,
        secondaryRepairAttempts: 0,
        secondaryAiReviewPassed: null,
        secondaryAiReviewSummary: null,
        workspacePath: null,
        secondaryWorkspacePath: null,
      },
    });
    this.runPipeline(taskId).catch((err) => {
      this.logger.error(`AI engineering pipeline crashed for task ${taskId}`, err);
    });
    return this.get(taskId);
  }

  private async fail(
    taskId: string,
    message: string,
    extra?: { specialistSummary?: string },
  ): Promise<void> {
    // Every fail() call site is past the point a workspace could exist (or
    // partially exist, if buildWorkspace itself threw) — destroy unconditionally
    // rather than duplicating this at each call site. Safe even when nothing
    // was ever created: destroyWorkspace is a force-rm that ignores ENOENT.
    await destroyWorkspace(taskId);
    await this.prisma.aiEngineeringTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        errorMessage: message,
        workspacePath: null,
        secondaryWorkspacePath: null,
        ...extra,
      },
    });
  }

  private async triage(task: {
    title: string;
    description: string;
    reproSteps: unknown;
    severity: string;
  }): Promise<TriageResult> {
    const [backendFiles, frontendFiles] = await Promise.all([
      listSourceFiles(path.join(getProjectDir('BACKEND'), 'src')),
      listSourceFiles(path.join(getProjectDir('FRONTEND'), 'src')),
    ]);

    const system =
      "You are the AI Project Manager for TestPilot's own internal AI Engineering Organization — you triage " +
      'bug reports about TestPilot itself (a NestJS backend + Next.js frontend QA automation platform). You ' +
      'never write code yourself, only decide where a fix belongs and sketch a plan for the engineer(s) who ' +
      'will. Return "BOTH" for area only when the fix genuinely requires coordinated backend AND frontend ' +
      'changes, and you can describe the shared contract (e.g. an API shape) precisely enough for two ' +
      "independently-scoped engineers to implement matching sides without seeing each other's code. Return " +
      '"touchesSchema": true only when area is "BACKEND" and the fix needs a Prisma schema change you can ' +
      'describe precisely (e.g. a field or model addition) — propose this instead of NEEDS_HUMAN when you are ' +
      'confident about the exact change; touchesSchema is never combined with BOTH. Choose NEEDS_HUMAN whenever ' +
      'you are not reasonably confident which files are involved, or the fix needs infrastructure/deployment ' +
      'changes — a wrong guess here wastes an isolated workspace build for nothing. Also write a ' +
      '"friendlySummary": exactly one plain-English sentence describing the problem for a non-technical ' +
      'stakeholder — no error codes, file paths, stack traces, or engineering jargon (rule names like ' +
      '"react-hooks/set-state-in-effect" or codes like "TS2345" must never appear in it), just what is wrong ' +
      'from a user\'s point of view. Return ONLY a JSON object: { "area": "BACKEND" | "FRONTEND" | "BOTH" | ' +
      '"NEEDS_HUMAN", "touchesSchema": boolean, "planSummary": string, "friendlySummary": string, ' +
      '"candidateFiles": string[], "reason": string | null }';

    const userPrompt =
      `Bug report:\nTitle: ${task.title}\nDescription: ${task.description}\n` +
      `Steps to reproduce: ${JSON.stringify(task.reproSteps ?? [])}\nSeverity: ${task.severity}\n\n` +
      `Backend source files (backend-v2/src):\n${backendFiles.join('\n')}\n\n` +
      `Frontend source files (frontend-v2/src):\n${frontendFiles.join('\n')}`;

    try {
      const parsed = await runCodexExecJson<{
        area?: string;
        touchesSchema?: boolean;
        planSummary?: string;
        friendlySummary?: string;
        candidateFiles?: string[];
        reason?: string | null;
      }>(system, userPrompt, 120_000);
      const validAreas = ['BACKEND', 'FRONTEND', 'BOTH'];
      const area = validAreas.includes(parsed.area ?? '') ? (parsed.area as AiTaskArea) : null;
      const touchesSchema = area === 'BACKEND' && parsed.touchesSchema === true;
      return {
        area,
        touchesSchema,
        planSummary: parsed.planSummary ?? '',
        friendlySummary: parsed.friendlySummary ?? '',
        candidateFiles: parsed.candidateFiles ?? [],
        reason: parsed.reason ?? undefined,
      };
    } catch (err) {
      return {
        area: null,
        touchesSchema: false,
        planSummary: '',
        friendlySummary: '',
        candidateFiles: [],
        reason: `Triage failed: ${(err as Error).message}`,
      };
    }
  }

  private buildSpecialistPrompt(
    task: { title: string; description: string; reproSteps: unknown; severity: string },
    area: SingleArea,
    triage: TriageResult,
    touchesSchema: boolean,
  ): string {
    const areaLabel = area === 'BACKEND' ? 'backend (NestJS)' : 'frontend (Next.js)';
    return [
      `You are a software engineer fixing a real bug in TestPilot, a NestJS + Next.js QA automation platform. ` +
        `You are working inside an isolated copy of the ${areaLabel} project — this copy is your entire scope. ` +
        `Make the actual code changes needed directly in these files.`,
      '',
      'Bug report:',
      `Title: ${task.title}`,
      `Description: ${task.description}`,
      `Steps to reproduce: ${JSON.stringify(task.reproSteps ?? [])}`,
      `Severity: ${task.severity}`,
      '',
      `Project Manager's triage notes: ${triage.planSummary}`,
      triage.candidateFiles.length ? `Likely relevant files: ${triage.candidateFiles.join(', ')}` : '',
      touchesSchema
        ? 'This fix may require a Prisma schema change — prisma/schema.prisma is included and editable. Do ' +
          'NOT run any `prisma` CLI commands yourself (no migrate, no generate, no db push) — schema review ' +
          'and migration generation are handled separately after your changes are reviewed by a human.'
        : '',
      '',
      'Make the minimal, correct fix — do not add unrelated refactors. When you believe the fix is complete, ' +
        'your final message must be a short (2-5 sentence) summary of exactly what you changed and why.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Repair passes are separate codex exec invocations (no session/continuity
  // between calls — see codex-cli.util.ts's runCodexAgent), so this prompt
  // has to restate enough context for a fresh call to pick up the work: it
  // reads whatever is currently on disk in the same workspace (the first
  // fix is not reverted) and is told exactly what verification found wrong.
  private buildRepairPrompt(
    task: { title: string; description: string },
    area: SingleArea,
    verification: VerificationResult,
  ): string {
    const areaLabel = area === 'BACKEND' ? 'backend (NestJS)' : 'frontend (Next.js)';
    return [
      `You are continuing to fix a bug in this same isolated copy of the ${areaLabel} project — your previous ` +
        `change is already on disk here. Verification just ran on your current change and failed.`,
      '',
      `Original bug report: ${task.title} — ${task.description}`,
      '',
      !verification.tsc.passed ? `TypeScript check (tsc --noEmit) output:\n${verification.tsc.output}` : '',
      !verification.tests.passed ? `Test suite output:\n${verification.tests.output}` : '',
      '',
      'Fix these specific failures without undoing the original bug fix. When done, your final message must be ' +
        'a short (2-5 sentence) summary of what you changed in this repair pass.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Advisory, not a gate: tsc/tests are the real pass/fail signal (deterministic,
  // not another LLM's opinion). This is a second, independent look specifically
  // at the risk tsc/tests can't see — whether the change has knock-on effects
  // elsewhere in the project that don't happen to trip a type error or an
  // existing test. Deliberately runs with --sandbox read-only: it must never be
  // able to change anything, only search/read the full project copy already
  // sitting in the workspace (buildWorkspace copies the whole src/ tree, not
  // just the touched file) and report back.
  private async runAiReview(workspaceDir: string, diffs: FileDiff[]): Promise<{ safe: boolean; summary: string } | null> {
    const diffText = diffs.map((d) => `--- ${d.path} ---\n${d.diff}`).join('\n\n');
    const prompt = [
      'You are reviewing a code change for unintended impact on the rest of the project — you have read-only ' +
        'access to a complete copy of the project source in this directory (not just the changed file). The ' +
        'change described below has already been applied here.',
      '',
      `Diff:\n${diffText}`,
      '',
      'Search the rest of the project for other usages of anything this diff changed (functions, exports, types, ' +
        'call sites) and check whether this change could break or contradict any of them. Do not run any command ' +
        'that could modify files.',
      '',
      'Your final message must be ONLY a JSON object: { "safe": boolean, "summary": string (2-4 sentences on ' +
        'what you checked and any concerns) }',
    ].join('\n');

    const result = await runCodexAgent({ cwd: workspaceDir, prompt, timeoutMs: 180_000, sandbox: 'read-only' });
    if (!result.succeeded) return null;
    try {
      return parseCodexJson<{ safe: boolean; summary: string }>(result.summary);
    } catch {
      return null;
    }
  }

  private async runAreaPipeline(params: {
    taskId: string;
    area: SingleArea;
    task: { title: string; description: string; reproSteps: unknown; severity: string };
    triage: TriageResult;
    touchesSchema: boolean;
    onRepairAttempt: (attempts: number) => Promise<void>;
  }): Promise<AreaPipelineResult> {
    const { taskId, area, task, triage, touchesSchema, onRepairAttempt } = params;

    let workspaceDir: string;
    try {
      const workspace = await buildWorkspace(taskId, area, { includeSchema: touchesSchema });
      workspaceDir = workspace.workspaceDir;
    } catch (err) {
      return { success: false, errorMessage: `Failed to build isolated workspace: ${(err as Error).message}` };
    }

    const prompt = this.buildSpecialistPrompt(task, area, triage, touchesSchema);
    const agentResult = await runCodexAgent({ cwd: workspaceDir, prompt, timeoutMs: 300_000 });
    if (!agentResult.succeeded) {
      return { success: false, errorMessage: agentResult.errorMessage ?? 'Codex agent call failed.' };
    }

    let diffs: FileDiff[] = await diffWorkspace(workspaceDir);
    if (diffs.length === 0) {
      return {
        success: false,
        errorMessage: 'Codex reported success but made no file changes.',
        specialistSummary: agentResult.summary,
      };
    }

    let migrationSql: string | undefined;
    if (touchesSchema && diffs.some((d) => d.path === 'prisma/schema.prisma')) {
      const migrationResult = await generateSchemaMigrationSql(path.join(workspaceDir, 'prisma', 'schema.prisma'));
      if (migrationResult.succeeded) migrationSql = migrationResult.sql;
    }

    const skipTestsNote =
      'Skipped: this task changes the database schema — automated tests are not run until the migration is ' +
      'applied by a human.';
    let verification = await runVerification(workspaceDir, area);
    if (touchesSchema) verification = { ...verification, tests: { passed: true, output: skipTestsNote } };
    let specialistSummary = agentResult.summary;
    let repairAttempts = 0;

    while (repairAttempts < MAX_REPAIR_ATTEMPTS && (!verification.tsc.passed || !verification.tests.passed)) {
      repairAttempts++;
      await onRepairAttempt(repairAttempts);

      const repairResult = await runCodexAgent({
        cwd: workspaceDir,
        prompt: this.buildRepairPrompt(task, area, verification),
        timeoutMs: 300_000,
      });
      if (!repairResult.succeeded) {
        specialistSummary += `\n\n(Automatic repair attempt ${repairAttempts} failed to run: ${repairResult.errorMessage ?? 'unknown error'}.)`;
        break;
      }

      const repairedDiffs = await diffWorkspace(workspaceDir);
      if (repairedDiffs.length === 0) {
        specialistSummary += `\n\n(Automatic repair attempt ${repairAttempts} removed all changes; keeping the prior fix for review.)`;
        break;
      }
      diffs = repairedDiffs;
      specialistSummary += `\n\n(Automatic repair attempt ${repairAttempts}: ${repairResult.summary})`;
      verification = await runVerification(workspaceDir, area);
      if (touchesSchema) verification = { ...verification, tests: { passed: true, output: skipTestsNote } };
    }

    const review = await this.runAiReview(workspaceDir, diffs);

    return {
      success: true,
      workspaceDir,
      diffs,
      verification,
      repairAttempts,
      specialistSummary,
      migrationSql,
      aiReviewPassed: review?.safe,
      aiReviewSummary: review?.summary,
    };
  }

  private async runPipeline(taskId: string): Promise<void> {
    await this.prisma.aiEngineeringTask.update({ where: { id: taskId }, data: { status: 'PLANNING' } });
    const task = await this.get(taskId);

    const triage = await this.triage(task);
    if (!triage.area) {
      await this.prisma.aiEngineeringTask.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          area: 'NEEDS_HUMAN',
          planSummary: triage.planSummary || undefined,
          friendlySummary: triage.friendlySummary || undefined,
          errorMessage: triage.reason ?? 'Flagged for human review by triage.',
        },
      });
      return;
    }

    await this.prisma.aiEngineeringTask.update({
      where: { id: taskId },
      data: {
        status: 'IN_PROGRESS',
        area: triage.area,
        touchesSchema: triage.touchesSchema,
        planSummary: triage.planSummary,
        friendlySummary: triage.friendlySummary,
      },
    });

    if (triage.area === 'BOTH') {
      const [backendResult, frontendResult] = await Promise.all([
        this.runAreaPipeline({
          taskId,
          area: 'BACKEND',
          task,
          triage,
          touchesSchema: false,
          onRepairAttempt: async (n) => {
            await this.prisma.aiEngineeringTask.update({ where: { id: taskId }, data: { repairAttempts: n } });
          },
        }),
        this.runAreaPipeline({
          taskId,
          area: 'FRONTEND',
          task,
          triage,
          touchesSchema: false,
          onRepairAttempt: async (n) => {
            await this.prisma.aiEngineeringTask.update({ where: { id: taskId }, data: { secondaryRepairAttempts: n } });
          },
        }),
      ]);

      if (!backendResult.success || !frontendResult.success) {
        const reasons = [
          !backendResult.success ? `Backend: ${backendResult.errorMessage}` : null,
          !frontendResult.success ? `Frontend: ${frontendResult.errorMessage}` : null,
        ]
          .filter(Boolean)
          .join(' ');
        const summaries = [
          !backendResult.success && backendResult.specialistSummary ? `Backend: ${backendResult.specialistSummary}` : null,
          !frontendResult.success && frontendResult.specialistSummary ? `Frontend: ${frontendResult.specialistSummary}` : null,
        ]
          .filter(Boolean)
          .join('\n\n');
        await this.fail(taskId, reasons || 'One side of this cross-area fix failed.', summaries ? { specialistSummary: summaries } : undefined);
        return;
      }

      await this.prisma.aiEngineeringTask.update({
        where: { id: taskId },
        data: {
          status: 'WAITING_REVIEW',
          specialistSummary: `Backend: ${backendResult.specialistSummary}\n\nFrontend: ${frontendResult.specialistSummary}`,
          diffSummary: backendResult.diffs as never,
          verificationJson: backendResult.verification as never,
          repairAttempts: backendResult.repairAttempts,
          workspacePath: backendResult.workspaceDir,
          aiReviewPassed: backendResult.aiReviewPassed,
          aiReviewSummary: backendResult.aiReviewSummary,
          secondaryDiffSummary: frontendResult.diffs as never,
          secondaryVerificationJson: frontendResult.verification as never,
          secondaryRepairAttempts: frontendResult.repairAttempts,
          secondaryWorkspacePath: frontendResult.workspaceDir,
          secondaryAiReviewPassed: frontendResult.aiReviewPassed,
          secondaryAiReviewSummary: frontendResult.aiReviewSummary,
        },
      });
      if (
        this.isEligibleForAutoApproval({
          touchesSchema: false,
          aiReviewPassed: backendResult.aiReviewPassed ?? null,
          verification: backendResult.verification,
          secondaryAiReviewPassed: frontendResult.aiReviewPassed ?? null,
          secondaryVerification: frontendResult.verification,
        })
      ) {
        await this.maybeAutoApprove(taskId);
      }
      return;
    }

    const result = await this.runAreaPipeline({
      taskId,
      area: triage.area as SingleArea,
      task,
      triage,
      touchesSchema: triage.touchesSchema,
      onRepairAttempt: async (n) => {
        await this.prisma.aiEngineeringTask.update({ where: { id: taskId }, data: { repairAttempts: n } });
      },
    });

    if (!result.success) {
      await this.fail(taskId, result.errorMessage, result.specialistSummary ? { specialistSummary: result.specialistSummary } : undefined);
      return;
    }

    await this.prisma.aiEngineeringTask.update({
      where: { id: taskId },
      data: {
        status: 'WAITING_REVIEW',
        specialistSummary: result.specialistSummary,
        diffSummary: result.diffs as never,
        verificationJson: result.verification as never,
        repairAttempts: result.repairAttempts,
        workspacePath: result.workspaceDir,
        migrationSql: result.migrationSql,
        aiReviewPassed: result.aiReviewPassed,
        aiReviewSummary: result.aiReviewSummary,
      },
    });
    if (
      this.isEligibleForAutoApproval({
        touchesSchema: triage.touchesSchema,
        aiReviewPassed: result.aiReviewPassed ?? null,
        verification: result.verification,
      })
    ) {
      await this.maybeAutoApprove(taskId);
    }
  }

  async approve(id: string, reviewedById?: string) {
    const task = await this.get(id);
    if (task.status !== 'WAITING_REVIEW') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Task is ${task.status}, expected WAITING_REVIEW.`],
        nextActions: ['Refresh and try again.'],
      });
    }
    return this.applyAndComplete(task, { reviewedById, autoApproved: false });
  }

  // Shared by a human clicking Approve and by the auto-approval path below —
  // same file-apply logic either way, only who (or what) authorized it
  // differs.
  private async applyAndComplete(
    task: Awaited<ReturnType<AiEngineeringService['get']>>,
    { reviewedById, autoApproved }: { reviewedById?: string; autoApproved: boolean },
  ) {
    if (!task.workspacePath || !task.area || task.area === 'NEEDS_HUMAN') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This task has no isolated workspace to apply changes from.'],
        nextActions: [],
      });
    }

    const primaryArea: WorkspaceArea = task.area === 'BOTH' ? 'BACKEND' : (task.area as WorkspaceArea);
    const diffs = (task.diffSummary as unknown as FileDiff[] | null) ?? [];
    const changedFiles = diffs.map((d) => d.path);
    let result = await applyApprovedChanges(task.workspacePath, getProjectDir(primaryArea), changedFiles, {
      allowSchema: task.touchesSchema,
    });

    if (task.area === 'BOTH' && task.secondaryWorkspacePath) {
      const secondaryDiffs = (task.secondaryDiffSummary as unknown as FileDiff[] | null) ?? [];
      const secondaryChangedFiles = secondaryDiffs.map((d) => d.path);
      const secondaryResult = await applyApprovedChanges(
        task.secondaryWorkspacePath,
        getProjectDir('FRONTEND'),
        secondaryChangedFiles,
      );
      result = {
        appliedFiles: [...result.appliedFiles, ...secondaryResult.appliedFiles],
        skippedFiles: [...result.skippedFiles, ...secondaryResult.skippedFiles],
      };
    }

    if (task.touchesSchema && task.migrationSql) {
      await writeDraftMigration(task.migrationSql, task.title);
    }

    await destroyWorkspace(task.id);

    await this.prisma.aiEngineeringTask.update({
      where: { id: task.id },
      data: {
        status: 'COMPLETED',
        reviewedById,
        autoApproved,
        workspacePath: null,
        secondaryWorkspacePath: null,
        completedAt: new Date(),
      },
    });
    return result;
  }

  // Val's clean review (no concerns) + verification actually passing + no
  // schema involved is the one combination trusted enough to skip the human
  // gate entirely — a deliberate choice, made only after being asked
  // explicitly, that this specific combination is safe to auto-apply. A
  // flagged review, a failing check, or any schema change always still
  // falls back to a human via WAITING_REVIEW; this never touches that path.
  private isEligibleForAutoApproval(params: {
    touchesSchema: boolean;
    aiReviewPassed: boolean | null;
    verification: VerificationResult;
    secondaryAiReviewPassed?: boolean | null;
    secondaryVerification?: VerificationResult;
  }): boolean {
    if (params.touchesSchema) return false;
    const primaryClean = params.aiReviewPassed === true && params.verification.tsc.passed && params.verification.tests.passed;
    if (!primaryClean) return false;
    if (params.secondaryVerification) {
      return (
        params.secondaryAiReviewPassed === true &&
        params.secondaryVerification.tsc.passed &&
        params.secondaryVerification.tests.passed
      );
    }
    return true;
  }

  private async maybeAutoApprove(taskId: string) {
    const task = await this.get(taskId);
    if (task.status !== 'WAITING_REVIEW') return;
    await this.applyAndComplete(task, { reviewedById: undefined, autoApproved: true });
  }

  async reject(id: string, reviewedById?: string) {
    const task = await this.get(id);
    if (task.status !== 'WAITING_REVIEW') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Task is ${task.status}, expected WAITING_REVIEW.`],
        nextActions: ['Refresh and try again.'],
      });
    }
    await destroyWorkspace(id);
    await this.prisma.aiEngineeringTask.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById, workspacePath: null, secondaryWorkspacePath: null },
    });
    return { success: true };
  }

  // Runs nightly, unattended — the user explicitly chose a scheduled trigger
  // over an admin-clicked button. Every finding is grounded in a real tsc/
  // eslint run (never an LLM guessing at bugs), capped per run, and deduped
  // against tasks that are already open so a repeat run doesn't pile up
  // duplicates for the same unresolved issue.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runScheduledScan(): Promise<void> {
    const findings: ScanFinding[] = [];
    for (const area of ['BACKEND', 'FRONTEND'] as const) {
      const projectDir = getProjectDir(area);
      const [tscResult, eslintResult] = await Promise.all([
        runCommand('npx', ['tsc', '--noEmit'], projectDir),
        runCommand('npx', ['eslint', 'src'], projectDir),
      ]);
      findings.push(...parseTscFindings(tscResult.stdout + tscResult.stderr, area));
      findings.push(...parseEslintFindings(eslintResult.stdout + eslintResult.stderr, area, projectDir));
    }

    const existingOpenTasks = await this.prisma.aiEngineeringTask.findMany({
      where: { status: { in: ['PENDING', 'PLANNING', 'IN_PROGRESS', 'WAITING_REVIEW'] } },
      select: { description: true },
    });

    let created = 0;
    for (const finding of findings) {
      if (created >= MAX_TASKS_PER_SCAN) break;
      const alreadyOpen = existingOpenTasks.some((t) => t.description.includes(finding.file));
      if (alreadyOpen) continue;

      await this.createTask(
        {
          title: `Scan found: ${finding.message.slice(0, 80)} (${finding.file})`,
          description:
            `Automated nightly scan found a real, reproducible issue in ${finding.file}:\n${finding.message}\n\n` +
            'Confirmed by running the project\'s own tsc/eslint — not guessed.',
          reproSteps: [`Run tsc --noEmit or eslint on ${finding.file}`, `Observe: ${finding.message}`],
          severity: 'LOW',
        },
        undefined,
        'SCHEDULED_SCAN',
      );
      created++;
    }
  }

  // Chat with the team — a lightweight Q&A channel via AiProvider.generateText
  // (fast, local Ollama call), deliberately separate from the heavy Codex CLI
  // pipeline above that actually triages/fixes tasks. Chat never authors code
  // or changes task state; it only answers questions about real, already-
  // recorded work, so there's nothing here for a human to approve.
  private readonly PERSONA_INFO: Record<string, { name: string; role: string; voice: string }> = {
    pm: {
      name: 'Pavi',
      role: 'AI Project Manager',
      voice: 'You triage incoming bug reports, decide which area they touch, and coordinate the rest of the team. Speak like a calm, organized PM.',
    },
    backend: {
      name: 'Dev',
      role: 'Backend Engineer',
      voice: 'You write and fix backend (NestJS/Prisma) code for the tasks assigned to you. Speak like a pragmatic backend engineer.',
    },
    frontend: {
      name: 'Fiona',
      role: 'Frontend Engineer',
      voice: 'You write and fix frontend (Next.js/React) code for the tasks assigned to you. Speak like a detail-oriented frontend engineer.',
    },
    db: {
      name: 'Sam',
      role: 'Database Engineer',
      voice: 'You handle schema changes and migrations — you draft SQL but never run it yourself, a human always applies it. Speak like a careful database engineer.',
    },
    reviewer: {
      name: 'Val',
      role: 'Senior Engineer',
      voice: 'You do an advisory code review pass on every task before a human signs off — your review never blocks approval. Speak like an experienced, constructive senior engineer.',
    },
    qa: {
      name: 'Robo',
      role: 'QA Verifier',
      voice: 'You run the real typecheck and test suite against every fix and report pass/fail. Speak like a precise, no-nonsense QA engineer.',
    },
  };

  private async getRecentTasksForPersona(personaId: string) {
    const where: Prisma.AiEngineeringTaskWhereInput =
      personaId === 'backend'
        ? { OR: [{ area: 'BACKEND' }, { area: 'BOTH' }] }
        : personaId === 'frontend'
          ? { OR: [{ area: 'FRONTEND' }, { area: 'BOTH' }] }
          : personaId === 'db'
            ? { touchesSchema: true }
            : personaId === 'reviewer'
              ? { OR: [{ aiReviewSummary: { not: null } }, { secondaryAiReviewSummary: { not: null } }] }
              : personaId === 'qa'
                ? { verificationJson: { not: Prisma.JsonNull } }
                : {};

    return this.prisma.aiEngineeringTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { title: true, status: true },
    });
  }

  listChatMessages(personaId: string) {
    return this.prisma.aiChatMessage.findMany({
      where: { personaId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendChatMessage(personaId: string, content: string, askedById?: string) {
    const persona = this.PERSONA_INFO[personaId];
    if (!persona) {
      throw new NotFoundException(`Unknown persona ${personaId}`);
    }

    await this.prisma.aiChatMessage.create({
      data: { personaId, role: 'USER', content, askedById },
    });

    const recentTasks = await this.getRecentTasksForPersona(personaId);
    const contextBlock = recentTasks.length
      ? `Recent tasks you've been involved with:\n${recentTasks.map((t) => `- [${t.status}] ${t.title}`).join('\n')}`
      : "You haven't been involved in any tasks yet.";

    const systemPrompt =
      `You are ${persona.name}, the ${persona.role} on TestPilot's AI Engineering team — a self-testing pipeline ` +
      `where AI personas triage, fix, and verify bugs in TestPilot itself, with a human always approving before ` +
      `anything reaches real source. ${persona.voice}\n\n${contextBlock}\n\n` +
      "Answer the admin's question conversationally and concisely (a few sentences), grounded in the real work " +
      "above — don't invent tasks or results that aren't listed.";

    let replyContent: string;
    try {
      const completion = await this.aiProvider.generateText(content, { system: systemPrompt, temperature: 0.4 });
      replyContent = completion.content;
    } catch (err) {
      replyContent = `Sorry, I couldn't reach the AI provider right now (${err instanceof Error ? err.message : 'unknown error'}).`;
    }

    return this.prisma.aiChatMessage.create({
      data: { personaId, role: 'ASSISTANT', content: replyContent },
    });
  }
}
