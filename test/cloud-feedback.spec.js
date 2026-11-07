const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const { FeedbackInbox } = require('../lib/cloud-feedback');
const crypto = require('crypto');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true, feedbackAdminUser: 'bob' }); });
test.afterEach(async () => { if (f) await f.close(); });
const body = (message, extra = {}) => ({ message, idempotency_key: crypto.randomUUID(), ...extra });
async function signIn(page, actor) {
  // WebKit keeps an existing HttpOnly cookie when addCookies supplies the same name.
  // Clear it first to model signing out before signing in as a different account.
  await page.context().clearCookies({ name: 'sdocs_cloud' });
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
}
async function openFeedback(page, actor = 'member') {
  await signIn(page, actor); await page.goto(f.origin + '/library?scope=cloud&workspace=' + f.team.workspaceId);
  const sidebar = page.locator('#_sd_site_sidebar');
  if (await page.locator('.sdocs-site-mobilebar-menu').isVisible()) await page.locator('.sdocs-site-mobilebar-menu').click();
  await sidebar.getByRole('button', { name: 'Feedback', exact: true }).click();
  return sidebar.locator('[data-feedback-panel]');
}

test('feedback is private, encrypted and attributed to the authenticated sender', async () => {
  const secret = 'Private sender feedback ' + crypto.randomUUID();
  const result = await f.api('member', '/api/cloud/v1/feedback', 'POST', body(secret, {
    user_id: f.users.bob.id, email: 'spoof@example.test', admin: true,
  }));
  expect(result.status).toBe(201);
  const rows = f.store.db.prepare('SELECT * FROM cloud_private_feedback').all();
  expect(rows).toHaveLength(1); expect(rows[0].user_id).toBe(f.users.member.id);
  expect(rows[0].ciphertext.toString()).not.toContain(secret);
  expect(rows[0].ciphertext.toString()).not.toContain(f.users.member.email);
  expect(rows[0]).not.toHaveProperty('message');
  for (const actor of ['member', 'josh', 'outsider']) {
    expect((await f.api(actor, '/api/cloud/v1/feedback/inbox?user_id=' + f.users.bob.id)).status).toBe(404);
    expect((await f.api(actor, '/cloud/feedback')).status).toBe(404);
    expect((await f.api(actor, '/public/cloud-feedback-admin.html')).status).toBe(404);
  }
  const admin = await f.api('bob', '/api/cloud/v1/feedback/inbox');
  expect(admin.status).toBe(200);
  expect(admin.headers.get('cache-control')).toContain('no-store');
  expect(admin.data.items[0]).toMatchObject({ message: secret, user_id: f.users.member.id, email: f.users.member.email });
  const publicResponse = await fetch(f.origin + '/api/feedback');
  expect(await publicResponse.text()).not.toContain(secret);
  expect((await fetch(f.origin + '/api/cloud/v1/feedback/inbox')).status).toBe(401);
  expect((await fetch(f.origin + '/public/cloud-feedback-admin.html', { redirect: 'manual' })).status).toBe(303);
});

test('submission rejects cross-origin requests and invalid input without storing data', async () => {
  const response = await fetch(f.origin + '/api/cloud/v1/feedback', { method: 'POST',
    headers: { Cookie: f.users.member.cookie, Origin: 'https://other.example', 'Content-Type': 'application/json' },
    body: JSON.stringify(body('Cross-site content')) });
  expect(response.status).toBe(403);
  for (const message of ['', '   ', {}, '\u{1F41F}'.repeat(1025)]) {
    expect((await f.api('member', '/api/cloud/v1/feedback', 'POST', body(message))).status).toBe(400);
  }
  expect(f.store.db.prepare('SELECT count(*) AS n FROM cloud_private_feedback').get().n).toBe(0);
});

