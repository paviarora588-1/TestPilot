/**
 * Deterministic Playwright + TypeScript Page Object Model compiler. Given a
 * flow's materialized, ordered steps (each optionally bound to a real
 * ObjectRepository locator and/or TestDataItem), produces real, readable,
 * runnable files — no AI in this path, so output is stable and reviewable.
 * The AI review pass (script-generator.service.ts) runs afterward, on the
 * compiled output, as a quality check rather than the source of the code.
 */

import { walkPageForObjects } from '../scanner/dom-walker';

// Bounds the live-DOM auto-heal capture (see buildDomCaptureHelperSource
// below): how many ranked candidates get written to disk regardless of how
// many interactive elements the live page actually has (a real scan in this
// app's own data has hit 1,000+ objects on one SAPUI5 page), and how long the
// in-browser capture itself is allowed to run before this catch block gives
// up and rethrows the original error unchanged.
const DOM_HEAL_MAX_CANDIDATES = 40;
const DOM_HEAL_CAPTURE_TIMEOUT_MS = 5000;

// Generous, not strict — this only trims an oversized live page before
// anything leaves the browser; the AI does the real semantic matching
// afterward. VERIFY_TEXT/VERIFY_ELEMENT_VISIBLE/HOVER/SCROLL/DOWNLOAD_FILE
// return undefined (no filter) since almost any element is a plausible
// target for those.
function objectTypeAllowlistFor(stepType: string): string[] | undefined {
  switch (stepType) {
    case 'CLICK':
      return ['button', 'link', 'tab', 'checkbox', 'checkbox-input', 'radio', 'radio-input'];
    case 'ENTER_TEXT':
      return ['text-input', 'email-input', 'password-input', 'number-input', 'tel-input', 'search-input', 'url-input', 'textarea'];
    case 'SELECT_DROPDOWN':
      return ['select', 'combobox', 'listbox'];
    case 'UPLOAD_FILE':
      return ['file-input'];
    default:
      return undefined;
  }
}

// Builds the one self-contained function TestPilot writes into a generated
// spec so a failing step can capture what's actually on screen at that exact
// moment — reusing dom-walker.ts's own walkPageForObjects rather than
// re-implementing DOM-walking heuristics a second time. page.evaluate(fn)
// ships fn.toString() to the browser as a single closure with no access to
// anything outside it, so walkPageForObjects's own (already-compiled, type-
// annotation-free) source has to be spliced in literally, nested inside this
// wrapper, rather than imported/called by reference at runtime.
function buildDomCaptureHelperSource(): string {
  return [
    `function __twpCaptureDomForHeal(opts) {`,
    `  const walkPageForObjects = ${walkPageForObjects.toString()};`,
    `  function __twpLabelScore(label, target) {`,
    `    if (!label || !target) return 0;`,
    `    const a = String(label).toLowerCase().trim();`,
    `    const b = String(target).toLowerCase().trim();`,
    `    if (!a || !b) return 0;`,
    `    if (a === b) return 100;`,
    `    if (a.includes(b) || b.includes(a)) return 50;`,
    `    const aw = a.split(/\\s+/);`,
    `    const bw = b.split(/\\s+/);`,
    `    return aw.filter((w) => bw.includes(w)).length * 10;`,
    `  }`,
    `  const raw = walkPageForObjects({ objectTypeAllowlist: opts.objectTypeAllowlist });`,
    `  return raw`,
    `    .map((o) => ({ label: o.label, objectType: o.objectType, recommendedLocator: o.recommendedLocator, score: __twpLabelScore(o.label, opts.targetLabel) }))`,
    `    .sort((a, b) => b.score - a.score)`,
    `    .slice(0, opts.maxCandidates)`,
    `    .map(({ label, objectType, recommendedLocator }) => ({ label, objectType, recommendedLocator }));`,
    `}`,
  ].join('\n');
}

