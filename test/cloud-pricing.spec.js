const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { await f.close(); });
for (const locale of ['en-GB', 'en-US', 'de-DE']) test('annual USD price and two-month trial are consistent for ' + locale, async ({ browser }) => {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  try {
    await page.goto(f.origin + '/home');
    await expect(page.locator('.homepage-price')).toContainText('$2.99 per user per month, billed annually');
    await expect(page.locator('.homepage-price')).toContainText('Two months free');
    await page.goto(f.origin + '/cloud');
    await expect(page.locator('[data-cloud-plan="standard"] [data-cloud-price-primary]')).toHaveText('$2.99');
    await expect(page.locator('.pricing')).toContainText('$35.88 per user per year');
    await context.addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
    await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
    await page.goto(f.origin + '/cloud/subscribe');
    await expect(page.locator('#subscription-summary')).toBeVisible();
    await expect(page.locator('#subscription-summary')).toContainText('$2.99');
    await expect(page.locator('#subscription-summary')).toContainText('$35.88 per user per year');
    await expect(page.locator('#subscription-summary')).toContainText('billed annually');
    await expect(page.locator('#subscription-legal')).toContainText('annual charge is taken immediately');
    await expect(page.locator('#subscribe')).toBeVisible();
  } finally { await context.close(); }
});
