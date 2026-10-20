const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { await f.close(); });
for (const width of [320, 390, 1440]) {
  for (const scheme of ['light', 'dark']) {
    test('intermediate pages use the auth pattern at ' + width + ' in ' + scheme, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.missing.sessionToken, url: f.origin }]);
      for (const path of ['/cloud/profile', '/cloud/join-request', '/cloud/invite', '/cloud/subscribe', '/cloud/business-invite']) {
        await page.goto(f.origin + path);
        // Wait for each page's meaningful state rather than a partially rendered card.
        if (path === '/cloud/profile') await expect(page.locator('#profile-email')).toHaveText('new@joes.com');
        if (path === '/cloud/subscribe') await expect(page.locator('#subscription-state')).toContainText('month free');
        if (path === '/cloud/join-request') {
          await expect(page.locator('#review-status')).toContainText('link is incomplete');
          await expect(page.getByRole('link', { name: 'Use another email' })).toBeVisible();
          await expect(page.locator('#review-form')).toBeHidden();
        }
        if (path === '/cloud/invite') {
          // The protected route preserves the invitation through profile capture.
          await expect(page).toHaveURL(/cloud\/profile/);
        }
        if (path === '/cloud/business-invite') {
          await expect(page.getByRole('heading', { name: 'Invitation unavailable' })).toBeVisible();
          await expect(page.locator('#choice-view')).toBeHidden();
        }
        const card = page.locator('.auth-card').first();
        await expect(card).toBeVisible();
        expect(await card.evaluate(el => getComputedStyle(el).borderRadius)).toBe('10px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const box = await card.boundingBox();
        expect(Math.abs(box.x - (width - box.width) / 2)).toBeLessThanOrEqual(1);
      }
    });
  }
}
test('subscription loading failure never offers an unverified payment action', async ({ page }) => {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
  await page.route('**/api/cloud/billing/subscription', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto(f.origin + '/cloud/subscribe');
  await expect(page.locator('#subscription-state')).toContainText('Reload this page');
  await expect(page.locator('#subscribe')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Back to settings' })).toBeVisible();
});
