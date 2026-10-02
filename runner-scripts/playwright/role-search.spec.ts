import { expect, test } from '@playwright/test';

test('role search result is visible', async ({ page }) => {
  await page.goto(process.env.PRODUCT_URL || 'https://example.test');
  await page.locator("//input[@placeholder='Role Name']").fill('AM_ANALYST');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('AM_ANALYST')).toBeVisible();
  await page.screenshot({ path: 'evidence/role-search.png' });
});
