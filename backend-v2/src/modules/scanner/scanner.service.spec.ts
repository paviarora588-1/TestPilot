import { ScannerService } from './scanner.service';
import { extractDrillTargets, extractPageLinks, extractTabs, extractTiles, walkPageForObjects } from './dom-walker';

// Regression baseline for the web scan path, written before any SAP GUI
// changes land in this file — startScan/startSapGuiScan/startCurrentPageScan
// are three independent entry points sharing nothing but the ScanSession
// table; this asserts that independence explicitly so a future SAP-focused
// change that accidentally couples them gets caught here.
jest.mock('playwright', () => ({
  chromium: { launch: jest.fn().mockRejectedValue(new Error('not exercised in this test')), connectOverCDP: jest.fn() },
}));
jest.mock('./sap/sap-gui-scanner.util', () => ({
  runSapGuiScan: jest.fn().mockRejectedValue(new Error('not exercised in this test')),
  mapSapGuiObject: jest.fn(),
}));
// crawl()'s saveScanPage() writes the captured HTML snapshot via a real
// fs/promises.writeFile — mocked here so the crawl()-level integration
// tests below don't perform real disk I/O for a session directory that
// doesn't exist. Explicit resolved values (not jest.mock's bare auto-mock)
// so `await fs.writeFile(...)` resolves the same way it would for real.
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

function makePrismaMock() {
  const createdScanPages: Array<{ id: string; scanSessionId: string; url: string }> = [];
  return {
    application: { findUnique: jest.fn().mockResolvedValue({ id: 'app-1', name: 'Test App' }) },
    scanSession: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'scan-1', ...data })),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    },
    scanPage: {
      // findMany reflects whatever create() has actually recorded so far —
      // realistic for the anomaly-detector tests below, which need to see
      // the SAME rows the crawl itself just wrote, not an independent mock.
      create: jest.fn().mockImplementation(({ data }) => {
        const page = { id: `page-${Math.random()}`, ...data };
        createdScanPages.push(page);
        return Promise.resolve(page);
      }),
      findMany: jest.fn().mockImplementation(({ where }: { where: { scanSessionId: string } }) =>
        Promise.resolve(createdScanPages.filter((p) => p.scanSessionId === where.scanSessionId)),
      ),
    },
    scanObject: {
      createMany: jest.fn().mockResolvedValue(undefined),
    },
    // Fetched once per startScan call to layer per-application custom words
    // onto extractDrillTargets' own built-in safety denylist — empty by
    // default so existing tests (which don't care about this) still pass.
    scanUnsafeClickWord: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function makeAiEngineeringMock() {
  return { reportRuntimeAnomaly: jest.fn().mockResolvedValue(null) };
}

function makeGatewayMock() {
  return { emitProgress: jest.fn() };
}

describe('ScannerService — web/SAP entry-point isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('startScan creates a QUEUED session with the given URL as targetUrl', async () => {
    const prisma = makePrismaMock();
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    const session = await service.startScan('app-1', 'https://example.com/login');

    expect(session).toMatchObject({ applicationId: 'app-1', targetUrl: 'https://example.com/login', status: 'QUEUED' });
    expect(prisma.scanSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetUrl: 'https://example.com/login' }) }),
    );
  });

  it('startSapGuiScan creates a session with a fixed sap-gui:// targetUrl, independent of any URL argument', async () => {
    const prisma = makePrismaMock();
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    const session = await service.startSapGuiScan('app-1');

    expect(session).toMatchObject({ applicationId: 'app-1', targetUrl: 'sap-gui://active-session', status: 'QUEUED' });
  });

  it('startScan and startSapGuiScan are independent calls — invoking one does not touch the other\'s dependencies', async () => {
    const prisma = makePrismaMock();
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);
    const { runSapGuiScan } = jest.requireMock('./sap/sap-gui-scanner.util') as { runSapGuiScan: jest.Mock };
    const { chromium } = jest.requireMock('playwright') as { chromium: { launch: jest.Mock } };

    await service.startScan('app-1', 'https://example.com');
    // Fire-and-forget background work is not awaited by startScan itself, and
    // runScan does a real fs.mkdir before reaching chromium.launch — a single
    // microtask tick isn't enough to let that real I/O settle, so wait a
    // short real timeout instead.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(chromium.launch).toHaveBeenCalled();
    expect(runSapGuiScan).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when starting a scan for an application that does not exist', async () => {
    const prisma = makePrismaMock();
    prisma.application.findUnique.mockResolvedValue(null);
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    await expect(service.startScan('missing-app', 'https://example.com')).rejects.toThrow('Application missing-app not found');
    expect(prisma.scanSession.create).not.toHaveBeenCalled();
  });
});

