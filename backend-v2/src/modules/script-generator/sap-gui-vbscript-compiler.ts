/**
 * Deterministic SAP GUI VBScript compiler — a second SAP GUI target
 * alongside sap-gui-compiler.ts (PowerShell), not a replacement for it.
 * Compiles ordered steps bound to SAP_GUI_ID-locator objects into a single
 * self-contained .vbs file executed with `cscript.exe //NoLogo`, matching
 * the literal SAP GUI Scripting API pattern most SAP customer tooling and
 * security policy expects (cscript is commonly allowed where PowerShell
 * execution policy is locked down). Same "no AI in this path" guarantee as
 * every other compiler, and the same pipe-delimited step-log format
 * ("<order>|PASS|" / "<order>|FAIL|<message>") so the runner side can reuse
 * an identical parser to selenium-runner.ts/sap-gui-runner.ts.
 *
 * VBScript has no try/catch — error handling here is On Error Resume Next
 * + an Err.Number check after each step's body. Unlike the PowerShell
 * compiler's real try/catch, an early failing line within a multi-line step
 * body doesn't halt that step's remaining lines; Err.Number reflects
 * whichever error was most recent by the time the step is checked. This is
 * the same idiom most real-world SAP VBScript automation already lives
 * with, not a shortcut unique to this generator.
 */

export interface CompilerObject {
  objectName: string;
  objectType: string;
  technicalPath: string;
}

export interface CompilerTestDataItem {
  key: string;
  value: string;
}

export interface CompilerStep {
  id: string;
  stepOrder: number;
  stepType: string;
  inlineValue: string | null;
  config: unknown;
  object: CompilerObject | null;
  testDataItem: CompilerTestDataItem | null;
}

export interface CompiledFile {
  fileName: string;
  code: string;
  role: 'SPEC' | 'PAGE_OBJECT' | 'FIXTURE' | 'CONFIG';
}

export interface CompileResult {
  files: CompiledFile[];
  command: string;
}

function toPascalCase(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}

// VBScript has no single-quoted string literal (' starts a comment) —
// double-quoted with an embedded quote doubled is the only string escape.
function vbsString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Step-log lines are pipe-delimited; a raw newline or pipe in a message
// would corrupt the format the runner parses.
function sanitizeMessage(value: string): string {
  return value.replace(/[\r\n|]+/g, ' ');
}

function configValue(config: unknown, key: string): unknown {
  if (config && typeof config === 'object') {
    return (config as Record<string, unknown>)[key];
  }
  return undefined;
}

function valueExprFor(step: CompilerStep): string {
  const raw = step.testDataItem?.value ?? step.inlineValue ?? '';
  return `ResolvePlaceholders(${vbsString(raw)})`;
}

const SELECTABLE_TYPES = new Set(['GuiTab', 'GuiMenu', 'GuiMenubar']);

function findByIdLine(varName: string, obj: CompilerObject): string {
  return `Set ${varName} = Session.findById(${vbsString(obj.technicalPath)})`;
}

