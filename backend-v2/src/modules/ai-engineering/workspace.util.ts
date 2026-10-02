import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Per-task isolation without needing git in the main repo (there isn't one
// yet, confirmed — d:\TestPilot has no .git anywhere). Each task gets its
// own throwaway copy of just the source it's allowed to touch, plus its own
// SCRATCH git init purely as an implementation detail (Codex CLI's own
// tooling assumes a real repo; this gives it one without ever touching
// TestPilot's own, currently git-less, source tree). Deleting the task
// directory is the entire cleanup story — no partial-state to reconcile.
export type WorkspaceArea = 'BACKEND' | 'FRONTEND';

const REPO_ROOT = path.join(process.cwd(), '..');
const TASKS_ROOT = path.join(REPO_ROOT, '.ai-tasks');

interface AreaConfig {
  projectDir: string;
  rootFiles: string[];
  copyDirs: string[];
  junctionDirs: string[];
}

const AREA_CONFIG: Record<WorkspaceArea, AreaConfig> = {
  BACKEND: {
    projectDir: path.join(REPO_ROOT, 'backend-v2'),
    rootFiles: ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json'],
    copyDirs: ['src'],
    // node_modules for real installed deps; generated for the Prisma client
    // (backend source imports from '../../generated/prisma/...' throughout —
    // without this, tsc fails on the very first file). Junctioned, not
    // copied: the specialist has no reason to edit either, and a junction
    // costs no disk space or copy time.
    junctionDirs: ['node_modules', 'generated'],
  },
  FRONTEND: {
    projectDir: path.join(REPO_ROOT, 'frontend-v2'),
    rootFiles: ['package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'components.json', 'next-env.d.ts'],
    copyDirs: ['src'],
    junctionDirs: ['node_modules'],
  },
};

// Deliberately not part of AreaConfig.copyDirs/rootFiles for BACKEND:
// prisma/schema.prisma is never copied into a workspace at all — not
// read-only, not present. A bug that needs a schema change is exactly the
// "needs a human" case the PM triage step is meant to flag, and the
// specialist can't touch what was never given to it in the first place.

export interface WorkspaceHandle {
  taskId: string;
  area: WorkspaceArea;
  workspaceDir: string;
}

export async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: err.message }));
  });
}

async function createJunction(dest: string, target: string): Promise<void> {
  await runCommand('cmd', ['/c', 'mklink', '/J', dest, target], path.dirname(dest));
}

export async function buildWorkspace(
  taskId: string,
  area: WorkspaceArea,
  opts?: { includeSchema?: boolean },
): Promise<WorkspaceHandle> {
  const config = AREA_CONFIG[area];
  const taskDir = path.join(TASKS_ROOT, taskId);
  const workspaceDir = path.join(taskDir, path.basename(config.projectDir));
  await fs.mkdir(workspaceDir, { recursive: true });

  for (const file of config.rootFiles) {
    await fs.copyFile(path.join(config.projectDir, file), path.join(workspaceDir, file)).catch(() => undefined);
  }
  for (const dir of config.copyDirs) {
    await fs.cp(path.join(config.projectDir, dir), path.join(workspaceDir, dir), { recursive: true });
  }
  for (const dir of config.junctionDirs) {
    await createJunction(path.join(workspaceDir, dir), path.join(config.projectDir, dir)).catch(() => undefined);
  }
  // Only ever requested for BACKEND (touchesSchema tasks) — a single
  // writable file, not the whole prisma/ dir. Still never .env: the
  // specialist edits schema.prisma as plain text, nothing more; migration
  // SQL generation happens later, in the service's own process, not here.
  if (area === 'BACKEND' && opts?.includeSchema) {
    const schemaSrc = path.join(config.projectDir, 'prisma', 'schema.prisma');
    const schemaDest = path.join(workspaceDir, 'prisma', 'schema.prisma');
    await fs.mkdir(path.dirname(schemaDest), { recursive: true });
    await fs.copyFile(schemaSrc, schemaDest).catch(() => undefined);
  }

  // .gitignore before the first commit — without it, `git add -A` would try
  // to index the junctioned node_modules/generated trees (thousands of
  // files, no value in tracking them, and painfully slow). `.next/` matters
  // for the same reason specifically for FRONTEND: if the specialist (or its
  // own verification) ever runs a Next.js build/dev server inside the
  // workspace, hundreds of compiled chunk/manifest files land here and, left
  // untracked, get swept into `git add -A` and bloat the diff a human has to
  // review with zero real content (confirmed live — a genuine 3-file fix
  // showed up as 533 changed files). Harmless to include for BACKEND too,
  // which never produces one.
  const gitignoreLines = [...config.junctionDirs.map((d) => `${d}/`), 'dist/', '.next/'];
  await fs.writeFile(path.join(workspaceDir, '.gitignore'), gitignoreLines.join('\n') + '\n', 'utf-8');

  await runCommand('git', ['init', '-q'], workspaceDir);
  await runCommand('git', ['config', 'user.email', 'ai-engineering@testpilot.local'], workspaceDir);
  await runCommand('git', ['config', 'user.name', 'TestPilot AI Engineering'], workspaceDir);
  await runCommand('git', ['add', '-A'], workspaceDir);
  await runCommand('git', ['commit', '-q', '-m', 'baseline'], workspaceDir);

  return { taskId, area, workspaceDir };
}

