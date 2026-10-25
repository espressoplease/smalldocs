const { test, expect } = require('@playwright/test');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { startFixture } = require('./cloud-onboarding-fixture');
const { startCaptureServer, decodeMimeParts } = require('./test-email');
test.use({ serviceWorkers: 'block' });
let f, dir, mail, identity;
test.beforeEach(async ({ page }) => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-account-linking-'));
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const filename = path.join(dir, 'keys.json');
  fs.writeFileSync(filename, JSON.stringify({ jwk: { ...keys.publicKey.export({ format: 'jwk' }), kid: 'link-test', alg: 'RS256', use: 'sig' },
    privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }) }));
  mail = await startCaptureServer();
  f = await startFixture({ singlePlan: true, smtpPort: mail.port, env: {
    GOOGLE_OAUTH_CLIENT_ID: 'link-test-client', GOOGLE_OAUTH_CLIENT_SECRET: 'link-test-secret',
    SDOCS_TEST_GOOGLE_KEYS: filename, NODE_OPTIONS: '--require=' + path.join(__dirname, 'google-oauth-preload.js'),
  } });
  identity = { email: 'fresh@gmail.com', first: 'Robin', last: 'Walker' };
  await page.route('**/api/cloud/auth/oauth/google?*', async route => {
    const begun = await route.fetch({ maxRedirects: 0 });
    if (begun.status() !== 303 || !begun.headers().location.startsWith('https://accounts.google.com')) {
      return route.fulfill({ response: begun });
    }
    const provider = new URL(begun.headers().location), callback = new URL(provider.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', provider.searchParams.get('state'));
    callback.searchParams.set('code', Buffer.from(JSON.stringify({ ...identity, nonce: provider.searchParams.get('nonce') })).toString('base64url'));
    await route.fulfill({ response: begun, headers: { ...begun.headers(), location: callback.href }, body: '' });
  });
});
test.afterEach(async () => { if (f) await f.close(); if (mail) await new Promise(resolve => mail.server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
async function deliveredCode(before) {
  await expect.poll(() => mail.messages.length).toBe(before + 1);
  return decodeMimeParts(mail.messages[before]).map(p => p.body).join('\n').match(/\b\d{6}\b/)[0];
}
async function googleSignIn(page) {
  await page.goto(f.origin + '/cloud/sign-in?return=%2Flibrary%3Fscope%3Dcloud');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
}
async function emailSignIn(page, email) {
  const before = mail.messages.length;
  await page.goto(f.origin + '/cloud/sign-in?return=%2Flibrary%3Fscope%3Dcloud');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await page.locator('#code').fill(await deliveredCode(before));
  await page.locator('#code-form').getByRole('button').click();
}
async function finishSignup(page) {
  await expect(page).toHaveURL(/cloud\/terms/);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /agree|continue/i }).click();
  await expect(page).toHaveURL(/cloud\/profile|library\?scope=cloud/);
  if (new URL(page.url()).pathname === '/cloud/profile') {
    await page.getByLabel('First name').fill('Robin');
    await page.getByLabel('Last name').fill('Walker');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
}
const me = async page => (await (await page.request.get(f.origin + '/api/cloud/v1/me')).json()).user;
const libraries = async page => (await (await page.request.get(f.origin + '/api/cloud/v1/workspaces')).json()).workspaces;
async function post(page, url, data, origin = f.origin) {
  return page.request.post(f.origin + url, { headers: { Origin: origin }, data });
}
for (const hosted of [false, true]) for (const first of ['google', 'email']) {
  test((hosted ? 'Workspace' : 'Gmail') + ' ' + first + ' first keeps documents, trial and permissions when switching sign-in method', async ({ page, context }) => {
    identity.email = hosted ? 'fresh-linked@joes.com' : 'new-person@gmail.com';
    if (hosted) identity.hd = 'joes.com';
    if (first === 'google') await googleSignIn(page); else await emailSignIn(page, identity.email);
    await finishSignup(page);
    const original = await me(page), workspaces = await libraries(page);
    expect(workspaces).toHaveLength(1);
    const trial = f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(original.id);
    expect(trial).toBeTruthy();
    expect(trial.ends_at_ms).toBeGreaterThan(trial.starts_at_ms);
    expect(f.billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id=?').get(original.id).n).toBe(1);
    const saved = await post(page, '/api/cloud/v1/account/documents', { account_id: workspaces[0].id,
      filename: 'kept.md', markdown: '# Original private content', tags: ['linking'], idempotency_key: 'kept-doc' });
    expect(saved.status()).toBe(201);
    const doc = await saved.json();
    await page.goto('about:blank');
    await context.clearCookies();
    if (first === 'google') await emailSignIn(page, identity.email); else await googleSignIn(page);
    await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
    expect((await me(page)).id).toBe(original.id);
    expect((await libraries(page)).map(w => w.id)).toEqual(workspaces.map(w => w.id));
    expect(f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(original.id)).toEqual(trial);
    const read = await page.request.get(f.origin + '/api/cloud/v1/documents/' + doc.document.id);
    expect(read.status()).toBe(200);
    const denied = await f.api('outsider', '/api/cloud/v1/documents/' + doc.document.id);
    expect(denied.status).toBe(404);
    // A company email and Google hosted-domain claim do not grant membership.
    expect((await page.request.get(f.origin + '/api/cloud/v1/account?account_id=' + f.team.workspaceId)).status()).toBe(404);
  });
}
test('a third-party Google address needs its delivered mailbox code before any account is created', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  identity.email = 'third-party@company.test';
  const beforeUsers = f.auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_auth_users').get().n;
  await googleSignIn(page);
  await expect(page).toHaveURL(f.origin + '/cloud/link');
  await expect(page.getByRole('heading', { name: 'Connect Google' })).toBeVisible();
  expect(f.auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_auth_users').get().n).toBe(beforeUsers);
  const before = mail.messages.length;
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await deliveredCode(before);
  await page.getByLabel('Six-digit code').fill(code === '111111' ? '222222' : '111111');
  await page.getByRole('button', { name: 'Connect Google', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('invalid');
  expect((await post(page, '/api/cloud/auth/link', {}, 'https://attacker.test')).status()).toBe(403);
  const pending = (await context.cookies()).find(cookie => cookie.name === 'sdocs_oauth_link');
  expect(pending.httpOnly).toBe(true);
  expect(pending.sameSite).toBe('Lax');
  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Connect Google', exact: true }).click();
  await finishSignup(page);
  expect((await me(page)).email).toBe(identity.email);
  expect((await post(page, '/api/cloud/auth/link', {})).status()).toBe(401);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('Preferences explicitly connects a different Google email without a second library or trial', async ({ page, context }) => {
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.returning.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/cloud/admin?panel=preferences');
  await expect(page.locator('#sign-in-methods')).toContainText(f.users.returning.email);
  const previousLibraries = await libraries(page);
  const subscription = f.billing.getSubscription(f.personal.workspaceId);
  expect(subscription).toBeTruthy();
  await page.getByRole('link', { name: 'Connect Google', exact: true }).click();
  await expect(page).toHaveURL(f.origin + '/cloud/link');
  await expect(page.locator('#link-account')).toContainText(f.users.returning.email);
  expect((await f.api('outsider', '/api/cloud/auth/link')).status).toBe(401);
  await page.getByRole('button', { name: 'Connect Google', exact: true }).click();
  await expect(page).toHaveURL(f.origin + '/cloud/admin?panel=preferences');
  expect((await me(page)).id).toBe(f.users.returning.id);
  expect((await libraries(page)).map(w => w.id)).toEqual(previousLibraries.map(w => w.id));
  expect(f.billing.getSubscription(f.personal.workspaceId)).toEqual(subscription);
  await page.goto('about:blank');
    await context.clearCookies();
  await googleSignIn(page);
  await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
  expect((await me(page)).id).toBe(f.users.returning.id);
});
test('adding a verified email in Preferences makes it a login for the existing account', async ({ page, context }) => {
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.returning.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/cloud/admin?panel=preferences');
  await page.getByRole('link', { name: 'Add an email address', exact: true }).click();
  const before = mail.messages.length;
  await page.getByLabel('Email address', { exact: true }).fill('another-mailbox@company.test');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Six-digit code').fill(await deliveredCode(before));
  await page.getByRole('button', { name: 'Add email address', exact: true }).click();
  await expect(page).toHaveURL(f.origin + '/cloud/admin?panel=preferences');
  await expect(page.locator('#sign-in-methods')).toContainText('another-mailbox@company.test');
  await page.goto('about:blank');
    await context.clearCookies();
  await emailSignIn(page, 'another-mailbox@company.test');
  await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
  expect((await me(page)).id).toBe(f.users.returning.id);
});
test('normal Google login switches users without connecting to the currently open account', async ({ page, context }) => {
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.returning.sessionToken, url: f.origin }]);
  identity.email = f.users.gmail.email;
  await googleSignIn(page);
  await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
  expect((await me(page)).id).toBe(f.users.gmail.id);
  expect(f.auth.getUser(f.users.returning.id).identities).toHaveLength(1);
  expect((await page.request.get(f.origin + '/api/cloud/v1/account?account_id=' + f.personal.workspaceId)).status()).toBe(404);
});
test('connecting an email already owned by another account leaves both accounts separate', async ({ page, context }) => {
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.returning.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/cloud/link-email');
  const before = mail.messages.length;
  await page.getByLabel('Email address', { exact: true }).fill(f.users.bob.email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Six-digit code').fill(await deliveredCode(before));
  await page.getByRole('button', { name: 'Add email address', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('different SmallDocs account');
  expect((await me(page)).id).toBe(f.users.returning.id);
  expect(f.auth.getUser(f.users.returning.id).identities).toHaveLength(1);
  expect((await page.request.get(f.origin + '/api/cloud/v1/account?account_id=' + f.team.workspaceId)).status()).toBe(404);
});