// Mirrors compileStepBody in sap-gui-compiler.ts: returns null for step
// types with no meaningful SAP GUI equivalent (caller emits no step-log
// line, so the run's own "no result for this step" reconciliation marks it
// SKIPPED automatically). CLICK/ENTER_TEXT/SELECT_DROPDOWN/VERIFY_TEXT/
// VERIFY_ELEMENT_VISIBLE/WAIT already cover press/setText/select/
// selectTab/assertFieldValue/wait for SAP objects — only the genuinely new
// actions get their own case here.
function compileStepBody(step: CompilerStep): string[] | null {
  const obj = step.object;
  switch (step.stepType) {
    case 'CLICK': {
      if (!obj) return null;
      const action = SELECTABLE_TYPES.has(obj.objectType) ? 'obj.Select' : 'obj.Press';
      return [findByIdLine('obj', obj), `${action}`];
    }
    case 'ENTER_TEXT':
    case 'SELECT_DROPDOWN': {
      if (!obj) return null;
      return [findByIdLine('obj', obj), `obj.Text = ${valueExprFor(step)}`];
    }
    case 'VERIFY_TEXT': {
      if (!obj) return null;
      return [
        findByIdLine('obj', obj),
        `expected = ${valueExprFor(step)}`,
        `If InStr(obj.Text, expected) = 0 Then Err.Raise vbObjectError + 1, "VerifyText", "Expected text containing '" & expected & "' but found '" & obj.Text & "'"`,
      ];
    }
    case 'VERIFY_ELEMENT_VISIBLE': {
      if (!obj) return null;
      return [findByIdLine('obj', obj), `If Not obj.Visible Then Err.Raise vbObjectError + 1, "VerifyVisible", "Element is not visible"`];
    }
    case 'WAIT': {
      const ms = Number(configValue(step.config, 'durationMs') ?? 1000);
      return [`WScript.Sleep ${ms}`];
    }
    case 'SAP_SEND_VKEY': {
      const vkey = Number(configValue(step.config, 'vkey') ?? step.inlineValue ?? 0);
      const lines: string[] = [];
      if (obj) {
        lines.push(findByIdLine('obj', obj), `obj.SetFocus`);
      }
      lines.push(`Session.findById(${vbsString('wnd[0]')}).sendVKey ${vkey}`);
      return lines;
    }
    case 'SAP_START_TRANSACTION': {
      // Forces a clean /n reset regardless of what a prior run (or a
      // manually-attached session) left on screen — this step is the SAP
      // equivalent of "open the app fresh," so it shouldn't depend on
      // whatever screen the session already happens to be on. Respects an
      // already-explicit prefix (/n, /o, /*) rather than doubling it.
      const raw = (step.testDataItem?.value ?? step.inlineValue ?? '').trim();
      const withReset = /^\/[a-zA-Z*]/.test(raw) ? raw : `/n${raw}`;
      return [`Session.StartTransaction ResolvePlaceholders(${vbsString(withReset)})`];
    }
    case 'SAP_CHECK':
    case 'SAP_UNCHECK': {
      if (!obj) return null;
      return [findByIdLine('obj', obj), `obj.Selected = ${step.stepType === 'SAP_CHECK' ? 'True' : 'False'}`];
    }
    case 'SAP_GRID_SET_CELL': {
      if (!obj) return null;
      const row = Number(configValue(step.config, 'row') ?? 0);
      const column = String(configValue(step.config, 'column') ?? '');
      return [
        findByIdLine('obj', obj),
        `obj.SetCurrentCell ${row}, ${vbsString(column)}`,
        `obj.ModifyCell ${row}, ${vbsString(column)}, ${valueExprFor(step)}`,
      ];
    }
    case 'SAP_GRID_DOUBLE_CLICK_CELL': {
      if (!obj) return null;
      const row = Number(configValue(step.config, 'row') ?? 0);
      const column = String(configValue(step.config, 'column') ?? '');
      return [findByIdLine('obj', obj), `obj.SetCurrentCell ${row}, ${vbsString(column)}`, `obj.DoubleClickCurrentCell`];
    }
    case 'SAP_TABLE_SET_CELL': {
      if (!obj) return null;
      const row = Number(configValue(step.config, 'row') ?? 0);
      const column = String(configValue(step.config, 'column') ?? '');
      return [findByIdLine('obj', obj), `obj.GetCell(${row}, ${vbsString(column)}).Text = ${valueExprFor(step)}`];
    }
    case 'SAP_READ_STATUS_BAR': {
      return [`Set sbar = Session.findById(${vbsString('wnd[0]/sbar')})`, `LogAction "Status bar: [" & sbar.MessageType & "] " & sbar.Text`];
    }
    case 'SAP_ASSERT_STATUS_MESSAGE': {
      return [
        `Set sbar = Session.findById(${vbsString('wnd[0]/sbar')})`,
        `expected = ${valueExprFor(step)}`,
        `If InStr(sbar.Text, expected) = 0 Then Err.Raise vbObjectError + 1, "AssertStatusMessage", "Expected status bar containing '" & expected & "' but found '" & sbar.Text & "' (type " & sbar.MessageType & ")"`,
      ];
    }
    case 'SAP_VALIDATION': {
      // Generic "did the previous action succeed" check — SAP's own
      // convention for a failed action is a status-bar message of type "E"
      // (Error) or "A" (Abort); anything else (commonly "S" Success or "W"
      // Warning) is treated as passing.
      return [
        `Set sbar = Session.findById(${vbsString('wnd[0]/sbar')})`,
        `If sbar.MessageType = "E" Or sbar.MessageType = "A" Then Err.Raise vbObjectError + 1, "SapValidation", "SAP reported an error: [" & sbar.MessageType & "] " & sbar.Text`,
      ];
    }
    case 'SAP_HANDLE_POPUP': {
      // Conditional by nature — a run that never triggers the popup isn't a
      // failure, so this checks for wnd[1] with its own local error guard
      // rather than letting a missing popup fail the step.
      const buttonId = configValue(step.config, 'buttonId');
      const actionLine = buttonId
        ? `Session.findById(${vbsString(`wnd[1]/${String(buttonId)}`)}).Press`
        : `Session.findById(${vbsString('wnd[1]')}).sendVKey 0`;
      return [
        `On Error Resume Next`,
        `Dim popupExists : popupExists = False`,
        `Session.findById(${vbsString('wnd[1]')}).Visible`,
        `If Err.Number = 0 Then popupExists = True`,
        `Err.Clear`,
        `If popupExists Then`,
        `  ${actionLine}`,
        `End If`,
      ];
    }
    default:
      return null;
  }
}

