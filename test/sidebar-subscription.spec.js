const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
const DAY = 86400000;
let f;

test.beforeAll(async () => {
  f = await startFixture({ singlePlan: true });
  const signup = await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  expect(signup.status).toBe(200);
});
test.afterAll(async () => { await f.close(); });
test.beforeEach(() => { setTrial(23); });

async function signIn(page, actor = 'josh') {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
}
function setTrial(daysLeft) {
  const now = Date.now();
  f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET starts_at_ms=?, ends_at_ms=? WHERE user_id=?')
    .run(now + (daysLeft - 30) * DAY, now + daysLeft * DAY, f.users.josh.id);
}

test('reader and Library use the actual trial above Account settings', async ({ page }) => {
  setTrial(23);
  await signIn(page);
  for (const path of ['/docs', '/library?scope=cloud', '/cloud/admin?panel=install']) {
    await page.goto(f.origin + path);
    const summary = page.locator('.sdocs-sidebar-subscription');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Free trial');
    await expect(summary).toContainText('23 days left');
    await expect(summary.getByRole('meter')).toHaveAttribute('aria-valuenow', '77');
    await expect(summary.getByRole('link', { name: 'Subscribe', exact: true }))
      .toHaveAttribute('href', f.origin + '/cloud/subscribe');
    const geometry = await summary.evaluate(el => ({
      nextIsFooter: el.nextElementSibling.classList.contains('sdocs-sidebar-footer'),
      bottom: el.getBoundingClientRect().bottom,
      accountTop: el.nextElementSibling.querySelector('.sdocs-sidebar-account-link').getBoundingClientRect().top,
    }));
    expect(geometry.nextIsFooter).toBe(true);
    expect(geometry.accountTop).toBeGreaterThan(geometry.bottom);
    expect(geometry.accountTop - geometry.bottom).toBeLessThan(32);
    await page.evaluate(() => window.SDocsSidebarShared.bindSubscriptionUi());
    await expect(page.locator('.sdocs-sidebar-subscription')).toHaveCount(1);
  }
  await page.locator('.sdocs-sidebar-subscribe').click();
  await expect(page).toHaveURL(f.origin + '/cloud/subscribe');
});

test('the last trial day and warning week have distinct remaining-time labels', async ({ page }) => {
  await signIn(page);
  setTrial(0.25);
  await page.goto(f.origin + '/docs');
  const summary = page.locator('.sdocs-sidebar-subscription');
  await expect(summary).toContainText('1 day left');
  await expect(summary.getByRole('meter')).toHaveAttribute('aria-valuenow', '1');
  setTrial(-2);
  await page.evaluate(() => window.SDocsSidebarShared.bindSubscriptionUi());
  await expect(summary).toHaveAttribute('data-subscription-status', 'trial_warning');
  await expect(summary).toContainText('Trial ended');
  await expect(summary).toContainText('5 days of access left');
  await expect(summary.getByRole('meter')).toHaveAttribute('aria-valuenow', '71');
  await expect(summary.getByRole('link', { name: 'Share feedback' })).toHaveAttribute('href', f.origin + '/cloud/trial-feedback');
  setTrial(-8);
  await page.evaluate(() => window.SDocsSidebarShared.bindSubscriptionUi());
  await expect(summary).toContainText('Subscription required');
  await expect(summary.getByRole('meter')).toHaveCount(0);
  await expect(summary).not.toContainText('days left');
});

test('paid members do not see a trial or a second Subscribe action', async ({ page }) => {
  await signIn(page, 'returning');
  await page.goto(f.origin + '/cloud/admin?panel=install');
  const status = await f.api('returning', '/api/cloud/billing/subscription');
  expect(status.data.phase).toBe('active');
  await page.evaluate(() => window.SDocsSidebarShared.bindSubscriptionUi());
  await expect(page.locator('.sdocs-sidebar-subscription')).toHaveCount(0);
});

test('signed-out pages and unavailable billing do not show a guessed trial', async ({ page }) => {
  await page.goto(f.origin + '/docs');
  await expect(page.locator('.sdocs-sidebar-subscription')).toHaveCount(0);
  await signIn(page);
  await page.route('**/api/cloud/billing/subscription', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto(f.origin + '/docs');
  await page.evaluate(() => window.SDocsSidebarShared.bindSubscriptionUi());
  await expect(page.locator('.sdocs-sidebar-subscription')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Account settings', exact: true })).toBeVisible();
});

test('the trial block hides on the compact rail and fits the mobile drawer in both themes', async ({ page }) => {
  setTrial(23);
  await signIn(page);
  await page.setViewportSize({ width: 950, height: 700 });
  await page.goto(f.origin + '/library?scope=cloud');
  const summary = page.locator('.sdocs-sidebar-subscription');
  await expect(summary).toHaveCount(1);
  await expect(summary).toBeHidden();
  await page.locator('.sdocs-sidebar-collapse-toggle').click();
  await expect(summary).toBeVisible();
  for (const dark of [false, true]) {
    await page.setViewportSize({ width: 390, height: 568 });
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.evaluate(dark => document.documentElement.dataset.theme = dark ? 'dark' : 'light', dark);
    await page.locator('.sdocs-site-mobilebar-menu').click();
    const subscribe = summary.getByRole('link', { name: 'Subscribe', exact: true });
    await subscribe.scrollIntoViewIfNeeded();
    await expect(subscribe).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await summary.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.width);
    await page.keyboard.press('Escape');
  }
});

test.describe('reader navigation with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });
  test('a cached signed-out reader does not hide trial status after sign-in', async ({ page }) => {
    await page.goto(f.origin + '/docs');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      });
      const anonymous = await fetch('/docs');
      const cache = await caches.open('signed-out-reader-test');
      await cache.put('/docs', anonymous);
    });
    await signIn(page);
    await page.goto(f.origin + '/docs');
    await expect(page.getByRole('link', { name: 'Account settings', exact: true })).toBeVisible();
    await expect(page.locator('.sdocs-sidebar-subscription')).toContainText('23 days left');
  });
});

for (const phase of ['past_due_grace', 'past_due', 'read_only']) {
  test(phase + ' offers billing recovery instead of another subscription', async ({ page }) => {
    await signIn(page);
    await page.route('**/api/cloud/billing/subscription', route => route.fulfill({ json: {
      phase, billing_url: f.origin + '/cloud/admin?panel=billing', subscribe_url: f.origin + '/cloud/subscribe',
    } }));
    await page.goto(f.origin + '/docs');
    const summary = page.locator('.sdocs-sidebar-subscription');
    await expect(summary).toContainText(phase === 'past_due_grace' ? 'Payment needs attention' : 'Read-only access');
    await expect(summary.getByRole('link', { name: 'Update billing', exact: true })).toHaveAttribute('href', f.origin + '/cloud/admin?panel=billing');
    await expect(summary.getByRole('link', { name: 'Subscribe', exact: true })).toHaveCount(0);
  });
}