export interface FileDiff {
  path: string;
  diff: string;
}

// Stages everything (respecting .gitignore) before diffing so a new file
// the specialist created shows up too, not just modifications to files that
// already existed at baseline.
export async function diffWorkspace(workspaceDir: string): Promise<FileDiff[]> {
  await runCommand('git', ['add', '-A'], workspaceDir);
  const { stdout: nameStatus } = await runCommand('git', ['diff', '--cached', '--name-only'], workspaceDir);
  const files = nameStatus
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const diffs: FileDiff[] = [];
  for (const file of files) {
    const { stdout } = await runCommand('git', ['diff', '--cached', '--', file], workspaceDir);
    diffs.push({ path: file, diff: stdout });
  }
  return diffs;
}

export interface VerificationResult {
  tsc: { passed: boolean; output: string };
  tests: { passed: boolean; output: string };
}

const MAX_OUTPUT_CHARS = 8000;

export async function runVerification(workspaceDir: string, area: WorkspaceArea): Promise<VerificationResult> {
  const tscResult = await runCommand('npx', ['tsc', '--noEmit'], workspaceDir);
  const tsc = {
    passed: tscResult.code === 0,
    output: (tscResult.stdout + tscResult.stderr).slice(0, MAX_OUTPUT_CHARS),
  };

  if (area !== 'BACKEND') {
    return { tsc, tests: { passed: true, output: 'No automated test suite for this area yet.' } };
  }
  const testResult = await runCommand('npx', ['jest', '--silent'], workspaceDir);
  const tests = {
    passed: testResult.code === 0,
    output: (testResult.stdout + testResult.stderr).slice(0, MAX_OUTPUT_CHARS),
  };
  return { tsc, tests };
}

export interface TestCaseResult {
  name: string;
  status: 'passed' | 'failed' | 'pending';
  durationMs: number | null;
}

export interface TestFileResult {
  file: string;
  status: 'passed' | 'failed';
  tests: TestCaseResult[];
}

export interface TestSuiteResult {
  ranAt: string;
  durationMs: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  files: TestFileResult[];
}

