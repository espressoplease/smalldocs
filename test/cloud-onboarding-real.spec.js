const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let fixture;
test.beforeEach(async () => { fixture = await startFixture(); });
test.afterEach(async () => { await fixture.close(); });
async function signIn(context, actor) {
  await context.addCookies([{ name: 'sdocs_cloud', value: fixture.users[actor].sessionToken, url: fixture.origin }]);
}
for (const width of [390, 1440]) {
  test('new email user completes details, provisions a trial and reaches Install at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page.context(), 'missing');
    await page.goto(fixture.origin + '/cloud/profile');
    await expect(page.locator('#profile-email')).toHaveText('new@joes.com');
    await page.getByLabel('First name').fill('Taylor');
    await page.getByLabel('Last name').fill('Example');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
    await expect(page.locator('#account-switcher')).toBeVisible();
    await expect(page.locator('#account-switcher-name')).toHaveText('Taylor Example');
    await expect(page.locator('#install-prompt')).toContainText('--account ');
    await expect(page.locator('#account-label')).toHaveText('Taylor Example · new@joes.com');
    await page.getByRole('button', { name: 'Billing', exact: true }).click();
    await expect(page.locator('#billing-status')).toContainText('Free until');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('returning user skips details and keeps the existing account', async ({ page }) => {
  await signIn(page.context(), 'returning');
  await page.goto(fixture.origin + '/cloud/profile');
  await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
  await expect(page.locator('#account-switcher-name')).toHaveText('Alex Example');
  await expect(page).toHaveURL(new RegExp('workspace_id=' + fixture.personal.workspaceId));
  expect(fixture.billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials').get().n).toBe(0);
});
test('existing personal user can choose team setup without being promised another free trial', async ({ page }) => {
  await signIn(page.context(), 'returning');
  await page.goto(fixture.origin + '/cloud/start?choose=1');
  await expect(page.getByRole('button', { name: 'Open my library', exact: true })).toBeVisible();
  await expect(page.locator('#personal-copy')).toContainText('unchanged');
  await page.getByRole('button', { name: 'Open my library', exact: true }).click();
  await expect(page.locator('#account-switcher')).toBeVisible();
  expect(fixture.billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials').get().n).toBe(0);
});
test('private request leads to a named invitation, explicit acceptance and the team Install screen', async ({ page, browser }) => {
  await signIn(page.context(), 'josh');
  await page.goto(fixture.origin + '/cloud/start?choose=1');
  await page.getByRole('button', { name: 'Request to join a team at joes.com', exact: true }).click();
  await page.getByLabel('Anything else? (optional)').fill('I work with the engineering team.');
  await page.locator('#request-consent').check();
  await page.getByRole('button', { name: 'Create request link' }).click();
  await expect(page.getByRole('heading', { name: 'Your request link' })).toBeVisible();
  const requestUrl = await page.getByRole('textbox', { name: 'Your request link' }).inputValue();
  expect(await page.locator('body').innerText()).not.toContain("Joe's engineering");
  expect(await page.locator('body').innerText()).not.toContain('bob@joes.com');
  const adminContext = await browser.newContext();
  await signIn(adminContext, 'bob');
  const admin = await adminContext.newPage();
  await admin.goto(requestUrl);
  await expect(admin.locator('#requester-email')).toHaveText('josh@joes.com');
  await admin.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(admin.locator('#invite-link')).toBeVisible();
  const inviteUrl = await admin.locator('#invite-link').inputValue();
  expect(fixture.store.listWorkspaceMemberships(fixture.users.josh.id)).toHaveLength(1);
  await page.goto(inviteUrl);
  await expect(page.getByRole('heading', { name: "Join Joe's engineering" })).toBeVisible();
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
  await expect(page.locator('#account-switcher-name')).toHaveText("Joe's engineering");
  expect(fixture.billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials').get().n).toBe(1);
  await adminContext.close();
});
test('new invitee preserves the invitation through name capture without creating a personal trial', async ({ page }) => {
  const invitation = await fixture.store.createInvitation({ userId: fixture.users.bob.id, workspaceId: fixture.team.workspaceId,
    email: fixture.users.missing.email, projectGrants: [{ projectId: fixture.team.projectId, role: 'editor' }] });
  await signIn(page.context(), 'missing');
  await page.goto(fixture.origin + '/cloud/invite?token=' + invitation.token);
  await expect(page).toHaveURL(/cloud\/profile\?return=/);
  await page.getByLabel('First name').fill('Morgan');
  await page.getByLabel('Last name').fill('Example');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: "Join Joe's engineering" })).toBeVisible();
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.locator('#account-switcher-name')).toHaveText("Joe's engineering");
  expect(fixture.billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials').get().n).toBe(0);
});
test('shared email provider offers invitations without a company request directory', async ({ page }) => {
  await signIn(page.context(), 'gmail');
  await page.goto(fixture.origin + '/cloud/start?choose=1');
  await expect(page.locator('#shared-email-help')).toBeVisible();
  await expect(page.locator('#show-team-request')).toBeHidden();
});

for (const width of [390, 1440]) {
  test('trial user upgrades the same library with unchanged private access at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page.context(), 'josh');
    await page.goto(fixture.origin + '/cloud/start');
    await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
    const workspace = (await fixture.store.listWorkspaces(fixture.users.josh.id))[0];
    const expiry = fixture.billing.computeEntitlements(workspace.id).trialEndsAtMs;
    await page.getByRole('link', { name: 'Join or create a team', exact: true }).click();
    await page.getByRole('button', { name: 'Create a team', exact: true }).click();
    await page.getByLabel('Team name', { exact: true }).fill('Engineering');
    await page.getByRole('button', { name: 'Review team upgrade', exact: true }).click();
    await expect(page.locator('#upgrade-access')).toContainText('0 documents');
    await expect(page.locator('#upgrade-billing')).toContainText('original trial deadline');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Create team', exact: true }).click();
    await expect(page.locator('#account-switcher-name')).toHaveText('Engineering');
    expect((await fixture.store.listWorkspaces(fixture.users.josh.id)).map(w => w.id)).toEqual([workspace.id]);
    expect(fixture.billing.computeEntitlements(workspace.id).trialEndsAtMs).toBe(expiry);
    await page.goto(fixture.origin + '/cloud/start');
    await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
    expect((await fixture.store.listWorkspaces(fixture.users.josh.id)).length).toBe(1);
  });
}
