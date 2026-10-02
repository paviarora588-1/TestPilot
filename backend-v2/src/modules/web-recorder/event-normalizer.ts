import { LocatorType } from '../../../generated/prisma/enums';
import type { RecordedRawEvent } from './recorder-injected-script';

export interface NormalizedStepInput {
  actionType:
    | 'NAVIGATE'
    | 'CLICK'
    | 'DOUBLE_CLICK'
    | 'RIGHT_CLICK'
    | 'ENTER_TEXT'
    | 'SELECT_OPTION'
    | 'CHECK'
    | 'UNCHECK'
    | 'UPLOAD_FILE'
    | 'NEW_TAB'
    | 'SWITCH_TAB'
    | 'CLOSE_TAB'
    | 'ALERT_ACCEPT'
    | 'ALERT_DISMISS';
  label: string | null;
  pageUrl: string | null;
  // The real, human page title (document.title) at the moment of the
  // action — a non-technical reviewer can recognize "Reset Password" far
  // more readily than the raw URL it came from, which is kept alongside for
  // anyone who does need it.
  pageTitle: string | null;
  frameUrl: string | null;
  tabIndex: number;
  recommendedLocator: string | null;
  recommendedLocatorType: LocatorType | null;
  backupLocators: string[] | null;
  objectTypeHint: string | null;
  rawValue: string | null;
  config: Record<string, unknown> | null;
}

export interface NormalizerState {
  lastStep: { actionType: NormalizedStepInput['actionType']; atMs: number } | null;
  lastNav: { url: string; atMs: number } | null;
}

export function createNormalizerState(): NormalizerState {
  return { lastStep: null, lastNav: null };
}

// A plain <a href> or a JS-driven navigation caused by a click fires a
// 'framenavigated' event a beat after that click's own step was already
// recorded — without this window, every navigating click would produce TWO
// steps (the click, then a redundant NAVIGATE to where it landed) for what
// the user experienced as one action.
// 6s, not 1.5s: confirmed live against a real SAP Fiori GRC dashboard
// (the sample application's Threat Detection area) — the router's own hash change landed
// well past the original 1.5s window, so the click's own resulting
// navigation got recorded as a second, spurious OPEN_URL step. Replaying
// that step later as a raw page.goto() to the hash it landed on doesn't
// reliably reproduce the state the real click achieved (see
// playwright-compiler.ts's OPEN_URL handling), so it's cheaper to just not
// record it in the first place. Matches SAME_URL_ECHO_WINDOW_MS below, which
// was widened for the exact same class of app for the same underlying
// reason (Fiori's shell + lazy-loaded routing targets genuinely take a few
// seconds to settle).
const NAV_DEDUPE_WINDOW_MS = 6000;

// Some apps genuinely fire 'framenavigated' more than once for what a user
// experiences as a single page load (a server-side redirect chain that
// bounces straight back, a client-side reload to the same URL) — confirmed
// live against a real app during development, where the exact same URL was
// recorded twice a few milliseconds apart. Suppressing an immediate repeat
// of the identical URL is safe: a script replaying the flow only needs to
// know it ended up on that URL once, not how many internal hops it took.
// 6s, not 2s: a real SAP Fiori launchpad recording still produced two
// identical OPEN_URL steps under the original 2s window — Fiori's own
// bootstrap (loading the shell, then the actual app) can genuinely take a
// few seconds longer than a typical app's redirect bounce.
const SAME_URL_ECHO_WINDOW_MS = 6000;

export function normalizeBrowserEvent(
  raw: RecordedRawEvent,
  ctx: { pageUrl: string; pageTitle: string | null; frameUrl: string; tabIndex: number },
  state: NormalizerState,
): NormalizedStepInput {
  const step: NormalizedStepInput = {
    actionType: raw.actionType,
    label: raw.label,
    pageUrl: ctx.pageUrl,
    pageTitle: ctx.pageTitle,
    frameUrl: ctx.frameUrl === ctx.pageUrl ? null : ctx.frameUrl,
    tabIndex: ctx.tabIndex,
    recommendedLocator: raw.recommendedLocator,
    recommendedLocatorType: raw.recommendedLocatorType as LocatorType,
    backupLocators: raw.backupLocators,
    objectTypeHint: raw.objectType,
    rawValue: raw.value,
    config: null,
  };
  state.lastStep = { actionType: step.actionType, atMs: Date.now() };
  return step;
}

export function normalizeNavigation(
  url: string,
  ctx: { tabIndex: number; pageTitle: string | null },
  state: NormalizerState,
  nowMs: number = Date.now(),
): NormalizedStepInput | null {
  const last = state.lastStep;
  const suppressedByRecentClick =
    !!last &&
    (last.actionType === 'CLICK' || last.actionType === 'DOUBLE_CLICK') &&
    nowMs - last.atMs <= NAV_DEDUPE_WINDOW_MS;
  if (suppressedByRecentClick) return null;

  const suppressedByEcho =
    !!state.lastNav && state.lastNav.url === url && nowMs - state.lastNav.atMs <= SAME_URL_ECHO_WINDOW_MS;
  if (suppressedByEcho) return null;

  const step: NormalizedStepInput = {
    actionType: 'NAVIGATE',
    label: ctx.pageTitle || url,
    pageUrl: url,
    pageTitle: ctx.pageTitle,
    frameUrl: null,
    tabIndex: ctx.tabIndex,
    recommendedLocator: null,
    recommendedLocatorType: null,
    backupLocators: null,
    objectTypeHint: null,
    rawValue: url,
    config: null,
  };
  state.lastStep = { actionType: 'NAVIGATE', atMs: nowMs };
  state.lastNav = { url, atMs: nowMs };
  return step;
}

export function normalizeTabSwitch(
  actionType: 'NEW_TAB' | 'SWITCH_TAB' | 'CLOSE_TAB',
  tabIndex: number,
  pageUrl: string | null,
  pageTitle: string | null = null,
): NormalizedStepInput {
  return {
    actionType,
    label: pageTitle || pageUrl || `Tab ${tabIndex}`,
    pageUrl,
    pageTitle,
    frameUrl: null,
    tabIndex,
    recommendedLocator: null,
    recommendedLocatorType: null,
    backupLocators: null,
    objectTypeHint: null,
    rawValue: null,
    config: null,
  };
}

export function normalizeAlert(
  actionType: 'ALERT_ACCEPT' | 'ALERT_DISMISS',
  message: string,
  tabIndex: number,
): NormalizedStepInput {
  return {
    actionType,
    label: message.slice(0, 120) || null,
    pageUrl: null,
    pageTitle: null,
    frameUrl: null,
    tabIndex,
    recommendedLocator: null,
    recommendedLocatorType: null,
    backupLocators: null,
    objectTypeHint: null,
    rawValue: message,
    config: null,
  };
}
