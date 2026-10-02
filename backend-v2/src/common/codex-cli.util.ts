import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Async, non-blocking wrapper around `codex exec` — this runs inside a real
// NestJS process handling real HTTP requests, so a synchronous multi-minute
// subprocess call (spawnSync, used in the throwaway scratch script this was
// first proven out in) would freeze every other request on the single Node
// event loop for the whole duration. spawn() + Promise here instead.
//
// shell:true is required on Windows — Codex CLI installs as a `codex.cmd`
// shim, and Node's spawn() can't exec a .cmd directly without a shell (a
// separate, already-confirmed gotcha from the SAP GUI scripting work in
// this codebase — see sap-gui-scanner.util.ts's spawn calls for the .exe
// case that DIDN'T need this).
//
// --skip-git-repo-check: this repo isn't a git repository, and Codex
// refuses to run in an untrusted (non-git) directory by default.
//
// --output-last-message <file>: writes just the final agent response to a
// file, cleanly separated from the interactive session transcript that
// otherwise goes to stdout — confirmed against a real run (the alternative,
// parsing `--json`'s event stream for an "agent_message" event, was NOT
// verified against a real run and was deliberately not used here instead).
export interface CodexExecResult {
  content: string;
  succeeded: boolean;
  errorMessage?: string;
}

// imagePaths: absolute paths to local image files, passed straight through
// to Codex CLI's own `-i/--image` flag (confirmed against a real screenshot
// that this is genuine multimodal analysis, not a stub) — the caller owns
// downloading/writing and cleaning up these files; this function only reads
// them.
export async function runCodexExec(
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 180_000,
  imagePaths?: string[],
): Promise<CodexExecResult> {
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  const outFile = path.join(os.tmpdir(), `codex-out-${Date.now()}-${randomUUID()}.txt`);

  const result = await new Promise<CodexExecResult>((resolve) => {
    let stderr = '';
    const args = ['exec', '--skip-git-repo-check'];
    if (imagePaths?.length) args.push('-i', ...imagePaths);
    args.push('--output-last-message', outFile);
    const child = spawn('codex', args, {
      windowsHide: true,
      shell: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ content: '', succeeded: false, errorMessage: `Codex call timed out after ${timeoutMs / 1000}s` });
    }, timeoutMs);

    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ content: '', succeeded: false, errorMessage: `Failed to launch codex: ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ content: '', succeeded: false, errorMessage: stderr.trim() || `codex exec exited with code ${code}` });
        return;
      }
      resolve({ content: '', succeeded: true }); // content filled in below once the file's been read
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });

  if (!result.succeeded) return result;

  try {
    const content = await fs.readFile(outFile, 'utf-8');
    await fs.unlink(outFile).catch(() => undefined);
    return { content: content.trim(), succeeded: true };
  } catch (err) {
    return { content: '', succeeded: false, errorMessage: `Codex reported success but its output file was unreadable: ${(err as Error).message}` };
  }
}

function extractFirstJsonValue(text: string): string {
  const braceIndex = text.indexOf('{');
  if (braceIndex === -1) throw new Error('No JSON object found in Codex response');
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = braceIndex; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (char === '\\') escapeNext = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(braceIndex, i + 1);
    }
  }
  throw new Error('Unbalanced JSON in Codex response');
}

export function parseCodexJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned) as T; } catch { return JSON.parse(extractFirstJsonValue(cleaned)) as T; }
}

// Convenience wrapper for the common "send a prompt, parse a JSON object
// back" shape both script review and Jira story generation need.
export async function runCodexExecJson<T>(systemPrompt: string, userPrompt: string, timeoutMs = 180_000): Promise<T> {
  const result = await runCodexExec(systemPrompt, userPrompt, timeoutMs);
  if (!result.succeeded) throw new Error(result.errorMessage ?? 'Codex call failed');
  return parseCodexJson<T>(result.content);
}

export interface CodexAgentResult {
  succeeded: boolean;
  summary: string;
  errorMessage?: string;
}

// Distinct from runCodexExec above on purpose, not a refactor of it: that
// function is used for single JSON-prompt-response calls (test-case
// generation, script review, object disambiguation) and always runs with
// this backend process's own cwd, with --skip-git-repo-check because it's
// never run inside a repo. This one is for the AI Engineering Organization's
// specialist step — a genuinely agentic, multi-file-editing Codex session
// scoped to an isolated task workspace (see ai-engineering/workspace.util.ts)
// that has its OWN scratch git init, so --skip-git-repo-check is deliberately
// omitted: Codex CLI's normal, best-supported mode assumes a real repo, and
// the workspace gives it one without touching TestPilot's own (currently
// git-less) source tree at all.
export async function runCodexAgent(params: {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
  // 'workspace-write' (default): the specialist/repair steps, which need to
  // edit files in the isolated workspace. 'read-only': the AI review step —
  // it only reads the (already-fixed) full project copy to check for
  // unintended impact elsewhere, never touches anything.
  sandbox?: 'workspace-write' | 'read-only';
}): Promise<CodexAgentResult> {
  const { cwd, prompt, timeoutMs = 300_000, sandbox = 'workspace-write' } = params;
  const outFile = path.join(os.tmpdir(), `codex-agent-out-${Date.now()}-${randomUUID()}.txt`);

  const result = await new Promise<CodexAgentResult>((resolve) => {
    let stderr = '';
    // --sandbox workspace-write: codex exec defaults to a read-only sandbox
    // — without this it reports success having made zero file changes,
    // confirmed live (the first real run of this pipeline did exactly that).
    // Safe to grant here specifically: `cwd` is always an isolated,
    // disposable task workspace (see workspace.util.ts), never the real
    // project — "workspace-write" only ever means write access to that copy.
    const args = ['exec', '--sandbox', sandbox, '--output-last-message', outFile];
    const child = spawn('codex', args, { cwd, windowsHide: true, shell: true });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ succeeded: false, summary: '', errorMessage: `Codex agent call timed out after ${timeoutMs / 1000}s` });
    }, timeoutMs);

    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ succeeded: false, summary: '', errorMessage: `Failed to launch codex: ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ succeeded: false, summary: '', errorMessage: stderr.trim() || `codex exec exited with code ${code}` });
        return;
      }
      resolve({ succeeded: true, summary: '' });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });

  if (!result.succeeded) return result;

  try {
    const summary = await fs.readFile(outFile, 'utf-8');
    await fs.unlink(outFile).catch(() => undefined);
    return { succeeded: true, summary: summary.trim() };
  } catch (err) {
    return {
      succeeded: false,
      summary: '',
      errorMessage: `Codex reported success but its output file was unreadable: ${(err as Error).message}`,
    };
  }
}

// "Verify linking" for the Settings page's Codex CLI status card — a real,
// minimal `codex exec` round trip is the only way to actually confirm the
// CLI is both installed AND authenticated to a working account (checking
// for a config/auth file on disk would only prove installation, not that
// the linked account can still generate). Short timeout since this is a
// connectivity probe, not a real generation call.
export async function checkCodexHealth(): Promise<{ healthy: boolean; detail?: string }> {
  const result = await runCodexExec('Reply with exactly the single word: OK', 'Respond now, with nothing else.', 20_000);
  if (!result.succeeded) {
    return { healthy: false, detail: result.errorMessage ?? 'Codex CLI call failed.' };
  }
  return { healthy: true, detail: result.content.slice(0, 200) || 'Codex CLI responded successfully.' };
}
