const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f, workspace;
test.beforeEach(async ({ page }) => {
  f = await startFixture({ singlePlan: true });
  workspace = (await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})).data.workspaces[0].id;
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
});
test.afterEach(async () => { await f.close(); });
async function document(actor, name, tags) {
  const saved = await f.api(actor, '/api/cloud/v1/account/documents', 'POST', {
    account_id: workspace, filename: name + '.md', markdown: (tags.length ? '---\ntags:\n' + tags.map(tag => '  - ' + tag).join('\n') + '\n---\n' : '') + '# ' + name,
    idempotency_key: name,
  });
  expect(saved.status).toBe(201);
  return saved.data.document;
}

test('empty and single-document libraries stay closed, including when others have private documents', async ({ page }) => {
  await page.goto(f.origin + '/docs');
  const trigger = page.locator('[data-sidebar-section="cloud"] > button');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  const current = await document('josh', 'Current document', ['design']);
  f.store.addWorkspaceMember({ actorUserId: f.users.josh.id, workspaceId: workspace, userId: f.users.member.id, role: 'member' });
  const project = (await f.store.listProjects(f.users.josh.id, workspace))[0];
  f.store.grantProject({ actorUserId: f.users.josh.id, workspaceId: workspace, projectId: project.id, userId: f.users.member.id, role: 'editor' });
  await f.store.createDocument({ userId: f.users.member.id, projectId: project.id, filename: 'private.md',
    markdown: '# Private member document', idempotencyKey: 'private-member' });
  await page.goto(f.origin + '/docs?cloud-document=' + current.id);
  await page.waitForFunction(() => window.SDocs._appReady);
  await expect(page.locator('#_sd_sidebar_cloud_recent_count')).toHaveText('0');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_sidebar')).not.toContainText('Private member document');
});

test('multiple documents open Library with its subsections collapsed and respect later user choices', async ({ page }) => {
  const current = await document('josh', 'Current document', ['design']);
  const related = await document('josh', 'Related document', ['design']);
  const requests = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/cloud/v1/search') requests.push(request.postDataJSON()); });
  await page.goto(f.origin + '/docs?cloud-document=' + current.id);
  const trigger = page.locator('[data-sidebar-section="cloud"] > button');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const shared = page.locator('#_sd_sidebar_cloud_shared_section > button');
  const recent = page.locator('#_sd_sidebar_cloud_recent_section > button');
  const relatedLink = page.locator('#_sd_sidebar_cloud_tag_groups').getByRole('link', { name: 'Related document', exact: true });
  await expect(shared).toHaveAttribute('aria-expanded', 'false');
  await expect(recent).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_sidebar_cloud_shared_count')).toHaveText('1');
  await expect(relatedLink).toHaveAttribute('href', '/docs?cloud-document=' + related.id);
  await expect(page.locator('#_sd_sidebar_cloud_shared_content')).toHaveCSS('height', '0px');
  await expect(page.locator('#_sd_sidebar_cloud_shared_content')).toHaveCSS('opacity', '0');
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.workspace_id === workspace && request.limit === 11)).toBe(true);
  await shared.click();
  await expect(page.locator('#_sd_sidebar_cloud_shared_content')).toHaveCSS('opacity', '1');
  await expect(relatedLink).toBeVisible();
  await page.evaluate(() => window.SDocs.sidebarRefresh());
  await expect(shared).toHaveAttribute('aria-expanded', 'true');
  await expect(recent).toHaveAttribute('aria-expanded', 'false');
  await recent.click();
  await expect(shared).toHaveAttribute('aria-expanded', 'false');
  await expect(recent).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => window.SDocs.sidebarRefresh());
  await expect(recent).toHaveAttribute('aria-expanded', 'true');
  await trigger.click();
  await page.evaluate(() => window.SDocs.sidebarRefresh());
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('without related tags, Recent stays collapsed inside the mobile menu until opened', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const current = await document('josh', 'Current document', ['design']);
  await document('josh', 'Recent document', ['release']);
  await page.goto(f.origin + '/docs?cloud-document=' + current.id);
  const trigger = page.locator('[data-sidebar-section="cloud"] > button');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#_sd_sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Open SmallDocs menu', exact: true }).click();
  const recent = page.locator('#_sd_sidebar_cloud_recent_section > button');
  const recentLink = page.locator('#_sd_sidebar_cloud_recent').getByRole('link', { name: 'Recent document', exact: true });
  await expect(recent).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_sidebar_cloud_recent_count')).toHaveText('1');
  await expect(page.locator('#_sd_sidebar_cloud_recent_content')).toHaveCSS('height', '0px');
  await expect(page.locator('#_sd_sidebar_cloud_recent_content')).toHaveCSS('opacity', '0');
  await recent.click();
  await expect(page.locator('#_sd_sidebar_cloud_recent_content')).toHaveCSS('opacity', '1');
  await expect(recentLink).toBeVisible();
});

test('Cloud navigation is correct before the renderer and billing checks finish loading', async ({ page }) => {
  const current = await document('josh', 'Current document', []);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/public/sdocs-theme.js*', async route => { await gate; await route.continue(); });
  await page.goto(f.origin + '/docs?cloud-document=' + current.id, { waitUntil: 'commit' });
  try {
    const sidebar = page.locator('#_sd_sidebar');
    await expect(sidebar.getByText('Library', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Local library', { exact: true })).toBeHidden();
    await expect(sidebar.getByText('Cloud library', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
  } finally { release(); }
  await page.waitForLoadState('load');
});

test('Library reserves the sidebar layout and hides the old header before sidebar JavaScript loads', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/public/sdocs-site-sidebar.js*', async route => { await gate; await route.continue(); });
  await page.goto(f.origin + '/library?scope=cloud', { waitUntil: 'commit' });
  try {
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('body')).toHaveCSS('padding-left', '224px');
  } finally { release(); }
  await page.waitForLoadState('load');
  await expect(page.locator('body')).toHaveCSS('padding-left', '224px');
  await expect(page.locator('#_sd_site_sidebar')).toBeVisible();
});

test('a delayed Cloud module cannot show the introductory document before the requested document', async ({ page }) => {
  const current = await document('josh', 'Requested Cloud document', []);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/public/sdocs-cloud-prototype.js*', async route => { await gate; await route.continue(); });
  await page.goto(f.origin + '/docs?cloud-document=' + current.id, { waitUntil: 'commit' });
  try {
    await expect(page.locator('.sdocs-sidebar-brand')).toBeVisible();
    await expect(page.locator('#_sd_rendered')).toBeEmpty();
  } finally { release(); }
  await expect(page.locator('#_sd_rendered h1')).toHaveText('Requested Cloud document');
});

test('the authorized Cloud document appears before optional account details finish loading', async ({ page }) => {
  const current = await document('josh', 'Requested Cloud document', []);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/cloud/v1/account/members?*', async route => { await gate; await route.continue(); });
  await page.goto(f.origin + '/docs?cloud-document=' + current.id);
  try {
    await expect(page.locator('#_sd_rendered h1')).toHaveText('Requested Cloud document');
    await page.waitForFunction(() => window.SDocs._appReady);
  } finally { release(); }
});
