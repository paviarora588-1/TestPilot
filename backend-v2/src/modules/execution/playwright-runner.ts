import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

// child.kill() only signals the direct child (this Playwright CLI process),
// not the Chromium browser (and its own GPU/renderer subprocesses) it spawns
// — on Windows that leaves the browser running indefinitely after a timeout,
// confirmed by orphaned chrome.exe processes surviving well past a killed
// run. taskkill's /T kills the whole process tree.
function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined);
  }
}

export interface PlaywrightStepResult {
  title: string;
  duration: number;
  error?: { message: string };
}

export interface PlaywrightTestResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  error?: { message: string };
  errors: { message: string }[];
  attachments: { name: string; path?: string; contentType: string }[];
  steps: PlaywrightStepResult[];
}

interface RawSuite {
  specs?: { tests?: { results?: PlaywrightTestResult[] }[] }[];
  suites?: RawSuite[];
}

function collectSpecs(suites: RawSuite[] | undefined): NonNullable<RawSuite['specs']>[number][] {
  if (!suites) return [];
  const specs: NonNullable<RawSuite['specs']>[number][] = [];
  for (const suite of suites) {
    if (suite.specs) specs.push(...suite.specs);
    if (suite.suites) specs.push(...collectSpecs(suite.suites));
  }
  return specs;
}

export interface RunPlaywrightResult {
  passed: boolean;
  durationMs: number;
  testResult: PlaywrightTestResult | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs one generated spec file in the shared scratch Playwright project via
 * its own JSON reporter output — not console.log regex-scraping (the legacy
 * app's approach) — so step-level pass/fail/duration/error come from
 * Playwright's own structured result, matched 1:1 against our test.step()
 * calls in the generated spec.
 */
export async function runPlaywrightSpec(params: {
  projectDir: string;
  specFileName: string;
  timeoutMs: number;
}): Promise<RunPlaywrightResult> {
  const { projectDir, specFileName, timeoutMs } = params;
  const resultsDir = path.join(projectDir, 'test-results');
  const resultsPath = path.join(resultsDir, 'results.json');
  await fs.rm(resultsPath, { force: true }).catch(() => undefined);
  // Per-step screenshots use fixed step-<order>.png names (see
  // playwright-compiler.ts) so a run that crashes before reaching a step
  // can't be attributed a stale screenshot left over from a previous run.
  await fs
    .readdir(resultsDir)
    .then((files) => Promise.all(files.filter((f) => /^step-\d+\.png$/.test(f)).map((f) => fs.rm(path.join(resultsDir, f)))))
    .catch(() => undefined);

  // Spawn Playwright's own CLI entry file directly via `node`, rather than
  // `npx`/`npx.cmd` — this sidesteps two Windows-only problems: (1) Node
  // refuses to spawn a .cmd file without shell:true (throws EINVAL), and
  // (2) shell:true with an args array only concatenates them unescaped
  // (Node flags this as a command-injection risk, DEP0190). Invoking the
  // JS entry point with execFile-style argv avoids a shell entirely.
  // '@playwright/test/cli.js' isn't a subpath its package.json "exports"
  // map allows resolving directly, so resolve the package root via its
  // main entry point instead and join the on-disk file path from there.
  const testPkgRoot = path.dirname(require.resolve('@playwright/test'));
  const playwrightCli = path.join(testPkgRoot, 'cli.js');
  // --config must be an absolute path: npx/playwright resolves a relative
  // one against the nearest package.json directory (backend-v2), not cwd,
  // which silently made it scan backend-v2/src instead of this scratch project.
  const configPath = path.join(projectDir, 'playwright.config.ts');

  const { stdout, stderr, timedOut } = await new Promise<{ stdout: string; stderr: string; timedOut: boolean }>(
    (resolve) => {
      const child = spawn(
        process.execPath,
        [playwrightCli, 'test', '--config', configPath, `tests/${specFileName}`],
        {
          cwd: projectDir,
          env: process.env,
          windowsHide: true,
        },
      );
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        if (child.pid) killProcessTree(child.pid);
      }, timeoutMs);
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      // 'exit', not 'close': Playwright launches Chromium as a child of this
      // process, and on Windows a lingering browser/renderer subprocess (GPU
      // process, crashpad handler — doesn't always exit cleanly with the
      // test run) can keep holding the inherited stdio pipes open. 'close'
      // only fires once every process sharing those pipes has exited, so a
      // straggling browser process silently hung this promise forever even
      // after the actual test run had passed and results.json was already
      // written — confirmed on a run whose screenshots proved it passed but
      // still got force-failed by the outer watchdog. 'exit' fires as soon
      // as this direct child terminates, which is all that's needed since
      // pass/fail is read from results.json on disk, not from this stream.
      child.on('exit', () => {
        clearTimeout(timer);
        resolve({ stdout, stderr, timedOut });
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve({ stdout, stderr: stderr + '\nFailed to spawn playwright process', timedOut });
      });
    },
  );

  let testResult: PlaywrightTestResult | null = null;
  let passed = false;
  let durationMs = 0;
  try {
    const raw = JSON.parse(await fs.readFile(resultsPath, 'utf-8'));
    durationMs = raw.stats?.duration ?? 0;
    const specs = collectSpecs(raw.suites);
    const firstResult = specs[0]?.tests?.[0]?.results?.[0];
    if (firstResult) {
      testResult = firstResult;
      passed = firstResult.status === 'passed';
    }
  } catch {
    // Reporter file missing/unparsable (e.g. crashed before flush) — passed stays false.
  }

  return { passed, durationMs, testResult, stdout, stderr, timedOut };
}