// Runs the REAL test suite against the real project directory for the given
// area (not an isolated workspace — there's nothing to isolate from, this
// only reads test results, never modifies source). `--outputFile` (not the
// bare stdout `--json`) so a test's own console output (e.g. ScannerService's
// intentional `console.error` in its "crash" test case) can never get mixed
// into the JSON we parse. Jest's and Vitest's `--json` reporters share the
// exact same shape for the fields used here, so one parser covers both.
async function runFullTestSuite(area: WorkspaceArea): Promise<TestSuiteResult> {
  const projectDir = getProjectDir(area);
  const outputFile = path.join(
    os.tmpdir(),
    `ai-engineering-test-${area.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const started = Date.now();
  if (area === 'BACKEND') {
    await runCommand('npx', ['jest', '--silent', '--json', `--outputFile=${outputFile}`], projectDir);
  } else {
    await runCommand('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`], projectDir);
  }
  const durationMs = Date.now() - started;

  const raw = await fs.readFile(outputFile, 'utf-8');
  await fs.rm(outputFile, { force: true });
  const parsed = JSON.parse(raw) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    testResults: Array<{
      name: string;
      status: string;
      assertionResults: Array<{ fullName: string; title: string; status: string; duration: number | null }>;
    }>;
  };

  const files: TestFileResult[] = parsed.testResults.map((suite) => ({
    file: path.relative(projectDir, suite.name).replace(/\\/g, '/'),
    status: suite.status === 'passed' ? 'passed' : 'failed',
    tests: suite.assertionResults.map((t) => ({
      name: t.fullName || t.title,
      status: t.status as TestCaseResult['status'],
      durationMs: t.duration,
    })),
  }));

  return {
    ranAt: new Date().toISOString(),
    durationMs,
    numTotalTests: parsed.numTotalTests,
    numPassedTests: parsed.numPassedTests,
    numFailedTests: parsed.numFailedTests,
    files,
  };
}

export function runFullBackendTestSuite(): Promise<TestSuiteResult> {
  return runFullTestSuite('BACKEND');
}

export function runFullFrontendTestSuite(): Promise<TestSuiteResult> {
  return runFullTestSuite('FRONTEND');
}

interface PlaywrightSpec {
  title: string;
  tests: Array<{ results: Array<{ status: string; duration: number }> }>;
}
interface PlaywrightSuite {
  file: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

function collectPlaywrightSpecs(suite: PlaywrightSuite): PlaywrightSpec[] {
  const specs = [...(suite.specs ?? [])];
  for (const nested of suite.suites ?? []) specs.push(...collectPlaywrightSpecs(nested));
  return specs;
}

// Runs the REAL Playwright e2e suite (frontend-v2/e2e) against whatever is
// currently live on localhost:3000/4000 — a genuinely different kind of
// "test" than jest/vitest above: it drives a real browser through the real
// running app (login, scan, generate, execute...), not an isolated unit.
// Takes minutes, not seconds — real AI calls and real browser automation
// don't get faster just because this is a "regression suite" button.
// `--reporter=json` alone (no config outputFile) prints valid JSON straight
// to stdout, confirmed live — simpler than jest/vitest's temp-file dance.
export async function runFullE2ETestSuite(): Promise<TestSuiteResult> {
  const projectDir = getProjectDir('FRONTEND');
  const started = Date.now();
  const result = await runCommand('npx', ['playwright', 'test', '--reporter=json'], projectDir);
  const durationMs = Date.now() - started;

  const parsed = JSON.parse(result.stdout) as { suites: PlaywrightSuite[] };

  const files: TestFileResult[] = parsed.suites.map((fileSuite) => {
    const specs = collectPlaywrightSpecs(fileSuite);
    const tests: TestCaseResult[] = specs.map((spec) => {
      const lastResult = spec.tests[0]?.results?.at(-1);
      const status: TestCaseResult['status'] =
        lastResult?.status === 'passed' ? 'passed' : lastResult?.status === 'skipped' ? 'pending' : 'failed';
      return { name: spec.title, status, durationMs: lastResult?.duration ?? null };
    });
    return {
      file: fileSuite.file,
      status: tests.some((t) => t.status === 'failed') ? 'failed' : 'passed',
      tests,
    };
  });

  const numTotalTests = files.reduce((sum, f) => sum + f.tests.length, 0);
  const numPassedTests = files.reduce((sum, f) => sum + f.tests.filter((t) => t.status === 'passed').length, 0);
  const numFailedTests = files.reduce((sum, f) => sum + f.tests.filter((t) => t.status === 'failed').length, 0);

  return { ranAt: new Date().toISOString(), durationMs, numTotalTests, numPassedTests, numFailedTests, files };
}

// Only ever true for a real, editable source file — never a config/root
// file (those are present in the workspace purely so tsc/jest resolve
// correctly, never meant to be changed) and never anything outside src/.
// The one exception is prisma/schema.prisma, and only when the caller
// explicitly opts in via allowSchema (touchesSchema tasks only) — every
// other caller keeps the exact same src/-only behavior as before.
// Exported standalone so this rule is unit-testable without touching disk.
export function isPathEligibleForCopyBack(relativePath: string, opts?: { allowSchema?: boolean }): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (opts?.allowSchema && normalized === 'prisma/schema.prisma') return true;
  return normalized.startsWith('src/');
}

