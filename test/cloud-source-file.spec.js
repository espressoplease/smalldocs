const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { await f.close(); });

async function document(markdown, source = { absolute_path: '/Users/alex/Work/<notes>&"/brief.md', relative_path: 'reports/brief.md' }) {
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
  await expect(page.locator('#_sd_rendered h1')).toHaveText('Brief');
  await page.getByRole('button', { name: 'Document metadata', exact: true }).click();
  const metadata = page.locator('#_sd_metadata-panel');
  await expect(metadata.locator('[data-metadata="fullPath"] button')).toHaveText(doc.source.absolute_path);
  await expect(metadata.locator('[data-metadata="path"] button')).toHaveText(doc.source.relative_path);
  await expect(metadata).toContainText('File paths are visible only to you.');
  await expect(card.locator('[data-key], .fic-label')).toHaveCount(0);
  await expect(metadata.locator('[data-metadata="file"]')).toHaveCount(0);
  await expect(card.locator('[data-key="file"]')).toHaveCount(0);
  await expect(card.locator('[data-key="fullPath"] .fic-local-tag')).toHaveCount(0);
  await expect(card.locator('.fic-privacy-note')).toBeHidden();
  expect(await page.evaluate(() => window.SDocs.localMeta)).toEqual({});
  expect(await page.evaluate(() => window.SDocs.currentMeta)).not.toHaveProperty('source_file');
  expect(await page.evaluate(() => window.SDocs.currentMarkdown?.() || window.SDocs.currentBody)).not.toContain(doc.source.absolute_path);
  await page.reload();
  await page.getByRole('button', { name: 'Document metadata', exact: true }).click();
  await expect(metadata.locator('[data-metadata="fullPath"] button')).toHaveText(doc.source.absolute_path);
  const fresh = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const other = await fresh.newPage(); await signIn(other, 'member');
    let payload;
    other.on('response', async response => { if (new URL(response.url()).pathname === '/api/cloud/v1/documents/' + doc.id) payload = await response.json(); });
    await other.goto(f.origin + '/docs?cloud-document=' + doc.id);
    await expect(other.locator('#_sd_rendered h1')).toHaveText('Brief');
    await other.getByRole('button', { name: 'Document metadata', exact: true }).click();
    await expect(other.locator('#_sd_metadata-panel [data-metadata="file"]')).toContainText('brief.md');
    await expect(other.locator('#_sd_metadata-panel [data-metadata="fullPath"], #_sd_metadata-panel [data-metadata="path"]')).toHaveCount(0);
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
  await expect(fileInfo.locator('.sdoc-cf-localtag')).toHaveCount(0);
  await expect(fileInfo.locator('.sdoc-cf-filabel', { hasText: 'Filename' })).toHaveCount(0);
});

for (const width of [1440, 390, 320]) {
  test('metadata wraps and copies complete paths and title at ' + width, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const title = 'A complete title with <angle brackets> & symbols ' + 'and more detail '.repeat(12).trim();
    const source = { absolute_path: '/Users/alex/Work/' + 'UnbrokenFolderName'.repeat(12) + '/<notes>&"/brief.md', relative_path: 'reports/Research notes/brief.md' };
    const doc = await document('---\ntitle: Different front matter title\nfile: brief.md\n---\n# ' + title.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '\n\nShared content.\n', source);
    await signIn(page, 'bob');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
    await expect(page.locator('#_sd_rendered h1')).toContainText('A complete title');
    const trigger = page.getByRole('button', { name: 'Document metadata', exact: true });
    await expect(trigger).toHaveAttribute('data-tip', 'Metadata: file paths & document title');
    await trigger.click();
    const panel = page.locator('#_sd_metadata-panel');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Close metadata panel' })).toBeVisible();
    for (const [label, value] of [['document title', title], ['absolute path', source.absolute_path], ['relative path', source.relative_path]]) {
      const copy = panel.getByRole('button', { name: 'Copy ' + label, exact: true });
      await expect(copy).toHaveText(value);
      await copy.click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
      await expect(copy.locator('svg polyline')).toHaveAttribute('points', '20 6 9 17 4 12');
    }
    const geometry = await panel.locator('[data-metadata="fullPath"] button > span').evaluate(el => {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return { height: box.height, lineHeight: parseFloat(style.lineHeight), client: el.clientWidth, scroll: el.scrollWidth, right: box.right };
    });
    expect(geometry.height).toBeGreaterThan(geometry.lineHeight * 2);
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    expect(geometry.right).toBeLessThan(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('metadata-' + width + '.png') });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    if (width > 768) await trigger.click();
    await page.getByRole('button', { name: 'Share document', exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator('#_sd_share-panel')).toBeVisible();
    if (width <= 768) await page.getByRole('button', { name: 'Close sharing panel' }).click();
    await trigger.click();
    await expect(page.locator('#_sd_share-panel')).toBeHidden();
    await expect(panel).toBeVisible();
    await page.getByRole('button', { name: 'Close metadata panel' }).click();
    expect(errors).toEqual([]);
  });
}

