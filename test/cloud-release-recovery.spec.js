const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f, library;
test.beforeEach(async ({ context }) => {
  f = await startFixture({ singlePlan: true });
  library = (await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})).data.workspaces[0].id;
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
});
test.afterEach(async () => { if (f) await f.close(); });
test('expired checkout confirmation offers sign-in and returns to the subscription page', async ({ page }) => {
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET created_at_ms=? WHERE user_id=?').run(Date.now() - 31 * 60000, f.users.josh.id);
  await page.goto(f.origin + '/cloud/subscribe');
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  const link = page.locator('#subscribe-status a');
  await expect(link).toHaveText('Sign in');
  await expect(link).toHaveAttribute('href', '/cloud/sign-in?return=%2Fcloud%2Fsubscribe');
});
test('delayed payment polls status only, then offers manual recovery without another checkout', async ({ page }) => {
  let reads = 0, posts = 0;
  await page.clock.install();
  await page.route('**/api/cloud/billing/subscription', route => { reads++; return route.fulfill({ json: { ok: true, email: 'josh@joes.com', payment_pending: true, subscription_status: 'read_only' } }); });
  await page.route('**/api/cloud/billing/subscribe', route => { posts++; return route.fulfill({ status: 500, json: {} }); });
  await page.goto(f.origin + '/cloud/subscribe?payment=confirming');
  await expect(page.locator('#subscribe-status')).toContainText('being confirmed');
  for (let i = 0; i < 10; i++) { await page.clock.runFor(3100); await expect.poll(() => reads).toBe(i + 2); }
  await expect(page.locator('#subscribe-status')).toContainText('taking longer');
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Check payment status' }).click();
  expect(posts).toBe(0);
  await page.unroute('**/api/cloud/billing/subscription');
  await page.route('**/api/cloud/billing/subscription', route => route.fulfill({ json: { ok: true, email: 'josh@joes.com', subscription_status: 'active', phase: 'active' } }));
  await page.clock.runFor(3100);
  await expect(page.locator('#subscription-state')).toContainText('subscription is active');
  await expect(page.getByRole('button', { name: 'Check payment status' })).toBeHidden();
  expect(posts).toBe(0);
});
test('an invitation without email delivery shows the shareable link and does not claim it was sent', async ({ page }) => {
  await page.goto(f.origin + '/cloud/admin?panel=people&workspace_id=' + library);
  await page.locator('#invite-open').click();
  await page.locator('#invite-email').fill('new-person@joes.com');
  await page.locator('#invite-form button[type=submit]').click();
  await expect(page.locator('#invite-status')).toContainText('Share this link');
  await expect(page.locator('#invite-status')).not.toContainText('sent');
  await expect(page.locator('#invite-status a')).toHaveAttribute('href', /\/cloud\/invite\?token=/);
});
test('settings reauthentication preserves the invitation draft', async ({ page }) => {
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET created_at_ms=? WHERE user_id=?').run(Date.now() - 31 * 60000, f.users.josh.id);
  await page.goto(f.origin + '/cloud/admin?panel=people&workspace_id=' + library);
  await page.locator('#invite-open').click();
  await page.locator('#invite-email').fill('draft@joes.com');
  await page.locator('#invite-form button[type=submit]').click();
  await expect(page.locator('#page-error a')).toHaveText('Sign in');
  await expect(page.locator('#page-error a')).toHaveAttribute('target', '_blank');
  await expect(page.locator('#invite-email')).toHaveValue('draft@joes.com');
  expect(new URL(page.url()).pathname).toBe('/cloud/admin');
});
test('linked work emails are selectable and cannot be replaced by an unverified address', async ({ page, context }) => {
  f.auth._insertIdentity(f.users.gmail.id, { provider: 'email', subject: 'alex@joes.com', verifiedEmail: 'alex@joes.com' }, Date.now());
  f.auth._insertIdentity(f.users.gmail.id, { provider: 'email', subject: 'alex@other-work.test', verifiedEmail: 'alex@other-work.test' }, Date.now());
  await f.api('gmail', '/api/cloud/v1/onboarding/complete', 'POST', {});
  await context.clearCookies();
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.gmail.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/cloud/admin?panel=libraries');
  await expect(page.locator('#library-request-email option')).toHaveCount(2);
  await page.locator('#library-request-email').selectOption('alex@joes.com');
  await page.locator('#library-request-consent').check();
  await page.locator('#library-request-form button').click();
  await expect(page.locator('#library-request-url')).toBeVisible();
  const url = new URL(await page.locator('#library-request-url').inputValue());
  const review = await f.api('bob', '/api/cloud/v1/join-requests/review?token=' + encodeURIComponent(url.searchParams.get('token')));
  expect(review.status).toBe(200); expect(review.data.request.email).toBe('alex@joes.com');
  expect((await f.api('outsider', '/api/cloud/v1/join-requests/review?token=' + encodeURIComponent(url.searchParams.get('token')))).status).toBe(404);
  expect((await f.api('gmail', '/api/cloud/v1/join-requests', 'POST', { email: 'imposter@joes.com', consented: true })).status).toBe(400);
  f.auth.db.prepare('DELETE FROM cloud_auth_identities WHERE user_id=? AND verified_email=?').run(f.users.gmail.id, 'alex@joes.com');
  expect((await f.api('bob', '/api/cloud/v1/join-requests/review?token=' + encodeURIComponent(url.searchParams.get('token')))).status).toBe(404);
});

test('a canceled subscriber without a trial is offered payment without another trial promise', async ({ page }) => {
  await page.route('**/api/cloud/billing/subscription', route => route.fulfill({ json: { ok: true,
    email: 'josh@joes.com', subscription_status: 'canceled', phase: 'canceled', quantity: 1 } }));
  await page.goto(f.origin + '/cloud/subscribe');
  await expect(page.locator('#subscription-state')).toContainText('Your subscription has ended.');
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeEnabled();
  await expect(page.locator('#subscription-state')).not.toContainText('month free');
});
