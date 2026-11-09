const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');

test.use({ serviceWorkers: 'block' });
let fixture;
test.beforeEach(async () => { fixture = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { if (fixture) await fixture.close(); });

async function signIn(page, actor) {
  const setup = await fixture.api(actor, '/api/cloud/v1/onboarding/complete', 'POST', {});
  expect(setup.status).toBe(200);
  await page.context().addCookies([{ name: 'sdocs_cloud', value: fixture.users[actor].sessionToken, url: fixture.origin }]);
  return setup.data.workspaces.find(workspace => workspace.kind === 'personal');
}

test('first documents do not wait for an account round trip, tag response or text indexing', async ({ page }) => {
  await signIn(page, 'bob');
  for (let index = 0; index < 61; index++) {
    await fixture.store.createDocument({ userId: fixture.users.bob.id, projectId: fixture.team.projectId,
      filename: 'record-' + index + '.md', markdown: '---\ntags:\n  - first-load\n---\n# Record ' + index,
      idempotencyKey: 'first-load-' + index });
  }
  fixture.store.db.prepare('DELETE FROM cloud_search_documents').run();
  let accountRequests = 0, tagRequests = 0, releaseTags;
  const tagsHeld = new Promise(resolve => { releaseTags = resolve; });
  await page.route('**/api/cloud/v1/account?*', route => { accountRequests++; return route.abort(); });
  await page.route('**/api/cloud/v1/account/tags?*', async route => { tagRequests++; await tagsHeld; await route.continue(); });
  try {
    await page.goto(fixture.origin + '/library?scope=cloud&workspace=' + fixture.team.workspaceId);
    await expect(page.locator('.res')).toHaveCount(60);
    await expect(page.locator('#count')).toHaveText('61 results');
    expect(accountRequests).toBe(0);
    expect(tagRequests).toBe(1);
    expect(fixture.store.searchIndexStatus().ready).toBe(false);
    releaseTags();
    await expect.poll(async () => fixture.store.searchIndexStatus().ready).toBe(true);
    await page.locator('[data-facet="tag"]').click();
    await expect(page.locator('#facet-panel')).toContainText('first-load');
    expect(tagRequests).toBe(1);
  } finally { releaseTags(); }
});

test('a new empty personal library finishes loading without the redundant account request', async ({ page }) => {
  const personal = await signIn(page, 'josh');
  let accountRequests = 0;
  await page.route('**/api/cloud/v1/account?*', route => { accountRequests++; return route.abort(); });
  await page.goto(fixture.origin + '/library?scope=cloud&workspace=' + personal.id);
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#count')).toHaveText('0 results');
  await expect(page.locator('#results')).toContainText('No Cloud documents yet.');
  expect(accountRequests).toBe(0);
});

test('the page still enforces the paywall before loading an expired library', async ({ page }) => {
  const personal = await signIn(page, 'josh');
  fixture.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?')
    .run(Date.now() - 8 * 24 * 60 * 60 * 1000, fixture.users.josh.id);
  let searches = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/cloud/v1/search') searches++; });
  await page.goto(fixture.origin + '/library?scope=cloud&workspace=' + personal.id);
  await expect(page).toHaveURL(/\/cloud\/subscribe/);
  expect(searches).toBe(0);
});