// SAPUI5 calendar/date-picker day cells carry the actual selected date
// baked into their own id (confirmed live against the sample application's "Incident
// Pattern" wizard: `...createPatternWIActiveToDateTimePicker-cal--Month0-
// 20260905`) — recorded once, that id is only ever valid again on the exact
// calendar year the flow was recorded in, since the widget re-renders a
// different set of cells for every month. A step bound to one of these
// fails the very first time it's replayed on a different day than it was
// recorded, which for anything date-related is effectively "immediately."
const CALENDAR_DAY_CELL_RE = /^(.*-cal--Month\d+-)(\d{4})(\d{2})(\d{2})$/;

function parseCalendarDayCellLocator(
  technicalPath: string,
): { idPrefix: string; recordedDate: Date } | null {
  const m = CALENDAR_DAY_CELL_RE.exec(technicalPath);
  if (!m) return null;
  const [, idPrefix, y, mo, d] = m;
  return { idPrefix, recordedDate: new Date(Number(y), Number(mo) - 1, Number(d)) };
}

// Whole calendar days apart, ignoring time-of-day — both inputs are
// truncated to their own UTC calendar date first so the result can't drift
// from a DST transition or from one Date carrying a time-of-day and the
// other not.
function daysApartUTC(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

// Builds the one self-contained function TestPilot writes into a generated
// spec so a calendar-day-cell click keeps working forever, not just on the
// day it was recorded: re-derives "the same date, relative to whenever this
// actually runs" (deltaDays, baked in at compile time from the gap between
// the object's own createdAt and the date it was recorded clicking), builds
// both locator strategies the scanner already captured for this kind of
// object (the raw id and the human-readable aria-label — confirmed present
// as a real backup locator on this exact object), and — since the day cell
// for a different month plainly won't exist in the DOM until the calendar
// is actually showing that month — falls back to clicking the widget's own
// month-navigation controls a bounded number of times, re-checking after
// each click, rather than assuming the initially-open month is the right
// one. `.sapUiCalHeadNext`/`.sapUiCalHeadPrev` are OpenUI5/SAPUI5 framework-
// level classes for this (stable across apps built on the framework),
// unlike the per-cell ids this whole helper exists to stop depending on.
function buildCalendarDateClickHelperSource(): string {
  return [
    `async function __twpClickRelativeCalendarDate(page, opts) {`,
    `  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];`,
    `  const pad2 = (n) => String(n).padStart(2, '0');`,
    `  const now = new Date();`,
    `  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());`,
    `  const target = new Date(todayUtcMs + opts.deltaDays * 86400000);`,
    `  const ty = target.getUTCFullYear();`,
    `  const tm = target.getUTCMonth();`,
    `  const td = target.getUTCDate();`,
    `  const idSelector = opts.idPrefix + ty + pad2(tm + 1) + pad2(td);`,
    `  const ariaSelector = '[aria-label="' + MONTH_NAMES[tm] + ' ' + td + ', ' + ty + '"]';`,
    `  async function tryClickTarget() {`,
    `    for (const sel of [idSelector, ariaSelector]) {`,
    `      const loc = page.locator(sel).first();`,
    `      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {`,
    `        await loc.click();`,
    `        return true;`,
    `      }`,
    `    }`,
    `    return false;`,
    `  }`,
    `  if (await tryClickTarget()) return;`,
    `  const monthsDelta = (ty - now.getUTCFullYear()) * 12 + (tm - now.getUTCMonth());`,
    `  const navSelector = monthsDelta >= 0 ? '.sapUiCalHeadNext' : '.sapUiCalHeadPrev';`,
    `  const navClicks = Math.min(Math.abs(monthsDelta) + 2, 36);`,
    `  const deadline = Date.now() + 30000;`,
    `  for (let i = 0; i < navClicks && Date.now() < deadline; i++) {`,
    `    const navLoc = page.locator(navSelector).first();`,
    `    if ((await navLoc.count()) === 0) break;`,
    `    await navLoc.click().catch(() => undefined);`,
    `    await page.waitForTimeout(150);`,
    `    if (await tryClickTarget()) return;`,
    `  }`,
    `  throw new Error('Could not find or navigate to calendar day ' + ty + '-' + pad2(tm + 1) + '-' + pad2(td) + ' (tried ' + idSelector + ' and ' + ariaSelector + ')');`,
    `}`,
  ].join('\n');
}

interface CompilerObject {
  objectName: string;
  screenName: string | null;
  technicalPath: string;
  objectType: string;
  // Only used to make a calendar-day-cell locator (see
  // parseCalendarDayCellLocator below) replay correctly on any future date —
  // optional so every other object, and every existing test fixture, is
  // unaffected. When absent on a date-cell object, the step just falls back
  // to a plain (date-stale) click, same as before this existed.
  createdAt?: Date;
}

interface CompilerTestDataItem {
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

function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : 'value';
}

const ACTION_VERB: Record<string, string> = {
  CLICK: 'click',
  ENTER_TEXT: 'enter',
  SELECT_DROPDOWN: 'select',
  VERIFY_TEXT: 'verifyTextOf',
  VERIFY_ELEMENT_VISIBLE: 'verifyVisible',
  UPLOAD_FILE: 'upload',
  HOVER: 'hoverOver',
  SCROLL: 'scrollTo',
  DOWNLOAD_FILE: 'download',
};

function methodNameFor(stepType: string, objectName: string): string {
  const verb = ACTION_VERB[stepType] ?? toCamelCase(stepType);
  return `${verb}${toPascalCase(objectName)}`;
}

function screenClassName(screenName: string | null | undefined): string {
  const base = toPascalCase(screenName || 'App');
  return base.endsWith('Page') ? base : `${base}Page`;
}

function configValue(config: unknown, key: string): unknown {
  if (config && typeof config === 'object') {
    return (config as Record<string, unknown>)[key];
  }
  return undefined;
}

export function compileFlowToPlaywright(params: {
  flowName: string;
  applicationEntryUrl: string | null;
  steps: CompilerStep[];
  // 'validate': a cheap, non-destructive pre-flight — every bound object
  // still gets located and checked visible (so a stale Object Library entry
  // is caught before Execute ever runs), but nothing is actually clicked,
  // typed, selected, or submitted, EXCEPT a nav/tab-type object's own CLICK,
  // which still fires for real so the pass can walk through every screen
  // the flow visits rather than only ever validating the first one.
  mode?: 'execute' | 'validate';
}): CompileResult {
  const { flowName, applicationEntryUrl, steps, mode = 'execute' } = params;
  const suffix = mode === 'validate' ? 'Validate' : '';
  const flowBaseName = toCamelCase(flowName) + suffix;
  const flowPascalName = (toPascalCase(flowName) || 'GeneratedFlow') + suffix;

  // Group object-bound steps by screen to decide Page Object files — one
  // class per screen, mirroring how a human would structure a POM suite.
  const screenGroups = new Map<string, CompilerStep[]>();
  for (const step of steps) {
    if (!step.object) continue;
    const screen = step.object.screenName || 'App';
    if (!screenGroups.has(screen)) screenGroups.set(screen, []);
    screenGroups.get(screen)!.push(step);
  }

  const pageObjectFiles: CompiledFile[] = [];
  const pageObjectImports: string[] = [];
  const pageObjectInstantiations: string[] = [];
  const stepMethodInfo = new Map<string, { instanceVar: string; methodName: string }>();

  for (const [screenName, screenSteps] of screenGroups) {
    const className = screenClassName(screenName);
    const instanceVar = toCamelCase(className);
    const methods: string[] = [];
    const seenMethods = new Set<string>();
    let needsCalendarDateHelper = false;
    // Two DIFFERENT objects sharing a generic objectName (confirmed live: a
    // wizard with two date pickers, each with its own "OK" button — both
    // named just "OK") used to collide on the same generated method name.
    // methodNameFor() alone can't tell them apart, and the old plain
    // seenMethods Set treated the second one as "already generated" and
    // silently pointed its step at the FIRST OK button's locator — a
    // silent wrong-element click, not a compile error, so it only ever
    // surfaced as a confusing runtime timeout. Keyed by technicalPath: the
    // same real element reused across steps still shares one method (that
    // part was correct), but a same-named, different-locator object now
    // gets its own disambiguated method instead of overwriting.
    const methodNameForLocator = new Map<string, string>();
    const usedMethodNames = new Set<string>();

    for (const step of screenSteps) {
      const obj = step.object!;
      const baseName = methodNameFor(step.stepType, obj.objectName);
      let mName = methodNameForLocator.get(obj.technicalPath);
      if (!mName) {
        mName = baseName;
        for (let suffix = 2; usedMethodNames.has(mName); suffix++) {
          mName = `${baseName}${suffix}`;
        }
        methodNameForLocator.set(obj.technicalPath, mName);
        usedMethodNames.add(mName);
      }
      stepMethodInfo.set(step.id, { instanceVar, methodName: mName });
      if (seenMethods.has(mName)) continue;
      seenMethods.add(mName);

      const locator = `this.getPage().locator(${JSON.stringify(obj.technicalPath)})`;
      const isNavClick = step.stepType === 'CLICK' && /tab|nav/i.test(obj.objectType);

      if (mode === 'validate' && !isNavClick) {
        methods.push(`  async ${mName}(): Promise<void> {\n    await expect(${locator}).toBeVisible();\n  }`);
        continue;
      }

      switch (step.stepType) {
        case 'CLICK': {
          const dayCell = obj.createdAt ? parseCalendarDayCellLocator(obj.technicalPath) : null;
          if (dayCell) {
            needsCalendarDateHelper = true;
            const deltaDays = daysApartUTC(obj.createdAt!, dayCell.recordedDate);
            methods.push(
              `  async ${mName}(): Promise<void> {\n` +
                `    await __twpClickRelativeCalendarDate(this.getPage(), { idPrefix: ${JSON.stringify(dayCell.idPrefix)}, deltaDays: ${deltaDays} });\n` +
                `  }`,
            );
          } else {
            methods.push(`  async ${mName}(): Promise<void> {\n    await ${locator}.click();\n  }`);
          }
          break;
        }
        case 'ENTER_TEXT':
          // .fill() sets the value and fires input/change, but leaves focus
          // IN the field — confirmed live against this exact SAPUI5 wizard:
          // the typed value was visible on screen, yet clicking "Next Step"
          // still reported "There are errors in step 1 (Identification)"
          // with Name/Description showing empty. SAPUI5 form controls
          // commonly validate (and update their own data-bound model) on
          // blur, not on every keystroke — Tab both blurs this field and
          // matches how a real user would actually move to the next one.
          methods.push(`  async ${mName}(value: string): Promise<void> {\n    await ${locator}.fill(value);\n    await ${locator}.press('Tab');\n  }`);
          break;
        case 'SELECT_DROPDOWN': {
          if (obj.objectType === 'combobox') {
            // Frameworks like SAPUI5 render a "dropdown" (e.g. sap.m.Select)
            // as a JS-driven popup, not a native <select> — .selectOption()
            // fails outright ("not a <select> element"), and even a real
            // click-to-open plus clicking the option by locator doesn't
            // work: confirmed in practice that the popup's own <li> options
            // report visibility:hidden indefinitely after opening, in both
            // headless AND headed Chromium, regardless of how long you wait
            // — so this isn't an animation timing issue, the popup simply
            // isn't reliably clickable under automation. These frameworks
            // universally expose their control tree on window for exactly
            // this kind of scripting need, and driving the widget's own API
            // reproduces a real user selection (fires the same change
            // event) without depending on that popup ever becoming
            // click-able. The "-hiddenSelect"/"-hiddenInput" suffixes are
            // SAPUI5's own accessibility-shadow-element naming convention
            // for the real control's id.
            const controlId = obj.technicalPath.replace(/^#/, '').replace(/-hidden(Select|Input)$/, '');
            // page.evaluate() has no built-in timeout — unlike locator
            // actions, it waits forever for the browser's JS context to
            // respond. Confirmed in practice: a real execution hung here for
            // the full 150s outer watchdog with zero step-3 screenshot, no
            // Playwright-level timeout message, nothing actionable in the
            // logs. Racing against an explicit timeout turns a silent, slow
            // hang into a fast, clearly-labeled failure instead.
            //
            // The evaluate callback itself polls (100ms) until the control
            // AND a matching item both exist, instead of checking once and
            // failing immediately — confirmed in practice that a single
            // immediate check threw "control not found" on a normal page
            // that just hadn't finished SAPUI5 init yet at that exact
            // instant, with no retry to recover from it.
            methods.push(
              `  async ${mName}(value: string): Promise<void> {\n` +
                `    await Promise.race([\n` +
                `      this.getPage().evaluate(({ val, deadlineMs }) => new Promise<void>((resolve, reject) => {\n` +
                `        const deadline = Date.now() + deadlineMs;\n` +
                `        function attempt() {\n` +
                `          const sapCore = (window as any).sap?.ui?.getCore?.();\n` +
                `          const control = sapCore?.byId(${JSON.stringify(controlId)});\n` +
                `          const item = control?.getItems().find((i: any) => i.getText() === val || i.getKey() === val);\n` +
                `          if (control && item) {\n` +
                `            control.setSelectedItem(item);\n` +
                `            control.fireChange({ selectedItem: item });\n` +
                `            resolve();\n` +
                `            return;\n` +
                `          }\n` +
                `          if (Date.now() > deadline) {\n` +
                `            reject(new Error(control ? \`No option matching "\${val}" in ${controlId}\` : ${JSON.stringify(`SAPUI5 control "${controlId}" not found — is this really a sap.m.Select?`)}));\n` +
                `            return;\n` +
                `          }\n` +
                `          setTimeout(attempt, 100);\n` +
                `        }\n` +
                `        attempt();\n` +
                `      }), { val: value, deadlineMs: 15000 }),\n` +
                `      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(${JSON.stringify(`Timed out waiting for SAPUI5 control "${controlId}" to respond (20s) — the page may be unresponsive.`)})), 20000)),\n` +
                `    ]);\n` +
                `  }`,
            );
          } else {
            methods.push(`  async ${mName}(value: string): Promise<void> {\n    await ${locator}.selectOption(value);\n  }`);
          }
          break;
        }
        case 'VERIFY_TEXT': {
          // An <input>/<textarea>'s value lives in the value property, not
          // textContent — toContainText() checks textContent, which for
          // these elements is always empty, so the assertion fails even
          // when the displayed value is exactly right (confirmed in
          // practice against a real execution). dom-walker.ts's own
          // objectType taxonomy (`<type>-input`, `textarea`) is what lets
          // this be detected precisely instead of guessed.
          const isValueBased = /-input$/i.test(obj.objectType) || obj.objectType.toLowerCase() === 'textarea';
          methods.push(
            isValueBased
              ? `  async ${mName}(expected: string): Promise<void> {\n    await expect(${locator}).toHaveValue(expected);\n  }`
              : `  async ${mName}(expected: string): Promise<void> {\n    await expect(${locator}).toContainText(expected);\n  }`,
          );
          break;
        }
        case 'VERIFY_ELEMENT_VISIBLE':
          methods.push(`  async ${mName}(): Promise<void> {\n    await expect(${locator}).toBeVisible();\n  }`);
          break;
        case 'UPLOAD_FILE':
          methods.push(`  async ${mName}(filePath: string): Promise<void> {\n    await ${locator}.setInputFiles(filePath);\n  }`);
          break;
        case 'HOVER':
          methods.push(`  async ${mName}(): Promise<void> {\n    await ${locator}.hover();\n  }`);
          break;
        case 'SCROLL':
          methods.push(`  async ${mName}(): Promise<void> {\n    await ${locator}.scrollIntoViewIfNeeded();\n  }`);
          break;
        case 'DOWNLOAD_FILE':
          methods.push(
            `  async ${mName}() {\n    const [download] = await Promise.all([\n      this.getPage().waitForEvent('download'),\n      ${locator}.click(),\n    ]);\n    return download;\n  }`,
          );
          break;
        default:
          break;
      }
    }

    const code = [
      `import { Page, expect } from '@playwright/test';`,
      ``,
      ...(needsCalendarDateHelper ? [buildCalendarDateClickHelperSource(), ``] : []),
      `export class ${className} {`,
      `  constructor(private readonly getPage: () => Page) {}`,
      ``,
      methods.join('\n\n'),
      `}`,
      ``,
    ].join('\n');

    pageObjectFiles.push({ fileName: `${className}.ts`, code, role: 'PAGE_OBJECT' });
    pageObjectImports.push(`import { ${className} } from './${className}';`);
    pageObjectInstantiations.push(`  const ${instanceVar} = new ${className}(() => page);`);
  }

  // Data fixture: every distinct test-data reference or literal inline value
  // used across the flow, resolved at RUN time (not generation time) so
  // placeholders like {{timestamp}} stay fresh on every execution — but
  // resolved exactly ONCE per distinct value, not inline at every call site.
  // resolvePlaceholders() generates a fresh random value on each call for
  // {{randomUser}}/{{randomEmail}}/etc; calling it separately at an
  // ENTER_TEXT step and again at a later VERIFY_TEXT step for the "same"
  // value produced two DIFFERENT random strings, so the verification could
  // never match what was actually entered (confirmed against a real
  // execution failure). Resolving into a `resolved<Name>` constant once,
  // up front, and having every step reference that constant fixes this.
  const dataEntries = new Map<string, string>();
  const stepDataVar = new Map<string, string | null>();
  for (const step of steps) {
    let varName: string | null = null;
    if (step.testDataItem) {
      varName = toCamelCase(step.testDataItem.key);
      dataEntries.set(varName, step.testDataItem.value);
    } else if (step.inlineValue && ['ENTER_TEXT', 'SELECT_DROPDOWN', 'VERIFY_TEXT', 'UPLOAD_FILE'].includes(step.stepType)) {
      varName = `${toCamelCase(step.object?.objectName ?? step.stepType)}Value`;
      dataEntries.set(varName, step.inlineValue);
    }
    stepDataVar.set(step.id, varName);
  }
  function resolvedVarName(dataVar: string): string {
    return `resolved${toPascalCase(dataVar)}`;
  }

  const specLines: string[] = [];
  for (const step of steps) {
    const stepLabel = `Step ${step.stepOrder}: ${step.stepType}${step.object ? ` (${step.object.objectName})` : ''}`;
    const bodyLines: string[] = [];

    switch (step.stepType) {
      case 'OPEN_URL': {
        const url = configValue(step.config, 'url') || step.inlineValue || applicationEntryUrl || 'about:blank';
        // The bare goto used to be enough, but a hash-only URL change on a
        // real SAP Fiori SPA (the sample application's GRC dashboard, confirmed live) is
        // reported "COMPLETED" almost instantly even though the router's
        // target view hasn't actually rendered yet — Fiori commonly
        // lazy-loads a routing target's component bundle + its first OData
        // call the first time you navigate there, which the network layer
        // sees but a plain goto doesn't wait for. Bounded at 8s (not the
        // step's full budget) since some dashboards poll continuously and
        // would never truly go idle; the .catch just means "gave it a fair
        // chance," not "confirmed rendered."
        bodyLines.push(`await page.goto(${JSON.stringify(url)});`);
        bodyLines.push(`await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);`);
        break;
      }
      case 'WAIT': {
        const ms = configValue(step.config, 'durationMs') ?? 1000;
        bodyLines.push(`await page.waitForTimeout(${Number(ms)});`);
        break;
      }
      case 'ACCEPT_ALERT': {
        bodyLines.push(`page.once('dialog', (dialog) => dialog.accept());`);
        break;
      }
      case 'SWITCH_TAB': {
        bodyLines.push(`// Captures the tab opened by the previous step and makes it the active page for all subsequent steps.`);
        bodyLines.push(`const [newPage] = await Promise.all([context.waitForEvent('page')]);`);
        bodyLines.push(`await newPage.waitForLoadState();`);
        bodyLines.push(`page = newPage;`);
        break;
      }
      case 'API_CALL': {
        // Never a real network call in validate mode — the whole point of a
        // dry run is that nothing outside the browser session is touched.
        if (mode === 'validate') {
          bodyLines.push(`// API_CALL step — skipped in validate mode (no real network calls in a dry run).`);
          break;
        }
        const method = String(configValue(step.config, 'method') ?? 'get').toLowerCase();
        const url = configValue(step.config, 'url');
        // A flow-generated API_CALL step with no real endpoint configured
        // has nothing to call — compiling it anyway produced a literal
        // request.get("") in practice, an unintended live network call to
        // whatever Playwright's baseURL happens to be. Same "no equivalent
        // for this step" no-op treatment as DB_VALIDATION/SAP_VALIDATION
        // below, rather than emitting a call with no real target.
        if (!url || typeof url !== 'string' || !url.trim()) {
          bodyLines.push(`// API_CALL step has no URL configured — skipped rather than calling an empty endpoint.`);
          break;
        }
        bodyLines.push(`const apiResponse = await request.${method}(${JSON.stringify(url)});`);
        bodyLines.push(`expect(apiResponse.ok()).toBeTruthy();`);
        break;
      }
      case 'DB_VALIDATION':
      case 'SAP_VALIDATION': {
        bodyLines.push(`// ${step.stepType} is reserved for a future phase — not implemented yet.`);
        break;
      }
      default: {
        const info = stepMethodInfo.get(step.id);
        if (!info) {
          bodyLines.push(`// No object assigned for this step — skipped during generation.`);
          break;
        }
        const isNavClick = mode === 'validate' && step.stepType === 'CLICK' && step.object != null && /tab|nav/i.test(step.object.objectType);
        const takesArgument =
          (mode === 'execute' || isNavClick) &&
          (step.stepType === 'ENTER_TEXT' ||
            step.stepType === 'SELECT_DROPDOWN' ||
            step.stepType === 'VERIFY_TEXT' ||
            step.stepType === 'UPLOAD_FILE');
        let actionCall: string;
        if (takesArgument) {
          const dataVar = stepDataVar.get(step.id) ?? null;
          const arg = dataVar ? resolvedVarName(dataVar) : JSON.stringify(step.inlineValue ?? '');
          actionCall = `await ${info.instanceVar}.${info.methodName}(${arg});`;
        } else {
          actionCall = `await ${info.instanceVar}.${info.methodName}();`;
        }

        // On failure, capture what's actually on screen right now (same
        // authenticated, already-navigated live page the failing action just
        // ran against — no separate browser, no remembered URL needed) so
        // ExecutionService can later ask AI whether one of these live
        // candidates is a plausible replacement for the locator that just
        // didn't resolve. Best-effort only: any problem capturing/writing
        // this never masks or replaces the real error, which is always
        // rethrown unchanged.
        const allowlist = objectTypeAllowlistFor(step.stepType);
        const targetLabel = step.object!.objectName;
        bodyLines.push(
          `try {\n` +
            `      ${actionCall}\n` +
            `    } catch (err) {\n` +
            `      try {\n` +
            `        const candidates = await Promise.race([\n` +
            `          page.evaluate(__twpCaptureDomForHeal, { objectTypeAllowlist: ${JSON.stringify(allowlist)}, targetLabel: ${JSON.stringify(targetLabel)}, maxCandidates: ${DOM_HEAL_MAX_CANDIDATES} }),\n` +
            `          new Promise((_, reject) => setTimeout(() => reject(new Error('dom snapshot timed out')), ${DOM_HEAL_CAPTURE_TIMEOUT_MS})),\n` +
            `        ]);\n` +
            `        await fs.writeFile('test-results/step-${step.stepOrder}-dom.json', JSON.stringify({ stepOrder: ${step.stepOrder}, candidates }));\n` +
            `      } catch { /* best-effort only — never mask the real error */ }\n` +
            `      throw err;\n` +
            `    }`,
        );
      }
    }

    // One screenshot per step, always (not just on failure) — the Executions
    // UI shows these after the run finishes, on top of the live headed
    // browser window (see playwright.config.ts) the run itself pops up.
    bodyLines.push(`await page.screenshot({ path: 'test-results/step-${step.stepOrder}.png' }).catch(() => undefined);`);

    specLines.push(`  await test.step(${JSON.stringify(stepLabel)}, async () => {`);
    for (const line of bodyLines) specLines.push(`    ${line}`);
    specLines.push(`  });`);
  }

  const dataFileLines = [
    `// Generated data fixture. Values may contain placeholder tokens resolved at run time.`,
    `export function resolvePlaceholders(value: string): string {`,
    `  return value.replace(/\\{\\{\\s*([a-zA-Z]+)(?::(\\d+))?\\s*\\}\\}/g, (match, token: string, param?: string) => {`,
    `    switch (token.toLowerCase()) {`,
    `      case 'timestamp':`,
    `        return String(Date.now());`,
    `      case 'randomemail':`,
    `        return \`user\${Math.floor(100000 + Math.random() * 900000)}@example.com\`;`,
    `      case 'randomuser':`,
    `        return \`user\${Math.floor(100000 + Math.random() * 900000)}\`;`,
    `      case 'today':`,
    `        return new Date().toISOString().slice(0, 10);`,
    `      case 'futuredate': {`,
    `        const days = param ? parseInt(param, 10) : 7;`,
    `        const future = new Date();`,
    `        future.setDate(future.getDate() + days);`,
    `        return future.toISOString().slice(0, 10);`,
    `      }`,
    `      default:`,
    `        return match;`,
    `    }`,
    `  });`,
    `}`,
    ``,
    `export const testData = {`,
    ...Array.from(dataEntries.entries()).map(([varName, rawValue]) => `  ${varName}: ${JSON.stringify(rawValue)},`),
    `};`,
    ``,
  ];

  const needsContextFixture = steps.some((s) => s.stepType === 'SWITCH_TAB');
  const needsRequestFixture = mode === 'execute' && steps.some((s) => s.stepType === 'API_CALL');
  const needsDomHealCapture = steps.some((s) => s.object != null);
  const fixtureArgs = ['page: initialPage', ...(needsContextFixture ? ['context'] : []), ...(needsRequestFixture ? ['request'] : [])];

  const specCode = [
    mode === 'validate'
      ? `// VALIDATE MODE — a pre-flight dry run. Every bound object below is\n` +
        `// located and checked visible, but nothing is clicked, typed, selected,\n` +
        `// or submitted except a nav/tab click needed to reach a later screen.\n` +
        `// A clean pass here means the Object Library is current against this\n` +
        `// application right now — it does not execute the real test.`
      : `// Deterministic compiler output (playwright-compiler.ts) — no AI in this path.`,
    `import { test, expect } from '@playwright/test';`,
    ...(needsDomHealCapture ? [`import * as fs from 'fs/promises';`] : []),
    `import { testData, resolvePlaceholders } from './${flowBaseName}.data';`,
    ...pageObjectImports,
    ``,
    ...(needsDomHealCapture ? [buildDomCaptureHelperSource(), ``] : []),
    `test(${JSON.stringify(flowName)}, async ({ ${fixtureArgs.join(', ')} }) => {`,
    `  let page = initialPage;`,
    ...pageObjectInstantiations,
    // Resolved exactly once per distinct value, up front — every step
    // referencing the same test-data key or inline value reuses this same
    // constant instead of re-resolving (and re-randomizing) it per step.
    ...Array.from(dataEntries.keys()).map(
      (varName) => `  const ${resolvedVarName(varName)} = resolvePlaceholders(testData.${varName});`,
    ),
    ...specLines,
    `});`,
    ``,
    `test.afterEach(async ({ page }, testInfo) => {`,
    `  if (testInfo.status !== testInfo.expectedStatus) {`,
    `    await page.screenshot({ path: \`test-results/\${testInfo.title.replace(/\\s+/g, '-')}-failure.png\`, fullPage: true });`,
    `  }`,
    `});`,
    ``,
  ].join('\n');

  return {
    files: [
      ...pageObjectFiles,
      { fileName: `${flowBaseName}.data.ts`, code: dataFileLines.join('\n'), role: 'FIXTURE' },
      { fileName: `${flowPascalName}.spec.ts`, code: specCode, role: 'SPEC' },
    ],
    command: `npx playwright test ${flowPascalName}.spec.ts`,
  };
}