describe('ScannerService — pure URL/link helpers (private, exercised via instance)', () => {
  function helpers() {
    const service = new ScannerService(makePrismaMock() as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);
    return service as unknown as {
      normalizeUrl(url: string): string;
      isSameOrigin(url: string, originUrl: string): boolean;
      isUnsafeLink(url: string): boolean;
      urlPattern(url: string): string;
      safePathname(url: string): string;
    };
  }

  it('normalizeUrl keeps hash-routed SPA paths distinct', () => {
    const h = helpers();
    expect(h.normalizeUrl('https://x.com/app#/dashboard')).not.toBe(h.normalizeUrl('https://x.com/app#/settings'));
  });

  it('normalizeUrl strips a trailing slash so equivalent URLs collapse', () => {
    const h = helpers();
    expect(h.normalizeUrl('https://x.com/app/')).toBe(h.normalizeUrl('https://x.com/app'));
  });

  it('normalizeUrl preserves distinct query strings', () => {
    const h = helpers();
    expect(h.normalizeUrl('https://x.com/app?id=1')).not.toBe(h.normalizeUrl('https://x.com/app?id=2'));
  });

  it('isSameOrigin is true for same origin, false across origins', () => {
    const h = helpers();
    expect(h.isSameOrigin('https://x.com/a', 'https://x.com/b')).toBe(true);
    expect(h.isSameOrigin('https://y.com/a', 'https://x.com/b')).toBe(false);
  });

  it('isUnsafeLink flags logout/delete-style links so the crawler never auto-follows them', () => {
    const h = helpers();
    expect(h.isUnsafeLink('https://x.com/logout')).toBe(true);
    expect(h.isUnsafeLink('https://x.com/users/5/delete')).toBe(true);
    expect(h.isUnsafeLink('https://x.com/dashboard')).toBe(false);
  });

  it('urlPattern collapses different numeric ids in the same path shape to one template', () => {
    // Confirmed live against OrangeHRM's public demo: 6 employee records,
    // each with its own /pim/viewPersonalDetails/empNumber/N URL, each
    // structurally identical — without this, the crawler queued and fully
    // re-explored (own tab/tile/drillTarget discovery pass and all) every
    // single one, for 93.5% duplicate pages captured on one real scan.
    const h = helpers();
    const a = h.urlPattern('https://x.com/pim/viewPersonalDetails/empNumber/7');
    const b = h.urlPattern('https://x.com/pim/viewPersonalDetails/empNumber/8');
    expect(a).toBe(b);
  });

  it('urlPattern keeps genuinely different paths distinct', () => {
    const h = helpers();
    expect(h.urlPattern('https://x.com/pim/viewPersonalDetails/empNumber/7')).not.toBe(
      h.urlPattern('https://x.com/admin/viewSystemUsers'),
    );
  });

  it('urlPattern drops query string and hash — a record\'s shape does not change by which tab it was opened on', () => {
    const h = helpers();
    const a = h.urlPattern('https://x.com/pim/viewPersonalDetails/empNumber/7?tab=personal');
    const b = h.urlPattern('https://x.com/pim/viewPersonalDetails/empNumber/9#/contact');
    expect(a).toBe(b);
  });

  it('urlPattern falls back to the raw string for an unparsable URL rather than throwing', () => {
    const h = helpers();
    expect(() => h.urlPattern('not-a-real-url')).not.toThrow();
  });

  it('safePathname returns just the pathname, ignoring query and hash', () => {
    const h = helpers();
    expect(h.safePathname('https://x.com/pim/viewPersonalDetails/empNumber/7?tab=personal#/x')).toBe(
      '/pim/viewPersonalDetails/empNumber/7',
    );
  });

  it('safePathname distinguishes a real navigation from a same-path hash-only change', () => {
    // This is exactly the gate crawl() uses to decide whether a tab click
    // was a genuine navigation (record-list-style apps) versus a same-page
    // client-render swap (Fiori-style dashboards) — a hash change alone
    // must never look like "a different page" here, or a real dashboard's
    // own distinct tabs would wrongly get treated as duplicate records.
    const h = helpers();
    expect(h.safePathname('https://x.com/app#/dashboard')).toBe(h.safePathname('https://x.com/app#/settings'));
    expect(h.safePathname('https://x.com/pim/viewPersonalDetails/empNumber/7')).not.toBe(
      h.safePathname('https://x.com/pim/contactDetails/empNumber/7'),
    );
  });

  it('safePathname falls back to the raw string for an unparsable URL rather than throwing', () => {
    const h = helpers();
    expect(() => h.safePathname('not-a-real-url')).not.toThrow();
  });
});

describe('ScannerService — gotoResilient (real-world redirect-during-goto handling)', () => {
  function serviceWithGoto() {
    const service = new ScannerService(makePrismaMock() as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);
    return service as unknown as {
      gotoResilient(page: { goto: jest.Mock; waitForLoadState: jest.Mock }, url: string, timeoutMs: number): Promise<void>;
    };
  }

  it('re-throws an ordinary navigation failure unchanged (e.g. a genuinely unreachable host)', async () => {
    const s = serviceWithGoto();
    const page = { goto: jest.fn().mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED')), waitForLoadState: jest.fn() };

    await expect(s.gotoResilient(page, 'https://nope.invalid', 1000)).rejects.toThrow('net::ERR_NAME_NOT_RESOLVED');
    expect(page.waitForLoadState).not.toHaveBeenCalled();
  });

  it('swallows a "interrupted by another navigation" error and waits for the real one to settle instead', async () => {
    // Confirmed live against OrangeHRM's public demo: visiting the login
    // page while a just-established session is already valid triggers
    // exactly this Playwright error — a real, common redirect pattern, not
    // a genuine failure to reach the page at all.
    const s = serviceWithGoto();
    const page = {
      goto: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'page.goto: Navigation to "https://x.com/auth/login" is interrupted by another navigation to "https://x.com/dashboard/index"',
          ),
        ),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
    };

    await expect(s.gotoResilient(page, 'https://x.com/auth/login', 5000)).resolves.toBeUndefined();
    expect(page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 5000 });
  });

  it('does not throw even if the fallback waitForLoadState itself times out', async () => {
    const s = serviceWithGoto();
    const page = {
      goto: jest.fn().mockRejectedValue(new Error('interrupted by another navigation to somewhere')),
      waitForLoadState: jest.fn().mockRejectedValue(new Error('Timeout 5000ms exceeded')),
    };

    await expect(s.gotoResilient(page, 'https://x.com/auth/login', 5000)).resolves.toBeUndefined();
  });
});

describe('ScannerService — per-application custom unsafe-click words', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('startScan fetches this application\'s custom words before firing the background crawl', async () => {
    const prisma = makePrismaMock();
    prisma.scanUnsafeClickWord.findMany.mockResolvedValue([{ word: 'quarantine' }, { word: 'blacklist' }]);
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    await service.startScan('app-1', 'https://example.com');

    expect(prisma.scanUnsafeClickWord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { applicationId: 'app-1' } }),
    );
  });

  it('listUnsafeClickWords returns this application\'s words, newest first', async () => {
    const prisma = makePrismaMock();
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    await service.listUnsafeClickWords('app-1');

    expect(prisma.scanUnsafeClickWord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { applicationId: 'app-1' }, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('addUnsafeClickWord trims the word and upserts rather than erroring on a duplicate', async () => {
    const prisma = makePrismaMock();
    (prisma.scanUnsafeClickWord as { upsert: jest.Mock }).upsert = jest
      .fn()
      .mockResolvedValue({ id: 'w-1', applicationId: 'app-1', word: 'quarantine' });
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    await service.addUnsafeClickWord('app-1', '  Quarantine  ', 'user-1');

    expect(prisma.scanUnsafeClickWord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationId_word: { applicationId: 'app-1', word: 'Quarantine' } },
        create: { applicationId: 'app-1', word: 'Quarantine', createdById: 'user-1' },
        update: {},
      }),
    );
  });

  it('addUnsafeClickWord throws NotFoundException for a missing application', async () => {
    const prisma = makePrismaMock();
    prisma.application.findUnique.mockResolvedValue(null);
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    await expect(service.addUnsafeClickWord('missing-app', 'quarantine')).rejects.toThrow(
      'Application missing-app not found',
    );
  });

  it('removeUnsafeClickWord deletes by id', async () => {
    const prisma = makePrismaMock();
    (prisma.scanUnsafeClickWord as { delete: jest.Mock }).delete = jest.fn().mockResolvedValue({ id: 'w-1' });
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    const result = await service.removeUnsafeClickWord('w-1');

    expect(prisma.scanUnsafeClickWord.delete).toHaveBeenCalledWith({ where: { id: 'w-1' } });
    expect(result).toEqual({ success: true });
  });

  it('removeUnsafeClickWord surfaces a missing id as NotFoundException, not a raw Prisma error', async () => {
    const prisma = makePrismaMock();
    (prisma.scanUnsafeClickWord as { delete: jest.Mock }).delete = jest
      .fn()
      .mockRejectedValue(new Error('Record to delete does not exist.'));
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    await expect(service.removeUnsafeClickWord('missing-id')).rejects.toThrow('Unsafe-click word missing-id not found');
  });
});

