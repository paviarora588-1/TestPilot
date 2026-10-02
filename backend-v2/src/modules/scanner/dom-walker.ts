/**
 * Runs inside the browser page via page.evaluate(). No Node APIs, no imports —
 * only plain DOM/browser globals are available here. Ported concept from the
 * legacy app's client-side frontend/src/utils/webObjectScanner.ts heuristics
 * (label priority: data-testid > id > aria-label > name > css > xpath > text),
 * rewritten as a server-side Playwright scan instead of a DevTools bookmarklet.
 */
export interface RawScannedObject {
  label: string | null;
  objectType: string;
  xpath: string;
  cssSelector: string | null;
  idAttr: string | null;
  nameAttr: string | null;
  placeholder: string | null;
  buttonText: string | null;
  ariaLabel: string | null;
  nearbyLabelText: string | null;
  recommendedLocator: string;
  recommendedLocatorType: 'ID' | 'DATA_TESTID' | 'ARIA_LABEL' | 'NAME' | 'CSS' | 'XPATH' | 'TEXT';
  backupLocators: string[];
  confidenceScore: number;
  // Confirmed live: two DIFFERENT search forms on two DIFFERENT pages
  // (Performance Review's search, Leave List's filter) render the SAME
  // reusable OrangeHRM component — same "Reset"/"Search" labels, same
  // relative DOM position, and therefore the SAME fallback CSS locator
  // (getCssPath() anchors to the app's own root id, `#app`, when no closer
  // unique ancestor id exists — which is itself a coincidence of markup,
  // not evidence two elements are "the same recurring widget"). Locator
  // recurrence alone is NOT reliable evidence of persistent shell chrome —
  // only genuine landmark membership (a real nav/header/menubar/banner
  // that visually never leaves the screen) is. This flag is computed here,
  // once, from the DOM structure itself, so the common-object folding in
  // ScannerService only ever applies to elements that are actually part of
  // the persistent shell — never to content-area widgets that merely
  // happen to reuse the same component.
  isPersistentChrome: boolean;
}

