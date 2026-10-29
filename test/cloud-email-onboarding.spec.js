const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const { startCaptureServer, decodeMimeParts } = require('./test-email');
let f, mail;
test.beforeEach(async () => { mail = await startCaptureServer(); f = await startFixture({ singlePlan: true, smtpPort: mail.port }); });
test.afterEach(async () => { await f.close(); await new Promise(resolve => mail.server.close(resolve)); });

for (const width of [390, 1440]) {
  test('new email signup returns to the same CLI authorization at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const authorization = f.auth.issueDeviceAuthorization({ displayName: 'Fresh laptop' });
    const target = '/cloud/authorize?user_code=' + authorization.userCode;
    await page.goto(f.origin + target);
    await expect(page).toHaveURL(/cloud\/sign-in/);
    await page.getByLabel('Email address', { exact: true }).fill('fresh-cli@example.test');
    await page.locator('#email-form').getByRole('button').click();
    await expect.poll(() => mail.messages.length).toBe(1);
    const text = decodeMimeParts(mail.messages[0]).map(part => part.body).join('\n');
    await page.locator('#code').fill(text.match(/\b\d{6}\b/)[0]);
    await page.locator('#code-form').getByRole('button').click();
    await expect(page).toHaveURL(/cloud\/terms/);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /accept|continue/i }).click();
    await expect(page).toHaveURL(/cloud\/profile/);
    await page.getByLabel('First name').fill('Fresh');
    await page.getByLabel('Last name').fill('Person');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page).toHaveURL(f.origin + target);
    await expect(page.getByLabel('Authorization code')).toHaveValue(authorization.userCode);
    await expect(page.locator('#authorization-detail')).toContainText('Fresh laptop');
    await page.getByRole('button', { name: 'Authorize CLI', exact: true }).click();
    await expect(page.locator('#authorization-result')).toHaveText('CLI authorized. You can return to the terminal.');
    const token = f.auth.pollDeviceAuthorization({ deviceCode: authorization.deviceCode });
    expect(token.ok).toBe(true);
    const headers = { Authorization: 'Bearer ' + token.accessToken };
    const account = await page.request.get(f.origin + '/api/cloud/v1/account', { headers });
    expect((await account.json()).account.can_create_document).toBe(true);
    const saved = await page.request.post(f.origin + '/api/cloud/v1/account/documents', { headers, data: {
      filename: 'first.md', markdown: '# Ready after signup', idempotency_key: 'first-cli-document' } });
    expect(saved.status()).toBe(201);
    expect(f.store.listWorkspaceMemberships(token.userId)).toHaveLength(1);
    expect(f.billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id=?').get(token.userId).n).toBe(1);
    const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  });
}

