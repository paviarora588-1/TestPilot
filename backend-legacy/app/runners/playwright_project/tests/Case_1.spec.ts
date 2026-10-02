import { test, expect } from '@playwright/test';

test('Login Attempt', async ({ page }) => {
  await page.goto(process.env.PRODUCT_URL || 'http://localhost');
  // Open chrome
  // TODO open with body > div > div.orangehrm-login-layout:nth-of-type(1) > div.orangehrm-login-layout-blob > div.orangehrm-login-container:nth-of-type(1) > div.orangehrm-login-slot-wrapper > div.orangehrm-login-slot:nth-of-type(2) > div.orangehrm-login-form:nth-of-type(2) > form.oxd-form > div.oxd-form-actions.orangehrm-login-action:nth-of-type(3) > button.oxd-button.oxd-button--medium
  // open url "https://opensource-demo.orangehrmlive.com/web/index.php/auth/login"
  // TODO open with body > div > div.orangehrm-login-layout:nth-of-type(1) > div.orangehrm-login-layout-blob > div.orangehrm-login-container:nth-of-type(1) > div.orangehrm-login-slot-wrapper > div.orangehrm-login-slot:nth-of-type(2) > div.orangehrm-login-form:nth-of-type(2) > form.oxd-form > div.oxd-form-actions.orangehrm-login-action:nth-of-type(3) > button.oxd-button.oxd-button--medium
  // enter user name as Admin
  try {
    await page.locator('input[name="username"]').fill('Admin');
    console.log('Step 3: Username passed');
  } catch (e) {
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log('Step 3: Username failed: ' + message);
    throw e;
  }
  // Password admin123
  try {
    await page.locator('input[name="password"]').fill('admin123');
    console.log('Step 4: Password passed');
  } catch (e) {
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log('Step 4: Password failed: ' + message);
    throw e;
  }
  // click on login
  try {
    await page.locator('body > div > div.orangehrm-login-layout:nth-of-type(1) > div.orangehrm-login-layout-blob > div.orangehrm-login-container:nth-of-type(1) > div.orangehrm-login-slot-wrapper > div.orangehrm-login-slot:nth-of-type(2) > div.orangehrm-login-form:nth-of-type(2) > form.oxd-form > div.oxd-form-actions.orangehrm-login-action:nth-of-type(3) > button.oxd-button.oxd-button--medium').click();
    console.log('Step 5: Login passed');
  } catch (e) {
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log('Step 5: Login failed: ' + message);
    throw e;
  }
  // Verify whether "Dashboard" appear or not on next page
  try {
    await expect(page.locator('body > div > div.oxd-layout.orangehrm-upgrade-layout:nth-of-type(1) > div.oxd-layout-navigation:nth-of-type(1) > aside.oxd-sidepanel > nav.oxd-navbar-nav > div.oxd-sidepanel-body:nth-of-type(2) > ul.oxd-main-menu > li.oxd-main-menu-item-wrapper:nth-of-type(8) > a.oxd-main-menu-item.active')).toBeVisible();
    console.log('Step 6: Dashboard passed');
  } catch (e) {
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log('Step 6: Dashboard failed: ' + message);
    throw e;
  }
});