export function walkPageForObjects(opts?: { objectTypeAllowlist?: string[] }): RawScannedObject[] {
  // Widened from the original 6-role set after a real scan's own object
  // count looked low for what was actually on screen — it covered the
  // basics (button/link/checkbox/radio/textbox) but missed most of the
  // rest of the standard ARIA interactive-role vocabulary: a toggle
  // (switch), a slider, a numeric stepper (spinbutton), a searchable
  // dropdown (combobox), menu items, an actual tab (captured as a
  // navigation target by extractTabs, but never as an object a test could
  // reference/verify), a listbox option, a tree row, and a rich-text
  // editor (contenteditable). graphics-symbol/graphics-document/
  // img+tabindex are the same W3C ARIA Graphics-module roles added to
  // extractDrillTargets for chart segments — without them here too, a
  // chart could be found as a place to click into but never captured as
  // an object of its own.
  const SELECTOR =
    'input, textarea, select, button, a[href], [role="button"], [role="link"], [role="textbox"], ' +
    '[role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="spinbutton"], ' +
    '[role="combobox"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], ' +
    '[role="tab"], [role="option"], [role="treeitem"], [role="graphics-symbol"], ' +
    '[role="graphics-document"], [role="img"][tabindex], [contenteditable="true"], [tabindex]';
  const elements = Array.from(document.querySelectorAll(SELECTOR)) as HTMLElement[];

  // Icon fonts (SAP-icons, Font Awesome, Material Icons, …) render a glyph as
  // a single character in the Unicode Private Use Areas — invisible/
  // meaningless to a human, but a real, non-whitespace character as far as
  // .trim() is concerned. Left unstripped, an icon-only button's textContent
  // (e.g. U+E091) reads as "real" text, wins the label priority chain over
  // ariaLabel/etc., and produces an object with no usable identifier at all
  // (confirmed on RP's header icon buttons: id="lang"/"user" both got a
  // blank-looking label instead of falling through to their own id).
  // Nested (not module-scope): this whole function is serialized standalone
  // via page.evaluate(walkPageForObjects) — a module-level helper wouldn't
  // exist in that browser-side execution context.
  function stripIconGlyphs(text: string): string {
    return text.replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '').trim();
  }

  function getXPath(el: Element): string {
    if ((el as HTMLElement).id) return `//*[@id="${(el as HTMLElement).id}"]`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${node.nodeName.toLowerCase()}[${index}]`);
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  }

  function escapeAttrValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function getCssPath(el: Element): string {
    if ((el as HTMLElement).id) return `#${CSS.escape((el as HTMLElement).id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      // Anchor to the nearest ancestor with an id instead of walking all the
      // way to <body> — confirmed live against a real SAPUI5 app: an icon
      // click with no id of its own (common — decorative icons/containers
      // rarely get one) produced a 20-level absolute nth-of-type chain from
      // body, fragile to any upstream layout/component change. A short
      // `#stableAncestorId > ...` selector only breaks if something between
      // that ancestor and this element changes, not the whole page.
      const parentEl = node.parentElement;
      if (parentEl?.id) {
        let selector = node.nodeName.toLowerCase();
        const className = (node as HTMLElement).className;
        if (className && typeof className === 'string') {
          const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
        }
        let index = 1;
        let sibling = node.previousElementSibling;
        while (sibling) {
          if (sibling.nodeName === node.nodeName) index++;
          sibling = sibling.previousElementSibling;
        }
        selector += `:nth-of-type(${index})`;
        parts.unshift(selector);
        parts.unshift(`#${CSS.escape(parentEl.id)}`);
        return parts.join(' > ');
      }
      let selector = node.nodeName.toLowerCase();
      const className = (node as HTMLElement).className;
      if (className && typeof className === 'string') {
        const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
      }
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousElementSibling;
      }
      selector += `:nth-of-type(${index})`;
      parts.unshift(selector);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function findNearbyLabelText(el: HTMLElement): string | null {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text = label?.textContent ? stripIconGlyphs(label.textContent) : '';
      if (text) return text;
    }
    const parentLabel = el.closest('label');
    const parentText = parentLabel?.textContent ? stripIconGlyphs(parentLabel.textContent) : '';
    if (parentText) return parentText;

    let sibling = el.previousElementSibling;
    let hops = 0;
    while (sibling && hops < 3) {
      const text = stripIconGlyphs(sibling.textContent ?? '');
      if (text && text.length > 0 && text.length < 80) return text;
      sibling = sibling.previousElementSibling;
      hops++;
    }
    return null;
  }

  function objectTypeOf(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return `${el.getAttribute('type') || 'text'}-input`;
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    return el.getAttribute('role') || tag;
  }

  const results: RawScannedObject[] = [];

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const elementObjectType = objectTypeOf(el);
    if (opts?.objectTypeAllowlist && !opts.objectTypeAllowlist.includes(elementObjectType)) continue;

    const idAttr = el.id || null;
    const nameAttr = el.getAttribute('name') || null;
    const dataTestId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || null;
    const ariaLabel = el.getAttribute('aria-label') || null;
    const placeholder = el.getAttribute('placeholder') || null;
    // Own visible text is only meaningless for input/select/textarea (a
    // <select>'s textContent is every <option> concatenated; an <input> has
    // no child text at all) — everything else the SELECTOR matches (button,
    // a, and any role="tab"/"button"/"link"/tabindex element) has its own
    // text as the single most reliable label, and must be captured here
    // rather than left to fall through to nearbyLabelText below. Previously
    // this only fired for tag button/a, so a role="tab" element (a common
    // pattern for SPA tab bars) fell all the way through to nearbyLabelText
    // instead — which, combined with that also being checked before this,
    // caused every tab in a tab bar to be labeled with the PREVIOUS tab's
    // text (confirmed on a real app: a 6-tab nav bar had every tab's stored
    // label shifted by exactly one position from its real locator).
    // A wrapper that itself contains other matched elements (e.g. a
    // role="navigation" bar wrapping six role="tab" children) has no
    // meaningful "own" text of its own — its textContent is every child's
    // text concatenated — so it's excluded the same as input/select/textarea.
    const hasInteractiveDescendant = el.querySelector(SELECTOR) !== null;
    const isTextBearing = !hasInteractiveDescendant && !['input', 'select', 'textarea'].includes(el.tagName.toLowerCase());
    const buttonText = isTextBearing ? stripIconGlyphs(el.textContent || '').slice(0, 80) || null : null;
    const nearbyLabelText = findNearbyLabelText(el);
    // An element's own text (buttonText) now takes priority over a sibling's
    // text (nearbyLabelText) — nearbyLabelText is only the right signal for
    // elements with no meaningful text of their own, like a bare <input>
    // whose real label lives in a preceding <label>/<span>.
    const label = ariaLabel || buttonText || nearbyLabelText || placeholder || nameAttr || idAttr || null;

    const xpath = getXPath(el);
    const cssSelector = getCssPath(el);

    let recommendedLocator: string;
    let recommendedLocatorType: RawScannedObject['recommendedLocatorType'];
    let confidenceScore: number;

    if (dataTestId) {
      recommendedLocator = `[data-testid="${escapeAttrValue(dataTestId)}"]`;
      recommendedLocatorType = 'DATA_TESTID';
      confidenceScore = 0.95;
    } else if (idAttr) {
      recommendedLocator = `#${CSS.escape(idAttr)}`;
      recommendedLocatorType = 'ID';
      confidenceScore = 0.92;
    } else if (ariaLabel) {
      recommendedLocator = `[aria-label="${escapeAttrValue(ariaLabel)}"]`;
      recommendedLocatorType = 'ARIA_LABEL';
      confidenceScore = 0.85;
    } else if (nameAttr) {
      recommendedLocator = `[name="${escapeAttrValue(nameAttr)}"]`;
      recommendedLocatorType = 'NAME';
      confidenceScore = 0.8;
    } else if (cssSelector) {
      recommendedLocator = cssSelector;
      recommendedLocatorType = 'CSS';
      confidenceScore = 0.65;
    } else {
      recommendedLocator = xpath;
      recommendedLocatorType = 'XPATH';
      confidenceScore = 0.5;
    }

    const backupCandidates = [
      xpath,
      cssSelector,
      nameAttr ? `[name="${escapeAttrValue(nameAttr)}"]` : null,
      ariaLabel ? `[aria-label="${escapeAttrValue(ariaLabel)}"]` : null,
    ];
    const backupLocators = backupCandidates.filter(
      (value, index): value is string => !!value && value !== recommendedLocator && backupCandidates.indexOf(value) === index,
    );

    // Same landmark set extractDrillTargets already uses to exclude
    // persistent shell chrome from click candidates — genuine membership in
    // a real nav/header/menubar/banner landmark, not locator recurrence, is
    // what actually makes something "the same physical widget on every
    // page" rather than two different pages coincidentally reusing the
    // same form component.
    const isPersistentChrome = !!el.closest('[role="navigation"], nav, [role="menubar"], [role="banner"], header');

    results.push({
      label,
      objectType: elementObjectType,
      xpath,
      cssSelector,
      idAttr,
      nameAttr,
      placeholder,
      buttonText,
      ariaLabel,
      nearbyLabelText,
      recommendedLocator,
      recommendedLocatorType,
      backupLocators,
      confidenceScore,
      isPersistentChrome,
    });
  }

  return results;
}

