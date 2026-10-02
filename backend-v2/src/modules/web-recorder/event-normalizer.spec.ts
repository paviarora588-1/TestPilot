import { createNormalizerState, normalizeBrowserEvent, normalizeNavigation, normalizeTabSwitch, normalizeAlert } from './event-normalizer';
import type { RecordedRawEvent } from './recorder-injected-script';

const clickEvent: RecordedRawEvent = {
  actionType: 'CLICK',
  recommendedLocator: '#submit',
  recommendedLocatorType: 'ID',
  backupLocators: [],
  label: 'Submit',
  value: null,
  objectType: 'button',
};

describe('event-normalizer', () => {
  it('maps a raw browser event onto a NormalizedStepInput carrying its locator and context', () => {
    const state = createNormalizerState();
    const step = normalizeBrowserEvent(
      clickEvent,
      { pageUrl: 'https://app.test/login', pageTitle: 'Login', frameUrl: 'https://app.test/login', tabIndex: 0 },
      state,
    );

    expect(step).toMatchObject({
      actionType: 'CLICK',
      label: 'Submit',
      pageUrl: 'https://app.test/login',
      frameUrl: null, // same as pageUrl — top-level frame, not worth carrying twice
      recommendedLocator: '#submit',
      recommendedLocatorType: 'ID',
    });
  });

  it('carries a non-top-level frameUrl distinctly from pageUrl', () => {
    const state = createNormalizerState();
    const step = normalizeBrowserEvent(
      clickEvent,
      { pageUrl: 'https://app.test/checkout', pageTitle: 'Checkout', frameUrl: 'https://payments.test/embed', tabIndex: 0 },
      state,
    );
    expect(step.frameUrl).toBe('https://payments.test/embed');
  });

  it('suppresses a navigation that lands within the dedupe window right after a CLICK', () => {
    const state = createNormalizerState();
    normalizeBrowserEvent(clickEvent, { pageUrl: 'https://app.test/', pageTitle: 'Home', frameUrl: 'https://app.test/', tabIndex: 0 }, state);

    const nav = normalizeNavigation('https://app.test/dashboard', { tabIndex: 0, pageTitle: null }, state, Date.now() + 200);
    expect(nav).toBeNull();
  });

  it('keeps a navigation once the dedupe window has passed since the last click', () => {
    const state = createNormalizerState();
    normalizeBrowserEvent(clickEvent, { pageUrl: 'https://app.test/', pageTitle: 'Home', frameUrl: 'https://app.test/', tabIndex: 0 }, state);

    const nav = normalizeNavigation('https://app.test/dashboard', { tabIndex: 0, pageTitle: null }, state, Date.now() + 6500);
    expect(nav).not.toBeNull();
    expect(nav?.actionType).toBe('NAVIGATE');
    expect(nav?.pageUrl).toBe('https://app.test/dashboard');
  });

  it('suppresses an immediate repeat of the identical URL (a redirect echo, not a real second navigation)', () => {
    const state = createNormalizerState();
    const first = normalizeNavigation('https://app.test/', { tabIndex: 0, pageTitle: null }, state, 1000);
    expect(first).not.toBeNull();

    const echo = normalizeNavigation('https://app.test/', { tabIndex: 0, pageTitle: null }, state, 1500);
    expect(echo).toBeNull();
  });

  it('keeps a second navigation to the identical URL once the echo window has passed', () => {
    const state = createNormalizerState();
    normalizeNavigation('https://app.test/', { tabIndex: 0, pageTitle: null }, state, 1000);

    const later = normalizeNavigation('https://app.test/', { tabIndex: 0, pageTitle: null }, state, 10_000);
    expect(later).not.toBeNull();
  });

  it('keeps a navigation with no preceding step at all (the very first page load path aside)', () => {
    const state = createNormalizerState();
    const nav = normalizeNavigation('https://app.test/', { tabIndex: 0, pageTitle: null }, state);
    expect(nav).not.toBeNull();
  });

  it('does not suppress a navigation following an ENTER_TEXT (only CLICK/DOUBLE_CLICK cause the redundant-echo problem)', () => {
    const state = createNormalizerState();
    normalizeBrowserEvent(
      { ...clickEvent, actionType: 'ENTER_TEXT', value: 'hello' },
      { pageUrl: 'https://app.test/', pageTitle: 'Home', frameUrl: 'https://app.test/', tabIndex: 0 },
      state,
    );
    const nav = normalizeNavigation('https://app.test/next', { tabIndex: 0, pageTitle: null }, state, Date.now() + 100);
    expect(nav).not.toBeNull();
  });

  it('builds a labeled tab-switch step', () => {
    const step = normalizeTabSwitch('NEW_TAB', 1, 'https://app.test/help');
    expect(step).toMatchObject({ actionType: 'NEW_TAB', tabIndex: 1, pageUrl: 'https://app.test/help' });
    expect(step.label).toContain('https://app.test/help');
  });

  it('builds an alert step carrying the dialog message as rawValue', () => {
    const step = normalizeAlert('ALERT_ACCEPT', 'Are you sure?', 0);
    expect(step).toMatchObject({ actionType: 'ALERT_ACCEPT', rawValue: 'Are you sure?' });
  });
});
