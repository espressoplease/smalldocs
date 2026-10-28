const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { await f.close(); });

async function document(markdown) {
  const source = { absolute_path: '/Users/alex/Work/<notes>&"/brief.md', relative_path: 'reports/brief.md' };
  const saved = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
    account_id: f.team.workspaceId, filename: 'brief.md', markdown, source_file: source,
    idempotency_key: require('crypto').randomUUID() });
  expect(saved.status).toBe(201);
  f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: saved.data.document.id, mode: 'everyone' });
  return { id: saved.data.document.id, source };
}
async function signIn(page, actor) {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
}

test('creator paths survive a fresh browser load without duplicate filename or local-only claims', async ({ page, browser }) => {
  const doc = await document('---\nfile: brief.md\n---\n# Brief\n\nShared content.\n');
  await signIn(page, 'bob');
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
  const card = page.locator('#_sd_sdocs-file-info');
  await expect(card.locator('[data-key="fullPath"] .fic-value')).toHaveText(doc.source.absolute_path);
  await expect(card.locator('[data-key="path"] .fic-value')).toHaveText(doc.source.relative_path);
  await expect(card.locator('[data-key="file"]')).toHaveCount(0);
  await expect(card.locator('[data-key="fullPath"] .fic-local-tag')).toHaveText('Only you');
  await expect(card.locator('.fic-privacy-note')).toBeHidden();
  expect(await page.evaluate(() => window.SDocs.localMeta)).toEqual({});
  expect(await page.evaluate(() => window.SDocs.currentMeta)).not.toHaveProperty('source_file');
  expect(await page.evaluate(() => window.SDocs.currentMarkdown?.() || window.SDocs.currentBody)).not.toContain(doc.source.absolute_path);
  await page.reload();
  await expect(card.locator('[data-key="fullPath"] .fic-value')).toHaveText(doc.source.absolute_path);
  const fresh = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const other = await fresh.newPage(); await signIn(other, 'member');
    let payload;
    other.on('response', async response => { if (new URL(response.url()).pathname === '/api/cloud/v1/documents/' + doc.id) payload = await response.json(); });
    await other.goto(f.origin + '/docs?cloud-document=' + doc.id);
    await expect(other.locator('#_sd_rendered h1')).toHaveText('Brief');
    await expect(other.locator('#_sd_sdocs-file-info [data-key="file"]')).toContainText('brief.md');
    await expect(other.locator('#_sd_sdocs-file-info [data-key="path"], #_sd_sdocs-file-info [data-key="fullPath"]')).toHaveCount(0);
    await expect.poll(() => !!payload).toBe(true);
    expect(payload.document).not.toHaveProperty('source_file');
    expect(JSON.stringify(payload)).not.toContain('/Users/alex');
    expect(await other.locator('body').innerHTML()).not.toContain('/Users/alex');
  } finally { await fresh.close(); }
});

test('whole-file code views use the same creator-only paths', async ({ page }) => {
  const doc = await document('```javascript\nconst answer = 42;\n```\n');
  await signIn(page, 'bob');
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
  await expect(page.locator('#_sd_rendered pre')).toContainText('const answer = 42;');
  await page.evaluate(() => window.SDocs.codeFocus.open(window.SDocs.renderedEl.querySelector('pre')));
  const fileInfo = page.locator('.sdoc-cf-fileinfo');
  await expect(fileInfo).toBeVisible();
  await expect(fileInfo).toContainText(doc.source.absolute_path);
  await expect(fileInfo).toContainText(doc.source.relative_path);
  await expect(fileInfo.locator('.sdoc-cf-localtag')).toHaveCount(2);
  await expect(fileInfo.locator('.sdoc-cf-localtag').first()).toHaveText('Only you');
  await expect(fileInfo.locator('.sdoc-cf-filabel', { hasText: 'Filename' })).toHaveCount(0);
});
