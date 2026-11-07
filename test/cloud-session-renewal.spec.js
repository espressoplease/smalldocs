const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async ({ context }) => {
  f = await startFixture({ singlePlan: true });
  await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
});
test.afterEach(async () => { await f.close(); });
function row() { return f.auth.db.prepare('SELECT * FROM cloud_auth_sessions WHERE user_id=?').get(f.users.josh.id); }

test('normal usage renews both the persistent cookie and server expiry', async ({ context, browser }) => {
  const signedIn = Date.now() - 2 * 86400000;
  const oldExpiry = Date.now() + 300000;
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET created_at_ms=?, expires_at_ms=? WHERE user_id=?').run(signedIn, oldExpiry, f.users.josh.id);
  const before = Date.now();
  const response = await context.request.get(f.origin + '/api/cloud/v1/me');
  expect(response.status()).toBe(200);
  expect(response.headers()['set-cookie']).toContain('sdocs_cloud=');
  expect(response.headers()['set-cookie']).toContain('HttpOnly');
  expect(response.headers()['set-cookie']).toContain('SameSite=Lax');
  const maxAge = Number(/Max-Age=(\d+)/.exec(response.headers()['set-cookie'])[1]);
  expect(maxAge).toBeGreaterThanOrEqual(30 * 86400 - 10);
  expect(maxAge).toBeLessThanOrEqual(30 * 86400);
  expect(row().expires_at_ms).toBeGreaterThanOrEqual(before + 30 * 86400000);
  expect(row().created_at_ms).toBe(signedIn);
  const cookie = (await context.cookies()).find(c => c.name === 'sdocs_cloud');
  expect(cookie.expires).toBeGreaterThan(oldExpiry / 1000);
  const persisted = await context.storageState();
  const reopened = await browser.newContext({ storageState: persisted });
  try { expect((await reopened.request.get(f.origin + '/api/cloud/v1/me')).status()).toBe(200); }
  finally { await reopened.close(); }
});
test('continued use does not satisfy the recent sign-in check for sensitive actions', async ({ context }) => {
  const signedIn = Date.now() - 31 * 60000;
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET created_at_ms=? WHERE user_id=?').run(signedIn, f.users.josh.id);
  expect((await context.request.get(f.origin + '/api/cloud/v1/me')).status()).toBe(200);
  const response = await context.request.post(f.origin + '/api/cloud/billing/portal', { data: {}, headers: { Origin: f.origin } });
  expect(response.status()).toBe(401);
  expect((await response.json()).error).toBe('recent_auth_required');
  expect(row().created_at_ms).toBe(signedIn);
});
test('expired and revoked cookies cannot renew or regain access', async ({ context }) => {
  const expired = Date.now() - 1000;
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET expires_at_ms=? WHERE user_id=?').run(expired, f.users.josh.id);
  const response = await context.request.get(f.origin + '/api/cloud/v1/me');
  expect(response.status()).toBe(401);
  expect(response.headers()['set-cookie']).toBeUndefined();
  expect(row().expires_at_ms).toBe(expired);
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET expires_at_ms=?, revoked_at_ms=? WHERE user_id=?').run(Date.now() + 86400000, Date.now(), f.users.josh.id);
  const revoked = await context.request.get(f.origin + '/api/cloud/v1/me');
  expect(revoked.status()).toBe(401);
  expect(revoked.headers()['set-cookie']).toBeUndefined();
});
test('signing out clears the renewed cookie and revokes its server session', async ({ context }) => {
  const response = await context.request.post(f.origin + '/api/cloud/auth/logout', { maxRedirects: 0, headers: { Origin: f.origin } });
  expect(response.status()).toBe(303);
  const cookies = response.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
  expect(cookies.length).toBe(2);
  for (const cookie of cookies) expect(cookie.value).toContain('Max-Age=0');
  expect(row().revoked_at_ms).not.toBeNull();
  expect((await f.api('josh', '/api/cloud/v1/me')).status).toBe(401);
});
test('static file requests do not keep an otherwise unused login alive', async ({ context }) => {
  const before = row().expires_at_ms;
  const response = await context.request.get(f.origin + '/public/css/cloud-admin.css');
  expect(response.status()).toBe(200);
  expect(response.headers()['set-cookie']).toBeUndefined();
  expect(row().expires_at_ms).toBe(before);
});
