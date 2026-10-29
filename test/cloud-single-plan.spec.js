const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { await f.close(); });
async function login(page, actor = 'josh') {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
}
for (const width of [390, 1440]) {
  test('signup and library management remain in settings without a choice page at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, 'missing');
    await page.goto(f.origin + '/cloud/profile');
    await page.getByLabel('First name').fill('Taylor');
    await page.getByLabel('Last name').fill('Example');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Your SmallDocs libraries');
    await page.getByRole('button', { name: 'Libraries', exact: true }).click();
    await page.getByRole('textbox', { name: 'Library name', exact: true }).fill('Engineering');
    await page.getByRole('button', { name: 'Create team library', exact: true }).click();
    await expect(page.locator('#account-switcher-name')).toHaveText('Engineering');
    expect((await f.store.listWorkspaces(f.users.missing.id)).length).toBe(2);
    await page.goto(f.origin + '/cloud/admin?panel=libraries');
    await expect(page.getByRole('heading', { name: 'Libraries', exact: true })).toBeVisible();
    await expect(page.locator('#all-libraries')).toContainText('Engineering');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test('Library pill opens the shared right panel, updates a computer default and moves privately at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    const initial = await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
    const originalId = initial.data.workspaces[0].id;
    const second = await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Engineering' });
    const destinationId = second.data.workspace.workspaceId;
    const saved = await f.api('josh', '/api/cloud/v1/account/documents', 'POST', { account_id: originalId, markdown: '# Library selection\n\nKeep this document private.', filename: 'library.md', idempotency_key: 'library-ui' });
    const id = saved.data.document.id;
    const device = f.auth.issueDeviceAuthorization({ displayName: 'Joshs computer' });
    f.auth.approveDeviceAuthorization({ userCode: device.userCode, userId: f.users.josh.id });
    const credential = f.auth.pollDeviceAuthorization({ deviceCode: device.deviceCode });
    await page.goto(f.origin + '/docs?cloud-document=' + id);
    await expect.poll(() => page.evaluate(() => window.SDocs && window.SDocs.cloudDocument && window.SDocs.cloudDocument.id)).toBe(id);
    await page.evaluate(() => window.SDocs.renderFileInfoCard());
    const pill = page.locator('[data-cloud-open="library"]');
    await expect(pill).toBeVisible();
    const color = await pill.locator('svg').evaluate(el => getComputedStyle(el).color);
    await pill.click();
    const panel = page.locator('#_sd_cloud-lab-panel');
    await expect(panel.locator('[data-cloud-panel-title]')).toHaveText('Library');
    await panel.locator('[data-library-machine]').selectOption(destinationId);
    await expect(panel).toContainText('Default library updated.');
    expect(f.store.machineLibraryDefault(f.users.josh.id, credential.credentialId)).toBe(destinationId);
    // A default change must not move the open file.
    expect(f.store.getDocumentContext({ userId: f.users.josh.id, documentId: id }).workspaceId).toBe(originalId);
    await panel.locator('[data-library-choice="' + destinationId + '"]').click();
    await expect(panel).toContainText('Access will be reset to Only you');
    await panel.getByRole('button', { name: 'Move document', exact: true }).click();
    await expect(panel).toContainText('Document moved. Access is Only you.');
    expect(new URL(page.url()).searchParams.get('cloud-document')).toBe(id);
    await expect(pill).toContainText('Engineering');
    expect(await pill.locator('svg').evaluate(el => getComputedStyle(el).color)).not.toBe('');
    const permission = f.store.getDocumentPermission({ userId: f.users.josh.id, documentId: id });
    expect(permission.member_user_ids).toEqual([f.users.josh.id]);
    // Close and reopen uses the same assigned color, without a dropdown arrow.
    const colorAfter = await pill.locator('svg').evaluate(el => getComputedStyle(el).color);
    await page.keyboard.press('Escape'); await pill.click();
    expect(await pill.locator('svg').evaluate(el => getComputedStyle(el).color)).toBe(colorAfter);
    expect(color).toMatch(/^rgb/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const width of [390, 1440]) {
  test('subscription shows the real free trial and reuses sign-in styling at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    // A direct OAuth return to settings must create a library without a payment step.
    await page.goto(f.origin + '/cloud/admin?panel=install');
    await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
    const trial = f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.josh.id);
    expect(trial).toBeTruthy();
    await page.goto(f.origin + '/cloud/subscribe');
    await expect(page.locator('#subscription-state')).toContainText('Your free trial ends on');
    const subscribe = page.getByRole('button', { name: 'Subscribe', exact: true });
    await expect(subscribe).toBeVisible();
    await expect(subscribe).toHaveClass('primary-button');
    await expect(page.locator('.primary-button:visible')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Back to library', exact: true })).toHaveAttribute('href', '/library?scope=cloud');
    await expect(page.locator('#subscription-legal')).toContainText('immediately');
    expect(await page.locator('h1').evaluate(el => getComputedStyle(el).fontSize)).toBe('18px');
    expect(await page.locator('.auth-card').evaluate(el => getComputedStyle(el).borderRadius)).toBe('10px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Back to library', exact: true }).click();
    await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
    await page.goto(f.origin + '/cloud/subscribe');
    await page.getByRole('link', { name: 'Back to settings' }).click();
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    await expect(page.locator('#billing-status')).toContainText('Free until');
    expect(f.billing.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.josh.id).ends_at_ms).toBe(trial.ends_at_ms);
  });
}
test('expired trial offers payment with a readable error and retains the library', async ({ page }) => {
  await login(page);
  await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now() - 1, f.users.josh.id);
  await page.goto(f.origin + '/cloud/subscribe');
  await expect(page.locator('#subscription-state')).toContainText('Your free trial has ended');
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(page.locator('#subscribe-status')).toContainText('Payment could not be opened');
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeEnabled();
});
test('paid accounts cannot accidentally start a second subscription from the page', async ({ page }) => {
  await login(page, 'returning');
  await page.goto(f.origin + '/cloud/admin?panel=install');
  // Initialize coverage through the same billing access used by the app.
  await f.api('returning', '/api/cloud/v1/account/documents', 'POST', { account_id: f.personal.workspaceId, filename: 'existing.md', markdown: '# Existing', idempotency_key: 'paid-summary' });
  await page.goto(f.origin + '/cloud/subscribe');
  await expect(page.locator('#subscription-state')).toContainText('Your subscription is active');
  await expect(page.locator('#subscribe')).toBeHidden();
});

test('first sign-in through the library starts a free trial instead of offering a plan', async ({ page }) => {
  await login(page, 'gmail');
  await page.goto(f.origin + '/library?scope=cloud');
  await expect(page).toHaveURL(/library\?scope=cloud/);
  await expect(page.locator('.sdocs-site-sidebar').getByRole('link', { name: 'Library', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/subscribe|checkout/);
  expect((await f.store.listWorkspaces(f.users.gmail.id)).length).toBe(1);
  const summary = await f.api('gmail', '/api/cloud/billing/subscription');
  expect(summary.data.trial_active).toBe(true);
});

test('cancelling an early subscription does not claim a future trial deadline has passed', async ({ page }) => {
  await login(page);
  const setup = await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  f.billing.upsertSubscription({ workspaceId: setup.data.workspaces[0].id, plan: 'team', status: 'canceled', provider: 'manual' });
  await page.goto(f.origin + '/cloud/subscribe');
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible();
  await expect(page.locator('#subscription-state')).not.toContainText('trial has ended');
  await expect(page.locator('#subscription-state')).toContainText('Subscribe again to save changes');
});
