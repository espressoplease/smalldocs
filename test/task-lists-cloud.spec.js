const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const crypto = require('crypto');
const yaml = require('../cli/shared/sdocs-yaml');

test.use({ serviceWorkers: 'block' });
test.setTimeout(30000);

async function setup(page) {
  const f = await startFixture({ singlePlan: true });
  const grant = f.auth.issueDeviceAuthorization({ displayName: 'Writing agent' });
  f.auth.approveDeviceAuthorization({ userCode: grant.userCode, userId: f.users.bob.id });
  const credential = f.auth.pollDeviceAuthorization({ deviceCode: grant.deviceCode });
  const markdown = yaml.serializeFrontMatter({ tags: ['todo'], comments: [{
    id: 'c1', kind: 'inline', quote: 'Reading plan.', text: 'Keep this context.', author: 'Josh',
  }] }) + '\n# Reading\n\nReading plan.\n\n- [ ] Read chapter\n- [ ] Write notes\n';
  const doc = await f.store.createDocument({ userId: f.users.bob.id,
    projectId: f.team.projectId, credentialId: credential.credentialId,
    filename: 'reading.md', markdown, idempotencyKey: crypto.randomUUID() });
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
  await expect(page.getByRole('checkbox', { name: 'Read chapter', exact: true })).toBeEnabled();
  async function agent(endpoint = '', body) {
    const response = await fetch(f.origin + '/api/cloud/v1/documents/' + doc.id + endpoint, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + credential.accessToken, Origin: f.origin,
        'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }
  return { f, doc, markdown, agent };
}

test('Cloud reader completion is durable document state visible to an authenticated agent', async ({ page }) => {
  const { f, doc, agent } = await setup(page);
  try {
    await page.getByRole('checkbox', { name: 'Read chapter', exact: true }).check();
    await page.evaluate(() => SDocs.saveCloudNow());
    const saved = await agent();
    expect(saved.status).toBe(200);
    expect(saved.data.document.markdown).toContain('- [x] Read chapter');
    expect(saved.data.document.tags).toContain('todo');
    expect(yaml.parseFrontMatter(saved.data.document.markdown).meta.comments[0].text).toBe('Keep this context.');
    const history = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/history');
    expect(history.data.entries[0]).toMatchObject({ kind: 'browser', save_count: 1, edit_session_id: null });
    expect(history.data.entries[0].actor_user_id).toBe(f.users.bob.id);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'Read chapter', exact: true })).toBeChecked();
    const revisions = f.store.listRevisions({ userId: f.users.bob.id, documentId: doc.id }).length;
    await page.evaluate(() => { SDocs.setMode('write'); SDocs.setMode('read'); });
    await page.evaluate(() => SDocs.saveCloudNow());
    expect(f.store.listRevisions({ userId: f.users.bob.id, documentId: doc.id }).length).toBe(revisions);
  } finally { await f.close(); }
});

test('reader task clicks merge with agent edits and a second reader without losing either change', async ({ page }) => {
  const { f, doc, agent } = await setup(page);
  const second = await page.context().newPage();
  try {
    await second.goto(f.origin + '/docs?cloud-document=' + doc.id);
    const remote = await agent('/edits', { base_revision_id: doc.current_revision_id,
      edits: [{ old_text: 'Reading plan.', new_text: 'Updated reading plan.', section: 'Reading' }],
      edit_reason: 'Clarify the reading plan.', idempotency_key: crypto.randomUUID() });
    expect(remote.status).toBe(201);
    await page.getByRole('checkbox', { name: 'Read chapter', exact: true }).check();
    await page.evaluate(() => SDocs.saveCloudNow());
    await second.getByRole('checkbox', { name: 'Write notes', exact: true }).check();
    await second.evaluate(() => SDocs.saveCloudNow());
    const saved = (await agent()).data.document;
    expect(saved.markdown).toContain('Updated reading plan.');
    expect(saved.markdown).toContain('- [x] Read chapter\n- [x] Write notes');
    await page.evaluate(() => SDocs.checkCloudNow());
    await expect(page.getByRole('checkbox', { name: 'Write notes', exact: true })).toBeChecked();
    expect(new URL(page.url()).searchParams.get('cloud-document')).toBe(doc.id);
    expect(new URL(page.url()).hash).not.toContain('md=');
  } finally { await second.close(); await f.close(); }
});

test('revoking Cloud access rejects completion while keeping the unsaved local change visible', async ({ page, browser }) => {
  const { f, doc, agent } = await setup(page);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id,
      mode: 'everyone', memberUserIds: [] });
    await context.addCookies([{ name: 'sdocs_cloud', value: f.users.member.sessionToken, url: f.origin }]);
    const member = await context.newPage();
    await member.goto(f.origin + '/docs?cloud-document=' + doc.id);
    await expect(member.getByRole('checkbox', { name: 'Read chapter', exact: true })).toBeEnabled();
    f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id,
      mode: 'custom', memberUserIds: [] });
    await member.getByRole('checkbox', { name: 'Read chapter', exact: true }).check();
    await expect(member.locator('#_sd_status-text')).toHaveText('Changes were not saved to Cloud.');
    await expect(member.getByRole('checkbox', { name: 'Read chapter', exact: true })).toBeChecked();
    expect((await agent()).data.document.markdown).toContain('- [ ] Read chapter');
  } finally { await context.close(); await f.close(); }
});
