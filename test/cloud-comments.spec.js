const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const yaml = require('../cli/shared/sdocs-yaml');
const model = require('../lib/cloud-comments');
test.use({ serviceWorkers: 'block' });

async function setup(page) {
  const f = await startFixture({ singlePlan: true });
  const body = '# Guide\n\n## Production\n\nProduction retry window: 10 minutes.\n\n## Sandbox\n\nSandbox retry window: 10 minutes.\n';
  const c = { id: 'c1', uid: 'cm_browser', kind: 'inline', quote: '10 minutes', prefix: 'Production retry window: ',
    suffix: '.', block: 'p:0', block_text: 'Production retry window: 10 minutes.', author: 'Ana', text: 'Use 45 minutes.' };
  const r = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', { account_id: f.team.workspaceId,
    filename: 'guide.md', markdown: yaml.serializeFrontMatter({ comments: [c] }) + '\n' + body, idempotency_key: 'browser-comments-create' });
  expect(r.status).toBe(201);
  const doc = r.data.document;
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id + '&comment=c1');
  await expect(page.locator('.sdoc-card[data-c="c1"]')).toContainText('Use 45 minutes.');
  return { f, doc, body };
}

test('Cloud edits, comment replies and resolution update the same open reader and retain the visual target', async ({ page }) => {
  test.setTimeout(35000);
  const { f, doc } = await setup(page);
  try {
    const loadedAt = await page.evaluate(() => performance.timeOrigin);
    const edit = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
      base_revision_id: doc.current_revision_id, edits: [{ old_text: '10 minutes', new_text: '45 minutes', section: 'Production' }], idempotency_key: 'browser-comments-edit' });
    expect(edit.status).toBe(201);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveText('45 minutes');
    const reply = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/comments/actions', 'POST', {
      action: 'resolve', comment_id: 'c1', text: 'Changed and verified.', base_revision_id: edit.data.document.revision_id, idempotency_key: 'browser-comments-resolve' });
    expect(reply.status).toBe(201);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-thread-reply-text')).toHaveText('Changed and verified.');
    await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-thread-status')).toHaveText('Resolved');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(loadedAt);
    await expect(page.locator('#_sd_rendered')).toContainText('Sandbox retry window: 10 minutes.');
    await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
  } finally { await f.close(); }
});

test('a deleted Cloud comment disappears from the open reader while its quoted passage remains', async ({ page }) => {
  test.setTimeout(30000);
  const { f, doc, body } = await setup(page);
  try {
    const loadedAt = await page.evaluate(() => performance.timeOrigin);
    const deleted = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/comments/actions', 'POST', {
      action: 'delete', comment_id: 'c1', base_revision_id: doc.current_revision_id, idempotency_key: 'browser-comments-delete' });
    expect(deleted.status).toBe(201);
    expect(deleted.data.comment_id).toBe('c1');
    expect(deleted.data.comment).toBe(null);
    await page.evaluate(() => window.SDocs.checkCloudNow());
    await expect(page.locator('.sdoc-card[data-c="c1"]')).toHaveCount(0);
    await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveCount(0);
    await expect(page.locator('#_sd_rendered')).toContainText('Production retry window: 10 minutes.');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(loadedAt);
    const saved = await f.api('bob', '/api/cloud/v1/documents/' + doc.id);
    expect(model.snapshot(saved.data.document.markdown).body.trim()).toBe(body.trim());
    expect(model.snapshot(saved.data.document.markdown).comments).toEqual([]);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.SDocs.currentBody)).toContain('Production retry window: 10 minutes.');
    await expect(page.locator('.sdoc-card[data-c="c1"]')).toHaveCount(0);
  } finally { await f.close(); }
});

test('replies made in the browser persist to Cloud and reload as structured feedback', async ({ page }) => {
  test.setTimeout(30000);
  const { f, doc, body } = await setup(page);
  try {
    const card = page.locator('.sdoc-card[data-c="c1"]');
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    await card.getByPlaceholder('Add a reply...').fill('I checked the source.');
    await card.getByRole('button', { name: 'Save reply', exact: true }).click();
    await expect.poll(async () => {
      const r = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/comments?comment_id=c1');
      return r.data.comments[0].replies.map(reply => reply.text);
    }).toEqual(['I checked the source.']);
    await page.reload();
    await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-thread-reply-text')).toHaveText('I checked the source.');
    const saved = await f.api('bob', '/api/cloud/v1/documents/' + doc.id);
    expect(model.snapshot(saved.data.document.markdown).body.trim()).toBe(body.trim());
    expect(model.snapshot(saved.data.document.markdown).comments[0].uid).toBe('cm_browser');
  } finally { await f.close(); }
});

test('deleted Cloud target stays visibly unplaced until explicit reattachment', async ({ page }) => {
  test.setTimeout(30000);
  const { f, doc } = await setup(page);
  try {
    const edit = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
      base_revision_id: doc.current_revision_id, edits: [{ old_text: 'Production retry window: 10 minutes.', new_text: 'Production limits are under review.', section: 'Production' }], idempotency_key: 'browser-comments-delete-target' });
    expect(edit.status).toBe(201);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.sdoc-card[data-c="c1"]')).toHaveClass(/sdoc-card-orphaned/);
    await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveCount(0);
    const attach = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/comments/actions', 'POST', {
      action: 'reattach', comment_id: 'c1', anchor: { kind: 'inline', quote: 'under review', section: 'Production' },
      base_revision_id: edit.data.document.revision_id, idempotency_key: 'browser-comments-reattach' });
    expect(attach.status).toBe(201);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveText('under review');
    await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
  } finally { await f.close(); }
});

test('a remote Cloud edit preserves an unsaved reply draft and merges it when submitted', async ({ page }) => {
  test.setTimeout(30000);
  const { f, doc } = await setup(page);
  try {
    const card = page.locator('.sdoc-card[data-c="c1"]');
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    await card.getByPlaceholder('Add a reply...').fill('Keep this draft while another person edits.');
    const changed = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
      base_revision_id: doc.current_revision_id, edits: [{ old_text: '10 minutes', new_text: '45 minutes', section: 'Production' }], idempotency_key: 'draft-remote-edit' });
    expect(changed.status).toBe(201);
    await page.evaluate(() => window.SDocs.checkCloudNow());
    await expect(card.getByPlaceholder('Add a reply...')).toHaveValue('Keep this draft while another person edits.');
    await card.getByRole('button', { name: 'Save reply', exact: true }).click();
    await expect.poll(async () => {
      const r = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/comments?comment_id=c1');
      return r.data.comments[0].replies.map(reply => reply.text);
    }).toEqual(['Keep this draft while another person edits.']);
    await expect.poll(() => page.evaluate(() => window.SDocs.currentBody)).toContain('Production retry window: 45 minutes.');
    await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-thread-reply-text')).toHaveText('Keep this draft while another person edits.');
  } finally { await f.close(); }
});
