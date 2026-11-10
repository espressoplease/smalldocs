const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true, analytics: true, feedbackAdminUser: 'bob' }); });
test.afterEach(async () => { if (f) await f.close(); });
async function signIn(page, actor) {
  await page.context().clearCookies({ name: 'sdocs_cloud' });
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
}

test('public signup API returns only aggregate counts, independently of browser identity and query parameters', async () => {
  const response = await fetch(f.origin + '/analytics/signups?user_id=' + f.users.bob.id + '&email=owner@other.com&group_by=email');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  const data = await response.json();
  expect(Object.keys(data).sort()).toEqual(['available', 'daily', 'generated_at', 'summary', 'timezone']);
  expect(data.summary).toEqual({ total: 7, today: 7, last_7_days: 7, last_30_days: 7 });
  expect(data.daily).toHaveLength(90);
  expect(data.daily.every(day => Object.keys(day).sort().join() === 'accounts,date')).toBe(true);
  const text = JSON.stringify(data);
  for (const user of Object.values(f.users)) { expect(text).not.toContain(user.id); expect(text).not.toContain(user.email); }
  expect((await f.api('bob', '/analytics/signups')).data).toEqual(data);
  expect((await fetch(f.origin + '/analytics/signups', { method: 'POST' })).status).toBe(405);
});

test('private overview rejects ordinary users, company owners and caller-supplied administrator identities', async () => {
  expect((await fetch(f.origin + '/cloud/overview', { redirect: 'manual' })).status).toBe(303);
  expect((await fetch(f.origin + '/api/cloud/v1/admin/overview')).status).toBe(401);
  expect((await fetch(f.origin + '/api/cloud/v1/admin/users')).status).toBe(401);
  for (const actor of ['josh', 'member', 'outsider', 'gmail']) {
    expect((await f.api(actor, '/cloud/overview')).status).toBe(404);
    expect((await f.api(actor, '/api/cloud/v1/admin/overview?user_id=' + f.users.bob.id)).status).toBe(404);
    expect((await f.api(actor, '/api/cloud/v1/admin/users?user_id=' + f.users.bob.id)).status).toBe(404);
    expect((await f.api(actor, '/api/cloud/v1/admin/status')).data.can_view_overview).toBe(false);
  }
  const admin = await f.api('bob', '/api/cloud/v1/admin/overview');
  expect(admin.status).toBe(200); expect(admin.headers.get('cache-control')).toBe('no-store');
  expect(admin.data.totals.accounts).toBe(7);
  expect(admin.data).not.toHaveProperty('subscription');
  for (const user of Object.values(f.users)) {
    expect(JSON.stringify(admin.data)).not.toContain(user.email);
    expect(JSON.stringify(admin.data)).not.toContain(user.id);
  }
});

test('administrator template stays outside public assets and requires browser login', async () => {
  const page = await f.api('bob', '/cloud/overview');
  expect(page.status).toBe(200); expect(page.headers.get('cache-control')).toBe('no-store');
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(page.data).toContain('Product overview');
  for (const path of ['/templates/cloud-product-overview.html', '/public/cloud-product-overview.html']) {
    expect((await fetch(f.origin + path)).status).toBe(404);
  }
  const manifest = await (await fetch(f.origin + '/trust/manifest')).json();
  expect(manifest.files.some(file => file.path.includes('cloud-product-overview.html'))).toBe(false);
});

test('revoked browser sessions and CLI credentials cannot reuse cached private aggregates', async () => {
  const credentials = f.auth._createCliCredential(f.users.bob.id, 'Overview access', Date.now());
  const bearer = () => fetch(f.origin + '/api/cloud/v1/admin/overview', { headers: { Authorization: 'Bearer ' + credentials.accessToken } });
  expect((await bearer()).status).toBe(200);
  f.auth.revokeCliCredential({ userId: f.users.bob.id, credentialId: credentials.credentialId });
  expect((await bearer()).status).toBe(401);
  expect((await fetch(f.origin + '/api/cloud/v1/admin/users', { headers: { Authorization: 'Bearer ' + credentials.accessToken } })).status).toBe(401);
  expect((await f.api('bob', '/api/cloud/v1/admin/overview')).status).toBe(200);
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET revoked_at_ms=? WHERE user_id=?').run(Date.now(), f.users.bob.id);
  expect((await f.api('bob', '/api/cloud/v1/admin/overview')).status).toBe(401);
  expect((await f.api('bob', '/api/cloud/v1/admin/users')).status).toBe(401);
});