/**
 * Runs inside the browser page via page.evaluate(). Returns every same-document
 * anchor href (browser-resolved to an absolute URL, hash included) so the
 * crawler can discover other pages reachable from the current one — including
 * client-side-routed SPA "pages" that share a path but differ only by hash.
 */
export function extractPageLinks(): string[] {
  return Array.from(document.querySelectorAll('a[href]'))
    .map((a) => (a as HTMLAnchorElement).href)
    .filter(Boolean);
}

export interface PageTab {
  selector: string;
  label: string;
}

/**
 * Many SPA frameworks (this includes SAPUI5/OpenUI5 IconTabBar, Material
 * tabs, etc.) render "pages" as role="tab" elements with no href at all —
 * switching between them is a pure JS content swap, so link-following alone
 * never finds them. role="tab" is a deliberately narrow, safe signal to act
 * on: by ARIA definition a tab only changes what's visible, it never submits
 * or mutates data the way an arbitrary button might.
 *
 * Previously required the tab element to have an `id` (so the selector could
 * just be `#id`), which meant a tab bar built without ids — confirmed on a
 * real 7-tab dashboard — was invisible to the crawler entirely, even though
 * every tab was a genuine role="tab". A CSS nth-of-type path (same technique
 * walkPageForObjects's getCssPath uses) covers that case without requiring
 * any specific markup.
 */
