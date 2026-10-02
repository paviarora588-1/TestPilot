import { chromium } from 'playwright';
import type { LocatorType } from '../../../generated/prisma/enums';

export interface LocatorHealthResult {
  resolves: boolean;
  // A locator matching more than one element is unhealthy in a different way
  // than "gone" — surfaced distinctly so a human reviewing a BROKEN object
  // knows which kind of problem it is.
  ambiguous: boolean;
  errorMessage?: string;
}

// dom-walker.ts already generates every non-XPath recommendedLocator as a
// ready-to-use CSS selector string (`#id`, `[data-testid="..."]`,
// `[aria-label="..."]`, `[name="..."]`, or a raw CSS selector) — only XPATH
// and TEXT need a Playwright selector-engine prefix to be interpreted
// correctly rather than as plain CSS.
function toPlaywrightSelector(technicalPath: string, locatorStrategy: LocatorType): string {
  if (locatorStrategy === 'XPATH') return `xpath=${technicalPath}`;
  if (locatorStrategy === 'TEXT') return `text=${technicalPath}`;
  return technicalPath;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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

// Deterministic, explainable check — no AI, no guessing: does this locator
// resolve on this page right now. Headless (unlike Scanner/WebRecorder,
// nothing here is ever meant for a human to watch live). Called once per
// object, sequentially, by ExecutionService.runQualityWatch — never in
// parallel, since concurrent browser/DB load is exactly what's repeatedly
// broken this project's local Postgres adapter (see the reports/summary bug
// filed this session).
export async function verifyLocatorLive(
  targetUrl: string,
  technicalPath: string,
  locatorStrategy: LocatorType,
): Promise<LocatorHealthResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await withTimeout(
      (async () => {
        const page = await browser.newPage({ ignoreHTTPSErrors: true });
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const selector = toPlaywrightSelector(technicalPath, locatorStrategy);
        const count = await page.locator(selector).count();
        if (count === 0) return { resolves: false, ambiguous: false };
        if (count > 1) return { resolves: false, ambiguous: true };
        return { resolves: true, ambiguous: false };
      })(),
      20_000,
      `Locator check for ${targetUrl}`,
    );
  } catch (err) {
    return { resolves: false, ambiguous: false, errorMessage: (err as Error).message };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
