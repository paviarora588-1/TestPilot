import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Browser, chromium, Page } from 'playwright';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AiEngineeringService } from '../ai-engineering/ai-engineering.service';
import { ScanGateway } from './scan.gateway';
import { extractDrillTargets, extractPageLinks, extractTabs, extractTiles, RawScannedObject, walkPageForObjects } from './dom-walker';
import { listSapGuiSessions, mapSapGuiObject, runSapGuiScan } from './sap/sap-gui-scanner.util';
import { attemptAutoLogin, LoginCredentials } from './login-detector';

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'scans');

// Bounds on the crawl so a large/looping site can't turn a "scan one app" click
// into an unbounded background job. Raised from 15/2 after a real multi-tab
// dashboard (7 top-level tabs, each with its own cards/sub-pages) showed the
// old caps left most of the app unscanned — depth 2 wasn't enough to reach a
// tab's own cards, and 15 pages was consumed by the tabs alone. SCAN_TIMEOUT_MS
// below is still the real backstop on wall-clock time regardless of this cap.
// Raised again (60→150, 3→8) once tile-crawling (extractTiles) was added: a
// real Fiori launchpad's tiles each open into their own multi-step sub-app —
// depth 3 only reached "tile → its first sub-page → one thing on that page"
// before the crawl stopped expanding further, which real dashboards need
// several more hops past to actually bottom out.
const MAX_PAGES_PER_SCAN = 150;
const MAX_CRAWL_DEPTH = 8;

// Scans run fire-and-forget in-process (see startScan) with no job queue, so
// nothing else ever revisits a session once launched. If the server restarts
// mid-scan, or a real-world page's crawl just runs long, the session would
// otherwise sit at RUNNING forever with its browser process still alive —
// confirmed in practice after a restart orphaned an in-flight scan. Mirrors
// ExecutionService's watchdog: force-close the browser and mark FAILED
// instead of leaving it stuck.
// Raised from 5 min once the crawl itself was deepened (depth 3→8,
// 60→150 pages, plus extractDrillTargets exploring well beyond tabs/tiles)
// — 5 min was sized for the old, much shallower crawl and was confirmed
// live to force-stop a real scan at 39 pages/3,624 objects well before it
// was actually done. 30 min gives a full-depth, full-width crawl a
// realistic chance to finish; this is still a hard ceiling, not a typical
// runtime — a scan that actually needs the full 150 pages is the
// exception, not the norm.
const SCAN_TIMEOUT_MS = 30 * 60 * 1000;

// Heuristic guard: never auto-follow links that plausibly mutate state instead
// of just navigating (a scanner should observe, not act).
const UNSAFE_LINK_KEYWORDS = ['logout', 'log-out', 'signout', 'sign-out', 'delete', 'remove', 'deactivate'];