export function extractTabs(): PageTab[] {
  // Self-contained like walkPageForObjects's own copy — this function is
  // also serialized standalone via page.evaluate(extractTabs).
  function stripIconGlyphs(text: string): string {
    return text.replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '').trim();
  }
  function cssPath(el: Element): string {
    if ((el as HTMLElement).id) return `#${CSS.escape((el as HTMLElement).id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      // Anchor to the nearest ancestor with an id — see walkPageForObjects's
      // own getCssPath for why: an absolute nth-of-type chain from body is
      // fragile to any upstream layout change, confirmed live on a real app.
      const parentEl = node.parentElement;
      if (parentEl?.id) {
        let selector = node.nodeName.toLowerCase();
        const className = (node as HTMLElement).className;
        if (className && typeof className === 'string') {
          const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
        }
        let index = 1;
        let sibling = node.previousElementSibling;
        while (sibling) {
          if (sibling.nodeName === node.nodeName) index++;
          sibling = sibling.previousElementSibling;
        }
        selector += `:nth-of-type(${index})`;
        parts.unshift(selector);
        parts.unshift(`#${CSS.escape(parentEl.id)}`);
        return parts.join(' > ');
      }
      let selector = node.nodeName.toLowerCase();
      const className = (node as HTMLElement).className;
      if (className && typeof className === 'string') {
        const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
      }
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousElementSibling;
      }
      selector += `:nth-of-type(${index})`;
      parts.unshift(selector);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  // Some SAPUI5 tile/tab templates render their title and subtitle as
  // sibling elements with no whitespace text node between them in the
  // source markup — textContent then concatenates them with nothing in
  // between ("Security OverviewExecutive Dashboard"), unlike other
  // templates that do have that whitespace and read fine as-is. Confirmed
  // live: a real scan of this app produced exactly that garbled title on
  // some tiles but not others. Inserting a space at a lowercase-to-
  // uppercase boundary is layout-agnostic — it fixes the concatenation
  // wherever it happens without needing to know this app's specific
  // section names, and is a no-op on any label that was already spaced.
  function insertWordBoundarySpaces(text: string): string {
    return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }

  return Array.from(document.querySelectorAll('[role="tab"]'))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    // An <a role="tab" target="_blank"> is unusual but not impossible —
    // clicking it opens an untracked new tab instead of switching the
    // current one, the same failure mode fixed in extractDrillTargets.
    .filter((el) => (el.getAttribute('target') || '').toLowerCase() !== '_blank')
    .map((el) => ({
      selector: cssPath(el),
      label:
        insertWordBoundarySpaces(stripIconGlyphs(el.getAttribute('aria-label') || el.textContent || '')).slice(0, 60) ||
        cssPath(el),
    }));
}

