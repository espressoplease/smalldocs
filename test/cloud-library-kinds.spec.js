const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { await f.close(); });
async function login(page, actor) {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
}
async function save(actor, workspaceId, name) {
  const result = await f.api(actor, '/api/cloud/v1/account/documents', 'POST', {
    account_id: workspaceId, filename: name + '.md', markdown: '# ' + name, idempotency_key: name });
  expect(result.status).toBe(201);
  return result.data.document;
}
for (const width of [390, 1440]) {
  test('Personal leads to team creation and all surfaces share library colours at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page, 'josh');
    await page.goto(f.origin + '/library?scope=cloud');
    await expect(page.locator('#workspace-button')).toContainText('Personal');
    await expect(page.locator('#workspace-button [data-library-kind="personal"]')).toBeVisible();
    await expect(page.locator('#personal-library-note')).toContainText('for you only');
    const personal = (await f.store.listWorkspaces(f.users.josh.id))[0];
    const document = await save('josh', personal.id, 'Private notes');
    const personalColor = await page.locator('#workspace-button .workspace-mark').evaluate(el => getComputedStyle(el).color);
    await page.locator('#workspace-button').click();
    const create = page.locator('#workspace-menu').getByRole('menuitem', { name: 'Create team library', exact: true });
    await expect(create).toHaveAttribute('href', '/library/settings?panel=libraries&workspace=' + personal.id);
    await create.click();
    await page.getByRole('textbox', { name: 'Library name', exact: true }).fill('Northstar Engineering');
    await page.getByRole('button', { name: 'Create team library', exact: true }).click();
    await expect(page.locator('#workspace-button')).toContainText('Northstar Engineering');
    await expect(page.locator('#workspace-button [data-library-kind="team"]')).toBeVisible();
    const teamId = new URL(page.url()).searchParams.get('workspace');
    const research = await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Northstar Research' });
    expect(research.status).toBe(201);
    await page.goto(f.origin + '/library?scope=cloud&workspace=' + teamId);
    await expect(page.locator('#workspace-button')).toContainText('Northstar Engineering');
    await expect(page.locator('#personal-library-note')).toBeHidden();
    await page.locator('#workspace-button').click();
    const menu = page.locator('#workspace-menu');
    await expect(menu.locator('[data-library-kind="personal"]')).toHaveCount(1);
    await expect(menu.locator('[data-library-kind="team"]')).toHaveCount(2);
    const colors = await menu.locator('.workspace-mark').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).color));
    expect(new Set(colors).size).toBe(3);
    await menu.getByRole('menuitem', { name: 'Personal', exact: true }).click();
    await expect(page.locator('#personal-library-note')).toBeVisible();
    expect(await page.locator('#workspace-button .workspace-mark').evaluate(el => getComputedStyle(el).color)).toBe(personalColor);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto(f.origin + '/docs?cloud-document=' + document.id);
    const pill = page.locator('[data-cloud-open="library"]');
    await expect(pill).toContainText('Personal');
    await expect(pill.locator('svg')).toHaveCSS('color', personalColor);
    await page.goto(f.origin + '/cloud/admin?panel=people&workspace_id=' + personal.id);
    await expect(page.locator('[data-panel="people"]')).toBeHidden();
    await expect(page.locator('#invite-open')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test('a document in the only Personal library shows its destination and a team creation action at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page, 'josh');
    const setup = await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
    const personalId = setup.data.workspaces[0].id;
    expect(await f.store.listWorkspaces(f.users.josh.id)).toHaveLength(1);
    const document = await save('josh', personalId, 'Solo destination');
    const permission = f.store.getDocumentPermission({ userId: f.users.josh.id, documentId: document.id });
    await page.goto(f.origin + '/docs?cloud-document=' + document.id);
    const pill = page.getByRole('button', { name: 'Library: Personal', exact: true });
    await expect(pill).toBeVisible();
    const row = page.locator('.sdoc-cloud-lab-pills');
    await expect(row.locator('button').first()).toHaveAttribute('data-cloud-open', 'library');
    await pill.click();
    const panel = page.locator('#_sd_cloud-lab-panel');
    await expect(panel.locator('[data-library-choice]')).toHaveCount(1);
    await expect(panel.locator('[data-library-choice]')).toContainText('Personal');
    const create = panel.getByRole('link', { name: 'Create team library', exact: true });
    await expect(create).toHaveAttribute('href', '/library/settings?panel=libraries&workspace=' + personalId);
    await expect(create).toHaveClass('sdoc-panel-action');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await create.click();
    await page.getByRole('textbox', { name: 'Library name', exact: true }).fill('First team');
    await page.getByRole('button', { name: 'Create team library', exact: true }).click();
    await expect(page.locator('#workspace-button')).toContainText('First team');
    expect(await f.store.listWorkspaces(f.users.josh.id)).toHaveLength(2);
    expect(f.store.getDocumentContext({ userId: f.users.josh.id, documentId: document.id }).workspaceId).toBe(personalId);
    expect(f.store.getDocumentPermission({ userId: f.users.josh.id, documentId: document.id }).member_user_ids).toEqual(permission.member_user_ids);
    await page.goto(f.origin + '/docs?cloud-document=' + document.id);
    await expect(page.getByRole('button', { name: 'Library: Personal', exact: true })).toBeVisible();
  });
  test('an invite opens the team and also provisions one private Personal library at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const invitation = await f.store.createInvitation({ userId: f.users.bob.id, workspaceId: f.team.workspaceId,
      email: f.users.gmail.email, projectGrants: [{ projectId: f.team.projectId, role: 'editor' }] });
    await login(page, 'gmail');
    await page.goto(f.origin + '/cloud/invite?token=' + encodeURIComponent(invitation.token));
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page).toHaveURL(/panel=install&workspace_id=/);
    await expect(page.locator('#install-methods')).toHaveAttribute('data-library-id', f.team.workspaceId);
    await expect(page.locator('#install-prompt')).toContainText("Joe's engineering");
    const libraries = await f.store.listWorkspaces(f.users.gmail.id);
    expect(libraries).toHaveLength(2);
    const personal = libraries.find(workspace => workspace.kind === 'personal');
    expect(personal.name).toBe('Personal');
    await page.goto(f.origin + '/library/settings?workspace=' + f.team.workspaceId);
    await page.locator('#workspace-button').click();
    await expect(page.locator('#workspace-menu [data-library-kind="personal"]')).toBeVisible();
    await page.locator('#workspace-menu').getByRole('menuitem', { name: 'Personal', exact: true }).click();
    await expect(page.locator('[data-panel="people"]')).toBeHidden();
    await page.reload();
    expect((await f.store.listWorkspaces(f.users.gmail.id)).filter(workspace => workspace.kind === 'personal')).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
