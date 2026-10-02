import { defineConfig } from '@playwright/test';

// Shared, disposable scratch project backend-v2 copies each generated flow's
// files into (tests/) before running `npx playwright test <spec>`. Only one
// execution runs at a time (see execution.service.ts's runLock) since this
// directory is not per-run isolated — same pattern the legacy app used.
export default defineConfig({
  testDir: './tests',
  // 60s was fine for the local demo app but too tight for a real external
  // site (page loads/searches over the network genuinely take longer) — a
  // run against one timed out mid-step despite every step having actually
  // succeeded, confirmed from its own screenshots. Raised again from 120s —
  // a real enterprise SAP system over an internal network (Example App/GRC
  // dashboards especially) can legitimately take longer than that per step.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [['json', { outputFile: 'test-results/results.json' }]],
  use: {
    // Without this, a click/fill/etc. on a missing locator has no timeout of
    // its own — Playwright lets it retry until the *whole test's* 240s
    // budget is gone, then reports a generic "Test timeout exceeded" instead
    // of a specific "locator.click: Timeout exceeded", and by then the page/
    // context is already being torn down — too late for the per-step
    // try/catch's own DOM-capture-on-failure (see playwright-compiler.ts) to
    // still evaluate anything against a live page. 30s (matching
    // expect.timeout) lets an action fail on its own, fast, with the page
    // still alive and ~210s of test budget left for that recovery to run.
    actionTimeout: 30_000,
    // Headed on purpose: the user watches each execution run live on this
    // machine, not just after the fact via per-step screenshots.
    headless: false,
    // Generated scripts routinely target internal/enterprise apps (SAP
    // Fiori launchpads especially) served over HTTPS with a self-signed or
    // internally-issued certificate — without this, execution fails at the
    // TLS handshake on the very first OPEN_URL step.
    ignoreHTTPSErrors: true,
    // Playwright Test's default 1280x720 is narrow enough that this app's
    // SAPUI5 tab bar collapses tabs beyond the 3rd into a "More" overflow
    // menu — a click on a later tab (e.g. "Other's Password") then waits
    // forever for an element that's genuinely not visible yet, confirmed by
    // Playwright's own timeout report (not a hang) after everything before
    // it passed. Wide enough that all of this app's tabs render directly.
    viewport: { width: 1920, height: 1080 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