test('CLI credentials use the same sender identity and administrator permissions', async () => {
  const credentials = Object.fromEntries(['member', 'bob'].map(actor => [actor,
    f.auth._createCliCredential(f.users[actor].id, 'Feedback test', Date.now())]));
  const request = async (actor, path, method = 'GET', data) => fetch(f.origin + '/api/cloud/v1/feedback' + path, {
    method, headers: { Authorization: 'Bearer ' + credentials[actor].accessToken, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  expect((await request('member', '', 'POST', body('Feedback from an agent'))).status).toBe(201);
  expect((await request('member', '/inbox')).status).toBe(404);
  const inbox = await (await request('bob', '/inbox')).json();
  expect(inbox.items[0]).toMatchObject({ message: 'Feedback from an agent', user_id: f.users.member.id });
  f.auth.revokeCliCredential({ userId: f.users.bob.id, credentialId: credentials.bob.credentialId });
  expect((await request('bob', '/inbox')).status).toBe(401);
});

test('signed-out visitors see a sign-in action rather than an anonymous feedback form', async ({ page }) => {
  await page.goto(f.origin + '/docs');
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  const section = page.locator('[data-sidebar-section="feedback"]');
  await expect(section.getByRole('textbox')).toHaveCount(0);
  await expect(section.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', /\/cloud\/sign-in\?return=/);
  await expect(section.locator('[data-feedback-inbox]')).toHaveCount(0);
});

test('retries are idempotent, account-scoped, and remain safe after the feedback rate limit', async () => {
  const request = body('First message');
  const first = await f.api('member', '/api/cloud/v1/feedback', 'POST', request);
  const repeat = await f.api('member', '/api/cloud/v1/feedback', 'POST', request);
  expect(repeat.data.feedback.id).toBe(first.data.feedback.id);
  expect((await f.api('member', '/api/cloud/v1/feedback', 'POST', { ...request, message: 'Different' })).status).toBe(409);
  const other = await f.api('outsider', '/api/cloud/v1/feedback', 'POST', request);
  expect(other.data.feedback.id).not.toBe(first.data.feedback.id);
  for (let i = 0; i < 9; i++) expect((await f.api('member', '/api/cloud/v1/feedback', 'POST', body('Message ' + i))).status).toBe(201);
  expect((await f.api('member', '/api/cloud/v1/feedback', 'POST', body('Over limit'))).status).toBe(429);
  expect((await f.api('member', '/api/cloud/v1/feedback', 'POST', request)).data.feedback.id).toBe(first.data.feedback.id);
});

test('the inbox is denied when no administrator is configured', async () => {
  const inbox = new FeedbackInbox({ store: f.store });
  expect(inbox.isAdmin(f.users.bob.id)).toBe(false);
  await expect(inbox.list({ userId: f.users.bob.id })).rejects.toMatchObject({ code: 'resource_unavailable' });
});

test('concurrent submissions, restart and paginated reads preserve every message once', async () => {
  const inbox = new FeedbackInbox({ store: f.store, adminUserIds: f.users.bob.id });
  const repeated = { user: f.users.member, email: f.users.member.email, message: 'A concurrent retry', requestId: 'same-retry' };
  const receipts = await Promise.all(Array.from({ length: 5 }, () => inbox.submit(repeated)));
  expect(new Set(receipts.map(r => r.id)).size).toBe(1);
  for (let i = 0; i < 51; i++) await inbox.submit({ ...repeated, message: 'Inbox message ' + i, requestId: 'page-' + i });
  await f.restart(require('path').join(__dirname, '..'));
  const one = await f.api('bob', '/api/cloud/v1/feedback/inbox');
  expect(one.data.items).toHaveLength(50); expect(one.data.next_cursor).toBeTruthy();
  const two = await f.api('bob', '/api/cloud/v1/feedback/inbox?after=' + one.data.next_cursor);
  expect(two.data.items).toHaveLength(2); expect(two.data.next_cursor).toBeNull();
  expect(new Set([...one.data.items, ...two.data.items].map(item => item.id)).size).toBe(52);
  expect((await f.api('bob', '/api/cloud/v1/feedback/inbox?after=invalid')).status).toBe(400);
});

test('encrypted messages are bound to their sender and creation metadata', async () => {
  await f.api('member', '/api/cloud/v1/feedback', 'POST', body('Keep this encrypted'));
  f.store.db.prepare('UPDATE cloud_private_feedback SET user_id=?').run(f.users.outsider.id);
  const result = await f.api('bob', '/api/cloud/v1/feedback/inbox');
  expect(result.status).toBe(503); expect(JSON.stringify(result.data)).not.toContain('Keep this encrypted');
});

for (const width of [1440, 390]) {
  test('sidebar feedback submits and the admin inbox renders plain text at ' + width, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 1000 });
    const panel = await openFeedback(page);
    const message = 'A suggestion for SmallDocs.\n<script>window.feedbackInjected = true</script>';
    await panel.getByRole('textbox', { name: 'Your feedback' }).fill(message);
    await panel.getByRole('button', { name: 'Send feedback' }).click();
    await expect(panel.getByRole('status')).toHaveText('Feedback sent.');
    await expect(panel.getByRole('textbox')).toHaveValue('');
    await expect(panel.locator('[data-feedback-inbox]')).toBeHidden();
    const adminContext = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const admin = await adminContext.newPage(); await signIn(admin, 'bob');
      await admin.goto(f.origin + '/cloud/feedback');
      await expect(admin.locator('.feedback-message')).toHaveText(message);
      await expect(admin.locator('.feedback-sender')).toContainText(f.users.member.email);
      expect(await admin.evaluate(() => window.feedbackInjected)).toBeUndefined();
      await admin.evaluate(() => SDocsThemePreference.apply('dark', true));
      expect(await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    } finally { await adminContext.close(); }
    const adminPanel = await openFeedback(page, 'bob');
    await expect(adminPanel.locator('[data-feedback-inbox]')).toBeVisible();
  });
}

test('network retries preserve the draft and reuse the same submission receipt', async ({ page }) => {
  let requests = 0; const payloads = [];
  await page.route('**/api/cloud/v1/feedback', async route => {
    payloads.push(route.request().postDataJSON()); requests++;
    if (requests === 1) { await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  const panel = await openFeedback(page);
  await panel.getByRole('textbox').fill('Please keep this draft.');
  await panel.getByRole('button', { name: 'Send feedback' }).click();
  await expect(panel.getByRole('status')).toContainText('Your message is still here.');
  await expect(panel.getByRole('textbox')).toHaveValue('Please keep this draft.');
  await panel.getByRole('button', { name: 'Send feedback' }).click();
  await expect(panel.getByRole('status')).toHaveText('Feedback sent.');
  expect(payloads[0].idempotency_key).toBe(payloads[1].idempotency_key);
  expect(f.store.db.prepare('SELECT count(*) AS n FROM cloud_private_feedback').get().n).toBe(1);
});

test('session expiry leaves the draft available and offers sign-in without posting anonymously', async ({ page }) => {
  await page.route('**/api/cloud/v1/feedback', route => route.fulfill({ status: 401, json: { error: 'login_required' } }));
  const panel = await openFeedback(page);
  await panel.getByRole('textbox').fill('A draft that must survive.');
  await panel.getByRole('button', { name: 'Send feedback' }).click();
  await expect(panel.getByRole('textbox')).toHaveValue('A draft that must survive.');
  await expect(panel.locator('[data-feedback-sign-in]')).toBeVisible();
  expect(f.store.db.prepare('SELECT count(*) AS n FROM cloud_private_feedback').get().n).toBe(0);
});

test('typing while sending becomes a new draft and is not discarded by the receipt', async ({ page }) => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/cloud/v1/feedback', async route => { started(); await gate; await route.continue(); });
  try {
    const panel = await openFeedback(page);
    await panel.getByRole('textbox').fill('First submitted message.');
    await panel.getByRole('button', { name: 'Send feedback' }).click(); await ready;
    await panel.getByRole('textbox').fill('A new draft typed while sending.'); release();
    await expect(panel.getByRole('status')).toHaveText('Feedback sent.');
    await expect(panel.getByRole('textbox')).toHaveValue('A new draft typed while sending.');
    const inbox = await f.api('bob', '/api/cloud/v1/feedback/inbox');
    expect(inbox.data.items[0].message).toBe('First submitted message.');
  } finally { release(); }
});

test('authorization is checked again after asynchronous key work', async () => {
  const inbox = new FeedbackInbox({ store: f.store, adminUserIds: f.users.bob.id });
  const input = { user: f.users.member, email: f.users.member.email, message: 'Revocation case', requestId: 'revoked' };
  let authorized = true;
  const original = f.store.keyProvider.unwrapProjectKey.bind(f.store.keyProvider);
  f.store.keyProvider.unwrapProjectKey = async (...args) => { await new Promise(resolve => setImmediate(resolve)); authorized = false; return original(...args); };
  const recheck = () => { if (!authorized) throw Object.assign(new Error('login_required'), { code: 'login_required' }); };
  await expect(inbox.submit({ ...input, beforeCommit: recheck })).rejects.toMatchObject({ code: 'login_required' });
  expect(f.store.db.prepare('SELECT count(*) AS n FROM cloud_private_feedback').get().n).toBe(0);
  f.store.keyProvider.unwrapProjectKey = original;
  await inbox.submit(input); authorized = true;
  f.store.keyProvider.unwrapProjectKey = async (...args) => { await new Promise(resolve => setImmediate(resolve)); authorized = false; return original(...args); };
  await expect(inbox.list({ userId: f.users.bob.id, beforeReturn: recheck })).rejects.toMatchObject({ code: 'login_required' });
});

test('the admin inbox clears on history navigation and refuses a different account on return', async ({ page }) => {
  await f.api('member', '/api/cloud/v1/feedback', 'POST', body('Private inbox content'));
  await signIn(page, 'bob'); await page.goto(f.origin + '/cloud/feedback');
  await expect(page.locator('.feedback-message')).toHaveText('Private inbox content');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.feedback-message')).toHaveCount(0);
  await signIn(page, 'outsider');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('status')).toHaveText('This inbox is not available for this account.');
  await expect(page.locator('.feedback-message')).toHaveCount(0);
});
