import { spawn } from 'child_process';
import * as path from 'path';
import { resolveSapGuiInterpreter } from '../../../common/sap-gui-interpreter.util';

// Deliberately process.cwd()-relative, not __dirname — __dirname points into
// dist/ once compiled, and this plain-text script is never compiled or
// reliably copied there by the build (Nest's asset-copy step didn't pick it
// up). process.cwd() is the project root (backend-v2/) either way, whether
// running via `nest start --watch` or `node dist/src/main`.
//
// VBScript, not the original PowerShell (sap-gui-walker.ps1): confirmed via live testing that .NET's
// [Marshal]::GetActiveObject("SAPGUI") fails to connect on real hardware
// even with everything configured correctly, while VBScript's native
// GetObject("SAPGUI") — calling the exact same COM registration — connects
// successfully. See sap-gui-walker.vbs's header comment for the full
// findings (including a separate by-value-vs-by-reference collection quirk
// this walker also had to work around).
const WALKER_SCRIPT = path.join(process.cwd(), 'src', 'modules', 'scanner', 'sap', 'sap-gui-walker.vbs');
const LIST_SESSIONS_SCRIPT = path.join(process.cwd(), 'src', 'modules', 'scanner', 'sap', 'sap-gui-list-sessions.vbs');

export interface SapGuiOpenSession {
  connectionIndex: number;
  sessionIndex: number;
  connectionDescription: string;
  systemName: string;
  client: string;
  user: string;
  transaction: string;
  title: string;
}

export interface SapGuiSessionInfo {
  systemName: string;
  client: string;
  user: string;
  transaction: string;
  screenTitle: string;
}

export interface RawSapGuiObject {
  id: string;
  name: string;
  type: string;
  text: string;
  tooltip: string;
}

// One screen per base view / expanded tab / expanded "multiple selection"
// popup — mirrors how the web scanner represents each discovered tab as its
// own ScanPage rather than flattening everything into one object list.
export interface RawSapGuiScreen {
  label: string;
  context: 'base' | 'tab' | 'popup';
  objects: RawSapGuiObject[];
}

export interface SapGuiScanResult {
  session: SapGuiSessionInfo;
  screens: RawSapGuiScreen[];
}

// Every SAP GUI element's own `.Id` is a full, stable path
// (/app/con[0]/ses[0]/wnd[0]/usr/...) assigned by the SAP GUI runtime itself —
// unlike a web page's DOM, there's no heuristic guessing involved, so this is
// always the recommended locator at full confidence.
export interface MappedSapGuiObject {
  label: string | null;
  objectType: string;
  xpath: string;
  recommendedLocator: string;
  recommendedLocatorType: 'SAP_GUI_ID';
  confidenceScore: number;
}

export function mapSapGuiObject(raw: RawSapGuiObject): MappedSapGuiObject {
  return {
    label: raw.text || raw.tooltip || raw.name || null,
    objectType: raw.type,
    xpath: raw.id,
    recommendedLocator: raw.id,
    recommendedLocatorType: 'SAP_GUI_ID',
    confidenceScore: 1,
  };
}

// Spawns the VBScript walker directly via cscript.exe (no shell:true, no
// npx-style .cmd wrapper) — cscript.exe is a real binary, so this avoids
// both the DEP0190 shell-concatenation warning and any .cmd-specific spawn
// quirks this codebase already hit with npx on Windows. Same bitness
// resolution as the interpreter previously used for PowerShell — SAP GUI's
// COM registration is 32-bit-only on most installs, and 32-bit cscript
// can't be found via a bare PATH lookup on a 64-bit host.
// connectionIndex/sessionIndex default to the first open connection/session
// (0, 0) — the original always-grab-the-first behavior — but a caller that
// first calls listSapGuiSessions() can target a specific one, the same way
// the web scanner's "list open tabs, pick one" flow lets a specific browser
// tab be chosen instead of guessing.
export function runSapGuiScan(connectionIndex = 0, sessionIndex = 0, timeoutMs = 30_000): Promise<SapGuiScanResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolveSapGuiInterpreter('cscript.exe'),
      ['//nologo', WALKER_SCRIPT, String(connectionIndex), String(sessionIndex)],
      { windowsHide: true },
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`SAP GUI scan timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to launch cscript: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        try {
          const parsedError = JSON.parse(stderr.trim());
          reject(new Error(parsedError.error ?? stderr.trim() ?? `SAP GUI scan exited with code ${code}`));
        } catch {
          reject(new Error(stderr.trim() || `SAP GUI scan exited with code ${code}`));
        }
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as SapGuiScanResult);
      } catch (err) {
        reject(new Error(`Could not parse SAP GUI scan output: ${(err as Error).message}`));
      }
    });
  });
}

// Read-only enumeration — never selects/presses/navigates anything — so
// this can run freely (e.g. just to populate a picker in the UI) without
// any of the "safe to automate" concerns a real scan has to consider.
export function listSapGuiSessions(timeoutMs = 15_000): Promise<SapGuiOpenSession[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveSapGuiInterpreter('cscript.exe'), ['//nologo', LIST_SESSIONS_SCRIPT], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Listing SAP GUI sessions timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to launch cscript: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        try {
          const parsedError = JSON.parse(stderr.trim());
          reject(new Error(parsedError.error ?? stderr.trim() ?? `Listing SAP GUI sessions exited with code ${code}`));
        } catch {
          reject(new Error(stderr.trim() || `Listing SAP GUI sessions exited with code ${code}`));
        }
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as SapGuiOpenSession[]);
      } catch (err) {
        reject(new Error(`Could not parse SAP GUI session list: ${(err as Error).message}`));
      }
    });
  });
}
