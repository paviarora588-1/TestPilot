import { existsSync } from 'fs';
import * as path from 'path';

// SAP GUI for Windows has shipped almost exclusively as a 32-bit application
// for most of its history (64-bit builds exist only in recent versions and
// are rarely the default deployment) — its COM scripting registration
// (ProgID "SAPGUI") lives in the 32-bit registry hive (WOW6432Node) as a
// result. A 64-bit process (Node.js on a 64-bit Windows host, and therefore
// any interpreter it spawns via a bare PATH lookup like "powershell.exe" or
// "cscript.exe", which resolves to the 64-bit build in System32) cannot see
// that registration at all — GetObject("SAPGUI") fails with "Invalid class
// string" (CO_E_CLASSSTRING) even with scripting fully enabled and a session
// open, which is exactly what this fixes: confirmed against a real SAP GUI
// session during live verification of this pipeline. The fix is to spawn
// the SysWOW64 (32-bit) build of the interpreter instead of letting PATH
// resolve to System32's 64-bit one, matching whichever SAP GUI bitness is
// actually installed rather than assuming.
const windir = process.env.WINDIR ?? 'C:\\Windows';

function sapGuiInstalled(programFilesEnvVar: string): boolean {
  const root = process.env[programFilesEnvVar];
  if (!root) return false;
  return existsSync(path.join(root, 'SAP', 'FrontEnd', 'SapGui', 'saplogon.exe'));
}

// Cached at module load — the installed SAP GUI's bitness doesn't change
// during a running process, and this is called on every scan/execution.
const is32BitSapGui = sapGuiInstalled('PROGRAMFILES(X86)') && !sapGuiInstalled('PROGRAMFILES');

export function resolveSapGuiInterpreter(exe: 'powershell.exe' | 'cscript.exe'): string {
  if (!is32BitSapGui) return exe; // 64-bit (or undetectable) SAP GUI — plain PATH lookup is correct as-is.

  const candidate =
    exe === 'powershell.exe'
      ? path.join(windir, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : path.join(windir, 'SysWOW64', 'cscript.exe');
  return existsSync(candidate) ? candidate : exe;
}
