const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f, engineering, research;
test.beforeEach(async ({ context }) => {
  f = await startFixture({ singlePlan: true });
  await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  engineering = (await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Northstar Engineering' })).data.workspace.workspaceId;
  research = (await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Northstar Research' })).data.workspace.workspaceId;
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
});
test.afterEach(async () => { await f.close(); });
for (const width of [390, 1440]) {
  test('signed-in root returns to the most recently selected library without asking for login at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(f.origin + '/library?scope=cloud&workspace=' + engineering);
    await expect(page.locator('#workspace-button')).toContainText('Northstar Engineering');
    await page.locator('#workspace-button').click();
    await page.getByRole('menuitem', { name: 'Northstar Research', exact: true }).click();
    await expect(page.locator('#workspace-button')).toContainText('Northstar Research');
    const signInRequests = [];
    page.on('request', request => { if (/\/cloud\/sign-in|\/api\/cloud\/auth\/oauth\//.test(request.url())) signInRequests.push(request.url()); });
    await page.goto(f.origin + '/');
    await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
    await expect(page.locator('#workspace-button')).toContainText('Northstar Research');
    expect(signInRequests).toEqual([]);
    await page.reload();
    await expect(page.locator('#workspace-button')).toContainText('Northstar Research');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('explicit marketing pages and anchors remain available and offer Open library when signed in', async ({ page }) => {
  for (const path of ['/home', '/home-next', '/#learn']) {
    await page.goto(f.origin + path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('document format and library');
    const link = page.getByRole('link', { name: 'Open library', exact: true });
    await expect(link).toHaveAttribute('href', '/library?scope=cloud');
    await expect(page.getByRole('link', { name: 'Log in', exact: true })).toHaveCount(0);
  }
});
test('signed-out or expired sessions stay on the homepage instead of entering a sign-in loop', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(f.origin + '/');
  await expect(page).toHaveURL(f.origin + '/');
  await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET expires_at_ms=? WHERE user_id=?').run(Date.now() - 1, f.users.josh.id);
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
  await page.reload();
  await expect(page).toHaveURL(f.origin + '/');
  await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
});
test('root document fragments still open the reader ahead of remembered library routing', async ({ page }) => {
  await page.goto(f.origin + '/library?scope=cloud&workspace=' + engineering);
  await expect(page.locator('#workspace-button')).toContainText('Northstar Engineering');
  const encoded = zlib.brotliCompressSync(Buffer.from('# A shared document\n\nKeep this document destination.')).toString('base64url');
  await page.goto(f.origin + '/#md=' + encoded);
  await expect(page).toHaveURL(f.origin + '/docs#md=' + encoded);
  await expect(page.getByRole('heading', { name: 'A shared document', exact: true })).toBeVisible();
});
test('remembered libraries are checked against current access before being opened', async ({ page }) => {
  await page.addInitScript(id => localStorage.setItem('sdocs.cloud.account_id', id), f.otherTeam.workspaceId);
  await page.goto(f.origin + '/');
  await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
  await expect(page.locator('#workspace-button')).toContainText('Choose library');
  await page.locator('#workspace-button').click();
  await expect(page.locator('#workspace-menu')).not.toContainText('Other team');
  await expect(page.getByRole('menuitem', { name: 'Northstar Engineering', exact: true })).toBeVisible();
});
test('blocked browser storage does not send a valid login back through authentication', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = function () { throw new Error('Storage unavailable'); }; });
  await page.goto(f.origin + '/');
  await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
  await expect(page.locator('#workspace-button')).toContainText('Choose library');
});
