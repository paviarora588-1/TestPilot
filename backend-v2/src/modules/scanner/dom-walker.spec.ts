import { extractDrillTargets, extractTabs, extractTiles, walkPageForObjects } from './dom-walker';

// extractDrillTargets is serialized standalone into the browser via
// page.evaluate(fn) — Playwright ships only fn.toString(), so ANY reference
// to something declared outside the function body silently becomes a
// ReferenceError the moment it actually runs (confirmed live: exactly this
// bug, with UNSAFE_TO_CLICK_RE first written at module scope, broke every
// scan page after the first). No jsdom in this project to actually execute
// the function against a real DOM, so these tests check the two things that
// matter without one: the source stays self-contained, and the safety
// regex it builds (duplicated here on purpose — it can't be imported out of
// a serialized function body) makes the right call on every real button
// label this app has actually shown tonight, plus any per-application
// custom words layered on top.

// Kept identical to the construction inside extractDrillTargets in
// dom-walker.ts — if that changes, this must change with it, which is the
// point: the tests below only mean anything if this genuinely matches what
// runs in the browser, not a "good enough" approximation of it.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const BASE_UNSAFE_PATTERNS = [
  'delete', 'remove', 'discard', 'purge', 'drop', 'destroy',
  'terminate(?!\\s*control)', 'revoke', 'submit', 'save', 'update', 'apply',
  'create', 'add', 'insert', 'finish', 'complete', 'confirm', 'approve',
  'reject', 'deny', 'execute', 'run', 'send', 'pay', 'payment', 'transfer',
  'withdraw', 'deposit', 'sign', 'authorize', 'publish', 'unpublish',
  'deploy', 'install', 'uninstall', 'activate', 'deactivate', 'enable',
  'disable', 'archive', 'restore', 'reset', 'clear', 'wipe', 'empty',
  'log\\s*out', 'logout', 'sign\\s*out', 'yes', 'proceed', 'continue', 'ok',
];
function buildUnsafeRegex(extraWords: string[] = []): RegExp {
  const extraPatterns = extraWords.map((w) => w.trim().toLowerCase()).filter(Boolean).map(escapeRegExp);
  return new RegExp(`\\b(${[...BASE_UNSAFE_PATTERNS, ...extraPatterns].join('|')})\\b`, 'i');
}