interface CrawlQueueEntry {
  url: string;
  depth: number;
  // When set, the entry represents a same-URL "page" reached by clicking a
  // role="tab" element after loading `url` — not a real navigation.
  tabSelector?: string;
  tabLabel?: string;
  // Which extractor discovered this entry — carried purely for the debug
  // trace below. Without it, a duplicate showing up in the trace log is
  // just a URL with no way to tell whether it came in as a plain <a href>,
  // a role="tab", a Fiori tile, or a broader drillTarget candidate — which
  // is exactly the question that matters when a duplicate turns up that
  // the existing dedup logic didn't catch.
  source?: 'seed' | 'link' | 'tab' | 'tile' | 'drillTarget';
}

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scanGateway: ScanGateway,
    private readonly aiEngineering: AiEngineeringService,
  ) {}

  async listSessions(applicationId: string) {
    return this.prisma.scanSession.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSession(id: string) {
    const session = await this.prisma.scanSession.findUnique({
      where: { id },
      include: { pages: { include: { objects: true } } },
    });
    if (!session) {
      throw new NotFoundException(`Scan session ${id} not found`);
    }
    return await this.withCommonObjectsSplitOut(session);
  }

  // Chrome (menu bars, toolbars, nav tabs, ...) is the exact same physical
  // control on every page of a scan — same recommendedLocator, same
  // confidenceScore, because it IS the same element, just captured again
  // from whichever page happened to be active at the time. Left in each
  // page's own object list, this drowns out what's actually specific to
  // that page (confirmed in practice: an 588-object SAP GUI scan across 5
  // pages was dominated by ~90 identical menu entries per page). Anything
  // whose locator appears on a strict majority of pages is chrome, not page
  // content — pulled out into one shared list instead of repeated per page.
  //
  // Majority, not "2 or more": the SAP GUI walker's base-screen capture and
  // its explicit re-walk of whichever tab was already active are redundant
  // (same content, two separate ScanPage rows) — confirmed in practice, a
  // field genuinely unique to just the Home tab still showed up on 2 of 5
  // pages purely from that duplication, which "2+" alone misclassified as
  // common. Requiring a true majority of pages tolerates that one redundant
  // pair without needing to fix the duplication itself.
  //
  // Also checks the application's whole scan history, not just this
  // session's own pages: a locator already established as common in an
  // earlier scan (e.g. a prior full crawl) should be recognized immediately
  // in a later, smaller scan too (even a single-page one, where "majority
  // of pages within this session" can never fire on its own) — common,
  // once established, stays common rather than needing to be re-proven
  // from scratch every time.
  private async withCommonObjectsSplitOut<
    T extends {
      applicationId: string;
      pages: Array<{ objects: Array<{ recommendedLocator: string; isPersistentChrome: boolean }> }>;
    },
  >(session: T): Promise<T & { commonObjects: T['pages'][number]['objects'] }> {
    // Gated on isPersistentChrome, not locator recurrence alone — confirmed
    // live: two different pages' search forms (Performance Review's search,
    // Leave List's filter) render the SAME reusable component and so share
    // a fallback CSS locator by coincidence of markup, not because they're
    // the same physical widget. Folding those together silently discarded
    // BOTH pages' entire real content. Only elements dom-walker.ts already
    // determined sit inside a genuine nav/header/menubar/banner landmark
    // are eligible to ever be folded into "common" here — a locator
    // recurring on a hundred content-area buttons across a hundred pages
    // still isn't chrome unless it's actually part of the persistent shell.
    const localeCount = new Map<string, number>();
    for (const page of session.pages) {
      const seenOnThisPage = new Set<string>();
      for (const obj of page.objects) {
        if (!obj.isPersistentChrome) continue;
        if (seenOnThisPage.has(obj.recommendedLocator)) continue; // a page could list the same locator twice; count each page once
        seenOnThisPage.add(obj.recommendedLocator);
        localeCount.set(obj.recommendedLocator, (localeCount.get(obj.recommendedLocator) ?? 0) + 1);
      }
    }

    const majorityThreshold = session.pages.length / 2;
    const commonLocators = new Set(
      [...localeCount.entries()].filter(([, count]) => count > majorityThreshold && count >= 2).map(([locator]) => locator),
    );

    // Cross-scan history: locators seen on 2+ distinct SCREENS (by page
    // title) across this application's whole scan history are established
    // chrome, regardless of what this one session alone looks like.
    //
    // Distinct screens, not distinct scan sessions: re-scanning the exact
    // same screen a second time produces a second scan session with
    // identical content — confirmed in practice, scanning the Password
    // History Report screen twice made its own genuinely page-specific
    // fields (the actual report content, not chrome) look "common" under a
    // distinct-session count, since both scans trivially counted as "2
    // sessions" for every locator on that one screen. Grouping by title
    // instead means the same screen scanned N times still only counts
    // once — only a locator that's actually shared ACROSS DIFFERENT screens
    // (a real menu bar, a real toolbar) reaches 2+.
    const historicalObjects = await this.prisma.scanObject.findMany({
      where: { scanPage: { scanSession: { applicationId: session.applicationId } }, isPersistentChrome: true },
      select: { recommendedLocator: true, scanPage: { select: { title: true } } },
    });
    const screensPerLocator = new Map<string, Set<string>>();
    for (const obj of historicalObjects) {
      const set = screensPerLocator.get(obj.recommendedLocator) ?? new Set<string>();
      set.add(obj.scanPage.title ?? '');
      screensPerLocator.set(obj.recommendedLocator, set);
    }
    for (const [locator, screenTitles] of screensPerLocator) {
      if (screenTitles.size >= 2) commonLocators.add(locator);
    }

    const commonObjects: T['pages'][number]['objects'] = [];
    const seenCommonLocators = new Set<string>();
    for (const page of session.pages) {
      for (const obj of page.objects) {
        if (commonLocators.has(obj.recommendedLocator) && !seenCommonLocators.has(obj.recommendedLocator)) {
          seenCommonLocators.add(obj.recommendedLocator);
          commonObjects.push(obj);
        }
      }
    }

    const pagesWithoutCommon = session.pages.map((page) => ({
      ...page,
      objects: page.objects.filter((obj) => !commonLocators.has(obj.recommendedLocator)),
    }));

    return { ...session, pages: pagesWithoutCommon, commonObjects };
  }

  async removeSession(id: string) {
    const session = await this.prisma.scanSession.findUnique({ where: { id }, select: { status: true } });
    if (!session) {
      throw new NotFoundException(`Scan session ${id} not found`);
    }
    if (session.status === 'RUNNING' || session.status === 'QUEUED') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This scan is still running.'],
        nextActions: ['Wait for it to finish (or time out) before deleting it.'],
      });
    }
    // Pages/objects cascade; any Object Library entries promoted from this
    // scan just lose their "promoted from" back-reference (SET NULL) — the
    // promoted objects themselves are untouched.
    await this.prisma.scanSession.delete({ where: { id } });
    return { success: true };
  }

  async startScan(applicationId: string, targetUrl: string, triggeredById?: string, credentials?: LoginCredentials) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }

    const session = await this.prisma.scanSession.create({
      data: { applicationId, targetUrl, triggeredById, status: 'QUEUED' },
    });

    // Fetched once per scan (not per page) — extractDrillTargets's own
    // denylist screening doesn't change mid-scan, so there's no reason to
    // re-query this for every one of what could be 150 pages.
    const unsafeWords = await this.prisma.scanUnsafeClickWord.findMany({
      where: { applicationId },
      select: { word: true },
    });
    const extraUnsafeWords = unsafeWords.map((w) => w.word);

    // Fire-and-forget: the caller gets the session id immediately and follows
    // progress over the /scan WebSocket namespace or by polling getSession().
    // credentials (if any) are per-scan only — never written onto this row,
    // held in memory for the duration of this one run (see attemptAutoLogin).
    this.runScan(session.id, targetUrl, credentials, extraUnsafeWords).catch((err) => {
      this.logger.error(`Scan ${session.id} crashed`, err);
    });

    return session;
  }

  // The per-application custom words layered onto extractDrillTargets' own
  // built-in safety denylist (see dom-walker.ts) — a human's way of
  // extending it for an app whose own dangerous-action vocabulary the
  // built-in guess can't know about, without needing a code change.
  async listUnsafeClickWords(applicationId: string) {
    return this.prisma.scanUnsafeClickWord.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addUnsafeClickWord(applicationId: string, word: string, createdById?: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }
    const normalized = word.trim();
    // Same-word-twice is a no-op, not an error — the schema's own unique
    // constraint would otherwise surface as a raw Prisma error to whoever's
    // adding a word that (perhaps from a previous session) is already there.
    return this.prisma.scanUnsafeClickWord.upsert({
      where: { applicationId_word: { applicationId, word: normalized } },
      create: { applicationId, word: normalized, createdById },
      update: {},
    });
  }

  async removeUnsafeClickWord(id: string) {
    await this.prisma.scanUnsafeClickWord.delete({ where: { id } }).catch(() => {
      throw new NotFoundException(`Unsafe-click word ${id} not found`);
    });
    return { success: true };
  }

  private emit(sessionId: string, status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED', message: string) {
    this.scanGateway.emitProgress({ sessionId, status, message });
  }

  // Same ScanSession/ScanPage/ScanObject tables and promote-to-library flow
  // as the web scanner — only the capture mechanism differs (SAP GUI
  // Scripting COM API via a PowerShell helper, not a Playwright DOM walk).
  // One "page" per scan: a live SAP session is one active screen at a time,
  // not a crawlable site.
  // Read-only — lets the caller pick a specific connection/session instead
  // of leaving startSapGuiScan to always grab the first one, the SAP GUI
  // equivalent of the web scanner's listOpenTabs().
  async listSapGuiSessions() {
    return listSapGuiSessions();
  }

  async startSapGuiScan(applicationId: string, triggeredById?: string, connectionIndex = 0, sessionIndex = 0) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }

    const session = await this.prisma.scanSession.create({
      data: { applicationId, targetUrl: 'sap-gui://active-session', triggeredById, status: 'QUEUED' },
    });

    this.runSapGuiScanSession(session.id, connectionIndex, sessionIndex).catch((err) => {
      this.logger.error(`SAP GUI scan ${session.id} crashed`, err);
    });

    return session;
  }

  private async runSapGuiScanSession(sessionId: string, connectionIndex = 0, sessionIndex = 0) {
    await this.prisma.scanSession.update({
      where: { id: sessionId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    this.emit(sessionId, 'RUNNING', 'Attaching to the active SAP GUI session…');

    try {
      const result = await runSapGuiScan(connectionIndex, sessionIndex);
      const { session: sapSession, screens } = result;
      const targetUrl = `sap-gui://${sapSession.systemName}/${sapSession.client}/${sapSession.transaction}`;
      const baseTitle = sapSession.screenTitle || sapSession.transaction || 'SAP GUI screen';

      let objectsFound = 0;
      for (const screen of screens) {
        const scanPage = await this.prisma.scanPage.create({
          data: {
            scanSessionId: sessionId,
            url: screen.context === 'base' ? targetUrl : `${targetUrl}#${screen.context}=${encodeURIComponent(screen.label)}`,
            title: screen.context === 'base' ? baseTitle : `${baseTitle} — ${screen.label}`,
          },
        });

        if (screen.objects.length > 0) {
          await this.prisma.scanObject.createMany({
            data: screen.objects.map((raw) => {
              const mapped = mapSapGuiObject(raw);
              return {
                scanPageId: scanPage.id,
                label: mapped.label,
                objectType: mapped.objectType,
                xpath: mapped.xpath,
                recommendedLocator: mapped.recommendedLocator,
                recommendedLocatorType: mapped.recommendedLocatorType,
                confidenceScore: mapped.confidenceScore,
              };
            }),
          });
        }
        objectsFound += screen.objects.length;
      }

      await this.prisma.scanSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          targetUrl,
          pagesScanned: screens.length,
          objectsFound,
        },
      });
      this.emit(
        sessionId,
        'COMPLETED',
        `Captured ${objectsFound} object(s) across ${screens.length} screen(s) from ${sapSession.transaction || 'the active session'} (${sapSession.systemName}).`,
      );
    } catch (err) {
      const message = (err as Error).message;
      await this.prisma.scanSession.update({
        where: { id: sessionId },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message },
      });
      this.emit(sessionId, 'FAILED', message);
    }
  }

  // Launches a dedicated, separate-profile Chrome/Edge with remote debugging
  // enabled, so there's a browser for listOpenTabs/startCurrentPageScan to
  // attach to. Before this, using "scan the current page" required the user
  // to close their browser and relaunch it from a terminal with the exact
  // right flags — a plain already-open window can't be attached to after the
  // fact, since Chrome/Edge only expose the DevTools Protocol when started
  // with --remote-debugging-port. A separate --user-data-dir (not the user's
  // normal profile) is what lets this coexist with their regular browser
  // already being open.
  async launchCaptureBrowser(port = 9222): Promise<{ cdpUrl: string }> {
    const cdpUrl = `http://127.0.0.1:${port}`;

    // Already running — e.g. launched by hand earlier, or a second click of
    // the same button. Nothing to do.
    if (await this.isCdpReachable(cdpUrl)) {
      return { cdpUrl };
    }

    const executable = this.findCaptureBrowserExecutable();
    const profileDir = path.join(os.tmpdir(), 'testpilot-chrome-profile');
    const child = spawn(
      executable,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      { detached: true, stdio: 'ignore' },
    );
    // Must outlive this request (and survive a backend restart) — it's the
    // user's own working browser window, not a throwaway subprocess.
    child.unref();

    // Spawning the process and the DevTools Protocol actually accepting
    // connections aren't the same instant — poll briefly rather than
    // reporting success before listOpenTabs could actually reach it.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (await this.isCdpReachable(cdpUrl)) {
        return { cdpUrl };
      }
    }
    throw new Error(
      `Launched ${path.basename(executable)}, but it never became reachable at ${cdpUrl}. Try again, or launch it yourself with e.g. "chrome.exe --remote-debugging-port=${port}".`,
    );
  }

  private async isCdpReachable(cdpUrl: string): Promise<boolean> {
    try {
      const res = await fetch(`${cdpUrl}/json/version`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // Checks the handful of locations Chrome/Edge actually install to on
  // Windows rather than relying on PATH — chrome.exe is deliberately not
  // added to PATH by its own installer.
  private findCaptureBrowserExecutable(): string {
    const programFiles = process.env['PROGRAMFILES'];
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];
    const localAppData = process.env['LOCALAPPDATA'];
    const candidates = [
      programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      programFilesX86 &&
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      programFilesX86 &&
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter((candidate): candidate is string => !!candidate);

    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new NotFoundException(
        'Could not find Chrome or Edge installed in the usual locations. Launch one yourself with e.g. ' +
          '"chrome.exe --remote-debugging-port=9222" instead.',
      );
    }
    return found;
  }

  // Attaches to the user's own already-running browser over the Chrome
  // DevTools Protocol and captures whatever page is currently focused there
  // — no URL, no navigation. This is the only way to reach app states that
  // are impractical (or unsafe) to reproduce by scripting a fresh headless
  // navigation: deep in a login-gated multi-step business process, a page
  // reached via SSO, a specific record already pulled up, etc. The browser
  // must have been launched with --remote-debugging-port=<port> (Chrome/Edge
  // only expose the DevTools Protocol when started that way); a plain,
  // already-open window with no such flag simply isn't reachable, so this
  // fails fast with an actionable message rather than hanging.
  // Read-only, throwaway peek at the connected browser's open tabs — lets
  // the user pick exactly which one to capture instead of trusting a
  // heuristic to guess it (a same-window "which tab is focused" check is
  // fundamentally unreliable here, since focusing this app's own UI tab to
  // click a button necessarily happens in the SAME OS focus context as
  // whatever tab actually needs capturing). Index-based, not title/URL-based:
  // the whole point of this feature is capturing a page reached mid-flow
  // (e.g. after submitting a form), so its URL/title may well change between
  // listing tabs and triggering the scan — the tab's position doesn't.
  async listOpenTabs(cdpUrl?: string) {
    const url = cdpUrl || 'http://127.0.0.1:9222';
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(url, { timeout: 15_000 });
    } catch (err) {
      throw new NotFoundException(
        `Couldn't reach a browser at ${url}. Launch it with e.g. "chrome.exe --remote-debugging-port=9222" first. (${(err as Error).message})`,
      );
    }
    // Never browser.close() — see runCurrentPageScan for why.
    const pages = browser.contexts().flatMap((c) => c.pages());
    return Promise.all(
      pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title().catch(() => ''),
      })),
    );
  }

  async startCurrentPageScan(applicationId: string, cdpUrl?: string, pageIndex?: number, triggeredById?: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }

    const session = await this.prisma.scanSession.create({
      data: { applicationId, targetUrl: 'browser://current-page', triggeredById, status: 'QUEUED' },
    });

    this.runCurrentPageScan(session.id, cdpUrl || 'http://127.0.0.1:9222', pageIndex).catch((err) => {
      this.logger.error(`Current-page scan ${session.id} crashed`, err);
    });

    return session;
  }

  private async runCurrentPageScan(sessionId: string, cdpUrl: string, pageIndex?: number) {
    await this.prisma.scanSession.update({
      where: { id: sessionId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    this.emit(sessionId, 'RUNNING', `Connecting to your browser at ${cdpUrl}…`);

    const sessionDir = path.join(STORAGE_ROOT, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(cdpUrl, { timeout: 15_000 });
    } catch (err) {
      const message =
        `Couldn't reach a browser at ${cdpUrl}. Chrome/Edge only expose remote debugging when launched with it enabled — ` +
        `close all windows and relaunch with, e.g., "chrome.exe --remote-debugging-port=9222", then try again. ` +
        `(${(err as Error).message})`;
      await this.prisma.scanSession.update({
        where: { id: sessionId },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message },
      });
      this.emit(sessionId, 'FAILED', message);
      return;
    }

    // Deliberately never call browser.close() below: unlike the headless
    // browser this class launches itself elsewhere, this Browser object is
    // the user's own real, already-running browser (with all their other
    // tabs and login sessions) — closing it over CDP quits the whole
    // application, not just this connection. Just let the reference drop.
    try {
      const page =
        pageIndex != null
          ? (browser.contexts().flatMap((c) => c.pages()))[pageIndex]
          : await this.findFocusedPage(browser);
      if (!page) {
        throw new Error(
          pageIndex != null ? `Tab #${pageIndex + 1} isn't open anymore — list the tabs again and try once more.` : 'No open page found in that browser.',
        );
      }

      this.emit(sessionId, 'RUNNING', `Capturing ${page.url()}…`);
      const objectCount = await this.withTimeout(this.saveScanPage(sessionId, sessionDir, page), 30_000, 'Capturing the page');

      await this.prisma.scanSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', finishedAt: new Date(), targetUrl: page.url(), pagesScanned: 1, objectsFound: objectCount },
      });
      this.emit(sessionId, 'COMPLETED', `Captured ${objectCount} object(s) from ${page.url()}.`);
    } catch (err) {
      const message = (err as Error).message;
      await this.prisma.scanSession.update({
        where: { id: sessionId },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message },
      });
      this.emit(sessionId, 'FAILED', message);
    }
  }

  // The DevTools Protocol exposes every open tab across every window, with
  // no direct "which one is the user actually looking at" flag — but a
  // background tab's document reliably reports visibilityState 'hidden'
  // while the one truly in the foreground reports 'visible', so probing
  // each page for that is the correct way to find it. Falls back to the
  // most recently opened page if, for whatever reason, none reports visible
  // (e.g. the browser's own window itself isn't focused at all right now).
  private async findFocusedPage(browser: Browser): Promise<Page | null> {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (const page of pages) {
      const state = await page.evaluate(() => document.visibilityState).catch(() => null);
      if (state === 'visible') return page;
    }
    return pages.at(-1) ?? null;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} took too long (over ${Math.round(ms / 1000)}s).`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Keeps the hash: hash-routed SPA "pages" (e.g. #/dashboard vs #/settings)
   * share a path but are genuinely distinct pages, and must not collapse into
   * a single visited entry.
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  // Collapses a record-detail URL down to its template so the crawl loop
  // can recognize "this is just another one of those" instead of treating
  // every /empNumber/{N} as a brand-new page shape. Numeric path segments
  // become {id}; the query string and hash are dropped entirely (a
  // record's shape doesn't change based on which tab query param it was
  // opened with) — deliberately coarser than normalizeUrl, which exists to
  // do the opposite (keep genuinely distinct pages distinct).
  private urlPattern(url: string): string {
    try {
      const parsed = new URL(url);
      const pattern = parsed.pathname
        .split('/')
        .map((segment) => (/^\d+$/.test(segment) ? '{id}' : segment))
        .join('/');
      return `${parsed.origin}${pattern}`;
    } catch {
      return url;
    }
  }

  // Used only to detect whether a click actually navigated somewhere new
  // (a different pathname) versus just swapping content in place on the
  // same URL — see the landed-URL dedup check in crawl(). Deliberately
  // ignores query/hash, unlike normalizeUrl: a hash-routed dashboard tab
  // changing only its hash still counts as "same pathname" here, which is
  // the point — that case is a content swap, not a new record.
  private safePathname(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  // page.goto() throws "Navigation to X is interrupted by another
  // navigation to Y" when the browser itself starts navigating away
  // (a server or client-side redirect already in flight) before Playwright
  // can settle on the URL we explicitly asked for. Confirmed live against
  // a real, ordinary site (OrangeHRM's public demo): visiting its login
  // page while a just-established session is already valid triggers
  // exactly this — an extremely common pattern ("redirect away from login
  // if already authenticated"), not an edge case. Treating it as a hard
  // per-page failure meant the ENTIRE scan failed at 0 pages/0 objects
  // rather than just following wherever the browser actually landed. Y (an
  // interruption's destination) is a real navigation Playwright already
  // knows is happening — this just gives it a moment to finish instead of
  // giving up the instant X gets pre-empted.
  private async gotoResilient(page: Page, url: string, timeoutMs: number): Promise<void> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (err) {
      if (/interrupted by another navigation/i.test((err as Error).message)) {
        await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
        return;
      }
      throw err;
    }
  }

  private isSameOrigin(url: string, originUrl: string): boolean {
    try {
      return new URL(url).origin === new URL(originUrl).origin;
    } catch {
      return false;
    }
  }

  private isUnsafeLink(url: string): boolean {
    const lower = url.toLowerCase();
    return UNSAFE_LINK_KEYWORDS.some((keyword) => lower.includes(keyword));
  }

  // Tab-revealed views share the real URL, so a synthetic suffix is the only
  // way to tell them apart in the page list / stored records. Shared with
  // crawl()'s own exact-duplicate guard below — that guard only means
  // anything if it computes the identical string saveScanPage is about to
  // write, not an approximation of it.
  private storedPageUrl(page: Page, tabLabel?: string): string {
    return tabLabel ? `${page.url()}#tab=${encodeURIComponent(tabLabel)}` : page.url();
  }

  private async saveScanPage(sessionId: string, sessionDir: string, page: Page, tabLabel?: string) {
    const baseTitle = await page.title();
    const title = tabLabel ? `${baseTitle} — ${tabLabel}` : baseTitle;
    const url = this.storedPageUrl(page, tabLabel);
    const pageId = randomUUID();
    const screenshotPath = path.join(sessionDir, `${pageId}.png`);
    const htmlPath = path.join(sessionDir, `${pageId}.html`);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf-8');

    let rawObjects = await page.evaluate(walkPageForObjects, undefined);
    // Genuine "the page hadn't rendered yet" cases are real but rare —
    // worth one bounded, adaptive retry before accepting zero as final
    // (some real pages, like a pure redirect or splash screen, legitimately
    // have nothing to capture). This is NOT what was behind the specific,
    // repeatable set of pages that used to show 0 objects on every real
    // scan (Buzz, Leave List, Performance Review search, several PIM detail
    // tabs) — that turned out to be a downstream bug in how "common"
    // objects get folded out in getSession()/withCommonObjectsSplitOut,
    // fixed separately (see isPersistentChrome). walkPageForObjects itself
    // was confirmed, live, to always find these pages' real content
    // correctly on the first attempt.
    const MAX_OBJECT_CAPTURE_ATTEMPTS = 3;
    for (let attempt = 2; rawObjects.length === 0 && attempt <= MAX_OBJECT_CAPTURE_ATTEMPTS; attempt++) {
      await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
      await page.waitForTimeout(1_500 * (attempt - 1));
      rawObjects = await page.evaluate(walkPageForObjects, undefined);
    }

    const scanPage = await this.prisma.scanPage.create({
      data: {
        scanSessionId: sessionId,
        url,
        title,
        screenshotPath: `/scan-assets/${sessionId}/${pageId}.png`,
        htmlSnapshotPath: `/scan-assets/${sessionId}/${pageId}.html`,
      },
    });

    await this.prisma.scanObject.createMany({
      data: rawObjects.map((obj: RawScannedObject) => ({
        scanPageId: scanPage.id,
        label: obj.label,
        objectType: obj.objectType,
        xpath: obj.xpath,
        cssSelector: obj.cssSelector,
        idAttr: obj.idAttr,
        nameAttr: obj.nameAttr,
        placeholder: obj.placeholder,
        buttonText: obj.buttonText,
        ariaLabel: obj.ariaLabel,
        nearbyLabelText: obj.nearbyLabelText,
        recommendedLocator: obj.recommendedLocator,
        recommendedLocatorType: obj.recommendedLocatorType,
        backupLocators: obj.backupLocators ?? undefined,
        confidenceScore: obj.confidenceScore,
        isPersistentChrome: obj.isPersistentChrome,
      })),
    });

    return rawObjects.length;
  }

  private async runScan(
    sessionId: string,
    targetUrl: string,
    credentials?: LoginCredentials,
    extraUnsafeWords?: string[],
  ) {
    await this.prisma.scanSession.update({
      where: { id: sessionId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    this.emit(sessionId, 'RUNNING', 'Launching browser…');

    const sessionDir = path.join(STORAGE_ROOT, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // Headed on purpose: the user watches the scan run live, same as the
    // Web Recorder and script execution already do.
    const browser = await chromium.launch({ headless: false });
    // Force-closing the browser is what actually unblocks a hung crawl (see
    // SCAN_TIMEOUT_MS above) — whatever Playwright call is in flight rejects
    // once its browser is gone, which crawl()'s own try/catch treats as this
    // run being over rather than a real per-page failure.
    let timedOut = false;
    const watchdogTimer = setTimeout(() => {
      timedOut = true;
      browser.close().catch(() => undefined);
    }, SCAN_TIMEOUT_MS);

    try {
      await this.crawl(sessionId, targetUrl, sessionDir, browser, () => timedOut, credentials, extraUnsafeWords);
    } finally {
      clearTimeout(watchdogTimer);
      await browser.close().catch(() => undefined);
    }

    if (timedOut) {
      const message = `Scan exceeded the maximum allowed time (${Math.round(SCAN_TIMEOUT_MS / 60_000)} min) and was force-stopped.`;
      this.logger.error(`Scan ${sessionId} exceeded ${SCAN_TIMEOUT_MS}ms and was force-stopped by the watchdog.`);
      // Guarded on status still being RUNNING: crawl() may have already
      // written its own terminal status in the (rare) instant between the
      // watchdog firing and this check.
      await this.prisma.scanSession.updateMany({
        where: { id: sessionId, status: 'RUNNING' },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message },
      });
      this.emit(sessionId, 'FAILED', message);
    }
  }

  private async crawl(
    sessionId: string,
    targetUrl: string,
    sessionDir: string,
    browser: Browser,
    isTimedOut: () => boolean,
    credentials?: LoginCredentials,
    extraUnsafeWords?: string[],
  ) {
    const visited = new Set<string>();
    const queued = new Set<string>([this.normalizeUrl(targetUrl)]);
    const queue: CrawlQueueEntry[] = [{ url: targetUrl, depth: 0, source: 'seed' }];
    // Record-list apps (OrangeHRM's /pim/viewPersonalDetails/empNumber/7,
    // /8, /9, ... is the confirmed real case) generate a genuinely distinct
    // URL per record, so the visited/queued dedup above — which only
    // catches EXACT repeats — lets every one of them through as "new"
    // content. Each then gets its own full tab/tile/drillTarget discovery
    // pass, so N structurally-identical record pages costs N times the
    // per-page exploration budget for zero additional distinct UI found (a
    // real scan hit 93.5% duplicate pages this way: the same ~8 tabs
    // captured once per employee).
    //
    // Two separate sets, not one — confirmed live this actually matters:
    // queuedUrlPatterns marks a template the moment a plain <a href> link
    // is found, purely so a SECOND link matching the same template never
    // even gets queued (saves a real navigation on a known duplicate).
    // capturedUrlPatterns marks a template only once it's ACTUALLY been
    // captured, and is what every entry — link or click alike — is checked
    // against right before capturing. Collapsing these into one Set was
    // tried and broke immediately: a plain link pre-marks its own pattern
    // in queuedUrlPatterns at enqueue time, so by the time that SAME entry
    // is dequeued, a shared Set would make it look like its own pattern was
    // already "seen" and skip capturing itself, capturing nothing past the
    // very first page of the entire crawl.
    const queuedUrlPatterns = new Set<string>();
    const capturedUrlPatterns = new Set<string>();
    let pagesScanned = 0;
    let objectsFound = 0;

    try {
      // Internal/enterprise apps (SAP Fiori launchpads in particular) are
      // routinely served over HTTPS with a self-signed or internally-issued
      // certificate — without this, every request to one fails at the TLS
      // handshake before the scan ever sees a single element.
      const page = await browser.newPage({ ignoreHTTPSErrors: true });

      if (credentials) {
        this.emit(sessionId, 'RUNNING', 'Test login provided — attempting to sign in before scanning…');
        try {
          await this.gotoResilient(page, targetUrl, 60_000);
          await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
          await page.waitForSelector('input, button, a, select, textarea', { timeout: 10_000 }).catch(() => undefined);
          await page.waitForTimeout(500);

          const result = await attemptAutoLogin(page, credentials);
          if (result.message) this.emit(sessionId, 'RUNNING', result.message);
          if (result.succeeded) {
            // The rest of this crawl re-navigates to queue[0].url anyway —
            // pointing it at where login actually landed (not the original
            // pre-login URL) means the existing loop below needs no other
            // change to scan from an authenticated state.
            queue[0].url = page.url();
          }
        } catch (err) {
          this.logger.warn(`Auto-login attempt failed for scan ${sessionId}: ${(err as Error).message}`);
          this.emit(sessionId, 'RUNNING', "Couldn't complete the login attempt — continuing scan from the current page.");
        }
      }

      // The queue naturally emptying is the normal "done" signal (see the
      // while condition below) — but a large, mostly-templated app can keep
      // a queue technically non-empty for a long time without actually
      // surfacing anything new, if enough of what it finds turns out to be
      // more duplicate-shaped pages or pages with nothing on them. Rather
      // than let that grind all the way to MAX_PAGES_PER_SCAN or the
      // SCAN_TIMEOUT_MS wall clock, this tracks how many dequeues IN A ROW
      // contributed zero new objects and zero new queue entries — once that
      // streak is long enough, it's a real signal the scan has already
      // found everything it's going to, and stopping is the correct call,
      // not a compromise. The timeout stays only as the backstop for a
      // scan that's still genuinely making progress but is just slow.
      const NO_NEW_CONTENT_STOP_STREAK = 15;
      let noNewContentStreak = 0;
      let stoppedForDiminishingReturns = false;

      while (queue.length > 0 && pagesScanned < MAX_PAGES_PER_SCAN && !isTimedOut()) {
        const next = queue.shift()!;
        const baseKey = this.normalizeUrl(next.url);
        const visitKey = next.tabSelector ? `${baseKey}#tab:${next.tabSelector}` : baseKey;
        this.logger.debug(
          `[crawl-trace] dequeue source=${next.source ?? 'unknown'} url=${next.url} selector=${next.tabSelector ?? '-'} label=${next.tabLabel ?? '-'} depth=${next.depth} visitKey=${visitKey}`,
        );
        if (visited.has(visitKey)) {
          this.logger.debug(`[crawl-trace] SKIP (already visited) visitKey=${visitKey}`);
          continue;
        }
        visited.add(visitKey);

        this.emit(
          sessionId,
          'RUNNING',
          `Scanning page ${pagesScanned + 1}: ${next.url}${next.tabLabel ? ` (${next.tabLabel})` : ''}`,
        );
        try {
          // domcontentloaded, not networkidle: many real pages (analytics
          // beacons, third-party widgets, polling) never go fully network-idle,
          // and some sub-resource domains may be unreachable from this host
          // without ever failing fast — networkidle would then block for the
          // full timeout. 60s (not 30s): this network occasionally has real
          // navigations land right at 30s, which read as failures too often.
          await this.gotoResilient(page, next.url, 60_000);
          await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
          // Many target apps are client-rendered SPAs (React/Vue/Angular) — the
          // DOM at 'load' can still be an empty shell. Wait for at least one
          // interactive element before capturing/walking the page.
          await page.waitForSelector('input, button, a, select, textarea', { timeout: 10_000 }).catch(() => undefined);
          // 900ms, not the original 500ms — a dashboard whose cards load from
          // an API after first paint (confirmed missed content on a real
          // multi-tab dashboard) needs more room than a static page does.
          await page.waitForTimeout(900);
          // Bounded, best-effort, on top of (not instead of) the waits
          // above — the domcontentloaded comment above is still correct
          // that some pages never truly go idle (polling, beacons), which
          // is exactly why this is capped short and swallows its own
          // timeout rather than being the page's main wait strategy. Where
          // it DOES settle before the cap, it's a real signal the page's
          // own async content (the OData calls a heavy dashboard's cards
          // load after first paint) has actually finished, which the fixed
          // 900ms above can't tell one way or the other.
          await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);

          const pathnameBeforeClick = this.safePathname(page.url());
          // Only meaningful (and only worth the extra evaluate() round-trip)
          // for a click — a plain navigation to next.url has nothing to
          // compare against. innerText LENGTH, not the full string: cheap
          // to compute and compare even on a heavy page, and "did anything
          // at all change" doesn't need character-exact precision — a
          // coincidental length match on two genuinely different tabs would
          // need them to render literally the same amount of text, which
          // real UI content essentially never does by accident.
          const textLengthBeforeClick = next.tabSelector
            ? await page.evaluate(() => document.body.innerText.length).catch(() => -1)
            : -1;

          if (next.tabSelector) {
            await page.click(next.tabSelector, { timeout: 5_000 }).catch(() => undefined);
            // Tab content swaps are a client-side render, not a navigation —
            // give the framework a moment to finish before capturing. 1200ms,
            // not the original 800ms, for the same lazy-content reason above.
            await page.waitForTimeout(1200);
            // A Fiori tile click (see extractTiles below) is real navigation
            // into a whole different sub-app, not a same-page swap like a
            // tab — it can genuinely need to lazy-load a component bundle
            // and its first OData call (confirmed live elsewhere tonight on
            // this same class of app). Bounded, not the step's full budget:
            // some dashboards poll continuously and would never go idle.
            await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
          }

          // The seenUrlPatterns check on freshly-discovered <a href> links
          // (below, in the link-following section) only ever sees a
          // destination that was already sitting in the page's markup as a
          // real href, checked at ENQUEUE time — it has no way to catch a
          // record opened via a click handler instead (confirmed live:
          // OrangeHRM's employee list rows are a "View Details"-style
          // drillTarget, not a plain link, so that pre-emptive check never
          // saw empNumber/8, /9, ... at all). This catches that case after
          // the fact instead: once the click has actually landed, compare
          // where it went.
          //
          // It also turned out to matter for PLAIN links too, just not for
          // the reason above: OrangeHRM's own per-record tab menu is real
          // <a href> markup that ALSO carries role="tab" — so the exact same
          // element gets discovered independently by extractPageLinks (keyed
          // by destination URL, deduped pre-emptively) and by extractTabs
          // (keyed by origin-page + CSS selector, which has no way to know
          // the two paths lead to the same place). Confirmed live: an
          // employee's own page got captured 4 times — twice as a plain
          // link, twice more as a "tab" — because only the click-based path
          // was ever cross-checked against a "was this template already
          // captured" Set at all. Applying this check unconditionally after
          // every navigation (not just clicks) closes that gap for both
          // directions, since a plain goto() has no "was this just a
          // same-page swap" ambiguity to protect against in the first place
          // — that concern is real ONLY for a click, which is why it's
          // still gated on the pathname actually changing whenever a click
          // was involved. A same-path tab swap (typical of a Fiori-style
          // dashboard, where the tab is a client-side render, not a
          // navigation) must never be treated as "a duplicate record," or a
          // real dashboard's own distinct tabs would collapse into "already
          // seen" after the first one and never get explored.
          const pathnameAfterClick = this.safePathname(page.url());
          const textLengthAfterClick = next.tabSelector
            ? await page.evaluate(() => document.body.innerText.length).catch(() => -2)
            : -1;
          // Confirmed live via the [crawl-trace] debug logging added
          // specifically to chase this down: a record's own detail page
          // offers itself as one of its OWN tab/drillTarget candidates —
          // the currently-active tab, pointing right back at the page it's
          // already on. Clicking it is a genuine no-op: the URL never
          // changes, so the pathname-based check below (correctly) treats
          // it as "not a navigation" and skips pattern-checking to avoid
          // wrongly blocking a real Fiori-style same-URL tab swap. But a
          // real tab swap ALSO changes what's on screen even though the URL
          // doesn't; a no-op click changes nothing at all. Comparing the
          // rendered content before and after the click is what actually
          // tells those two cases apart — pathname alone can't.
          const clickWasNoOp = !!next.tabSelector && pathnameAfterClick === pathnameBeforeClick && textLengthAfterClick === textLengthBeforeClick;
          this.logger.debug(
            `[crawl-trace] post-nav source=${next.source ?? 'unknown'} pathnameBefore=${pathnameBeforeClick} pathnameAfter=${pathnameAfterClick} textLenBefore=${textLengthBeforeClick} textLenAfter=${textLengthAfterClick} clickWasNoOp=${clickWasNoOp} landedUrl=${page.url()}`,
          );
          if (clickWasNoOp) {
            this.logger.debug(
              `[crawl-trace] SKIP (click was a no-op — nothing rendered changed) source=${next.source ?? 'unknown'} selector=${next.tabSelector} label=${next.tabLabel ?? '-'}`,
            );
            this.emit(
              sessionId,
              'RUNNING',
              `Skipping ${next.url}${next.tabLabel ? ` (${next.tabLabel})` : ''} — this control didn't change the page (already on this view).`,
            );
            noNewContentStreak += 1;
            if (noNewContentStreak >= NO_NEW_CONTENT_STOP_STREAK) {
              stoppedForDiminishingReturns = true;
              break;
            }
            continue;
          }
          const landedSomewhereCheckable = !next.tabSelector || pathnameAfterClick !== pathnameBeforeClick;
          let landedPattern: string | null = null;
          if (landedSomewhereCheckable) {
            landedPattern = this.urlPattern(page.url());
            if (capturedUrlPatterns.has(landedPattern)) {
              this.logger.debug(
                `[crawl-trace] SKIP (pattern already captured) source=${next.source ?? 'unknown'} pattern=${landedPattern} landedUrl=${page.url()} selector=${next.tabSelector ?? '-'} label=${next.tabLabel ?? '-'}`,
              );
              this.emit(
                sessionId,
                'RUNNING',
                `Skipping ${next.url}${next.tabLabel ? ` (${next.tabLabel})` : ''} — already captured a sample of this page shape.`,
              );
              noNewContentStreak += 1;
              if (noNewContentStreak >= NO_NEW_CONTENT_STOP_STREAK) {
                stoppedForDiminishingReturns = true;
                break;
              }
              continue;
            }
            this.logger.debug(`[crawl-trace] CAPTURING (first sample of pattern) source=${next.source ?? 'unknown'} pattern=${landedPattern} landedUrl=${page.url()}`);
          }

          const objectCount = await this.saveScanPage(sessionId, sessionDir, page, next.tabLabel);
          this.logger.debug(`[crawl-trace] captured objectCount=${objectCount} url=${page.url()} label=${next.tabLabel ?? '-'}`);
          // Marked as "captured" only NOW, and only on a real, non-empty
          // result — confirmed live this actually matters: the exact same
          // page (an employee's Personal/Contact/Emergency/... detail
          // views) is discoverable via BOTH a plain link AND a tab/
          // drillTarget click (see the two-Set dedup comment above), and
          // whichever path happened to be processed FIRST was sometimes the
          // less reliable one — marking the pattern "done" the instant that
          // first, empty attempt landed permanently threw away every LATER
          // attempt's chance to actually capture real content, even though
          // a different path to the exact same page would have worked fine.
          // Marking on success only means a flaky/empty first attempt no
          // longer poisons the well for every subsequent arrival at the
          // same template — the real duplicate-suppression this exists for
          // (a SECOND employee's fully-successful record) still works
          // exactly as before, since that first record's capture usually
          // does succeed.
          if (landedPattern && objectCount > 0) {
            capturedUrlPatterns.add(landedPattern);
          }
          objectsFound += objectCount;
          pagesScanned += 1;
          await this.prisma.scanSession.update({ where: { id: sessionId }, data: { pagesScanned, objectsFound } });
          const queueLengthBeforeDiscovery = queue.length;

          // Previously this only ran for a page's own base state (never for
          // a tab-reached view), on the theory that it kept the crawl
          // bounded — in practice, that meant any cards/sub-page links
          // revealed only after clicking a tab were never found at all
          // (confirmed on a real 7-tab dashboard). Depth already bounds this
          // the same way it bounds ordinary link-following, so there's
          // nothing tab-specific left to guard against here.
          if (next.depth < MAX_CRAWL_DEPTH) {
            const links = await page.evaluate(extractPageLinks);
            for (const link of links) {
              if (!this.isSameOrigin(link, targetUrl)) continue;
              if (this.isUnsafeLink(link)) continue;
              const normalizedLink = this.normalizeUrl(link);
              if (visited.has(normalizedLink) || queued.has(normalizedLink)) continue;
              if (queued.size >= MAX_PAGES_PER_SCAN) continue;
              const pattern = this.urlPattern(link);
              // Checks both: queuedUrlPatterns catches "another link to this
              // same template is already waiting in the queue" (no need to
              // queue a second one); capturedUrlPatterns catches "this
              // template was already fully captured via some OTHER path (a
              // tab/tile/drillTarget click reached it first)" — without the
              // second check, a link to an already-captured template would
              // still get queued and, later, correctly skipped at capture
              // time anyway, just after wasting a real navigation getting
              // there.
              if (queuedUrlPatterns.has(pattern) || capturedUrlPatterns.has(pattern)) {
                this.logger.debug(`[crawl-trace] SKIP enqueue (link pattern already queued/captured) pattern=${pattern} url=${link}`);
                continue;
              }
              queuedUrlPatterns.add(pattern);
              queued.add(normalizedLink);
              queue.push({ url: link, depth: next.depth + 1, source: 'link' });
              this.logger.debug(`[crawl-trace] queue += source=link url=${link} pattern=${pattern}`);
            }

            // Use the page's REAL current location, not next.url — for any
            // entry that itself involved a click this iteration (tabSelector
            // was set), next.url is the PRE-click starting point, while the
            // tab/tile/drillTarget candidates just discovered live on
            // wherever that click actually landed. Queueing next.url here
            // was confirmed live to silently break every second-hop
            // exploration: re-navigating to the pre-click page and clicking
            // a selector that only exists on the post-click page either
            // hits nothing (swallowed by the click's own .catch) or — worse
            // — hits an unrelated element that happens to match the same
            // selector shape elsewhere, landing back on the same single
            // destination every time regardless of which candidate was
            // meant to be explored. This one-line base-URL fix is what
            // actually makes multi-hop apps (a list → a record → that
            // record's own sub-tabs) explorable at all; it isn't specific
            // to any one app's markup.
            // The dedup KEY needs the same fix as the queued URL above — a
            // key built from the stale pre-click next.url would let two
            // tabs discovered on two genuinely different real pages (that
            // happen to share a next.url from before their respective
            // clicks) collide in visited/queued as if they were the same
            // candidate, or conversely fail to recognize a real repeat.
            // currentKey always reflects wherever the candidates were
            // actually found.
            const currentUrl = page.url();
            const currentKey = this.normalizeUrl(currentUrl);
            const tabs = await page.evaluate(extractTabs);
            for (const tab of tabs) {
              const tabKey = `${currentKey}#tab:${tab.selector}`;
              if (visited.has(tabKey) || queued.has(tabKey)) {
                this.logger.debug(`[crawl-trace] SKIP enqueue (tabKey already visited/queued) tabKey=${tabKey}`);
                continue;
              }
              if (queued.size >= MAX_PAGES_PER_SCAN) continue;
              queued.add(tabKey);
              queue.push({ url: currentUrl, depth: next.depth + 1, tabSelector: tab.selector, tabLabel: tab.label, source: 'tab' });
              this.logger.debug(`[crawl-trace] queue += source=tab origin=${currentUrl} selector=${tab.selector} label=${tab.label}`);
            }

            // Fiori launchpad tiles (see extractTiles) reuse the exact same
            // tabSelector mechanism as a deliberate design choice, not a
            // shortcut: each queue entry independently re-navigates to
            // currentUrl (wherever it was actually found) before clicking
            // its own selector, so exploring tile A's whole sub-app and then
            // coming back to click tile B starts from a clean reload every
            // time — never a click chained onto wherever tile A's
            // exploration left the page. Same "#tab:" key prefix as above
            // (not "#tile:") on purpose — the visited-set key computed when
            // an entry is dequeued has no way to know which extractor found
            // it, so a mismatched prefix here would never actually be
            // recognized as already-visited.
            const tiles = await page.evaluate(extractTiles);
            for (const tile of tiles) {
              const tileKey = `${currentKey}#tab:${tile.selector}`;
              if (visited.has(tileKey) || queued.has(tileKey)) {
                this.logger.debug(`[crawl-trace] SKIP enqueue (tileKey already visited/queued) tileKey=${tileKey}`);
                continue;
              }
              if (queued.size >= MAX_PAGES_PER_SCAN) continue;
              queued.add(tileKey);
              queue.push({ url: currentUrl, depth: next.depth + 1, tabSelector: tile.selector, tabLabel: tile.label, source: 'tile' });
              this.logger.debug(`[crawl-trace] queue += source=tile origin=${currentUrl} selector=${tile.selector} label=${tile.label}`);
            }

            // Broader still — a "view details" button, a card that opens a
            // sub-page, anything that isn't already a tab or a Fiori tile.
            // Unlike those two, this has no framework-level guarantee of
            // being read-only, which is exactly why extractDrillTargets
            // itself screens by both label (delete/save/submit/finish/
            // yes/confirm/... and friends) and structure (real form-submit
            // buttons) before returning anything at all — this loop just
            // trusts that gate the same way it trusts role="tab"'s own
            // ARIA guarantee above. Same "#tab:" key/mechanism reuse as
            // tiles, same reasoning: reload-then-click-once per candidate,
            // so exploring one drill target always starts from a clean
            // reload of currentUrl, never chained onto a previous one.
            const drillTargets = await page.evaluate(extractDrillTargets, { extraUnsafeWords });
            for (const target of drillTargets) {
              const targetKey = `${currentKey}#tab:${target.selector}`;
              if (visited.has(targetKey) || queued.has(targetKey)) {
                this.logger.debug(`[crawl-trace] SKIP enqueue (drillTarget key already visited/queued) targetKey=${targetKey}`);
                continue;
              }
              if (queued.size >= MAX_PAGES_PER_SCAN) continue;
              queued.add(targetKey);
              queue.push({ url: currentUrl, depth: next.depth + 1, tabSelector: target.selector, tabLabel: target.label, source: 'drillTarget' });
              this.logger.debug(`[crawl-trace] queue += source=drillTarget origin=${currentUrl} selector=${target.selector} label=${target.label}`);
            }
          }

          const newlyQueuedThisPage = queue.length - queueLengthBeforeDiscovery;
          if (objectCount === 0 && newlyQueuedThisPage === 0) {
            noNewContentStreak += 1;
            if (noNewContentStreak >= NO_NEW_CONTENT_STOP_STREAK) {
              stoppedForDiminishingReturns = true;
              break;
            }
          } else {
            noNewContentStreak = 0;
          }
        } catch (pageErr) {
          const message = (pageErr as Error).message;
          this.logger.warn(`Skipped page ${next.url}: ${message}`);
          this.emit(sessionId, 'RUNNING', `Skipped ${next.url} (${message})`);
        }
      }

      // The watchdog in runScan() owns the terminal status once it fires —
      // don't race it with a COMPLETED/FAILED write of our own for a run
      // that's already been decided.
      if (isTimedOut()) return;

      // pagesScanned only increments after a page is actually captured — if
      // every queued page failed to load (network issue, target down, etc.),
      // that's a real failure and shouldn't look identical to a genuine
      // successful scan just because each per-page error was individually
      // caught and logged above.
      if (pagesScanned === 0) {
        const message = 'Every queued page failed to load — see logs for details.';
        await this.prisma.scanSession.update({
          where: { id: sessionId },
          data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message, pagesScanned, objectsFound },
        });
        this.emit(sessionId, 'FAILED', message);
        return;
      }

      await this.prisma.scanSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', finishedAt: new Date(), pagesScanned, objectsFound },
      });
      const completionMessage = stoppedForDiminishingReturns
        ? `Scanned ${pagesScanned} page(s), found ${objectsFound} object(s). Stopped early — the last ${NO_NEW_CONTENT_STOP_STREAK} pages found nothing new.`
        : `Scanned ${pagesScanned} page(s), found ${objectsFound} object(s).`;
      this.emit(sessionId, 'COMPLETED', completionMessage);
      this.checkForDuplicatePageAnomaly(sessionId, targetUrl).catch((err) => {
        this.logger.warn(`Runtime-anomaly check failed for scan ${sessionId}: ${(err as Error).message}`);
      });
    } catch (err) {
      // Expected: force-closing the browser makes whatever Playwright call
      // was in flight reject. That's the watchdog doing its job, not a real
      // scan failure — let it own the terminal status instead of double-
      // reporting FAILED with a confusing "browser has been closed" message.
      if (isTimedOut()) return;
      const message = (err as Error).message;
      await this.prisma.scanSession.update({
        where: { id: sessionId },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message, pagesScanned, objectsFound },
      });
      this.emit(sessionId, 'FAILED', message);
    }
  }

  // The first entry point into AiEngineeringService that's grounded in
  // TestPilot's own real runtime output rather than a human's report or a
  // static tsc/eslint finding — see reportRuntimeAnomaly's own comment for
  // why that gap mattered (confirmed live: the OrangeHRM duplicate-page bug
  // fixed earlier passed every compiler and lint check; nothing but
  // actually running a scan and looking at the result ever revealed it).
  // MIN_PAGES_FOR_ANOMALY_CHECK guards against a tiny scan (2-3 pages)
  // making one incidental repeat look like a 33%+ "anomaly" — duplication
  // this method cares about is a rate observed over a real sample, not a
  // fluke on a handful of pages.
  private async checkForDuplicatePageAnomaly(sessionId: string, targetUrl: string): Promise<void> {
    const MIN_PAGES_FOR_ANOMALY_CHECK = 10;
    const DUPLICATE_RATE_THRESHOLD = 0.15;

    const pages = await this.prisma.scanPage.findMany({ where: { scanSessionId: sessionId }, select: { url: true } });
    if (pages.length < MIN_PAGES_FOR_ANOMALY_CHECK) return;

    const distinctUrlCount = new Set(pages.map((p) => p.url)).size;
    const duplicateCount = pages.length - distinctUrlCount;
    const duplicateRate = duplicateCount / pages.length;
    if (duplicateRate <= DUPLICATE_RATE_THRESHOLD) return;

    const ratePct = Math.round(duplicateRate * 100);
    await this.aiEngineering.reportRuntimeAnomaly({
      title: `Scanner produced ${ratePct}% duplicate pages (scan ${sessionId})`,
      description:
        `A completed scan against ${targetUrl} (session ${sessionId}) captured ${pages.length} pages, but only ` +
        `${distinctUrlCount} of them have distinct URLs — ${duplicateCount} pages (${ratePct}%) are exact ` +
        `duplicates of a URL already captured earlier in the same scan.\n\n` +
        `This is a real, measured defect in the crawl logic in backend-v2/src/modules/scanner/scanner.service.ts ` +
        `(the crawl() method) or backend-v2/src/modules/scanner/dom-walker.ts, not a guess — a healthy scan should ` +
        `capture each real page/tab/record exactly once. Likely causes worth checking first, based on prior real ` +
        `incidents in this exact code path: a click-based navigation (a tab, tile, or drillTarget) landing on a ` +
        `URL that was already captured via a different discovery path; a record-detail page reached once per ` +
        `record instead of being recognized as the same template; or a control whose click doesn't actually ` +
        `change anything on the page (compare page content before/after the click, not just the URL, to tell a ` +
        `real same-URL tab swap apart from a no-op click on an already-active control).`,
      reproSteps: [
        `Start a scan against ${targetUrl}`,
        `Wait for it to complete, then list its ScanPage rows' url field`,
        `Observe: ${duplicateCount} of ${pages.length} rows share a url already seen earlier in the same list`,
      ],
      severity: duplicateRate > 0.5 ? 'HIGH' : 'MEDIUM',
      dedupeKey: 'runtime-anomaly:scanner-duplicate-pages',
    });
  }
}
