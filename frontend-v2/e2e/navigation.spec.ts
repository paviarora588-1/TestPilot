import { test, expect, type Response, chromium, type Browser, type Page } from '@playwright/test';
import { login } from './helpers';

// Every dashboard page should load with no uncaught exceptions and no API
// call that's still failing once React Query's automatic retries have had a
// chance to run — a broad, shallow safety net around the deep functional
// journey in full-journey.spec.ts.
//
// Deliberately NOT asserting on raw browser console output: the local dev
// database (PGlite via `prisma dev`) is known to intermittently fail the
// first attempt of a request under a burst of concurrent calls (confirmed
// live — /dashboard fires ~7 requests at once, and one or two occasionally
// 500 on the first try) while succeeding a moment later on React Query's
// default retry. Chrome logs that first failed attempt to the console
// regardless of the later success, so a "zero console errors" check would
// fail on a page that is, from the user's point of view, working correctly.
// What actually matters: no request is STILL failing once retries settle,
// and no uncaught JS exception occurred (pageerror always means a real bug,
// retries don't apply to those).
const PAGES = [
  '/home',
  '/dashboard',
  '/applications',
  '/knowledge-base',
  '/scanner',
  '/web-recorder',
  '/object-library',
  '/test-cases',
  '/test-data',
  '/automation-builder',
  '/script-generator',
  '/executions',
  '/reports',
  '/integrations',
  '/settings',
  '/ai-engineering',
];

test.describe('Navigation smoke test', () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await login(page);
  });

  test.afterAll(async () => {
    await browser.close();
  });

  for (const path of PAGES) {
    test(`${path} loads with no page exceptions and no persistently-failing API calls`, async () => {
      const pageErrors: string[] = [];
      const lastStatusByUrl = new Map<string, number>();

      const onPageError = (err: Error) => pageErrors.push(err.message);
      const onResponse = (res: Response) => {
        if (res.url().includes('/api/')) lastStatusByUrl.set(res.url(), res.status());
      };
      page.on('pageerror', onPageError);
      page.on('response', onResponse);

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      // Generous enough for React Query's default 3 retries (exponential
      // backoff) to finish settling on the final status for every request.
      await page.waitForTimeout(5000);

      page.off('pageerror', onPageError);
      page.off('response', onResponse);

      const stillFailing = [...lastStatusByUrl.entries()].filter(([, status]) => status >= 500);

      expect(pageErrors, `Uncaught page errors on ${path}:\n${pageErrors.join('\n')}`).toEqual([]);
      expect(
        stillFailing,
        `API calls still failing on ${path} after retries:\n${stillFailing.map(([u, s]) => `${s} ${u}`).join('\n')}`,
      ).toEqual([]);
    });
  }
});
