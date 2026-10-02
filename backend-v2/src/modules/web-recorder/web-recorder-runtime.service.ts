import { Injectable, Logger } from '@nestjs/common';
import { Browser, BrowserContext, Frame, Page, chromium } from 'playwright';
import { WebRecordingSessionService } from './web-recording-session.service';
import { installRecorderListeners, RecordedRawEvent } from './recorder-injected-script';
import {
  NormalizerState,
  createNormalizerState,
  normalizeAlert,
  normalizeBrowserEvent,
  normalizeNavigation,
  normalizeTabSwitch,
} from './event-normalizer';

// Playwright's own BindingSource type isn't part of the public surface the
// "playwright" package re-exports (only the underlying classes are) — this
// mirrors its actual shape rather than importing an internal path.
interface RecorderBindingSource {
  context: BrowserContext;
  page: Page;
  frame: Frame;
}

const BINDING_NAME = '__testpilotRecordEvent';
// Recording is a human sitting at the browser, not a scripted run — a
// generous window vs. the Scanner's own multi-minute scan timeout, so a
// slow read of a real form doesn't get treated as abandonment.
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const ACTIVE_STATUSES = ['LAUNCHING', 'RECORDING', 'PAUSED'] as const;

interface RuntimeEntry {
  browser: Browser;
  context: BrowserContext;
  pages: Map<number, Page>;
  activeTabIndex: number;
  paused: boolean;
  normalizerState: NormalizerState;
  idleTimer: ReturnType<typeof setTimeout>;
}

// The one genuinely new piece of runtime infrastructure this feature
// introduces: a live Browser/BrowserContext/Page held in memory for the
// lifetime of a recording, never serialized to the database (see the
// WebRecordingSession/WebRecordingStep models' own comment for why). Every
// other Playwright use in this codebase is a single open-act-close within
// one request or job; this is deliberately long-lived across many separate
// HTTP requests (start, pause, resume, stop each arrive as their own call).
@Injectable()
export class WebRecorderRuntimeService {
  private readonly logger = new Logger(WebRecorderRuntimeService.name);
  private readonly registry = new Map<string, RuntimeEntry>();

  constructor(private readonly sessions: WebRecordingSessionService) {}

  async launch(sessionId: string, targetUrl: string): Promise<void> {
    const browser = await chromium.launch({ headless: false });
    // Same reasoning as the Scanner's own newPage() call — an internal app
    // on a self-signed cert would otherwise fail to even load, before a
    // single action could be recorded.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    const entry: RuntimeEntry = {
      browser,
      context,
      pages: new Map(),
      activeTabIndex: 0,
      paused: false,
      normalizerState: createNormalizerState(),
      idleTimer: this.scheduleIdleTimeout(sessionId),
    };
    this.registry.set(sessionId, entry);

    browser.on('disconnected', () => this.handleDisconnected(sessionId));

    await context.exposeBinding(BINDING_NAME, async (source: RecorderBindingSource, raw: RecordedRawEvent) => {
      await this.handleRawEvent(sessionId, source, raw);
    });
    await context.addInitScript(installRecorderListeners, BINDING_NAME);

    const page = await context.newPage();
    entry.pages.set(0, page);
    this.wirePage(sessionId, page, 0);

    // Registered only now, after tab 0 already exists and is wired — a
    // context 'page' event fires for EVERY page it creates, including this
    // very first one. Registering any earlier produced a spurious NEW_TAB
    // step for tab 0's own creation and double-wired its listeners (every
    // navigation on tab 0 was then recorded twice), confirmed by a live
    // recording run against a real app before this was caught.
    context.on('page', (newPage) => {
      this.handleNewPage(sessionId, newPage).catch((err) =>
        this.logger.error(`New-tab handling failed for recording ${sessionId}`, err),
      );
    });

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (err) {
      await this.close(sessionId);
      throw new Error(`Could not open ${targetUrl}: ${(err as Error).message}`);
    }
    const pageTitle = await page.title().catch(() => null);

