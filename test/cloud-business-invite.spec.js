const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { await f.close(); });

for (const width of [390, 1440]) {
  test('old invitation link preserves acceptance through profile capture at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const invitation = await f.store.createInvitation({ userId: f.users.bob.id, workspaceId: f.team.workspaceId,
      email: f.users.missing.email, projectGrants: [{ projectId: f.team.projectId, role: 'editor' }] });
    await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.missing.sessionToken, url: f.origin }]);
    await page.goto(f.origin + '/cloud/business-invite?token=' + invitation.token);
    await expect(page).toHaveURL(/cloud\/profile\?return=/);
    await page.getByLabel('First name').fill('Morgan');
    await page.getByLabel('Last name').fill('Example');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: "Join Joe's engineering" })).toBeVisible();
    await expect(page.getByLabel('First name')).toBeHidden();
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page.locator('#account-switcher-name')).toHaveText("Joe's engineering");
    expect(f.store.listWorkspaceMemberships(f.users.missing.id)).toHaveLength(1);
    expect(f.billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.missing.id).n).toBe(0);
  });
}

test('old expired links offer normal invitation recovery without an acceptance form', async ({ page }) => {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/cloud/business-invite?token=expired-token');
  await expect(page.getByRole('heading', { name: 'Invitation unavailable' })).toBeVisible();
  await expect(page.locator('#accept-invite')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Use another email' })).toBeVisible();
});