export interface ApplyResult {
  appliedFiles: string[];
  skippedFiles: string[];
}

export async function applyApprovedChanges(
  workspaceDir: string,
  projectDir: string,
  changedFiles: string[],
  opts?: { allowSchema?: boolean },
): Promise<ApplyResult> {
  const appliedFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const relPath of changedFiles) {
    if (!isPathEligibleForCopyBack(relPath, opts)) {
      skippedFiles.push(relPath);
      continue;
    }
    const workspaceFile = path.join(workspaceDir, relPath);
    const realFile = path.join(projectDir, relPath);
    const existsInWorkspace = await fs
      .access(workspaceFile)
      .then(() => true)
      .catch(() => false);
    // The specialist deleted this file in its copy — never delete a live
    // file automatically, matching the "never delete project files" rule
    // literally. Flagged as skipped so a human notices and decides by hand.
    if (!existsInWorkspace) {
      skippedFiles.push(relPath);
      continue;
    }
    await fs.mkdir(path.dirname(realFile), { recursive: true });
    await fs.copyFile(workspaceFile, realFile);
    appliedFiles.push(relPath);
  }

  return { appliedFiles, skippedFiles };
}

export function getProjectDir(area: WorkspaceArea): string {
  return AREA_CONFIG[area].projectDir;
}

export async function destroyWorkspace(taskId: string): Promise<void> {
  await fs.rm(path.join(TASKS_ROOT, taskId), { recursive: true, force: true }).catch(() => undefined);
}

export interface MigrationDiffResult {
  sql: string;
  succeeded: boolean;
  errorMessage?: string;
}

// Pure file-to-file schema diff — --from-schema-datamodel/--to-schema-datamodel
// need no database connection at all (unlike --from-url/--to-url), which is
// exactly why this runs safely even though the isolated workspace was never
// given any DB credentials or a shadow database. Runs with cwd = the REAL
// backend-v2 project (not the workspace) since that's where a real `prisma`
// install and schema.prisma baseline already live.
export async function generateSchemaMigrationSql(workspaceSchemaPath: string): Promise<MigrationDiffResult> {
  const realSchemaPath = path.join(AREA_CONFIG.BACKEND.projectDir, 'prisma', 'schema.prisma');
  const result = await runCommand(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-schema-datamodel',
      realSchemaPath,
      '--to-schema-datamodel',
      workspaceSchemaPath,
      '--script',
    ],
    AREA_CONFIG.BACKEND.projectDir,
  );
  if (result.code !== 0) {
    return { sql: '', succeeded: false, errorMessage: result.stderr.trim() || `prisma migrate diff exited with code ${result.code}` };
  }
  return { sql: result.stdout.trim(), succeeded: true };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'change';
}

// Writes a migration file in exactly the layout Prisma's own CLI would —
// backend-v2/prisma/migrations/<timestamp>_<slug>/migration.sql — so a
// human's later `npx prisma migrate deploy` picks it up as a normal pending
// migration. Deliberately the only thing this function does: it never runs
// `migrate deploy`, `db push`, or `migrate dev` — file write only.
export async function writeDraftMigration(sql: string, description: string): Promise<{ migrationDir: string }> {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const migrationDir = path.join(AREA_CONFIG.BACKEND.projectDir, 'prisma', 'migrations', `${timestamp}_${slugify(description)}`);
  await fs.mkdir(migrationDir, { recursive: true });
  await fs.writeFile(path.join(migrationDir, 'migration.sql'), sql, 'utf-8');
  return { migrationDir };
}