describe('ScannerService — crawl() record-template dedup (real-world OrangeHRM bug)', () => {
  // Models exactly the shape that broke live: a list page whose rows are
  // opened via a click handler (an extractDrillTargets candidate), not a
  // plain <a href> — so the pre-emptive link-pattern dedup never sees the
  // record URLs at all — and each record exposes its own further sub-tabs
  // only reachable by a SECOND click, from the record's own page, not the
  // list page. A fake Page whose click() looks up (currentUrl, selector) in
  // a fixed transition table, and whose evaluate() dispatches on the real
  // dom-walker function reference (identity, not a name string, since
  // that's genuinely how page.evaluate(fn) is called at every site in
  // scanner.service.ts) — no jsdom needed, this never touches a real DOM.
  const LIST_URL = 'https://x.test/employees';
  const RECORD1_URL = 'https://x.test/employees/record/1';
  const RECORD2_URL = 'https://x.test/employees/record/2';
  const RECORD1_TAB_URL = 'https://x.test/employees/record/1/contact';
  const RECORD2_TAB_URL = 'https://x.test/employees/record/2/contact';

  const TRANSITIONS: Record<string, string> = {
    [`${LIST_URL}|row1`]: RECORD1_URL,
    [`${LIST_URL}|row2`]: RECORD2_URL,
    [`${RECORD1_URL}|contactTab`]: RECORD1_TAB_URL,
    [`${RECORD2_URL}|contactTab`]: RECORD2_TAB_URL,
  };

  function makeFakePage() {
    let currentUrl = LIST_URL;
    return {
      url: jest.fn(() => currentUrl),
      goto: jest.fn((url: string) => {
        currentUrl = url;
        return Promise.resolve(null);
      }),
      click: jest.fn((selector: string) => {
        const dest = TRANSITIONS[`${currentUrl}|${selector}`];
        if (dest) currentUrl = dest;
        return Promise.resolve();
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html></html>'),
      title: jest.fn().mockResolvedValue('Employees'),
      evaluate: jest.fn((fn: unknown, arg?: unknown) => {
        if (fn === extractPageLinks) return Promise.resolve([]);
        if (fn === extractTiles) return Promise.resolve([]);
        if (fn === extractTabs) {
          if (currentUrl === RECORD1_URL || currentUrl === RECORD2_URL) {
            return Promise.resolve([{ selector: 'contactTab', label: 'Contact' }]);
          }
          return Promise.resolve([]);
        }
        if (fn === extractDrillTargets) {
          void arg;
          if (currentUrl === LIST_URL) {
            return Promise.resolve([
              { selector: 'row1', label: 'Employee 1' },
              { selector: 'row2', label: 'Employee 2' },
            ]);
          }
          return Promise.resolve([]);
        }
        if (fn === walkPageForObjects) {
          // Only the pages that SHOULD be captured (list, record 1, and
          // record 1's own tab) carry any objects — record 2 and its tab
          // are never supposed to be visited at all, so if the fix
          // regresses and they DO get captured, they'd show up with zero
          // objects, which the assertions below would still catch via the
          // URL list itself.
          if (currentUrl === RECORD1_URL || currentUrl === RECORD1_TAB_URL) {
            return Promise.resolve([
              {
                label: 'Name',
                objectType: 'TEXT',
                xpath: '/x',
                cssSelector: '.x',
                idAttr: null,
                nameAttr: null,
                placeholder: null,
                buttonText: null,
                ariaLabel: null,
                nearbyLabelText: null,
                recommendedLocator: '.x',
                recommendedLocatorType: 'CSS',
                backupLocators: null,
                confidenceScore: 0.9,
              },
            ]);
          }
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }),
    };
  }

  function makeFakeBrowser(page: ReturnType<typeof makeFakePage>) {
    return { newPage: jest.fn().mockResolvedValue(page) };
  }

  function crawlHelper(prisma: ReturnType<typeof makePrismaMock>) {
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);
    return service as unknown as {
      crawl(
        sessionId: string,
        targetUrl: string,
        sessionDir: string,
        browser: unknown,
        isTimedOut: () => boolean,
        credentials?: unknown,
        extraUnsafeWords?: string[],
      ): Promise<void>;
    };
  }

  it('explores one record fully but skips a second record matching the same URL template entirely', async () => {
    const prisma = makePrismaMock();
    const page = makeFakePage();
    const browser = makeFakeBrowser(page);
    const service = crawlHelper(prisma);

    await service.crawl('scan-1', LIST_URL, '/fake/session-dir', browser, () => false);

    const capturedUrls = (prisma.scanPage.create as jest.Mock).mock.calls.map((call) => call[0].data.url as string);

    // Record 1 is reached via a drillTarget click, so saveScanPage suffixes
    // its stored url with the candidate's own label (same mechanism a real
    // tab/tile uses) — the bare RECORD1_URL is never what gets stored.
    expect(capturedUrls.some((u) => u.startsWith(RECORD1_URL))).toBe(true);
    expect(capturedUrls).toContain(`${RECORD1_TAB_URL}#tab=Contact`);
    // The real bug: record 2 (same URL template as record 1) used to get
    // its own full sub-tab exploration too, purely because its base page
    // was reached via a click the pre-emptive link check never saw.
    expect(capturedUrls.some((u) => u.startsWith(RECORD2_URL))).toBe(false);
    expect(capturedUrls.some((u) => u.startsWith(RECORD2_TAB_URL))).toBe(false);
  });

  it('reaches a record\'s own sub-tab via the record\'s real URL, not the stale pre-click list URL', async () => {
    // The second, independent bug: even setting dedup aside, queueing
    // next.url (the page BEFORE a click) instead of the page's real
    // post-click location meant every second-hop click target — go back to
    // next.url, click a selector that only exists on the page one hop
    // further — was attempted against the wrong page entirely. Confirmed
    // here by asserting page.goto was actually called with RECORD1_URL
    // before contactTab could ever resolve to RECORD1_TAB_URL — the fake
    // click() above only performs that transition when currentUrl is
    // already RECORD1_URL, so reaching RECORD1_TAB_URL at all is only
    // possible if crawl() re-navigated to RECORD1_URL first, not LIST_URL.
    const prisma = makePrismaMock();
    const page = makeFakePage();
    const browser = makeFakeBrowser(page);
    const service = crawlHelper(prisma);

    await service.crawl('scan-1', LIST_URL, '/fake/session-dir', browser, () => false);

    const gotoUrls = (page.goto as jest.Mock).mock.calls.map((call) => call[0] as string);
    expect(gotoUrls).toContain(RECORD1_URL);
    const capturedUrls = (prisma.scanPage.create as jest.Mock).mock.calls.map((call) => call[0].data.url as string);
    expect(capturedUrls).toContain(`${RECORD1_TAB_URL}#tab=Contact`);
  });

});

describe('ScannerService — crawl() zero-object retry (slow-rendering page race)', () => {
  // Confirmed live against OrangeHRM's own performance-review search page: a
  // real scan captured a normal screenshot and HTML snapshot for it (proving
  // the page genuinely loaded) but walkPageForObjects still came back with
  // zero objects — reproduced as a timing race under the crawl's real
  // back-to-back screenshot/HTML-dump load, not a selector bug (the exact
  // same page, visited in isolation with the exact same selector, reliably
  // found every element). The fix retries once, after a short extra wait,
  // before accepting zero as final.
  const URL = 'https://x.test/slow-page';

  function makeFakePage(objectsOnSuccess: unknown[], succeedOnAttempt = 2) {
    let evaluateCallsForWalker = 0;
    return {
      url: jest.fn(() => URL),
      goto: jest.fn().mockResolvedValue(null),
      click: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html><body><button>Real content</button></body></html>'),
      title: jest.fn().mockResolvedValue('Slow Page'),
      evaluate: jest.fn((fn: unknown) => {
        if (fn === extractPageLinks || fn === extractTabs || fn === extractTiles || fn === extractDrillTargets) {
          return Promise.resolve([]);
        }
        if (fn === walkPageForObjects) {
          evaluateCallsForWalker += 1;
          // Every attempt before succeedOnAttempt comes back empty,
          // simulating the confirmed-live race under real system load;
          // only the target attempt sees the now-rendered content.
          return Promise.resolve(evaluateCallsForWalker >= succeedOnAttempt ? objectsOnSuccess : []);
        }
        return Promise.resolve([]);
      }),
    };
  }

  it('retries once and captures the object that only appears after the extra wait', async () => {
    const prisma = makePrismaMock();
    const realObject = {
      label: 'Submit',
      objectType: 'button',
      xpath: '/button',
      cssSelector: 'button',
      idAttr: null,
      nameAttr: null,
      placeholder: null,
      buttonText: 'Submit',
      ariaLabel: null,
      nearbyLabelText: null,
      recommendedLocator: 'button',
      recommendedLocatorType: 'CSS',
      backupLocators: null,
      confidenceScore: 0.7,
    };
    const page = makeFakePage([realObject]);
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never) as unknown as {
      crawl(sessionId: string, targetUrl: string, sessionDir: string, browser: unknown, isTimedOut: () => boolean): Promise<void>;
    };

    await service.crawl('scan-1', URL, '/fake/session-dir', browser, () => false);

    const createCalls = (prisma.scanObject.createMany as jest.Mock).mock.calls;
    expect(createCalls.length).toBe(1);
    expect(createCalls[0][0].data).toHaveLength(1);
    expect(createCalls[0][0].data[0].label).toBe('Submit');
  });

  it('reaches the final bounded attempt when even the first retry is still too early', async () => {
    // A single retry (the original fix) wasn't persistent enough to survive
    // a real scan's own system load — this is what motivated widening it to
    // MAX_OBJECT_CAPTURE_ATTEMPTS. Confirms the loop actually reaches the
    // 3rd attempt when the page needs it, not just the 2nd.
    const prisma = makePrismaMock();
    const realObject = {
      label: 'Late Button',
      objectType: 'button',
      xpath: '/button',
      cssSelector: 'button',
      idAttr: null,
      nameAttr: null,
      placeholder: null,
      buttonText: 'Late Button',
      ariaLabel: null,
      nearbyLabelText: null,
      recommendedLocator: 'button',
      recommendedLocatorType: 'CSS',
      backupLocators: null,
      confidenceScore: 0.7,
    };
    const page = makeFakePage([realObject], 3);
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never) as unknown as {
      crawl(sessionId: string, targetUrl: string, sessionDir: string, browser: unknown, isTimedOut: () => boolean): Promise<void>;
    };

    await service.crawl('scan-1', URL, '/fake/session-dir', browser, () => false);

    const walkerCalls = (page.evaluate as jest.Mock).mock.calls.filter((call) => call[0] === walkPageForObjects);
    expect(walkerCalls.length).toBe(3);
    const createCalls = (prisma.scanObject.createMany as jest.Mock).mock.calls;
    expect(createCalls[0][0].data[0].label).toBe('Late Button');
  });

  it('accepts a genuinely empty page after the retry also comes back empty, without retrying forever', async () => {
    const prisma = makePrismaMock();
    const page = makeFakePage([]); // retry ALSO returns empty — a real splash/redirect page
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never) as unknown as {
      crawl(sessionId: string, targetUrl: string, sessionDir: string, browser: unknown, isTimedOut: () => boolean): Promise<void>;
    };

    await service.crawl('scan-1', URL, '/fake/session-dir', browser, () => false);

    // Exactly 3 evaluate() calls for walkPageForObjects (the first attempt
    // plus 2 retries, per MAX_OBJECT_CAPTURE_ATTEMPTS) — bounded, not an
    // unbounded retry loop.
    const walkerCalls = (page.evaluate as jest.Mock).mock.calls.filter((call) => call[0] === walkPageForObjects);
    expect(walkerCalls.length).toBe(3);
    expect((prisma.scanObject.createMany as jest.Mock).mock.calls[0][0].data).toHaveLength(0);
  });
});

