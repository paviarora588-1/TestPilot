/**
 * Runs inside the recorded browser page via context.addInitScript(). No Node
 * APIs, no imports, no references to anything outside this function — like
 * scanner/dom-walker.ts, Playwright serializes this whole function standalone
 * (Function.prototype.toString()) into every page and frame of the context,
 * so every helper must be nested inside it rather than module-scope.
 *
 * Reports each captured user action to Node via the exposed binding named by
 * `bindingName` (context.exposeBinding, wired up by WebRecorderRuntimeService)
 * — never console.log scraping, which is unreliable and easy for a page's own
 * logging to drown out.
 */
export interface RecordedRawEvent {
  actionType:
    | 'CLICK'
    | 'DOUBLE_CLICK'
    | 'RIGHT_CLICK'
    | 'ENTER_TEXT'
    | 'SELECT_OPTION'
    | 'CHECK'
    | 'UNCHECK'
    | 'UPLOAD_FILE';
  recommendedLocator: string;
  recommendedLocatorType: 'ID' | 'DATA_TESTID' | 'ARIA_LABEL' | 'NAME' | 'CSS' | 'XPATH' | 'TEXT';
  backupLocators: string[];
  label: string | null;
  value: string | null;
  objectType: string;
}

export function installRecorderListeners(bindingName: string): void {
  const w = window as unknown as Record<string, (payload: RecordedRawEvent) => void>;

  const INTERACTIVE_SELECTOR =
    'input, textarea, select, button, a[href], [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [tabindex]';

  // --- Locator generation — ported from scanner/dom-walker.ts's own
  // self-contained copy (same reasoning: this function is serialized
  // standalone, a module-level import would not exist in this context). ---
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
      // body, which is fragile to any upstream layout/component change and
      // wasn't even the actual cause of the flakiness it was blamed for —
      // it just made a genuinely brittle locator LOOK plausible. A short
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

  function findNearbyLabelText(el: Element): string | null {
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

  function objectTypeOf(el: Element): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return `${el.getAttribute('type') || 'text'}-input`;
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    return el.getAttribute('role') || tag;
  }

  function describeElement(el: Element): {
    label: string | null;
    objectType: string;
    recommendedLocator: string;
    recommendedLocatorType: RecordedRawEvent['recommendedLocatorType'];
    backupLocators: string[];
  } {
    const idAttr = el.id || null;
    const nameAttr = el.getAttribute('name') || null;
    const dataTestId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || null;
    const ariaLabel = el.getAttribute('aria-label') || null;
    const placeholder = el.getAttribute('placeholder') || null;
    const hasInteractiveDescendant = el.querySelector(INTERACTIVE_SELECTOR) !== null;
    const isTextBearing = !hasInteractiveDescendant && !['input', 'select', 'textarea'].includes(el.tagName.toLowerCase());
    const buttonText = isTextBearing ? stripIconGlyphs(el.textContent || '').slice(0, 80) || null : null;
    const nearbyLabelText = findNearbyLabelText(el);
    const label = ariaLabel || buttonText || nearbyLabelText || placeholder || nameAttr || idAttr || null;

    const xpath = getXPath(el);
    const cssSelector = getCssPath(el);

    let recommendedLocator: string;
    let recommendedLocatorType: RecordedRawEvent['recommendedLocatorType'];

    if (dataTestId) {
      recommendedLocator = `[data-testid="${escapeAttrValue(dataTestId)}"]`;
      recommendedLocatorType = 'DATA_TESTID';
    } else if (idAttr) {
      recommendedLocator = `#${CSS.escape(idAttr)}`;
      recommendedLocatorType = 'ID';
    } else if (ariaLabel) {
      recommendedLocator = `[aria-label="${escapeAttrValue(ariaLabel)}"]`;
      recommendedLocatorType = 'ARIA_LABEL';
    } else if (nameAttr) {
      recommendedLocator = `[name="${escapeAttrValue(nameAttr)}"]`;
      recommendedLocatorType = 'NAME';
    } else if (cssSelector) {
      recommendedLocator = cssSelector;
      recommendedLocatorType = 'CSS';
    } else {
      recommendedLocator = xpath;
      recommendedLocatorType = 'XPATH';
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

    return { label, objectType: objectTypeOf(el), recommendedLocator, recommendedLocatorType, backupLocators };
  }

  // Element, not HTMLElement: a click can legitimately land on an SVG node
  // (or its children) — confirmed relevant here since SAPUI5's TimePicker
  // renders its clock face as SVG, not an icon font like most of its other
  // controls. HTMLElement-only narrowing silently dropped clicks on those
  // entirely (no step recorded, no error either) since SVGElement isn't an
  // HTMLElement. closest()/getAttribute()/tagName/etc. are all defined on
  // the base Element interface, so nothing downstream actually needed the
  // narrower type — it was only ever a click-detection gap.
  function closestInteractive(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null;
    return target.closest(INTERACTIVE_SELECTOR) ?? target;
  }

  function emit(actionType: RecordedRawEvent['actionType'], el: Element, value: string | null): void {
    const described = describeElement(el);
    const fn = w[bindingName];
    if (typeof fn !== 'function') return;
    fn({ actionType, value, ...described });
  }

  // --- Text-commit buffering: raw keystrokes never cross the wire, only the
  // final value once the user moves on (blur, Enter, or clicking elsewhere).
  let pending: { el: HTMLElement; value: string } | null = null;

  function flushPending(): void {
    if (!pending) return;
    const { el, value } = pending;
    pending = null;
    emit('ENTER_TEXT', el, value);
  }

  function isTextEntryElement(el: HTMLElement): boolean {
    if (el.isContentEditable) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'].includes(type);
    }
    return false;
  }

  function currentValue(el: HTMLElement): string {
    if (el.isContentEditable) return el.textContent ?? '';
    return (el as HTMLInputElement).value ?? '';
  }

  document.addEventListener(
    'input',
    (e) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el || !isTextEntryElement(el)) return;
      pending = { el, value: currentValue(el) };
    },
    true,
  );

  document.addEventListener(
    'focusout',
    (e) => {
      if (pending && e.target === pending.el) flushPending();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter') return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      // A textarea's Enter is a newline, not a "done typing" signal — only
      // single-line fields treat Enter as a commit point.
      if (pending && el === pending.el && el.tagName.toLowerCase() !== 'textarea' && !el.isContentEditable) {
        flushPending();
      }
    },
    true,
  );

  document.addEventListener(
    'beforeunload',
    () => {
      flushPending();
    },
    true,
  );

  // Checkbox/radio/select/file all settle via 'change', which already
  // reflects the final state — no debouncing needed, and using 'change'
  // instead of 'click' here is what keeps a <label for="..."> click from
  // producing both a label-click step and a checkbox step (see the label
  // guard in the click handler below).
  document.addEventListener(
    'change',
    (e) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        const input = el as HTMLInputElement;
        if (type === 'checkbox') {
          emit(input.checked ? 'CHECK' : 'UNCHECK', el, null);
          return;
        }
        if (type === 'radio') {
          if (input.checked) emit('CHECK', el, null);
          return;
        }
        if (type === 'file') {
          const names = input.files ? Array.from(input.files).map((f) => f.name).join(', ') : null;
          emit('UPLOAD_FILE', el, names);
          return;
        }
        return; // other input types settle via the text-commit path above
      }
      if (tag === 'select') {
        const select = el as HTMLSelectElement;
        const selected = select.selectedOptions[0];
        emit('SELECT_OPTION', el, selected ? selected.text || selected.value : select.value);
      }
    },
    true,
  );

  let suppressClickUntil = 0;

  document.addEventListener(
    'dblclick',
    (e) => {
      const el = closestInteractive(e.target);
      if (!el) return;
      if (pending && el !== pending.el) flushPending();
      emit('DOUBLE_CLICK', el, null);
      suppressClickUntil = Date.now() + 500;
    },
    true,
  );

  document.addEventListener(
    'contextmenu',
    (e) => {
      const el = closestInteractive(e.target);
      if (!el) return;
      emit('RIGHT_CLICK', el, null);
    },
    true,
  );

  document.addEventListener(
    'click',
    (e) => {
      if (Date.now() < suppressClickUntil) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      // A <label for="checkboxId"> click also fires a native click/change on
      // the associated control — recording only the control's own 'change'
      // avoids a redundant label-click step for the exact same user action.
      const label = target.closest('label');
      if (label) {
        const forId = label.getAttribute('for');
        const control = forId ? document.getElementById(forId) : label.querySelector('input, select, textarea');
        if (control) {
          const controlTag = control.tagName.toLowerCase();
          const controlType = controlTag === 'input' ? (control.getAttribute('type') || 'text').toLowerCase() : null;
          if (controlTag === 'select' || controlType === 'checkbox' || controlType === 'radio') return;
        }
      }

      const el = closestInteractive(target);
      if (!el) return;
      const tag = el.tagName.toLowerCase();
      // Checkbox/radio/select settle via 'change' above — a 'click' on the
      // control itself would otherwise double it up.
      if (tag === 'select') return;
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (['checkbox', 'radio'].includes(type)) return;
      }

      if (pending && el !== pending.el) flushPending();
      emit('CLICK', el, null);
    },
    true,
  );
}