/**
 * Fiori/SAPUI5 launchpad home pages (the sample dashboard this was
 * confirmed against) are built almost entirely from GenericTile buttons —
 * "Security Overview", "Incident Monitor", etc. Each one is a real
 * navigation into a whole sub-app, not a page fragment, but nothing about a
 * plain role="button" click is inherently safe to auto-trigger — it could
 * just as easily be Save/Delete/Submit. Auto-clicking has to earn a narrow,
 * evidence-backed signal rather than "any button": confirmed live, every
 * one of this app's own tiles has "tile" baked into its own control id
 * (...execTDetectionTileIncidentMonitor, ...operationsHubTile,
 * ...vulnAssessTileAudit) AND SAPUI5's GenericTile renders an accessibility
 * hint reading literally "Tile" as the last line of the control's own text
 * content (confirmed: a real tile's captured label was "Security
 * Overview\nExecutive Dashboard\nTile"). Requiring either signal — not
 * inventing a guessed CSS class name — is what makes this safe to act on
 * automatically instead of just cataloguing the tile and stopping there
 * (which is what the crawl did before this: identical elements are already
 * separately captured as ordinary button objects by walkPageForObjects,
 * this only adds "and also treat it as a place to crawl into").
 */
export function extractTiles(): PageTab[] {
  function stripIconGlyphs(text: string): string {
    return text.replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '').trim();
  }
  function cssPath(el: Element): string {
    if ((el as HTMLElement).id) return `#${CSS.escape((el as HTMLElement).id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      const parentEl = node.parentElement;
      if (parentEl?.id) {
        let selector = node.nodeName.toLowerCase();
        const className = (node as HTMLElement).className;
        if (className && typeof className === 'string') {
          const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
        }
        let index = 1;
        let sibling = node.previousElementSibling;
        while (sibling) {
          if (sibling.nodeName === node.nodeName) index++;
          sibling = sibling.previousElementSibling;
        }
        selector += `:nth-of-type(${index})`;
        parts.unshift(selector);
        parts.unshift(`#${CSS.escape(parentEl.id)}`);
        return parts.join(' > ');
      }
      let selector = node.nodeName.toLowerCase();
      const className = (node as HTMLElement).className;
      if (className && typeof className === 'string') {
        const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
      }
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousElementSibling;
      }
      selector += `:nth-of-type(${index})`;
      parts.unshift(selector);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // Same concatenation issue extractTabs works around (see
  // insertWordBoundarySpaces there) — some tile templates render their
  // title/subtitle with no whitespace text node between them, so
  // textContent joins them with nothing in between. Duplicated here rather
  // than shared: this whole function is separately serialized standalone
  // via page.evaluate(extractTiles), same reasoning as everywhere else in
  // this file.
  function insertWordBoundarySpaces(text: string): string {
    return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }

  const seen = new Set<string>();
  const tiles: PageTab[] = [];
  const candidates = document.querySelectorAll('button, [role="button"]');
  for (const el of Array.from(candidates)) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // [role="button"] can land on an <a target="_blank"> styled as a tile
    // — same untracked-new-tab failure mode as extractDrillTargets.
    if ((el.getAttribute('target') || '').toLowerCase() === '_blank') continue;
    const id = el.id || '';
    const rawText = stripIconGlyphs(el.textContent || '');
    const idLooksLikeTile = /tile/i.test(id);
    const textEndsWithTile = /(^|\n)\s*Tile\s*$/i.test(rawText);
    if (!idLooksLikeTile && !textEndsWithTile) continue;
    const selector = cssPath(el);
    if (seen.has(selector)) continue;
    seen.add(selector);
    // "Tile" itself is SAPUI5's own accessibility hint text, not part of
    // the tile's actual name — stripped from the end (only there, so a
    // tile that's genuinely named e.g. "Title Search" is untouched) before
    // taking the first line, so the displayed label is the tile's real
    // full name rather than a fragment or the hint word.
    const spaced = insertWordBoundarySpaces(rawText).replace(/\s*Tile\s*$/i, '').trim();
    const label = (spaced.split('\n')[0].trim() || spaced || id).slice(0, 60);
    tiles.push({ selector, label });
  }
  return tiles;
}

