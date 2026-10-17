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
    await page.getByRole('button', { name: 'Create library', exact: true }).click();
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

test('one-plan subscription page has no personal/team choice', async ({ page }) => {
  await login(page);
  await page.goto(f.origin + '/cloud/subscribe');
  await expect(page.getByRole('heading', { name: 'SmallDocs, all features' })).toBeVisible();
  await expect(page.locator('#checkout-personal')).toHaveCount(0);
  await expect(page.locator('#checkout-team')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('status')).toContainText('Payment setup is unavailable');
});
