import type { Locator, Page } from '@playwright/test';

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

export async function login(page: Page) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for an isolated test account.');
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|home)/, { timeout: 15_000 });
}

// base-ui's <Select> renders an accessible combobox trigger + option listbox,
// not a native <select> — page.selectOption() doesn't apply here.
export async function chooseComboboxOption(page: Page, trigger: Locator, optionName: string | RegExp) {
  await trigger.click();
  await page.getByRole('option', { name: optionName }).click();
}