test('the private account list returns verified emails only to administrators and never to public reports', async () => {
  const response = await f.api('bob', '/api/cloud/v1/admin/users');
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.data.items).toHaveLength(7);
  const member = response.data.items.find(user => user.id === f.users.member.id);
  expect(member.emails).toEqual([f.users.member.email]);
  expect(member).not.toHaveProperty('first_name');
  for (const route of ['/analytics/signups', '/analytics/data', '/api/cloud/v1/admin/overview']) {
    const result = await f.api('bob', route);
    expect(JSON.stringify(result.data)).not.toContain(f.users.member.email);
  }
  expect((await fetch(f.origin + '/analytics/users')).status).toBe(404);
});

test('the account list has stable pagination and rejects invalid cursors', async () => {
  for (let i = 0; i < 48; i++) f.auth.signInWithVerifiedEmail('pagination-' + i + '@example.test');
  const one = await f.api('bob', '/api/cloud/v1/admin/users');
  const two = await f.api('bob', '/api/cloud/v1/admin/users?after=' + encodeURIComponent(one.data.next_cursor));
  expect(one.data.items).toHaveLength(50); expect(two.data.items).toHaveLength(5);
  expect(new Set([...one.data.items, ...two.data.items].map(user => user.id)).size).toBe(55);
  expect(two.data.next_cursor).toBeNull();
  expect((await f.api('bob', '/api/cloud/v1/admin/users?after=missing')).status).toBe(400);
});

test('account rows render email text safely, handle removed addresses and paginate in the browser', async ({ page }) => {
  const injected = '<img src=x onerror="window.emailInjected=true">@example.test';
  f.auth.db.prepare('UPDATE cloud_auth_identities SET verified_email=? WHERE user_id=?').run(injected, f.users.member.id);
  f.auth.db.prepare('DELETE FROM cloud_auth_identities WHERE user_id=?').run(f.users.missing.id);
  f.auth.db.prepare('UPDATE cloud_auth_users SET disabled_at_ms=? WHERE id=?').run(Date.now(), f.users.missing.id);
  for (let i = 0; i < 48; i++) f.auth.signInWithVerifiedEmail('browser-page-' + i + '@example.test');
  await signIn(page, 'bob'); await page.goto(f.origin + '/cloud/overview');
  await expect(page.locator('[data-product-users] tr')).toHaveCount(50);
  await expect(page.locator('[data-product-users-previous]')).toBeDisabled();
  await page.locator('[data-product-users-next]').click();
  await expect(page.locator('[data-product-users] tr')).toHaveCount(5);
  await expect(page.locator('[data-product-users-next]')).toBeDisabled();
  await page.locator('[data-product-users-previous]').click();
  await expect(page.locator('[data-product-users] tr')).toHaveCount(50);
  expect(await page.evaluate(() => window.emailInjected)).toBeUndefined();
  // Refresh to a small list so both special cases are on the first page.
  f.auth.db.prepare("DELETE FROM cloud_auth_users WHERE id NOT IN (SELECT user_id FROM cloud_auth_identities WHERE verified_email NOT LIKE 'browser-page-%') AND id!=?").run(f.users.missing.id);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('[data-product-users]')).toContainText(injected);
  await expect(page.locator('[data-product-users]')).toContainText('No verified email retained');
  await expect(page.locator('[data-product-users] img')).toHaveCount(0);
  expect(await page.evaluate(() => window.emailInjected)).toBeUndefined();
});

test('an explicit empty overview allowlist denies everyone while feedback access remains unchanged', async () => {
  await f.close();
  f = await startFixture({ singlePlan: true, analytics: true, feedbackAdminUser: 'bob', env: { CLOUD_ANALYTICS_ADMIN_USER_IDS: '' } });
  expect((await f.api('bob', '/api/cloud/v1/admin/overview')).status).toBe(404);
  expect((await f.api('bob', '/cloud/overview')).status).toBe(404);
  expect((await f.api('bob', '/api/cloud/v1/feedback/inbox')).status).toBe(200);
  expect((await f.api('bob', '/analytics/signups')).status).toBe(200);
});

