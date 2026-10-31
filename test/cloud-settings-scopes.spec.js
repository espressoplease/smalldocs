const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f, personal, team, second;
test.beforeEach(async ({ page }) => {
  f = await startFixture({ singlePlan: true });
  await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  personal = (await f.store.listWorkspaces(f.users.josh.id)).find(l => l.kind === 'personal');
  team = (await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Northstar Engineering' })).data.workspace;
  second = (await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Northstar Research' })).data.workspace;
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
});
test.afterEach(async () => { await f.close(); });
for (const width of [390, 1440]) {
  test('library management retains the documents header and selected library at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(f.origin + '/library?scope=cloud&workspace=' + team.workspaceId);
    await expect(page.locator('#workspace-button')).toContainText('Northstar Engineering');
    const box = await page.locator('#workspace-button').boundingBox();
    const colour = await page.locator('#workspace-button .workspace-mark').evaluate(n => getComputedStyle(n).color);
    await page.getByRole('link', { name: 'Manage members', exact: true }).click();
    await expect(page.locator('#panel-people')).toBeVisible();
    await expect(page.locator('#workspace-button')).toContainText('Northstar Engineering');
    const managed = await page.locator('#workspace-button').boundingBox();
    expect(Math.abs(managed.x - box.x)).toBeLessThan(1);
    expect(Math.abs(managed.y - box.y)).toBeLessThan(1);
    expect(Math.abs(managed.width - box.width)).toBeLessThan(1);
    expect(await page.locator('#workspace-button .workspace-mark').evaluate(n => getComputedStyle(n).color)).toBe(colour);
    await expect(page.getByRole('button', { name: 'Billing', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Library settings', exact: true }).click();
    await expect(page.locator('#panel-overview')).toBeVisible();
    await expect(page.locator('#library-settings-name')).toHaveText('Northstar Engineering');
    await expect(page.getByRole('button', { name: 'Delete library', exact: true })).toBeVisible();
    await page.locator('#workspace-button').click();
    await page.getByRole('menuitem', { name: 'Northstar Research', exact: true }).click();
    await expect(page.locator('#library-settings-name')).toHaveText('Northstar Research');
    await expect(page.locator('#library-documents-link')).toHaveAttribute('href', '/library?scope=cloud&workspace=' + second.workspaceId);
    await page.locator('#library-documents-link').click();
    await expect(page.locator('#workspace-button')).toContainText('Northstar Research');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('account settings loads billing without listing any library documents or members', async ({ page }) => {
  const paths = [];
  page.on('request', r => { if (r.url().includes('/api/cloud/')) paths.push(new URL(r.url()).pathname); });
  await page.goto(f.origin + '/cloud/admin?panel=billing&workspace_id=' + f.otherTeam.workspaceId);
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
  await expect(page.locator('#billing-status')).toContainText('free trial');
  await expect(page.locator('#library-header')).toBeHidden();
  await expect(page.locator('#account-switcher')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Members', exact: true })).toHaveCount(0);
  expect(paths).not.toContain('/api/cloud/v1/workspaces');
  expect(paths).not.toContain('/api/cloud/v1/documents');
  expect(paths).not.toContain('/api/cloud/v1/account/members');
  await page.getByRole('button', { name: 'Connected machines', exact: true }).click();
  await expect(page.locator('#panel-machines')).toBeVisible();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.locator('#panel-preferences')).toBeVisible();
  expect(paths).not.toContain('/api/cloud/v1/workspaces');
});
test('Personal has private settings and an outsider cannot select another company library', async ({ page }) => {
  await page.goto(f.origin + '/library/settings?panel=people&workspace=' + personal.id);
  await expect(page.locator('#library-settings-name')).toHaveText('Personal');
  await expect(page.locator('#manage-members-link')).toBeHidden();
  await expect(page.locator('[data-panel=people]')).toBeHidden();
  await expect(page.locator('#workspace-lifecycle')).toBeHidden();
  await page.goto(f.origin + '/library/settings?workspace=' + f.otherTeam.workspaceId);
  await expect(page.locator('#page-error')).toBeVisible();
  await expect(page.locator('#library-settings-name')).toBeEmpty();
  await expect(page.locator('#member-rows')).toBeEmpty();
  await expect(page.locator('#all-libraries')).not.toContainText('Other team');
});
test('member settings use the member role and legacy links retain their library', async ({ page }) => {
  const redirect = await f.api('josh', '/cloud/admin?panel=people&workspace_id=' + team.workspaceId);
  expect(redirect.status).toBe(303);
  expect(redirect.headers.get('location')).toBe('/library/settings?panel=people&workspace=' + team.workspaceId);
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.member.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/library/settings?panel=people&workspace=' + f.team.workspaceId);
  await expect(page.locator('#panel-people')).toBeVisible();
  await expect(page.locator('#domain-form')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Library settings', exact: true }).click();
  await expect(page.locator('#workspace-lifecycle')).toBeHidden();
});
test('recovery only requests and shows deleted documents from the selected library', async ({ page }) => {
  const deleted = [];
  for (const [id, filename] of [[team.workspaceId, 'Engineering notes.md'], [second.workspaceId, 'Research notes.md']]) {
    const response = await f.api('josh', '/api/cloud/v1/account/documents', 'POST', { account_id: id, filename, markdown: '# ' + filename, idempotency_key: filename });
    expect(response.status).toBe(201);
    f.store.deleteDocument({ userId: f.users.josh.id, documentId: response.data.document.id, expectedHeadRevisionId: response.data.document.current_revision_id });
    deleted.push(response.data.document);
  }
  await page.goto(f.origin + '/library/settings?workspace=' + team.workspaceId);
  await expect(page.locator('#recovery-list')).toContainText('Engineering notes');
  await expect(page.locator('#recovery-list')).not.toContainText('Research notes');
  await page.locator('#recovery-list').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('#recovery-list')).not.toContainText('Engineering notes');
  expect((await f.api('josh', '/api/cloud/v1/documents/' + deleted[0].id)).status).toBe(200);
});
test('changing section while membership is loading ignores the older response', async ({ page }) => {
  await page.goto(f.origin + '/library/settings?workspace=' + team.workspaceId);
  await expect(page.locator('#library-settings-name')).toHaveText('Northstar Engineering');
  let release, requested;
  const seen = new Promise(resolve => { requested = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/cloud/v1/account/members?**', async route => { requested(); await pending; await route.continue(); });
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await seen;
  await page.getByRole('button', { name: 'Library settings', exact: true }).click();
  await expect(page.locator('#library-settings-name')).toBeVisible();
  release();
  await expect(page.locator('#panel-overview')).toBeVisible();
  await expect(page.locator('#panel-people')).toBeHidden();
  await expect(page.locator('#recovery-list')).toContainText('No deleted items');
});
test('restoring a deleted Team library reopens its own settings and header', async ({ page }) => {
  f.store.deleteWorkspace({ userId: f.users.josh.id, workspaceId: second.workspaceId });
  await page.goto(f.origin + '/library/settings?panel=libraries&workspace=' + team.workspaceId);
  await expect(page.locator('#recovery-list')).toContainText('Northstar Research');
  await page.locator('#recovery-list').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('#workspace-button')).toContainText('Northstar Research');
  await expect(page.locator('#library-settings-name')).toHaveText('Northstar Research');
});
test('unpaid account settings and CLI installation do not reset the trial or depend on a paid library', async ({ page }) => {
  f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now() - 8 * 86400000, f.users.josh.id);
  const before = f.billing.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.josh.id).ends_at_ms;
  await page.goto(f.origin + '/cloud/admin');
  await expect(page.locator('#billing-status')).toContainText('Subscribe to continue');
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.locator('#install-destination').selectOption(team.workspaceId);
  await expect(page.locator('#install-prompt')).toContainText(team.workspaceId);
  await expect(page.locator('#install-prompt')).toContainText('Northstar Engineering');
  await page.getByRole('button', { name: 'Billing', exact: true }).click();
  await expect(page.locator('#billing-status')).toContainText('Subscribe to continue');
  expect(new URL(page.url()).searchParams.has('workspace_id')).toBe(false);
  expect(f.billing.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.josh.id).ends_at_ms).toBe(before);
});