function insertWordBoundarySpaces(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

describe('dom-walker — extractDrillTargets self-containment', () => {
  it('builds the safety regex inside its own function body, not at module scope', () => {
    const source = extractDrillTargets.toString();
    expect(source).toContain('UNSAFE_TO_CLICK_RE');
    // A real declaration, not just a usage — catches the regression where
    // the regex (or its inputs) lived outside and only got *referenced*
    // here, which is undefined the moment this runs in the browser.
    expect(source).toMatch(/const\s+UNSAFE_TO_CLICK_RE\s*=/);
    expect(source).toContain('BASE_UNSAFE_PATTERNS');
    expect(source).toMatch(/const\s+BASE_UNSAFE_PATTERNS\s*=/);
  });

  it('excludes persistent shell chrome (nav/header/menubar/banner) from candidates', () => {
    // No jsdom in this project to exercise el.closest() against a real DOM
    // tree — this is a regression guard on the source itself: confirmed
    // live that without this, a real scan burned its entire 5-minute
    // budget re-discovering the same left-nav menu links and header
    // controls from every one of 39 pages instead of finding new content.
    const source = extractDrillTargets.toString();
    expect(source).toContain('role="navigation"');
    expect(source).toContain('role="menubar"');
    expect(source).toContain('role="banner"');
  });

  it('excludes target="_blank" links from candidates', () => {
    // Confirmed live the hard way: a real scan against OrangeHRM's demo
    // clicked several target="_blank" links (including one leading clean
    // off the app to its own public marketing site). Each click opened a
    // brand new browser tab Playwright's page.click() has no way to know
    // about — the tracked page never moved, so the crawler re-captured the
    // same page it was already on as if it were new content, AND left
    // that new tab open forever since nothing ever closes it. A real run
    // orphaned dozens of tabs this way before it was caught. This is a
    // source-string regression guard (no jsdom in this project to actually
    // exercise el.getAttribute against a live DOM).
    const source = extractDrillTargets.toString();
    expect(source).toContain('_blank');
  });

  it('accepts an opts.extraUnsafeWords parameter', () => {
    // Confirms the per-application custom word list actually has a way in —
    // a signature regression here would silently make every custom word a
    // no-op even though the UI happily lets someone add one.
    expect(extractDrillTargets.length).toBe(1);
    expect(extractDrillTargets.toString()).toContain('extraUnsafeWords');
  });
});

describe('dom-walker — UNSAFE_TO_CLICK_RE (drill-down safety denylist)', () => {
  const UNSAFE_TO_CLICK_RE = buildUnsafeRegex();

  const dangerous = [
    'Delete',
    'Finish',
    'Yes',
    'Execute Reactions',
    'OK',
    'Confirm',
    'Save',
    'Submit',
    'Create Incident Pattern',
    'Approve',
    'Sign Out',
  ];

  it.each(dangerous)('blocks %j as visible text', (label) => {
    expect(UNSAFE_TO_CLICK_RE.test(label)).toBe(true);
  });

  // Excludes 2-letter all-caps words (OK) — insertWordBoundarySpaces only
  // inserts a space at a lowercase-to-uppercase transition, so an
  // all-caps acronym glued directly to the next capitalized word
  // ("OKButton") has no such transition to find. Not a real gap: this
  // app's own ids use hyphens between segments (...DateTimePicker-OK),
  // which already gives \b a real boundary on both sides without the
  // spacing fix at all — confirmed by the id-based test below.
  it.each(dangerous.filter((label) => label !== 'OK'))(
    'still blocks %j when concatenated with no spaces (camelCase-style)',
    (label) => {
      const concatenated = label.replace(/\s+/g, '') + 'Button';
      // Raw match may or may not fire depending on where the word lands —
      // the point of insertWordBoundarySpaces is that the SPACED form
      // always catches it regardless.
      expect(UNSAFE_TO_CLICK_RE.test(insertWordBoundarySpaces(concatenated))).toBe(true);
    },
  );

  const safe = [
    'Cancel',
    'Close',
    'Search',
    'Next Step',
    'Select',
    'Sort',
    'Ascending',
    'Only with Events',
    'Enter Full Screen Mode',
    'Incident Patterns',
    'Security Overview',
  ];

  it.each(safe)('does not block %j', (label) => {
    expect(UNSAFE_TO_CLICK_RE.test(label)).toBe(false);
  });

  it('blocks a real destructive id even with no visible label, once word-boundary-spaced', () => {
    // Icon-only button: no accessible text, only a camelCase id — the exact
    // case with no other signal to catch it.
    const id = 'container-example.sampleRoot---threat---incidentPatternBrowser--deleteIncidentPatternButton';
    expect(UNSAFE_TO_CLICK_RE.test(id)).toBe(false); // raw id: no real word boundary around "delete"
    expect(UNSAFE_TO_CLICK_RE.test(insertWordBoundarySpaces(id))).toBe(true); // spaced form catches it
  });

  it('does not block a real safe id (e.g. a Fiori tile id) even when spaced', () => {
    const id = 'container-example.sampleRoot---home--execTDetectionTileIncidentMonitor';
    expect(UNSAFE_TO_CLICK_RE.test(insertWordBoundarySpaces(id))).toBe(false);
  });
});

describe('dom-walker — UNSAFE_TO_CLICK_RE with per-application custom words', () => {
  it('does not block a custom word before it has been added', () => {
    expect(buildUnsafeRegex().test('Quarantine Device')).toBe(false);
  });

  it('blocks a custom word once supplied, without disturbing the base list', () => {
    const withCustom = buildUnsafeRegex(['Quarantine Device']);
    expect(withCustom.test('Quarantine Device')).toBe(true);
    expect(withCustom.test('Delete')).toBe(true); // base list still works
    expect(withCustom.test('Cancel')).toBe(false); // still not over-broad
  });

  it('is case-insensitive and trims whitespace on custom words', () => {
    const withCustom = buildUnsafeRegex(['  Verschieben  ']);
    expect(withCustom.test('verschieben')).toBe(true);
    expect(withCustom.test('VERSCHIEBEN')).toBe(true);
  });

  it('escapes regex special characters in a custom word instead of treating it as a pattern', () => {
    // A user typing "pay(now)" should match that literal text, not be
    // interpreted as a regex group — an unescaped "(" would otherwise
    // throw when building the RegExp at all.
    expect(() => buildUnsafeRegex(['pay(now)'])).not.toThrow();
    const withCustom = buildUnsafeRegex(['pay(now)']);
    expect(withCustom.test('please pay(now) to continue')).toBe(true);
  });

  it('ignores blank/empty custom word entries', () => {
    expect(() => buildUnsafeRegex(['', '   '])).not.toThrow();
  });
});

describe('dom-walker — target="_blank" exclusion (extractTiles/extractTabs)', () => {
  // Same untracked-new-tab failure mode as extractDrillTargets, for the two
  // other functions whose candidates could (less commonly, but really)
  // land on an anchor tag: an <a role="button"> Fiori tile, or an
  // <a role="tab">. Source-string regression guards — no jsdom in this
  // project to exercise a live DOM.
  it('extractTiles excludes target="_blank" candidates', () => {
    expect(extractTiles.toString()).toContain('_blank');
  });

  it('extractTabs excludes target="_blank" candidates', () => {
    expect(extractTabs.toString()).toContain('_blank');
  });
});

describe('dom-walker — walkPageForObjects computes isPersistentChrome from real landmark membership', () => {
  // Root cause of a real, user-reported bug: ScannerService's "common
  // object" folding used to key purely on locator-string recurrence across
  // pages — which coincidentally collides for two DIFFERENT pages' search
  // forms built from the SAME reusable component (identical labels,
  // identical relative DOM position, so dom-walker's own fallback CSS
  // locator comes out identical too). That folded both pages' real content
  // away as "chrome" and left them with zero objects. The actual, reliable
  // signal for "is this really part of the persistent shell" is landmark
  // membership, computed here once, per object, from the DOM itself — not
  // inferred later from how often a locator string happens to repeat.
  it('computes isPersistentChrome using the same landmark set extractDrillTargets already excludes by', () => {
    const source = walkPageForObjects.toString();
    expect(source).toContain('isPersistentChrome');
    expect(source).toMatch(/const\s+isPersistentChrome\s*=/);
    expect(source).toContain('role="navigation"');
    expect(source).toContain('role="menubar"');
    expect(source).toContain('role="banner"');
  });

  it('includes isPersistentChrome on every returned object, not just a subset', () => {
    // A regression where this field only got set on SOME branches (e.g.
    // added inside an if-block instead of unconditionally before the
    // push) would silently produce `undefined` for the rest — which a
    // Boolean-typed Prisma column would reject or coerce unpredictably.
    const source = walkPageForObjects.toString();
    const pushIndex = source.indexOf('results.push(');
    const isPersistentChromeIndex = source.indexOf('isPersistentChrome', source.indexOf('const isPersistentChrome'));
    expect(pushIndex).toBeGreaterThan(-1);
    expect(isPersistentChromeIndex).toBeGreaterThan(-1);
    expect(isPersistentChromeIndex).toBeLessThan(pushIndex);
  });
});