test('disabled accounts and missing current Terms cannot read private statistics', async () => {
  f.auth.db.prepare('DELETE FROM cloud_auth_terms_acceptances WHERE user_id=?').run(f.users.bob.id);
  expect((await f.api('bob', '/api/cloud/v1/admin/overview')).status).toBe(403);
  expect((await f.api('bob', '/cloud/overview')).status).toBe(303);
  f.auth.acceptCurrentTerms({ userId: f.users.bob.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
  expect((await f.api('bob', '/api/cloud/v1/admin/overview')).status).toBe(200);
  f.auth.db.prepare('UPDATE cloud_auth_users SET disabled_at_ms=? WHERE id=?').run(Date.now(), f.users.bob.id);
  expect((await f.api('bob', '/api/cloud/v1/admin/overview')).status).toBe(401);
});

test('overview readers can be configured independently of feedback readers', async () => {
  await f.close();
  f = await startFixture({ singlePlan: true, analytics: true, feedbackAdminUser: 'bob', analyticsAdminUser: 'outsider' });
  expect((await f.api('bob', '/api/cloud/v1/admin/overview')).status).toBe(404);
  expect((await f.api('outsider', '/api/cloud/v1/admin/overview')).status).toBe(200);
  expect((await f.api('outsider', '/api/cloud/v1/feedback/inbox')).status).toBe(404);
});

test('analytics is isolated to the configured deployment and disappears when disabled', async () => {
  const other = await startFixture({ singlePlan: true, analytics: true });
  try {
    other.auth.signInWithVerifiedEmail('another-account@example.test');
    const one = await (await fetch(f.origin + '/analytics/signups')).json();
    const two = await (await fetch(other.origin + '/analytics/signups')).json();
    expect(one.summary.total).toBe(7); expect(two.summary.total).toBe(8);
  } finally { await other.close(); }
  await f.close(); f = await startFixture({ singlePlan: true });
  expect((await fetch(f.origin + '/analytics/signups')).status).toBe(404);
});

for (const width of [1440, 390]) {
  test('public and private views work in both themes at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(f.origin + '/analytics');
    await expect(page.locator('[data-product-analytics=public] [data-signup-summary]')).toContainText('7');
    await expect(page.locator('[data-product-days-body] tr')).toHaveCount(30);
    await page.locator('[data-product-days]').selectOption('7');
    await expect(page.locator('[data-product-days-body] tr')).toHaveCount(7);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await signIn(page, 'bob'); await page.goto(f.origin + '/cloud/overview');
    await expect(page.locator('[data-product-results]')).toBeVisible();
    await expect(page.locator('[data-product-users]')).toContainText(f.users.member.email);
    if (width < 769) await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingLeft))).toBe(0);
    await expect(page.locator('[data-product-progress]')).toContainText('Profile completed');
    await expect(page.locator('[data-product-billing]')).toContainText('Active subscriptions');
    await page.locator('[data-product-days]').selectOption('90');
    await expect(page.locator('[data-product-days-body] tr')).toHaveCount(90);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => SDocsThemePreference.apply(theme, true), theme);
      await expect(page.locator('body')).toHaveCSS('color', theme === 'dark' ? 'rgb(231, 229, 226)' : 'rgb(28, 25, 23)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('[data-product-results]')).toBeVisible();
  });
}

test('account settings offer admin links only for the configured reader', async ({ page }) => {
  await signIn(page, 'bob'); await page.goto(f.origin + '/cloud/admin?panel=account');
  await expect(page.locator('#product-overview-link')).toBeVisible();
  await expect(page.locator('#product-feedback-link')).toBeVisible();
  await signIn(page, 'outsider'); await page.goto(f.origin + '/cloud/admin?panel=account');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.locator('#product-administration')).toBeHidden();
});

test('losing access clears displayed figures and history restoration checks authorization again', async ({ page }) => {
  await signIn(page, 'bob'); await page.goto(f.origin + '/cloud/overview');
  await expect(page.locator('[data-product-results]')).toBeVisible();
  await expect(page.locator('[data-product-users]')).toContainText(f.users.member.email);
  await page.route('**/api/cloud/v1/admin/overview', route => route.fulfill({ status: 404, json: { error: 'resource_unavailable' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-product-status]')).toContainText('not available for this account');
  await expect(page.locator('[data-product-results]')).toBeHidden();
  await expect(page.locator('[data-product-days-body] tr')).toHaveCount(0);
  await expect(page.locator('[data-product-users] tr')).toHaveCount(0);
  await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await expect(page.locator('[data-product-status]')).toContainText('not available for this account');
});

test('public totals and private errors have useful unavailable states', async ({ page }) => {
  await page.route('**/analytics/signups', route => route.fulfill({ json: { available: false } }));
  await page.goto(f.origin + '/analytics');
  await expect(page.locator('[data-product-status]')).toContainText('not available on this deployment');
  await signIn(page, 'bob');
  await page.route('**/api/cloud/v1/admin/overview', route => route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } }));
  await page.goto(f.origin + '/cloud/overview');
  await expect(page.locator('[data-product-status]')).toContainText('Try Refresh');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
});