test('metadata follows remote edits and leaves document access controls usable', async ({ page }) => {
  const doc = await document('# First title\n\nA passage.\n');
  await signIn(page, 'bob');
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
  await expect(page.locator('#_sd_rendered h1')).toHaveText('First title');
  await page.getByRole('button', { name: 'Document metadata', exact: true }).click();
  const current = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/head');
  const saved = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/revisions', 'POST', {
    markdown: '# Revised title\n\nA revised passage.\n', expected_head_revision_id: current.data.document.current_revision_id,
    idempotency_key: require('crypto').randomUUID(),
  });
  expect(saved.status).toBe(201);
  await page.evaluate(() => SDocs.checkCloudNow());
  await expect(page.getByRole('button', { name: 'Copy document title', exact: true })).toHaveText('Revised title');
  await page.locator('[data-cloud-open="access"]').click();
  await expect(page.locator('#_sd_metadata-panel')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/cloud-lab-mode/);
  await page.getByRole('button', { name: 'Document metadata', exact: true }).click();
  await expect(page.locator('body')).not.toHaveClass(/cloud-lab-mode/);
  await expect(page.locator('#_sd_metadata-panel')).toBeVisible();
});

test('private copies omit the creator paths from metadata, including in the creator tab', async ({ page, browser }) => {
  const doc = await document('# Shareable title\n\nA passage.\n');
  await signIn(page, 'bob');
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
  await page.getByRole('button', { name: 'Document metadata', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy absolute path', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Share document', exact: true }).click();
  await page.getByRole('button', { name: 'Private link', exact: true }).click();
  await page.getByRole('button', { name: 'Create private link', exact: true }).click();
  const privateUrl = await page.getByRole('textbox', { name: 'Private URL', exact: true }).inputValue();
  const guest = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const reader = await guest.newPage();
    for (const target of [reader, page]) {
      await target.goto(privateUrl);
      await expect(target.locator('#_sd_rendered h1')).toHaveText('Shareable title');
      await target.getByRole('button', { name: 'Document metadata', exact: true }).click();
      await expect(target.getByRole('button', { name: 'Copy document title', exact: true })).toHaveText('Shareable title');
      await expect(target.locator('[data-metadata="fullPath"], [data-metadata="path"]')).toHaveCount(0);
      expect(await target.locator('body').innerHTML()).not.toContain('/Users/alex');
    }
  } finally { await guest.close(); }
});

test('metadata falls back to the saved title and reports copy failures', async ({ page }) => {
  const doc = await document('---\ntitle: A saved title\n---\nA passage without a heading.\n', {});
  await signIn(page, 'bob');
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
  await expect(page.locator('#_sd_rendered')).toContainText('A passage without a heading.');
  await page.getByRole('button', { name: 'Document metadata', exact: true }).click();
  const title = page.getByRole('button', { name: 'Copy document title', exact: true });
  await expect(title).toHaveText('A saved title');
  await page.evaluate(() => { SDocs.copyWithIconFeedback = () => Promise.reject(new Error('Clipboard unavailable')); });
  await title.click();
  await expect(page.locator('[data-metadata="title"] [role="status"]')).toHaveText('Could not copy. Select the text to copy it.');
});