test('email signup verifies the delivered code, captures a profile and reaches Install with one library', async ({ page }) => {
  await page.goto(f.origin + '/');
  const form = page.locator('[data-install-form]').first();
  await form.locator('input[type=email]').fill('new-human@example.com');
  await form.getByRole('button', { name: 'Get install prompt' }).click();
  await expect(page).toHaveURL(/cloud\/sign-in/);
  await expect(page.locator('#code-view')).toBeVisible();
  await expect.poll(() => mail.messages.length).toBe(1);
  const text = decodeMimeParts(mail.messages[0]).map(part => part.body).join('\n');
  const code = text.match(/\b\d{6}\b/)[0];
  await page.locator('#code').fill(code);
  await page.locator('#code-form').getByRole('button', { name: /sign in|verify|continue/i }).click();
  await expect(page).toHaveURL(/cloud\/terms/);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /accept|continue/i }).click();
  await expect(page).toHaveURL(/cloud\/profile/);
  await page.getByLabel('First name').fill('Robin');
  await page.getByLabel('Last name').fill('Walker');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/cloud\/admin\?panel=install/);
  await expect(page.locator('body')).toContainText('Robin Walker');
  await expect(page.locator('#install-prompt')).toContainText('My library is "Robin Walker".');
  await expect(page.locator('#install-prompt')).toContainText('Create one short getting-started document');
  await expect(page.locator('#install-prompt')).toContainText('where I complete cancellation');
  const response = await page.request.get(f.origin + '/api/cloud/v1/workspaces');
  const data = await response.json();
  expect(data.workspaces).toHaveLength(1);
  await page.goto(f.origin + '/cloud/start');
  await expect(page).toHaveURL(/cloud\/admin\?panel=install/);
  const again = await page.request.get(f.origin + '/api/cloud/v1/workspaces');
  expect((await again.json()).workspaces).toHaveLength(1);
  await expect(page.locator('body')).not.toContainText('Preview only');
  // Authorize a real CLI connection using the session created by email verification.
  const issued = await (await page.request.post(f.origin + '/api/cloud/v1/cli/device-authorizations', { data: { display_name: 'Robins laptop' } })).json();
  const approved = await page.request.post(f.origin + '/api/cloud/v1/cli/device-authorizations/approve', { headers: { Origin: f.origin }, data: { user_code: issued.user_code } });
  expect(approved.ok()).toBe(true);
  const token = await (await page.request.post(f.origin + '/api/cloud/v1/cli/device-authorizations/token', { data: { device_code: issued.device_code } })).json();
  expect(token.ok).toBe(true);
  const fs = require('fs'), path = require('path');
  const state = path.join(f.dir, 'cli-state');
  fs.mkdirSync(path.join(state, 'cloud'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(state, 'cloud', 'credentials.json'), JSON.stringify({ [f.origin]: token }), { mode: 0o600 });
  const markdown = path.join(f.dir, 'first.md');
  fs.writeFileSync(markdown, '# First Cloud document\n\nSaved from the CLI.');
  const execFile = require('util').promisify(require('child_process').execFile);
  const defaultLibrary = JSON.parse((await execFile(process.execPath, [path.join(__dirname, '../cli/bin/sdocs-dev.js'),
    'cloud', 'library-default', data.workspaces[0].id, '--json'], { env: { ...process.env, SDOCS_HOME: state,
      SDOCS_CLOUD_URL: f.origin, SDOCS_CLOUD_FILE_CREDENTIALS: '1', SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', SDOCS_NO_UPDATE_CHECK: '1' } })).stdout);
  expect(defaultLibrary.ok).toBe(true);
  expect(defaultLibrary.workspace_id).toBe(data.workspaces[0].id);
  const save = async () => JSON.parse((await execFile(process.execPath, [path.join(__dirname, '../cli/bin/sdocs-dev.js'), markdown,
    '--cloud', '--url', f.origin, '--no-open', '--json'], { env: { ...process.env, SDOCS_HOME: state,
      SDOCS_CLOUD_URL: f.origin, SDOCS_CLOUD_FILE_CREDENTIALS: '1' } })).stdout);
  const first = await save();
  expect(first.ok).toBe(true);
  expect(first.url).toBe(f.origin + '/docs?cloud-document=' + first.document_id);
  fs.appendFileSync(markdown, '\n\nA second revision.');
  const second = await save();
  expect(second.url).toBe(first.url);
  expect(second.revision_id).not.toBe(first.revision_id);
  await page.goto(second.url);
  await expect(page.getByText('A second revision.', { exact: true })).toBeVisible();
  await page.goto(f.origin + '/cloud/admin?panel=machines');
  await expect(page.locator('body')).toContainText('Robins laptop');
});

test('homepage email Log in verifies the code and opens the Library', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(f.origin + '/');
  await page.getByRole('link', { name: 'Log in', exact: true }).click();
  await page.getByLabel('Email address', { exact: true }).fill('login-person@example.test');
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect.poll(() => mail.messages.length).toBe(1);
  const text = decodeMimeParts(mail.messages[0]).map(part => part.body).join('\n');
  await page.locator('#code').fill(text.match(/\b\d{6}\b/)[0]);
  await page.locator('#code-form').getByRole('button').click();
  await expect(page).toHaveURL(/cloud\/terms/);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /agree|continue/i }).click();
  await expect(page).toHaveURL(/cloud\/profile/);
  await page.getByLabel('First name').fill('Robin');
  await page.getByLabel('Last name').fill('Walker');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
});