/**
 * Broader than extractTiles' narrow, framework-guaranteed-safe signals —
 * this drills into whatever a real user might click to see more (a table
 * row, a "view details" button, an expand affordance) rather than only
 * tabs/tiles. That breadth is exactly why it needs its own, more careful
 * safety gate: UNSAFE_TO_CLICK_RE screens by what the element SAYS it does,
 * and the type="submit"/<form> check below screens by what it structurally
 * WOULD do regardless of its label — two independent checks since neither
 * alone is reliable (a mislabeled submit button; a "confirm password"
 * field's helper text that happens to contain "confirm" but isn't itself
 * clickable — the row must fail BOTH checks to be excluded, i.e. it's
 * excluded if EITHER check flags it).
 */
export function extractDrillTargets(opts?: { extraUnsafeWords?: string[] }): PageTab[] {
  // Self-contained like every other function in this file, and for the
  // exact same reason (page.evaluate(fn) ships only fn.toString() — a
  // module-level const referenced from inside here would be undefined,
  // not the regex, the moment this actually runs in the browser).
  //
  // Words that mean "this click does something, not just shows
  // something" — confirmed necessary the hard way tonight: this exact
  // app's own "create incident pattern" wizard ends on a literal
  // "Finish" button followed by a "Yes" confirmation, and would
  // otherwise have created a real record in a live SAP GRC audit trail
  // if the crawler had blindly clicked its way through a wizard while
  // exploring. Deliberately broad and erring toward excluding rather
  // than missing something — a scan skipping a few benign "Continue"
  // buttons is a much better failure mode than one that mutates
  // production-adjacent security data.
  //
  // This base list can't know any one application's own dangerous-action
  // vocabulary in advance (a different app's "delete" might be labeled
  // "Deactivate Permanently", or be in a different language entirely) —
  // opts.extraUnsafeWords lets a human extend it per application (see
  // ScanUnsafeClickWord) without a code change. User-supplied words are
  // escaped before going into the pattern (unlike the base list, which is
  // controlled here and can use real regex syntax like the "terminate"
  // negative lookahead below) since they're arbitrary text, not authored
  // regex.
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
  const extraPatterns = (opts?.extraUnsafeWords ?? [])
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .map(escapeRegExp);
  // Word-boundary matched so it doesn't false-positive on unrelated words
  // that merely contain one of these as a substring.
  const UNSAFE_TO_CLICK_RE = new RegExp(`\\b(${[...BASE_UNSAFE_PATTERNS, ...extraPatterns].join('|')})\\b`, 'i');

  function stripIconGlyphs(text: string): string {
    return text.replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '').trim();
  }
  function insertWordBoundarySpaces(text: string): string {
    return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }
  function cssPath(el: Element): string {
    if ((el as HTMLElement).id) return `#${CSS.escape((el as HTMLElement).id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      const parentEl = node.parentElement;
      if (parentEl?.id) {
        let selector = node.nodeName.toLowerCase();
        const className = (node as HTMLElement).className;
        if (className && typeof className === 'string') {
          const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
        }
        let index = 1;
        let sibling = node.previousElementSibling;
        while (sibling) {
          if (sibling.nodeName === node.nodeName) index++;
          sibling = sibling.previousElementSibling;
        }
        selector += `:nth-of-type(${index})`;
        parts.unshift(selector);
        parts.unshift(`#${CSS.escape(parentEl.id)}`);
        return parts.join(' > ');
      }
      let selector = node.nodeName.toLowerCase();
      const className = (node as HTMLElement).className;
      if (className && typeof className === 'string') {
        const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
      }
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousElementSibling;
      }
      selector += `:nth-of-type(${index})`;
      parts.unshift(selector);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  const seen = new Set<string>();
  const targets: PageTab[] = [];
  // Deliberately no [role="row"]/tr here: a real data table can have
  // thousands of rows (confirmed live: an Incident Monitor table with 2,481
  // rows, earlier tonight) that are all structurally identical detail
  // views — drilling into every one would burn the whole page budget on
  // repeats instead of finding genuinely different pages.
  //
  // [role="graphics-symbol"]/[role="graphics-document"] are the actual W3C
  // ARIA Graphics module roles for an individually-interactive piece of a
  // chart (a pie slice, a bar) — the accessible-charting equivalent of
  // role="button". [role="img"][tabindex] covers the other common pattern:
  // a chart library marking its whole visualization as one focusable,
  // clickable unit rather than annotating each segment. No blanket "every
  // svg element" here on purpose — most of an SVG chart (axis lines,
  // gridlines, decorative fills) isn't clickable at all, and without
  // live-inspecting this app's specific chart library there's no reliable
  // way to tell which unmarked shapes are from which aren't; these three
  // patterns are ones with an actual accessibility spec behind them.
  const candidates = document.querySelectorAll(
    'button, [role="button"], [role="link"], a[href], [role="graphics-symbol"], [role="graphics-document"], [role="img"][tabindex]',
  );
  for (const el of Array.from(candidates)) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue;

    // Persistent shell chrome — confirmed live the hard way: a real scan
    // (39 pages, 5 minutes, timed out) turned out to have burned almost its
    // entire budget re-discovering the SAME left-nav menu links and header
    // controls from every single page, since they're present identically
    // everywhere. These ARIA landmark roles exist specifically to mark
    // "this is chrome around the content, not the content" — [role="tab"]
    // gets trusted for the opposite reason (guaranteed safe to click);
    // these get excluded for this one (guaranteed to lead nowhere new, and
    // to keep reappearing on every page visited). A left-nav menu item
    // itself is a real navigation destination — extractTiles already finds
    // the same destinations via the home page's tile grid, so nothing is
    // actually lost by not also reaching them through this second, always-
    // present path.
    if (el.closest('[role="navigation"], nav, [role="menubar"], [role="banner"], header')) continue;

    // Structural check — catches a real submit button/link regardless of
    // what its label says.
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button' && type !== 'button' && el.closest('form')) continue;
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      // Confirmed live the hard way: clicking a target="_blank" link opens
      // a brand new browser tab that Playwright's page.click() call has no
      // idea exists — the tracked `page` object stays exactly where it
      // was, so the crawler both (a) re-captures the same already-scanned
      // page as if it were new (the source of a real scan's many
      // duplicate/near-empty page entries) and (b) leaves that new tab
      // open forever, since nothing ever closes it — a real 150-page scan
      // orphaned dozens of untracked tabs, one per such link, some landing
      // on a completely different site entirely (this app's own footer
      // linking out to its public marketing site). A target="_blank" click
      // can never be captured as "the next page" under this crawl's
      // one-tracked-page model, so it isn't a valid drill target at all.
      if ((el.getAttribute('target') || '').toLowerCase() === '_blank') continue;
    }

    // Text check — catches a mislabeled-for-our-purposes element regardless
    // of its tag/structure. The id is tested both raw AND word-boundary-
    // spaced: this app's own ids are heavily camelCase-joined
    // (createPatternWIActiveFromDateTimePicker, execTDetectionTile...) with
    // no real separators, so \bdelete\b would silently never match inside
    // something like "deleteIncidentButton" on an icon-only button with no
    // visible text — exactly the case with no OTHER signal to catch it.
    const id = el.id || '';
    const rawText = stripIconGlyphs(el.getAttribute('aria-label') || el.textContent || '');
    // Same concatenation bug confirmed earlier tonight on tile labels
    // ("Security OverviewExecutive Dashboard") could just as easily hide
    // "DeleteIncidentPattern" as one run-on word — spaced form is checked
    // for exactly the same reason as the id above.
    if (
      UNSAFE_TO_CLICK_RE.test(rawText) ||
      UNSAFE_TO_CLICK_RE.test(insertWordBoundarySpaces(rawText)) ||
      UNSAFE_TO_CLICK_RE.test(id) ||
      UNSAFE_TO_CLICK_RE.test(insertWordBoundarySpaces(id))
    ) {
      continue;
    }
    if (!rawText && !id) continue; // nothing to identify or label this by

    const selector = cssPath(el);
    if (seen.has(selector)) continue;
    seen.add(selector);
    const spaced = insertWordBoundarySpaces(rawText).trim();
    const label = (spaced.split('\n')[0].trim() || spaced || id).slice(0, 60);
    targets.push({ selector, label });
  }
  return targets;
}