describe('ScannerService — crawl() self-referential tab (no-op click) guard', () => {
  // Confirmed live via the [crawl-trace] debug logging added specifically
  // to chase this down: a record's own detail page (OrangeHRM's
  // viewPersonalDetails/empNumber/7) offers itself as one of its OWN tab
  // candidates — the currently-active tab, pointing right back at the page
  // it's already on. Clicking it is a genuine no-op: the URL never
  // changes, so the pathname-based pattern check must stay disabled for it
  // (a real Fiori-style same-URL tab swap to a DIFFERENT label must never
  // be blocked there). Pathname alone can't tell a no-op click apart from
  // a real same-URL tab swap — only comparing what's actually rendered
  // before and after the click can. This is why the fix compares
  // document.body.innerText.length before vs. after the click, not just
  // the URL: two calls returning the SAME number means nothing rendered,
  // so the resulting capture is a guaranteed duplicate of whatever was
  // already on screen.
  const RECORD_URL = 'https://x.test/record/1';
  const SELF_TAB_SELECTOR = 'selfTab';
  const REAL_TAB_SELECTOR = 'contactTab';

  function makeFakePage() {
    return {
      url: jest.fn(() => RECORD_URL),
      goto: jest.fn().mockResolvedValue(null),
      // Neither click navigates anywhere — both selectors live on the
      // record's own page, matching the real "reload-then-click-once"
      // design where next.url is already the record's own URL.
      click: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html></html>'),
      title: jest.fn().mockResolvedValue('Record'),
      evaluate: jest.fn((fn: unknown) => {
        if (fn === extractPageLinks || fn === extractTiles || fn === extractDrillTargets) return Promise.resolve([]);
        if (fn === extractTabs) {
          return Promise.resolve([
            { selector: SELF_TAB_SELECTOR, label: 'Personal Details' }, // points at itself — a no-op
            { selector: REAL_TAB_SELECTOR, label: 'Contact Details' }, // a real same-URL tab swap
          ]);
        }
        if (fn === walkPageForObjects) return Promise.resolve([]);
        // The content-fingerprint probe (an inline arrow, not one of the
        // named dom-walker exports above, so it can't be matched by
        // reference) — a real same-URL tab swap must report a DIFFERENT
        // length after REAL_TAB_SELECTOR's click than before it, while
        // SELF_TAB_SELECTOR's click must report the SAME length both times.
        if (typeof fn === 'function' && fn.toString().includes('innerText')) {
          return Promise.resolve(1000);
        }
        return Promise.resolve([]);
      }),
    };
  }

  it('skips a self-referential no-op tab click (same content before and after)', async () => {
    const prisma = makePrismaMock();
    const page = makeFakePage();
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never) as unknown as {
      crawl(sessionId: string, targetUrl: string, sessionDir: string, browser: unknown, isTimedOut: () => boolean): Promise<void>;
    };

    await service.crawl('scan-1', RECORD_URL, '/fake/session-dir', browser, () => false);

    const capturedUrls = (prisma.scanPage.create as jest.Mock).mock.calls.map((call) => call[0].data.url as string);
    const personalDetailsCaptures = capturedUrls.filter((u) => u.includes('#tab=Personal'));
    expect(personalDetailsCaptures.length).toBe(0);
  });

  it('still captures a real same-URL tab swap whose content genuinely changes', async () => {
    // Guards the fix from over-correcting: this is the exact scenario the
    // pathname-based check was already protecting (a Fiori-style dashboard
    // whose tabs never change the URL) — the content-length check must
    // agree that a genuine change means "capture it," not just "same URL,
    // must be a duplicate."
    const prisma = makePrismaMock();
    let realTabClicked = false;
    const page = {
      url: jest.fn(() => RECORD_URL),
      goto: jest.fn().mockResolvedValue(null),
      click: jest.fn((selector: string) => {
        if (selector === REAL_TAB_SELECTOR) realTabClicked = true;
        return Promise.resolve();
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html></html>'),
      title: jest.fn().mockResolvedValue('Record'),
      evaluate: jest.fn((fn: unknown) => {
        if (fn === extractPageLinks || fn === extractTiles || fn === extractDrillTargets) return Promise.resolve([]);
        if (fn === extractTabs) {
          return Promise.resolve([
            { selector: SELF_TAB_SELECTOR, label: 'Personal Details' },
            { selector: REAL_TAB_SELECTOR, label: 'Contact Details' },
          ]);
        }
        if (fn === walkPageForObjects) return Promise.resolve([]);
        if (typeof fn === 'function' && fn.toString().includes('innerText')) {
          // Real same-URL tab swap: content is different once the real
          // tab's own click has actually happened, regardless of which
          // entry's before/after probe is asking.
          return Promise.resolve(realTabClicked ? 2500 : 1000);
        }
        return Promise.resolve([]);
      }),
    };
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never) as unknown as {
      crawl(sessionId: string, targetUrl: string, sessionDir: string, browser: unknown, isTimedOut: () => boolean): Promise<void>;
    };

    await service.crawl('scan-1', RECORD_URL, '/fake/session-dir', browser, () => false);

    const capturedUrls = (prisma.scanPage.create as jest.Mock).mock.calls.map((call) => call[0].data.url as string);
    expect(capturedUrls.some((u) => u.includes('#tab=Contact'))).toBe(true);
  });
});

