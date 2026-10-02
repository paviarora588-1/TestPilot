import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveSapGuiInterpreter } from '../../common/sap-gui-interpreter.util';

export interface SapGuiStepResult {
  stepOrder: number;
  status: 'PASS' | 'FAIL';
  message: string;
}

export interface RunSapGuiResult {
  passed: boolean;
  durationMs: number;
  steps: SapGuiStepResult[];
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs one generated SAP GUI PowerShell script (sap-gui-compiler.ts) and
 * reads the step-log.txt it writes — same "<order>|PASS|"/"<order>|FAIL|msg"
 * pipe-delimited format selenium-runner.ts already parses, since SAP GUI
 * Scripting has no built-in per-step reporting either.
 */
export async function runSapGuiSpec(params: {
  projectDir: string;
  specFileName: string;
  timeoutMs: number;
}): Promise<RunSapGuiResult> {
  const { projectDir, specFileName, timeoutMs } = params;
  const resultsDir = path.join(projectDir, 'test-results');
  const stepLogPath = path.join(resultsDir, 'step-log.txt');
  await fs.rm(stepLogPath, { force: true }).catch(() => undefined);

  const scriptPath = path.join(projectDir, specFileName);
  const startedAt = Date.now();

  // Direct binary invocation (no shell:true) with an args array — same
  // Windows spawn-safety pattern used by sap-gui-scanner.util.ts and
  // playwright-runner.ts, avoiding both EINVAL on .cmd wrappers and Node's
  // DEP0190 unsafe-argument-concatenation warning.
  const { stdout, stderr, timedOut, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    timedOut: boolean;
    exitCode: number | null;
  }>((resolve) => {
    const child = spawn(
      resolveSapGuiInterpreter('powershell.exe'),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { cwd: projectDir, env: process.env, windowsHide: true },
    );
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
      resolve({ stdout, stderr: stderr + '\nFailed to spawn PowerShell process', timedOut, exitCode: null });
    });
  });

  const durationMs = Date.now() - startedAt;

  const steps: SapGuiStepResult[] = [];
  try {
    const raw = await fs.readFile(stepLogPath, 'utf-8');
    for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [orderStr, status, ...messageParts] = line.split('|');
      const stepOrder = Number(orderStr);
      if (!Number.isFinite(stepOrder) || (status !== 'PASS' && status !== 'FAIL')) continue;
      steps.push({ stepOrder, status, message: messageParts.join('|') });
    }
  } catch {
    // step-log.txt missing (e.g. failed to attach before the first step ran) — steps stays [].
  }

  return {
    passed: exitCode === 0 && !timedOut && steps.length > 0,
    durationMs,
    steps,
    stdout,
    stderr,
    timedOut,
  };
}

// Second SAP GUI runner alongside runSapGuiSpec above — spawns cscript.exe
// instead of powershell.exe, for scripts from sap-gui-vbscript-compiler.ts.
// runSapGuiSpec itself is untouched; the caller picks between the two based
// on the generated spec file's extension (.ps1 vs .vbs), not a schema
// change, so existing PowerShell-generated scripts keep routing exactly as
// before. Same step-log parsing (identical pipe-delimited format).
export async function runSapGuiVbsSpec(params: {
  projectDir: string;
  specFileName: string;
  timeoutMs: number;
}): Promise<RunSapGuiResult> {
  const { projectDir, specFileName, timeoutMs } = params;
  const resultsDir = path.join(projectDir, 'test-results');
  const stepLogPath = path.join(resultsDir, 'step-log.txt');
  await fs.rm(stepLogPath, { force: true }).catch(() => undefined);

  const scriptPath = path.join(projectDir, specFileName);
  const startedAt = Date.now();

  const { stdout, stderr, timedOut, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    timedOut: boolean;
    exitCode: number | null;
  }>((resolve) => {
    const child = spawn(resolveSapGuiInterpreter('cscript.exe'), ['//NoLogo', scriptPath], {
      cwd: projectDir,
      env: process.env,
      windowsHide: true,
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
      resolve({ stdout, stderr: stderr + '\nFailed to spawn cscript process', timedOut, exitCode: null });
    });
  });

  const durationMs = Date.now() - startedAt;

  const steps: SapGuiStepResult[] = [];
  try {
    const raw = await fs.readFile(stepLogPath, 'utf-8');
    for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [orderStr, status, ...messageParts] = line.split('|');
      const stepOrder = Number(orderStr);
      if (!Number.isFinite(stepOrder) || (status !== 'PASS' && status !== 'FAIL')) continue;
      steps.push({ stepOrder, status, message: messageParts.join('|') });
    }
  } catch {
    // step-log.txt missing (e.g. failed to attach before the first step ran) — steps stays [].
  }

  return {
    passed: exitCode === 0 && !timedOut && steps.length > 0,
    durationMs,
    steps,
    stdout,
    stderr,
    timedOut,
  };
}