// A cheap, non-destructive pre-flight — every bound object still gets
// located via findById (the exact same lookup a real run depends on), but
// nothing is pressed, typed, or selected. SAP_START_TRANSACTION still runs
// for real, since that's how the session reaches the transaction at all;
// everything else just resolves its own object's locator. The busy-wait/
// popup/status-bar checks the main loop injects after every step are pure
// reads with no side effects, so they stay active in this mode too — an
// unexpected popup during a dry run is exactly the kind of thing worth
// catching before Execute ever runs.
function compileStepBodyForValidate(step: CompilerStep): string[] | null {
  if (step.stepType === 'SAP_START_TRANSACTION') return compileStepBody(step);
  if (!step.object) return null;
  return [findByIdLine('obj', step.object)];
}

// Optional override lets a step's body come from somewhere other than the
// fixed switch above (see ScriptGeneratorService#codexSapGuiStepBodies)
// while every other line — connection setup, the exact LogStep
// pipe-delimited format execution result parsing depends on,
// ResolvePlaceholders, exit codes — stays the same proven scaffold either
// way. `null` in the override map means "no SAP GUI equivalent" (same
// meaning as compileStepBody returning null).
export function compileFlowToSapGuiVbs(params: {
  flowName: string;
  steps: CompilerStep[];
  stepBodyOverride?: Map<number, string[] | null>;
  mode?: 'execute' | 'validate';
}): CompileResult {
  const { flowName, steps, stepBodyOverride, mode = 'execute' } = params;
  const suffix = mode === 'validate' ? 'Validate' : '';
  const flowPascalName = (toPascalCase(flowName) || 'GeneratedSapFlow') + suffix;
  const fileName = `${flowPascalName}.vbs`;

  const lines: string[] = [
    `' Generated SAP GUI automation script for flow ${flowName.replace(/[\r\n]+/g, ' ')}.`,
    mode === 'validate'
      ? `' VALIDATE MODE — a pre-flight dry run. Every bound object is located via findById, but nothing is pressed, typed, or selected except starting the transaction itself. A clean pass means the Object Library is current against this session right now.`
      : stepBodyOverride
        ? `' Step actions below were written by Codex CLI; the surrounding scaffold (connection setup, LogStep format, exit codes) is the same deterministic code as every other script — see sap-gui-vbscript-compiler.ts.`
        : `' Deterministic compiler output (sap-gui-vbscript-compiler.ts) — no AI in this path.`,
    `Option Explicit`,
    `On Error Resume Next`,
    ``,
    `Dim fso, scriptDir, resultsDir, stepLogPath, runLogPath`,
    `Set fso = CreateObject("Scripting.FileSystemObject")`,
    `scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)`,
    `resultsDir = scriptDir & "\\test-results"`,
    `If Not fso.FolderExists(resultsDir) Then fso.CreateFolder(resultsDir)`,
    `stepLogPath = resultsDir & "\\step-log.txt"`,
    `runLogPath = resultsDir & "\\run-log.txt"`,
    `If fso.FileExists(stepLogPath) Then fso.DeleteFile(stepLogPath)`,
    `If fso.FileExists(runLogPath) Then fso.DeleteFile(runLogPath)`,
    ``,
    `Sub LogStep(stepOrder, status, msg)`,
    `  Dim f`,
    `  Set f = fso.OpenTextFile(stepLogPath, 8, True)`,
    `  f.WriteLine stepOrder & "|" & status & "|" & msg`,
    `  f.Close`,
    `End Sub`,
    ``,
    `Sub LogAction(msg)`,
    `  Dim f`,
    `  Set f = fso.OpenTextFile(runLogPath, 8, True)`,
    `  f.WriteLine "[" & Now & "] " & msg`,
    `  f.Close`,
    `End Sub`,
    ``,
    // Fixed-token resolver — no regex-replace-with-callback in VBScript, so
    // resolved sequentially; {{futureDate[:N]}} is the one parametrized
    // token and gets its own small scan-and-replace loop.
    `Function ResolvePlaceholders(value)`,
    `  Dim result, idx, closeIdx, token, colonIdx, daysStr, days`,
    `  result = value`,
    `  result = Replace(result, "{{timestamp}}", CStr(CLng(DateDiff("s", "01/01/1970 00:00:00", Now))) & "000")`,
    `  Randomize`,
    `  result = Replace(result, "{{randomEmail}}", "user" & CStr(Int(100000 + Rnd() * 899999)) & "@example.com")`,
    `  result = Replace(result, "{{randomUser}}", "user" & CStr(Int(100000 + Rnd() * 899999)))`,
    `  result = Replace(result, "{{today}}", FormatDateYmd(Now))`,
    `  idx = InStr(result, "{{futureDate")`,
    `  Do While idx > 0`,
    `    closeIdx = InStr(idx, result, "}}")`,
    `    If closeIdx = 0 Then Exit Do`,
    `    token = Mid(result, idx, closeIdx - idx + 2)`,
    `    colonIdx = InStr(token, ":")`,
    `    If colonIdx > 0 Then`,
    `      daysStr = Mid(token, colonIdx + 1, Len(token) - colonIdx - 2)`,
    `    Else`,
    `      daysStr = ""`,
    `    End If`,
    `    If daysStr = "" Then days = 7 Else days = CInt(daysStr)`,
    `    result = Replace(result, token, FormatDateYmd(DateAdd("d", days, Now)))`,
    `    idx = InStr(result, "{{futureDate")`,
    `  Loop`,
    `  ResolvePlaceholders = result`,
    `End Function`,
    ``,
    `Function FormatDateYmd(d)`,
    `  FormatDateYmd = Year(d) & "-" & Right("0" & Month(d), 2) & "-" & Right("0" & Day(d), 2)`,
    `End Function`,
    ``,
    `Dim SapGuiAuto, Engine, Connection, Session, obj, sbar, expected, popupText, sbarCheck, busyWaitCount`,
    `Set SapGuiAuto = GetObject("SAPGUI")`,
    `If Err.Number <> 0 Then`,
    `  LogAction "Could not attach to a running SAP GUI session: " & Err.Description`,
    `  WScript.Echo "ERROR: Could not attach to a running SAP GUI session: " & Err.Description`,
    `  WScript.Quit 1`,
    `End If`,
    ``,
    `Set Engine = SapGuiAuto.GetScriptingEngine`,
    `If Err.Number <> 0 Then`,
    `  LogAction "Could not get the SAP GUI scripting engine: " & Err.Description`,
    `  WScript.Echo "ERROR: Could not get the SAP GUI scripting engine: " & Err.Description`,
    `  WScript.Quit 1`,
    `End If`,
    ``,
    `Set Connection = Engine.Children(0)`,
    `Set Session = Connection.Children(0)`,
    `If Err.Number <> 0 Then`,
    `  LogAction "Could not attach to an active SAP GUI session (Connections(0)/Sessions(0)): " & Err.Description`,
    `  WScript.Echo "ERROR: Could not attach to an active SAP GUI session: " & Err.Description`,
    `  WScript.Quit 1`,
    `End If`,
    `Err.Clear`,
    ``,
  ];

  for (const step of steps) {
    const body = stepBodyOverride
      ? stepBodyOverride.get(step.stepOrder) ?? null
      : mode === 'validate'
        ? compileStepBodyForValidate(step)
        : compileStepBody(step);
    if (!body) {
      lines.push(`' Step ${step.stepOrder}: ${step.stepType} has no SAP GUI equivalent — skipped, no result recorded.`, ``);
      continue;
    }
    lines.push(
      `' Step ${step.stepOrder}: ${step.stepType}${step.object ? ` (${step.object.objectName.replace(/[\r\n]+/g, ' ')})` : ''}`,
      `Err.Clear`,
      ...body,
      // Everything below only runs when the step's own body didn't already
      // set an error — it's a supplementary check, never a replacement for
      // whatever the step itself already detected. Three things SAP silently
      // does that a script otherwise sails past, only to fail two steps
      // later on the wrong screen: (1) still processing the previous
      // action, (2) an unrequested modal dialog (multiple-logon warning,
      // transport prompt, "data will be lost" confirmation) sitting over
      // the main window, (3) a status-bar error with no COM exception at
      // all (a bad transaction code, an authorization failure) — none of
      // these throw on their own, so nothing before this would have caught
      // them.
      `If Err.Number = 0 Then`,
      `  busyWaitCount = 0`,
      `  Do While Session.Busy And busyWaitCount < 100`,
      `    WScript.Sleep 100`,
      `    busyWaitCount = busyWaitCount + 1`,
      `  Loop`,
      `End If`,
      `If Err.Number = 0 Then`,
      `  popupText = ""`,
      `  Err.Clear`,
      `  popupText = Session.findById("wnd[1]").Text`,
      `  If Err.Number <> 0 Then`,
      `    Err.Clear`,
      `  Else`,
      `    LogAction "Unexpected popup detected: " & popupText`,
      `    Session.findById("wnd[1]").Close`,
      `    Err.Clear`,
      `    Err.Raise vbObjectError + 900, "UnexpectedPopup", "Unexpected popup: " & popupText`,
      `  End If`,
      `End If`,
      `If Err.Number = 0 Then`,
      `  Set sbarCheck = Session.findById("wnd[0]/sbar")`,
      `  If Err.Number = 0 Then`,
      `    If sbarCheck.MessageType = "E" Or sbarCheck.MessageType = "A" Then`,
      `      Err.Raise vbObjectError + 901, "StatusBarError", sbarCheck.Text`,
      `    End If`,
      `  Else`,
      `    Err.Clear`,
      `  End If`,
      `End If`,
      `If Err.Number <> 0 Then`,
      `  LogStep ${step.stepOrder}, "FAIL", Replace(Replace(Err.Description, vbCrLf, " "), "|", " ")`,
      `Else`,
      `  LogStep ${step.stepOrder}, "PASS", ""`,
      `End If`,
      ``,
    );
  }

  lines.push(
    `Dim allLines, failCount, i`,
    `failCount = 0`,
    `If fso.FileExists(stepLogPath) Then`,
    `  Dim readF, line`,
    `  Set readF = fso.OpenTextFile(stepLogPath, 1)`,
    `  Do While Not readF.AtEndOfStream`,
    `    line = readF.ReadLine`,
    `    If InStr(line, "|FAIL|") > 0 Then failCount = failCount + 1`,
    `  Loop`,
    `  readF.Close`,
    `End If`,
    `If failCount > 0 Then WScript.Quit 1`,
    `WScript.Quit 0`,
  );

  return {
    files: [{ fileName, code: lines.join('\n'), role: 'SPEC' }],
    command: `cscript //NoLogo ${fileName}`,
  };
}
