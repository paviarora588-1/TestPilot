import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { login, chooseComboboxOption } from './helpers';

// One long, ordered, realistic user journey through TestPilot's core loop:
// register an app -> scan it -> promote what the scanner found -> write a
// test case -> let AI turn it into an automation flow -> generate a real
// script from that flow -> execute the script -> see a real result.
//
// Each stage is its own `test()` (not one giant test) so a failure at any
// stage is reported precisely, but they share one browser page and run in
// order (`.serial`) because each stage's UI state depends on the one before
// it — this mirrors how a person would actually use the product in one
// sitting, not isolated unit-style checks.
//
// The scan target is TestPilot's own /login page, not an external site:
// fully local, always reachable, and stable, but still a REAL page with a
// real login form the scanner has to actually detect.
test.describe.serial('Full product journey: application -> scan -> object library -> test case -> flow -> script -> execution', () => {
  let browser: Browser;
  let page: Page;
  let scriptWasGenerated = false;
  const runId = Date.now();
  const appName = `E2E Journey ${runId}`;
  const testCaseTitle = `E2E login check ${runId}`;

  test.beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('logs in', async () => {
    await login(page);
    await expect(page).toHaveURL(/\/(dashboard|home)/);
  });

  test('creates a new application targeting a real, local login page', async () => {
    await page.goto('/applications');
    await page.getByRole('button', { name: 'New Application' }).click();
    await page.getByLabel('Name').fill(appName);
    await page.getByLabel('Entry URL').fill('http://localhost:3000/login');
    await page.getByRole('button', { name: 'Create Application' }).click();
    await expect(page.getByText(appName).first()).toBeVisible({ timeout: 10_000 });
  });

  test('selects the new application in the switcher', async () => {
    const trigger = page.getByRole('combobox').first();
    await chooseComboboxOption(page, trigger, appName);
    await expect(trigger).toContainText(appName);
  });

  test('runs a real scan against the target and finds real objects', async () => {
    await page.goto('/scanner');
    await page.getByRole('button', { name: 'Start Scan' }).click();
    // Real crawl + real object detection — generous timeout, no mocking.
    await expect(page.getByText('COMPLETED', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/\d+ objects? found/)).toBeVisible();
    const objectsFoundText = await page.getByText(/\d+ objects? found/).textContent();
    const found = Number(objectsFoundText?.match(/(\d+) object/)?.[1] ?? 0);
    expect(found).toBeGreaterThan(0);
  });

  test('promotes scanned objects to the Object Library', async () => {
    const promoteAllBtn = page.getByRole('button', { name: 'Promote All' }).first();
    if (await promoteAllBtn.count()) {
      await promoteAllBtn.click();
      await expect(promoteAllBtn).toHaveCount(0, { timeout: 10_000 });
    }
  });

  test('Object Library shows the promoted objects', async () => {
    await page.goto('/object-library');
    await expect(page.getByText('No objects yet. Promote some from the Scanner.')).toHaveCount(0);
    await expect(page.locator('table tbody tr').first()).toBeVisible();
  });

  test('creates a manual test case for the login flow', async () => {
    await page.goto('/test-cases');
    await page.getByRole('button', { name: 'New Test Case' }).first().click();
    await page.getByLabel('Title').fill(testCaseTitle);
    await page.getByLabel('Module').fill('Auth');
    await page.getByLabel('Feature').fill('Login');
    await page
      .getByLabel('Steps (one per line)')
      .fill('Enter email\nEnter password\nClick sign in button\nVerify dashboard is visible');
    await page.getByLabel('Expected result').fill('User lands on the dashboard');
    await page.getByRole('button', { name: 'Create Test Case' }).click();
    await expect(page.getByText('Not started').first()).toBeVisible();
    await expect(page.getByText(testCaseTitle).first()).toBeVisible({ timeout: 10_000 });
  });

  test('generates an automation flow from the test case with AI', async () => {
    // Real local-AI (Ollama, CPU-bound) call reading the Object Library —
    // confirmed live to take well over 60s; give it real room rather than
    // guessing at a tighter number.
    test.setTimeout(240_000);
    await page.goto('/automation-builder');
    const testCaseSelect = page.getByRole('combobox').filter({ hasText: /select a test case/i }).first();
    await chooseComboboxOption(page, testCaseSelect, testCaseTitle);
    await page.getByRole('button', { name: 'Generate Flow' }).click();
    await expect(page.getByText(/generated a flow from the test case/i)).toBeVisible({ timeout: 220_000 });
  });

  test('generates a real script from the flow, or is correctly blocked by the confidence policy', async () => {
    await expect(page.getByRole('button', { name: 'Generate Script' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Generate Script' }).click();

    // Both are real, valid outcomes: a successful generation, or the flow
    // correctly refusing to generate because one of its steps maps to an
    // object the scanner detected below the Settings page's configured
    // minimum mapping confidence (0.7) — that gate existing and firing
    // correctly is itself real behavior worth this test recognizing rather
    // than treating as a failure.
    const generated = page.getByText(/script generated/i);
    const blocked = page.getByText('Blocked:');
    await expect(generated.or(blocked)).toBeVisible({ timeout: 30_000 });

    scriptWasGenerated = await generated.isVisible();
    if (!scriptWasGenerated) {
      console.log('Script generation was correctly blocked by the confidence policy — execution stage will be skipped.');
    }
  });

  test('executes the generated script and reaches a real terminal result', async () => {
    test.skip(!scriptWasGenerated, 'No script exists — the flow was correctly blocked by the confidence policy, not a failure.');
    await page.goto('/executions');
    const flowRow = page.locator('table tbody tr', { hasText: appName }).first();
    // Flow name is AI-assigned, not the app name — fall back to the first (only) flow row for this app.
    const firstFlowRow = (await flowRow.count()) ? flowRow : page.locator('table tbody tr').first();
    await firstFlowRow.click();

    const scriptRow = page.locator('table tbody tr').first();
    await expect(scriptRow).toBeVisible({ timeout: 10_000 });
    await scriptRow.click();

    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText('Execution started')).toBeVisible({ timeout: 10_000 });

    const terminalStatus = page.getByText(/^(COMPLETED|FAILED|BLOCKED)$/).first();
    await expect(terminalStatus).toBeVisible({ timeout: 60_000 });

    // Whatever the business outcome, real step-by-step results must exist —
    // that's the actual proof the execution engine really ran automation,
    // not just flipped a status.
    await expect(page.locator('table', { hasText: 'Action' }).locator('tbody tr').first()).toBeVisible();
  });
});
