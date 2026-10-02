import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SeleniumStepResult {
  stepOrder: number;
  status: 'PASS' | 'FAIL';
  message: string;
}

export interface RunSeleniumResult {
  passed: boolean;
  durationMs: number;
  steps: SeleniumStepResult[];
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs one generated Selenium (Java) test via Maven. JUnit has no built-in
 * per-step reporting the way Playwright's test.step() does, so this reads
 * the step-log.txt the compiled test itself writes (see
 * script-generator/selenium-java-compiler.ts) rather than inferring step
 * outcomes from a stack trace — same "no fragile inference" approach as the
 * rest of this app's reporting.
 */
export async function runSeleniumSpec(params: {
  projectDir: string;
  testClassName: string;
  timeoutMs: number;
}): Promise<RunSeleniumResult> {
  const { projectDir, testClassName, timeoutMs } = params;
  const resultsDir = path.join(projectDir, 'test-results');
  const stepLogPath = path.join(resultsDir, 'step-log.txt');
  await fs.rm(stepLogPath, { force: true }).catch(() => undefined);
  // Same reasoning as playwright-runner.ts: fixed step-<order>.png names mean
  // a run that crashes early can't be attributed a stale screenshot left
  // over from a previous run.
  await fs
    .readdir(resultsDir)
    .then((files) => Promise.all(files.filter((f) => /^step-\d+\.png$/.test(f)).map((f) => fs.rm(path.join(resultsDir, f)))))
    .catch(() => undefined);

  const startedAt = Date.now();
  // A single pre-built command string with shell:true and no args array —
  // Maven's launcher is a .cmd/shell script on Windows (same EINVAL problem
  // npx had), and unlike npx there's no JS entry point to invoke directly
  // via `node`. Building the whole line ourselves (instead of passing an
  // args array alongside shell:true) is what avoids Node's DEP0190 warning:
  // there's nothing left for Node to unsafely concatenate — testClassName is
  // always our own toPascalCase() output, never user input.
  const command = `mvn test "-Dtest=${testClassName}"`;

  const { stdout, stderr, timedOut, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    timedOut: boolean;
    exitCode: number | null;
  }>((resolve) => {
    const child = spawn(command, {
      cwd: projectDir,
      env: process.env,
      windowsHide: true,
      shell: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, exitCode: code });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + '\nFailed to spawn Maven process', timedOut, exitCode: null });
    });
  });

  const durationMs = Date.now() - startedAt;

  const steps: SeleniumStepResult[] = [];
  try {
    const raw = await fs.readFile(stepLogPath, 'utf-8');
    for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [orderStr, status, ...messageParts] = line.split('|');
      const stepOrder = Number(orderStr);
      if (!Number.isFinite(stepOrder) || (status !== 'PASS' && status !== 'FAIL')) continue;
      steps.push({ stepOrder, status, message: messageParts.join('|') });
    }
  } catch {
    // step-log.txt missing (e.g. crashed before the test method even started) — steps stays [].
  }

  return { passed: exitCode === 0 && !timedOut, durationMs, steps, stdout, stderr, timedOut };
}
