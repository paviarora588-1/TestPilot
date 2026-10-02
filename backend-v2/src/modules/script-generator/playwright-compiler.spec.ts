import { compileFlowToPlaywright, CompilerStep } from './playwright-compiler';

// Regression guard for the AI DOM-based auto-heal capture (see
// execution.service.ts's attemptAiDomHeal / suggestAutoHeal): a failing
// object-bound step must write test-results/step-<N>-dom.json before
// rethrowing its original error, and a flow with no object-bound steps at
// all must not pay for any of this machinery.

function specCodeFor(steps: CompilerStep[]): string {
  const result = compileFlowToPlaywright({ flowName: 'Test Flow', applicationEntryUrl: null, steps, mode: 'execute' });
  return result.files.find((f) => f.role === 'SPEC')!.code;
}

describe('compileFlowToPlaywright — AI DOM-based auto-heal capture', () => {
  it('wraps an object-bound step in try/catch, capturing to the right dump file and rethrowing unchanged', () => {
    const steps: CompilerStep[] = [
      {
        id: '1',
        stepOrder: 3,
        stepType: 'CLICK',
        inlineValue: null,
        config: null,
        object: { objectName: 'Incident Patterns', screenName: 'ThreatDetectionDashboard', technicalPath: '#__filter1', objectType: 'button' },
        testDataItem: null,
      },
    ];

    const code = specCodeFor(steps);

    expect(code).toContain(`import * as fs from 'fs/promises';`);
    expect(code).toContain('function __twpCaptureDomForHeal(opts)');
    expect(code).toContain('try {');
    expect(code).toContain('await threatDetectionDashboardPage.clickIncidentPatterns();');
    expect(code).toContain('} catch (err) {');
    expect(code).toContain(`'test-results/step-3-dom.json'`);
    expect(code).toContain('stepOrder: 3');
    expect(code).toContain('throw err;');
    // The unconditional per-step screenshot still runs after the try/catch,
    // outside it — a failure must not skip evidence capture either.
    expect(code).toContain(`'test-results/step-3.png'`);
  });

  it('gives a CLICK step a clickable-only allowlist, and an ENTER_TEXT step a text-input-only allowlist', () => {
    const steps: CompilerStep[] = [
      {
        id: '1',
        stepOrder: 1,
        stepType: 'CLICK',
        inlineValue: null,
        config: null,
        object: { objectName: 'Submit', screenName: 'Form', technicalPath: '#submit', objectType: 'button' },
        testDataItem: null,
      },
      {
        id: '2',
        stepOrder: 2,
        stepType: 'ENTER_TEXT',
        inlineValue: 'hello',
        config: null,
        object: { objectName: 'Username', screenName: 'Form', technicalPath: '#username', objectType: 'text-input' },
        testDataItem: null,
      },
    ];

    const code = specCodeFor(steps);

    expect(code).toContain('"button","link","tab","checkbox","checkbox-input","radio","radio-input"');
    expect(code).toContain('"text-input","email-input","password-input","number-input","tel-input","search-input","url-input","textarea"');
  });

  it('emits no capture machinery at all for a flow with no object-bound steps', () => {
    const steps: CompilerStep[] = [
      { id: '1', stepOrder: 1, stepType: 'OPEN_URL', inlineValue: 'https://example.com', config: null, object: null, testDataItem: null },
      { id: '2', stepOrder: 2, stepType: 'WAIT', inlineValue: null, config: { durationMs: 500 }, object: null, testDataItem: null },
    ];

    const code = specCodeFor(steps);

    expect(code).not.toContain('__twpCaptureDomForHeal');
    expect(code).not.toContain(`import * as fs from 'fs/promises';`);
    expect(code).not.toContain('-dom.json');
  });
});

