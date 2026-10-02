import { defineConfig } from '@playwright/test';

// Shared, disposable Playwright project TestPilot copies each generated .spec.ts into
// (tests/) before running `npx playwright test <file>`. Playwright's own actionability
// checks auto-wait for elements before every action, so generated scripts don't need the
// manual WebDriverWait boilerplate the Selenium path requires.
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
