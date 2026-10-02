/**
 * Deterministic SAP GUI compiler — the SAP counterpart to
 * playwright-compiler.ts/selenium-java-compiler.ts, same "no AI in this
 * path" guarantee. Compiles ordered steps bound to SAP_GUI_ID-locator
 * objects (captured by the SAP GUI scanner) into a single self-contained
 * PowerShell script that drives the SAP GUI Scripting API directly —
 * matching the same COM-attach approach already proven by
 * scanner/sap/sap-gui-walker.ps1. Step results are written as
 * "<order>|PASS|" / "<order>|FAIL|<message>" lines to test-results/step-log.txt,
 * the same pipe-delimited format selenium-java-compiler.ts already uses, so
 * the runner side can reuse an identical parser.
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

// PowerShell single-quoted string literal: fully literal except doubling an
// embedded `'` — no $ or backtick interpretation to worry about, unlike a
// double-quoted string, so this is safe for arbitrary scanned/user text.
function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Line comments end at the first newline — same class of bug fixed in
// selenium-java-compiler.ts's sanitizeComment.
function sanitizeComment(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

function configValue(config: unknown, key: string): unknown {
  if (config && typeof config === 'object') {
    return (config as Record<string, unknown>)[key];
  }
  return undefined;
}

function valueExprFor(step: CompilerStep): string {
  const raw = step.testDataItem?.value ?? step.inlineValue ?? '';
  return `(Resolve-Placeholders ${psString(raw)})`;
}

const SELECTABLE_TYPES = new Set(['GuiTab', 'GuiMenu', 'GuiMenubar']);

// Returns null for step types with no meaningful SAP GUI equivalent — the
// caller emits no step-log line for these, so the existing "no result for
// this step" reconciliation in execution.service.ts marks them SKIPPED
// automatically, exactly as it already does for a run that crashes early.
function compileStepBody(step: CompilerStep): string[] | null {
  const obj = step.object;
  switch (step.stepType) {
    case 'CLICK': {
      if (!obj) return null;
      const findLine = `$obj = $Session.findById(${psString(obj.technicalPath)})`;
      return SELECTABLE_TYPES.has(obj.objectType) ? [findLine, `$obj.Select()`] : [findLine, `$obj.Press()`];
    }
    case 'ENTER_TEXT':
    case 'SELECT_DROPDOWN': {
      if (!obj) return null;
      return [`$obj = $Session.findById(${psString(obj.technicalPath)})`, `$obj.Text = ${valueExprFor(step)}`];
    }
    case 'VERIFY_TEXT': {
      if (!obj) return null;
      return [
        `$obj = $Session.findById(${psString(obj.technicalPath)})`,
        `$expected = ${valueExprFor(step)}`,
        `if (-not $obj.Text.Contains($expected)) { throw "Expected text containing '$expected' but found '$($obj.Text)'" }`,
      ];
    }
    case 'VERIFY_ELEMENT_VISIBLE': {
      if (!obj) return null;
      return [
        `$obj = $Session.findById(${psString(obj.technicalPath)})`,
        `if (-not $obj.Visible) { throw "Element is not visible" }`,
      ];
    }
    case 'WAIT': {
      const ms = Number(configValue(step.config, 'durationMs') ?? 1000);
      return [`Start-Sleep -Milliseconds ${ms}`];
    }
    default:
      return null;
  }
}

export function compileFlowToSapGui(params: { flowName: string; steps: CompilerStep[] }): CompileResult {
  const { flowName, steps } = params;
  const flowPascalName = toPascalCase(flowName) || 'GeneratedSapFlow';
  const fileName = `${flowPascalName}.ps1`;

  const lines: string[] = [
    `# Generated SAP GUI automation script for flow ${psString(flowName)}.`,
    `# Deterministic compiler output (sap-gui-compiler.ts) — no AI in this path.`,
    `$ErrorActionPreference = 'Stop'`,
    ``,
    `function Write-ErrorJson($message) {`,
    `  $err = @{ error = $message } | ConvertTo-Json -Compress`,
    `  [Console]::Error.WriteLine($err)`,
    `}`,
    ``,
    // Mirrors playwright-compiler.ts's resolvePlaceholders exactly — same
    // tokens, resolved at run time (not generation time) so {{timestamp}}
    // etc. stay fresh on every execution.
    `function Resolve-Placeholders([string]$value) {`,
    `  $pattern = '\\{\\{\\s*([a-zA-Z]+)(?::(\\d+))?\\s*\\}\\}'`,
    `  $evaluator = {`,
    `    param($m)`,
    `    $token = $m.Groups[1].Value.ToLower()`,
    `    $paramStr = $m.Groups[2].Value`,
    `    switch ($token) {`,
    `      'timestamp' { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() }`,
    `      'randomemail' { return "user$((Get-Random -Minimum 100000 -Maximum 999999))@example.com" }`,
    `      'randomuser' { return "user$((Get-Random -Minimum 100000 -Maximum 999999))" }`,
    `      'today' { return (Get-Date).ToString('yyyy-MM-dd') }`,
    `      'futuredate' {`,
    `        $days = if ($paramStr) { [int]$paramStr } else { 7 }`,
    `        return (Get-Date).AddDays($days).ToString('yyyy-MM-dd')`,
    `      }`,
    `      default { return $m.Value }`,
    `    }`,
    `  }`,
    `  return [System.Text.RegularExpressions.Regex]::Replace($value, $pattern, [System.Text.RegularExpressions.MatchEvaluator]$evaluator)`,
    `}`,
    ``,
    `try {`,
    `  $SapGuiAuto = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SAPGUI")`,
    `  $Engine = $SapGuiAuto.GetScriptingEngine()`,
    `  $Connection = $Engine.Children.Item(0)`,
    `  $Session = $Connection.Children.Item(0)`,
    `} catch {`,
    `  Write-ErrorJson "Could not attach to a running SAP GUI session: $($_.Exception.Message)"`,
    `  exit 1`,
    `}`,
    ``,
    `$stepLog = New-Object System.Collections.Generic.List[string]`,
    `$resultsDir = Join-Path $PSScriptRoot 'test-results'`,
    `New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null`,
    ``,
  ];

  for (const step of steps) {
    const body = compileStepBody(step);
    if (!body) {
      lines.push(`# Step ${step.stepOrder}: ${step.stepType} has no SAP GUI equivalent — skipped, no result recorded.`, ``);
      continue;
    }
    lines.push(
      `# Step ${step.stepOrder}: ${step.stepType}${step.object ? ` (${sanitizeComment(step.object.objectName)})` : ''}`,
      `try {`,
      ...body.map((b) => `  ${b}`),
      `  $stepLog.Add("${step.stepOrder}|PASS|")`,
      `} catch {`,
      `  $msg = ($_.Exception.Message -replace '[\\r\\n\\|]+', ' ')`,
      `  $stepLog.Add("${step.stepOrder}|FAIL|$msg")`,
      `}`,
      ``,
    );
  }

  lines.push(
    `$stepLog | Out-File -FilePath (Join-Path $resultsDir 'step-log.txt') -Encoding utf8`,
    `$failCount = ($stepLog | Where-Object { $_ -match '\\|FAIL\\|' }).Count`,
    `if ($failCount -gt 0) { exit 1 }`,
    ``,
  );

  return {
    files: [{ fileName, code: lines.join('\n'), role: 'SPEC' }],
    command: `powershell -NoProfile -ExecutionPolicy Bypass -File ${fileName}`,
  };
}