// Regression guard for the date-relative calendar click fix (see
// suggestAutoHeal/execution.service.ts's real-world trigger: a SAPUI5
// calendar day cell's id bakes in the literal selected date — e.g.
// `...cal--Month0-20260905` — so replaying the exact recorded id only ever
// works again on the exact date it was recorded. The fix re-derives "the
// same date, relative to today" at run time instead of replaying the stale
// absolute date.
describe('compileFlowToPlaywright — date-relative calendar click', () => {
  function pageObjectCodeFor(steps: CompilerStep[]): string {
    const result = compileFlowToPlaywright({ flowName: 'Test Flow', applicationEntryUrl: null, steps, mode: 'execute' });
    return result.files.find((f) => f.role === 'PAGE_OBJECT')!.code;
  }

  it('rewrites a calendar-day-cell CLICK to the relative-date helper with the correct signed delta', () => {
    // Object created 2026-08-03, recorded selecting 2026-09-05 — 33 days later.
    const steps: CompilerStep[] = [
      {
        id: '1',
        stepOrder: 1,
        stepType: 'CLICK',
        inlineValue: null,
        config: null,
        object: {
          objectName: 'September 5, 2026',
          screenName: 'IncidentPatternWizard',
          technicalPath: '#container-example\\.sampleRoot---threat---incidentPatternBrowser--createPatternWIActiveToDateTimePicker-cal--Month0-20260905',
          objectType: 'button',
          createdAt: new Date(Date.UTC(2026, 7, 3)),
        },
        testDataItem: null,
      },
    ];

    const code = pageObjectCodeFor(steps);

    expect(code).toContain('async function __twpClickRelativeCalendarDate(page, opts)');
    expect(code).toContain(
      `idPrefix: "#container-example\\\\.sampleRoot---threat---incidentPatternBrowser--createPatternWIActiveToDateTimePicker-cal--Month0-"`,
    );
    expect(code).toContain('deltaDays: 33');
    expect(code).not.toContain('this.getPage().locator');
  });

  it('computes a negative delta when the recorded date is before the object was created', () => {
    // Object created 2026-08-03, recorded selecting 2026-08-02 — 1 day earlier.
    const steps: CompilerStep[] = [
      {
        id: '1',
        stepOrder: 1,
        stepType: 'CLICK',
        inlineValue: null,
        config: null,
        object: {
          objectName: 'August 2, 2026',
          screenName: 'IncidentPatternWizard',
          technicalPath: '#container-example\\.sampleRoot---threat---incidentPatternBrowser--createPatternWIActiveFromDateTimePicker-cal--Month0-20260802',
          objectType: 'button',
          createdAt: new Date(Date.UTC(2026, 7, 3)),
        },
        testDataItem: null,
      },
    ];

    const code = pageObjectCodeFor(steps);
    expect(code).toContain('deltaDays: -1');
  });

  it('leaves an ordinary (non-date-cell) CLICK untouched and emits no calendar helper', () => {
    const steps: CompilerStep[] = [
      {
        id: '1',
        stepOrder: 1,
        stepType: 'CLICK',
        inlineValue: null,
        config: null,
        object: { objectName: 'Submit', screenName: 'Form', technicalPath: '#submit', objectType: 'button', createdAt: new Date() },
        testDataItem: null,
      },
    ];

    const code = pageObjectCodeFor(steps);

    expect(code).toContain(`this.getPage().locator("#submit").click();`);
    expect(code).not.toContain('__twpClickRelativeCalendarDate');
  });

  it('gives two different objects that share a generic objectName ("OK") their own distinct methods and locators', () => {
    const steps: CompilerStep[] = [
      {
        id: '1',
        stepOrder: 1,
        stepType: 'CLICK',
        inlineValue: null,
        config: null,
        object: { objectName: 'OK', screenName: 'Wizard', technicalPath: '#activeFromPicker-OK', objectType: 'button', createdAt: new Date() },
        testDataItem: null,
      },
      {
        id: '2',
        stepOrder: 2,
        stepType: 'CLICK',
        inlineValue: null,
        config: null,
        object: { objectName: 'OK', screenName: 'Wizard', technicalPath: '#activeToPicker-OK', objectType: 'button', createdAt: new Date() },
        testDataItem: null,
      },
    ];

    const result = compileFlowToPlaywright({ flowName: 'Test Flow', applicationEntryUrl: null, steps, mode: 'execute' });
    const pageObject = result.files.find((f) => f.role === 'PAGE_OBJECT')!.code;
    const spec = result.files.find((f) => f.role === 'SPEC')!.code;

    // Two separate methods, each bound to its own real locator.
    expect(pageObject).toContain('#activeFromPicker-OK');
    expect(pageObject).toContain('#activeToPicker-OK');
    const okMethodCount = (pageObject.match(/async clickOK\d*\(/g) ?? []).length;
    expect(okMethodCount).toBe(2);

    // And the two steps' calls in the spec must resolve to two different methods.
    const calls = [...spec.matchAll(/wizardPage\.(clickOK\d*)\(\)/g)].map((m) => m[1]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toBe(calls[1]);
  });

  it('falls back to a plain click when createdAt is missing, even if the locator matches the date-cell pattern', () => {
    const steps: CompilerStep[] = [
      {
        id: '1',
        stepOrder: 1,
        stepType: 'CLICK',
        inlineValue: null,
        config: null,
        object: {
          objectName: 'September 5, 2026',
          screenName: 'IncidentPatternWizard',
          technicalPath: '#foo-cal--Month0-20260905',
          objectType: 'button',
          // createdAt intentionally omitted
        },
        testDataItem: null,
      },
    ];

    const code = pageObjectCodeFor(steps);

    expect(code).toContain('.click();');
    expect(code).not.toContain('__twpClickRelativeCalendarDate');
  });
});