describe('ScannerService — crawl() same destination via both a link and a tab click', () => {
  // Confirmed live: OrangeHRM's own per-record tab menu is real <a href>
  // markup that ALSO carries role="tab" — extractPageLinks and extractTabs
  // each independently find it and queue it through their own,
  // non-overlapping key spaces (destination URL vs. origin+selector), so
  // the SAME destination gets discovered — and, without this fix,
  // captured — twice. A single shared "seen" Set marked at LINK-enqueue
  // time was tried and caused a worse regression: a link's own capture saw
  // its own pre-mark and skipped ITSELF, capturing almost nothing in the
  // whole crawl. The real fix needs two Sets — queuedUrlPatterns (marked
  // at link enqueue time only, to avoid queueing a second redundant link)
  // and capturedUrlPatterns (checked and marked only at actual capture
  // time, for every entry regardless of how it was discovered).
  const LIST_URL = 'https://x.test/portal';
  const RECORD_URL = 'https://x.test/portal/record/1';

  function makeFakePage() {
    let currentUrl = LIST_URL;
    return {
      url: jest.fn(() => currentUrl),
      goto: jest.fn((url: string) => {
        currentUrl = url;
        return Promise.resolve(null);
      }),
      click: jest.fn((selector: string) => {
        if (currentUrl === LIST_URL && selector === 'recordTab') currentUrl = RECORD_URL;
        return Promise.resolve();
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html></html>'),
      title: jest.fn().mockResolvedValue('Portal'),
      evaluate: jest.fn((fn: unknown) => {
        // The same anchor, discoverable two ways from the SAME list page:
        // as a plain href (extractPageLinks) and as a role="tab" element
        // (extractTabs) — exactly the OrangeHRM markup shape confirmed live.
        if (fn === extractPageLinks) return Promise.resolve(currentUrl === LIST_URL ? [RECORD_URL] : []);
        if (fn === extractTabs) return Promise.resolve(currentUrl === LIST_URL ? [{ selector: 'recordTab', label: 'Record' }] : []);
        if (fn === extractTiles || fn === extractDrillTargets) return Promise.resolve([]);
        // Real content, not empty — dedup only needs to survive a SECOND
        // arrival once the FIRST one actually succeeded (see the
        // "capturedUrlPatterns only marks on objectCount > 0" fix): an
        // always-empty page would legitimately let both paths through, by
        // design, so this fixture models the realistic case a record page
        // actually has data.
        if (fn === walkPageForObjects) {
          return Promise.resolve(
            currentUrl === RECORD_URL
              ? [
                  {
                    label: 'Name',
                    objectType: 'TEXT',
                    xpath: '/x',
                    cssSelector: '.x',
                    idAttr: null,
                    nameAttr: null,
                    placeholder: null,
                    buttonText: null,
                    ariaLabel: null,
                    nearbyLabelText: null,
                    recommendedLocator: '.x',
                    recommendedLocatorType: 'CSS',
                    backupLocators: null,
                    confidenceScore: 0.9,
                  },
                ]
              : [],
          );
        }
        return Promise.resolve([]);
      }),
    };
  }

  it('captures the shared destination exactly once, not once per discovery mechanism', async () => {
    const prisma = makePrismaMock();
    const page = makeFakePage();
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never) as unknown as {
      crawl(sessionId: string, targetUrl: string, sessionDir: string, browser: unknown, isTimedOut: () => boolean): Promise<void>;
    };

    await service.crawl('scan-1', LIST_URL, '/fake/session-dir', browser, () => false);

    const capturedUrls = (prisma.scanPage.create as jest.Mock).mock.calls.map((call) => call[0].data.url as string);
    const recordCaptures = capturedUrls.filter((u) => u.startsWith(RECORD_URL));
    expect(recordCaptures.length).toBe(1);
  });

  it('lets a second path try again when the first one that reached the same page found nothing', async () => {
    // The actual bug fixed here, confirmed live on a real scan: OrangeHRM's
    // per-record detail views (Personal/Contact/Emergency/Dependents/...)
    // are reachable via both a link and a tab, exactly like the fixture
    // above — but on a REAL scan, whichever path happened to be processed
    // first sometimes returned 0 objects (a genuine capture race under
    // system load, not a broken page), and the ORIGINAL version of this
    // fix marked the page-shape "captured" regardless of that outcome —
    // permanently discarding the second path's real chance to actually get
    // the content. This is why capturedUrlPatterns is only marked on
    // success: a failed first attempt must not poison a page-shape for
    // every later arrival.
    let linkAttemptsSoFar = 0;
    const prisma = makePrismaMock();
    let currentUrl = LIST_URL;
    const page = {
      url: jest.fn(() => currentUrl),
      goto: jest.fn((url: string) => {
        currentUrl = url;
        return Promise.resolve(null);
      }),
      click: jest.fn((selector: string) => {
        if (currentUrl === LIST_URL && selector === 'recordTab') currentUrl = RECORD_URL;
        return Promise.resolve();
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html></html>'),
      title: jest.fn().mockResolvedValue('Portal'),
      evaluate: jest.fn((fn: unknown) => {
        if (fn === extractPageLinks) return Promise.resolve(currentUrl === LIST_URL ? [RECORD_URL] : []);
        if (fn === extractTabs) return Promise.resolve(currentUrl === LIST_URL ? [{ selector: 'recordTab', label: 'Record' }] : []);
        if (fn === extractTiles || fn === extractDrillTargets) return Promise.resolve([]);
        if (fn === walkPageForObjects) {
          if (currentUrl !== RECORD_URL) return Promise.resolve([]);
          linkAttemptsSoFar += 1;
          // The FIRST arrival at RECORD_URL (whichever path gets there
          // first) finds nothing, every single time, across all
          // MAX_OBJECT_CAPTURE_ATTEMPTS retries — modeling a genuinely
          // unlucky capture race, not a slow-rendering page a retry would
          // fix. Only a LATER, independent arrival succeeds.
          return Promise.resolve(linkAttemptsSoFar <= 3 ? [] : [
            {
              label: 'Name', objectType: 'TEXT', xpath: '/x', cssSelector: '.x', idAttr: null, nameAttr: null,
              placeholder: null, buttonText: null, ariaLabel: null, nearbyLabelText: null,
              recommendedLocator: '.x', recommendedLocatorType: 'CSS', backupLocators: null, confidenceScore: 0.9,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never) as unknown as {
      crawl(sessionId: string, targetUrl: string, sessionDir: string, browser: unknown, isTimedOut: () => boolean): Promise<void>;
    };

    await service.crawl('scan-1', LIST_URL, '/fake/session-dir', browser, () => false);

    const createManyCalls = (prisma.scanObject.createMany as jest.Mock).mock.calls;
    const gotRealContent = createManyCalls.some((call) => call[0].data.length > 0);
    expect(gotRealContent).toBe(true);
  });
});

describe('ScannerService — crawl() diminishing-returns early stop', () => {
  // "We don't want the timer to be 30 min — when all is done, stop
  // scanning" — a real completion signal (nothing new found in a while)
  // instead of always grinding toward MAX_PAGES_PER_SCAN or SCAN_TIMEOUT_MS.
  const LIST_URL = 'https://x.test/list';
  const DEAD_END_COUNT = 20;
  // Hyphenated, not a nested numeric path segment (/dead/1, /dead/2, ...)
  // — this test is isolated from the urlPattern template-dedup fix tested
  // elsewhere, and /dead/{n} would otherwise all collapse to the same
  // /dead/{id} pattern and get skipped by THAT logic instead of exercising
  // the diminishing-returns streak this test actually targets.
  const deadEndUrl = (n: number) => `https://x.test/dead-${n}`;

  function makeFakePage() {
    let currentUrl = LIST_URL;
    return {
      url: jest.fn(() => currentUrl),
      goto: jest.fn((url: string) => {
        currentUrl = url;
        return Promise.resolve(null);
      }),
      click: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html></html>'),
      title: jest.fn().mockResolvedValue('Dead end'),
      evaluate: jest.fn((fn: unknown) => {
        if (fn === extractPageLinks) {
          if (currentUrl === LIST_URL) {
            return Promise.resolve(Array.from({ length: DEAD_END_COUNT }, (_, i) => deadEndUrl(i + 1)));
          }
          return Promise.resolve([]); // every dead-end page is a true dead end: no further links
        }
        if (fn === extractTabs || fn === extractTiles || fn === extractDrillTargets) return Promise.resolve([]);
        if (fn === walkPageForObjects) return Promise.resolve([]); // no objects anywhere, including the list page itself
        return Promise.resolve([]);
      }),
    };
  }

  it('stops once enough consecutive pages contribute nothing new, without waiting for the queue to empty or the timer to fire', async () => {
    const prisma = makePrismaMock();
    const page = makeFakePage();
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never) as unknown as {
      crawl(
        sessionId: string,
        targetUrl: string,
        sessionDir: string,
        browser: unknown,
        isTimedOut: () => boolean,
      ): Promise<void>;
    };

    // isTimedOut always false: if this test passes, it did so because of
    // the diminishing-returns logic, never because the (irrelevant here)
    // wall-clock watchdog happened to fire.
    await service.crawl('scan-1', LIST_URL, '/fake/session-dir', browser, () => false);

    const capturedUrls = (prisma.scanPage.create as jest.Mock).mock.calls.map((call) => call[0].data.url as string);
    // 1 (list page, which itself queues 20 dead ends — "new" for that page)
    // + 15 (the streak threshold) dead ends visited before the 15th
    // consecutive contributes-nothing page trips the stop.
    expect(capturedUrls.length).toBe(16);
    // The remaining dead ends were still sitting in the queue, genuinely
    // unvisited — proof this stopped on the new conditional, not because
    // the queue ran out.
    expect(capturedUrls).not.toContain(deadEndUrl(DEAD_END_COUNT));

    const completedUpdate = (prisma.scanSession.update as jest.Mock).mock.calls.find(
      (call) => call[0].data.status === 'COMPLETED',
    );
    expect(completedUpdate).toBeTruthy();
  });
});

describe('ScannerService — checkForDuplicatePageAnomaly (runtime bug detector)', () => {
  // The scan-duplication bug fixed earlier this session passed every tsc
  // and eslint check — it was semantically wrong, not syntactically wrong,
  // so AI Engineering's other two task sources (a human's bug report, or
  // the nightly tsc/eslint scan) would never have caught it on their own.
  // This is the first detector grounded in TestPilot's own real runtime
  // output instead — real ScanPage rows, real duplicate URLs, no LLM ever
  // guessing a bug exists.
  function helper(prisma: ReturnType<typeof makePrismaMock>, aiEngineering: ReturnType<typeof makeAiEngineeringMock>) {
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, aiEngineering as never);
    return service as unknown as {
      checkForDuplicatePageAnomaly(sessionId: string, targetUrl: string): Promise<void>;
    };
  }

  function pagesWithUrls(urls: string[]) {
    return urls.map((url, i) => ({ id: `p${i}`, url }));
  }

  it('files a runtime-anomaly task when the duplicate rate is a real, measured problem', async () => {
    const prisma = makePrismaMock();
    // 12 pages total, 3 of them exact repeats of an earlier url = 25% > 15%.
    const urls = Array.from({ length: 9 }, (_, i) => `https://x.test/page-${i}`).concat([
      'https://x.test/page-0',
      'https://x.test/page-1',
      'https://x.test/page-2',
    ]);
    (prisma.scanPage.findMany as jest.Mock).mockResolvedValue(pagesWithUrls(urls));
    const aiEngineering = makeAiEngineeringMock();
    const h = helper(prisma, aiEngineering);

    await h.checkForDuplicatePageAnomaly('scan-1', 'https://x.test/start');

    expect(aiEngineering.reportRuntimeAnomaly).toHaveBeenCalledTimes(1);
    const call = (aiEngineering.reportRuntimeAnomaly as jest.Mock).mock.calls[0][0];
    expect(call.dedupeKey).toBe('runtime-anomaly:scanner-duplicate-pages');
    expect(call.description).toContain('scan-1');
    expect(call.severity).toBe('MEDIUM');
  });

  it('does not file a task when the duplicate rate is within normal bounds', async () => {
    const prisma = makePrismaMock();
    // 1 repeat out of 12 = ~8.3%, below the 15% threshold.
    const urls = Array.from({ length: 11 }, (_, i) => `https://x.test/page-${i}`).concat(['https://x.test/page-0']);
    (prisma.scanPage.findMany as jest.Mock).mockResolvedValue(pagesWithUrls(urls));
    const aiEngineering = makeAiEngineeringMock();
    const h = helper(prisma, aiEngineering);

    await h.checkForDuplicatePageAnomaly('scan-1', 'https://x.test/start');

    expect(aiEngineering.reportRuntimeAnomaly).not.toHaveBeenCalled();
  });

  it('does not file a task on a small scan even at 100% duplication — too small a sample to mean anything', async () => {
    const prisma = makePrismaMock();
    const urls = Array.from({ length: 5 }, () => 'https://x.test/only-page');
    (prisma.scanPage.findMany as jest.Mock).mockResolvedValue(pagesWithUrls(urls));
    const aiEngineering = makeAiEngineeringMock();
    const h = helper(prisma, aiEngineering);

    await h.checkForDuplicatePageAnomaly('scan-1', 'https://x.test/start');

    expect(aiEngineering.reportRuntimeAnomaly).not.toHaveBeenCalled();
  });

  it('escalates severity to HIGH once duplication passes 50% — this is the "108 of 124 pages" scale of real incident', async () => {
    const prisma = makePrismaMock();
    const urls = Array.from({ length: 5 }, (_, i) => `https://x.test/page-${i}`).concat(
      Array.from({ length: 7 }, () => 'https://x.test/page-0'),
    );
    (prisma.scanPage.findMany as jest.Mock).mockResolvedValue(pagesWithUrls(urls));
    const aiEngineering = makeAiEngineeringMock();
    const h = helper(prisma, aiEngineering);

    await h.checkForDuplicatePageAnomaly('scan-1', 'https://x.test/start');

    const call = (aiEngineering.reportRuntimeAnomaly as jest.Mock).mock.calls[0][0];
    expect(call.severity).toBe('HIGH');
  });
});

describe('ScannerService — getSession() common-object folding (isPersistentChrome gate)', () => {
  // The actual root cause of a real, user-reported bug: OrangeHRM's
  // Performance Review search form and its Leave List filter render the
  // SAME reusable component — same "Reset"/"Search" labels, same relative
  // DOM position — so dom-walker's fallback CSS locator (anchored to the
  // app's own root id, `#app`, when no closer unique ancestor id exists)
  // coincidentally comes out identical on both pages, despite them being
  // two completely different, page-specific controls. The OLD version of
  // this folding logic keyed purely on locator recurrence across a
  // majority of pages, so it silently folded BOTH pages' entire real
  // content into "common chrome" and discarded it — the pages ended up
  // with 0 objects each, even though the DOM was fully rendered and
  // walkPageForObjects found everything correctly. Confirmed live via a
  // real scan's own saved HTML and a direct re-run of the real capture
  // function against it. The fix: only objects dom-walker.ts already
  // determined sit inside a genuine nav/header/menubar/banner landmark
  // (isPersistentChrome) are eligible for this folding at all.
  function makeSessionPrismaMock(
    pages: Array<{ id: string; objects: Array<Record<string, unknown>> }>,
    historicalObjects: Array<{ recommendedLocator: string; isPersistentChrome: boolean; scanPage: { title: string } }> = [],
  ) {
    return {
      scanSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'scan-1', applicationId: 'app-1', pages }),
      },
      scanObject: {
        // Real behavior, not a bare mockResolvedValue — a plain mock would
        // return the full fixture regardless of the where clause the code
        // actually sent, which would make these tests pass even if the
        // isPersistentChrome:true filter were silently dropped from the
        // real query. Applying it here means the "where" assertions below
        // are checking something that actually matters.
        findMany: jest.fn().mockImplementation(({ where }: { where: { isPersistentChrome?: boolean } }) =>
          Promise.resolve(
            where.isPersistentChrome === undefined
              ? historicalObjects
              : historicalObjects.filter((o) => o.isPersistentChrome === where.isPersistentChrome),
          ),
        ),
      },
    };
  }

  function obj(overrides: Partial<Record<string, unknown>>) {
    return {
      id: `obj-${Math.random()}`,
      label: null,
      recommendedLocator: '#x',
      isPersistentChrome: false,
      ...overrides,
    };
  }

  it('folds a genuine nav-landmark locator recurring across a majority of pages into commonObjects', async () => {
    const navLink = { recommendedLocator: '#sidebar-nav-link-1', isPersistentChrome: true };
    const prisma = makeSessionPrismaMock([
      { id: 'p1', objects: [obj(navLink), obj({ recommendedLocator: '#p1-unique', isPersistentChrome: false })] },
      { id: 'p2', objects: [obj(navLink), obj({ recommendedLocator: '#p2-unique', isPersistentChrome: false })] },
      { id: 'p3', objects: [obj(navLink), obj({ recommendedLocator: '#p3-unique', isPersistentChrome: false })] },
    ]);
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    const result = await service.getSession('scan-1');

    expect(result.commonObjects).toHaveLength(1);
    expect(result.commonObjects[0].recommendedLocator).toBe('#sidebar-nav-link-1');
    for (const page of result.pages) {
      expect(page.objects.some((o: { recommendedLocator: string }) => o.recommendedLocator === '#sidebar-nav-link-1')).toBe(false);
      expect(page.objects.length).toBe(1); // each page keeps its own unique object
    }
  });

  it('never folds a coincidentally-recurring locator that is not actually persistent shell chrome', async () => {
    // The exact bug: two different pages' search forms share a fallback
    // locator by coincidence of markup, not because they're the same
    // physical widget.
    const coincidentalLocator = '#app > div.oxd-layout:nth-of-type(1) > div:nth-of-type(2) > button:nth-of-type(3)';
    const prisma = makeSessionPrismaMock([
      {
        id: 'performance-review',
        objects: [obj({ recommendedLocator: coincidentalLocator, isPersistentChrome: false, label: 'Reset' })],
      },
      {
        id: 'leave-list',
        objects: [obj({ recommendedLocator: coincidentalLocator, isPersistentChrome: false, label: 'Reset' })],
      },
    ]);
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    const result = await service.getSession('scan-1');

    expect(result.commonObjects).toHaveLength(0);
    // Both pages keep their own "Reset" button — this used to be the exact
    // failure mode: both ended up with 0 objects instead.
    expect(result.pages[0].objects).toHaveLength(1);
    expect(result.pages[1].objects).toHaveLength(1);
  });

  it('cross-scan history only treats a locator as established chrome when it was flagged persistent chrome', async () => {
    const prisma = makeSessionPrismaMock(
      [{ id: 'p1', objects: [obj({ recommendedLocator: '#reused-locator', isPersistentChrome: false })] }],
      [
        { recommendedLocator: '#reused-locator', isPersistentChrome: false, scanPage: { title: 'Screen A' } },
        { recommendedLocator: '#reused-locator', isPersistentChrome: false, scanPage: { title: 'Screen B' } },
      ],
    );
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    const result = await service.getSession('scan-1');

    // The historical query itself is scoped to isPersistentChrome: true —
    // asserting that filter is actually present, not just that this
    // particular mock happens to return nothing chrome-like.
    expect(prisma.scanObject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPersistentChrome: true }) }),
    );
    expect(result.commonObjects).toHaveLength(0);
    expect(result.pages[0].objects).toHaveLength(1);
  });

  it('still folds a genuine nav locator established as chrome across 2+ distinct screens in scan history', async () => {
    const prisma = makeSessionPrismaMock(
      [{ id: 'p1', objects: [obj({ recommendedLocator: '#sidebar-home-link', isPersistentChrome: true })] }],
      [
        { recommendedLocator: '#sidebar-home-link', isPersistentChrome: true, scanPage: { title: 'Screen A' } },
        { recommendedLocator: '#sidebar-home-link', isPersistentChrome: true, scanPage: { title: 'Screen B' } },
      ],
    );
    const service = new ScannerService(prisma as never, makeGatewayMock() as never, makeAiEngineeringMock() as never);

    const result = await service.getSession('scan-1');

    expect(result.commonObjects).toHaveLength(1);
    expect(result.pages[0].objects).toHaveLength(0);
  });
});