    // The launch navigation is recorded unconditionally as step 1 — unlike
    // every later navigation, there is no preceding click for it to be a
    // redundant echo of, so it bypasses normalizeNavigation's dedupe check.
    // It still updates the SAME normalizer state normalizeNavigation reads,
    // though — otherwise the real 'framenavigated' event Playwright fires a
    // moment later for this exact same initial load would land as an
    // undeduped second NAVIGATE step to the identical URL.
    const launchAt = Date.now();
    entry.normalizerState.lastStep = { actionType: 'NAVIGATE', atMs: launchAt };
    entry.normalizerState.lastNav = { url: targetUrl, atMs: launchAt };
    await this.sessions.appendStep(sessionId, {
      actionType: 'NAVIGATE',
      label: pageTitle || targetUrl,
      pageUrl: targetUrl,
      pageTitle,
      frameUrl: null,
      tabIndex: 0,
      recommendedLocator: null,
      recommendedLocatorType: null,
      backupLocators: null,
      objectTypeHint: null,
      rawValue: targetUrl,
      config: null,
    });
    await this.sessions.markStatus(sessionId, ['LAUNCHING'], 'RECORDING', { startedAt: new Date() });
  }

  pause(sessionId: string): void {
    const entry = this.registry.get(sessionId);
    if (entry) entry.paused = true;
  }

  resume(sessionId: string): void {
    const entry = this.registry.get(sessionId);
    if (entry) entry.paused = false;
  }

  async close(sessionId: string): Promise<void> {
    const entry = this.registry.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.idleTimer);
    this.registry.delete(sessionId);
    await entry.browser.close().catch(() => undefined);
  }

  isActive(sessionId: string): boolean {
    return this.registry.has(sessionId);
  }

  private wirePage(sessionId: string, page: Page, tabIndex: number): void {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const entry = this.registry.get(sessionId);
      if (!entry || entry.paused) return;
      const url = frame.url();
      if (!url || url === 'about:blank') return;
      (async () => {
        const pageTitle = await page.title().catch(() => null);
        const step = normalizeNavigation(url, { tabIndex, pageTitle }, entry.normalizerState);
        if (!step) return;
        this.resetIdleTimer(sessionId);
        await this.sessions.appendStep(sessionId, step);
      })().catch((err) => this.logger.error(`Failed to persist navigation step for ${sessionId}`, err));
    });

    // Playwright intercepts native dialogs entirely (they never render) and
    // requires a programmatic response — auto-accepting keeps a recording
    // session from hanging on an unattended confirm()/alert() while still
    // logging that it happened, so the step list reflects what the app did.
    page.on('dialog', (dialog) => {
      const entry = this.registry.get(sessionId);
      if (entry && !entry.paused) {
        this.resetIdleTimer(sessionId);
        this.sessions
          .appendStep(sessionId, normalizeAlert('ALERT_ACCEPT', dialog.message(), tabIndex))
          .catch((err) => this.logger.error(`Failed to persist alert step for ${sessionId}`, err));
      }
      dialog.accept().catch(() => undefined);
    });

    if (tabIndex !== 0) {
      page.on('close', () => {
        const entry = this.registry.get(sessionId);
        if (!entry) return;
        entry.pages.delete(tabIndex);
        this.sessions
          .appendStep(sessionId, normalizeTabSwitch('CLOSE_TAB', tabIndex, null))
          .catch((err) => this.logger.error(`Failed to persist close-tab step for ${sessionId}`, err));
      });
    }
  }

  private async handleNewPage(sessionId: string, newPage: Page): Promise<void> {
    const entry = this.registry.get(sessionId);
    if (!entry) return;
    const tabIndex = entry.pages.size;
    entry.pages.set(tabIndex, newPage);
    entry.activeTabIndex = tabIndex;
    this.wirePage(sessionId, newPage, tabIndex);
    if (entry.paused) return;

    await newPage.waitForLoadState('domcontentloaded').catch(() => undefined);
    const pageTitle = await newPage.title().catch(() => null);
    this.resetIdleTimer(sessionId);
    await this.sessions
      .appendStep(sessionId, normalizeTabSwitch('NEW_TAB', tabIndex, newPage.url(), pageTitle))
      .catch((err) => this.logger.error(`Failed to persist new-tab step for ${sessionId}`, err));
  }

  private async handleRawEvent(
    sessionId: string,
    source: RecorderBindingSource,
    raw: RecordedRawEvent,
  ): Promise<void> {
    const entry = this.registry.get(sessionId);
    if (!entry || entry.paused) return;
    let tabIndex = entry.activeTabIndex;
    for (const [index, page] of entry.pages) {
      if (page === source.page) {
        tabIndex = index;
        break;
      }
    }
    const pageTitle = await source.page.title().catch(() => null);
    const step = normalizeBrowserEvent(
      raw,
      { pageUrl: source.page.url(), pageTitle, frameUrl: source.frame.url(), tabIndex },
      entry.normalizerState,
    );
    this.resetIdleTimer(sessionId);
    await this.sessions.appendStep(sessionId, step);
    await this.sessions.touchActivity(sessionId);
  }

  private handleDisconnected(sessionId: string): void {
    const entry = this.registry.get(sessionId);
    // Already cleaned up via close() (stop/cancel) — this fires as a normal
    // side effect of that call closing the browser, not a surprise.
    if (!entry) return;
    clearTimeout(entry.idleTimer);
    this.registry.delete(sessionId);
    this.sessions
      .markStatus(sessionId, [...ACTIVE_STATUSES], 'FAILED', {
        endedAt: new Date(),
        errorMessage: 'The browser window was closed before recording was stopped.',
      })
      .catch(() => undefined);
  }

  private scheduleIdleTimeout(sessionId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.forceAbandon(sessionId).catch((err) =>
        this.logger.error(`Failed to abandon idle recording ${sessionId}`, err),
      );
    }, IDLE_TIMEOUT_MS);
  }

  private resetIdleTimer(sessionId: string): void {
    const entry = this.registry.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = this.scheduleIdleTimeout(sessionId);
  }

  private async forceAbandon(sessionId: string): Promise<void> {
    const entry = this.registry.get(sessionId);
    if (!entry) return;
    this.registry.delete(sessionId);
    await entry.browser.close().catch(() => undefined);
    await this.sessions
      .markStatus(sessionId, [...ACTIVE_STATUSES], 'ABANDONED', {
        endedAt: new Date(),
        errorMessage: 'Recording timed out after 20 minutes of inactivity.',
      })
      .catch(() => undefined);
  }
}
