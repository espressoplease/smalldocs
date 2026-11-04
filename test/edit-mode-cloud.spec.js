const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const yaml = require('../cli/shared/sdocs-yaml');
test.use({ serviceWorkers: 'block' });

async function setup(page) {
  const f = await startFixture({ singlePlan: true });
  const markdown = '# Working copy\n\nLocal paragraph.\n\nRemote paragraph.\n';
  const created = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
    account_id:f.team.workspaceId, filename:'working-copy.md', markdown, idempotency_key:'edit-mode-fixture' });
  expect(created.status).toBe(201);
  const doc = created.data.document;
  await page.context().addCookies([{ name:'sdocs_cloud', value:f.users.bob.sessionToken, url:f.origin }]);
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
  await expect(page.locator('#_sd_rendered h1')).toHaveText('Working copy');
  await expect.poll(() => page.evaluate(() => typeof SDocs.saveCloudNow)).toBe('function');
  return { f, doc };
}
async function type(page, text) {
  await page.locator('#_sd_write > p:first-of-type').evaluate(el => {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.getElementById('_sd_write').focus();
  });
  await page.keyboard.insertText(text);
}
async function saved(f, doc) { return (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document; }

// Hold the response after the real server has completed its work.
async function hold(page, url) {
  let release, received;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { received = resolve; });
  let held = false;
  await page.route(url, async route => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch(); received(); await gate; await route.fulfill({ response });
  });
  return { started, release };
}

test('write/read with no changes creates no Cloud revision', async ({ page }) => {
  const { f, doc } = await setup(page);
  try {
    for (let i=0; i<3; i++) { await page.locator('#_sd_btn-write').click(); await page.locator('#_sd_btn-read').click(); }
    await page.evaluate(() => SDocs.saveCloudNow());
    expect((await saved(f, doc)).current_revision_id).toBe(doc.current_revision_id);
  } finally { await f.close(); }
});

test('explicit save includes the most recent keystroke before the debounce expires', async ({ page }) => {
  const { f, doc } = await setup(page);
  try {
    await page.locator('#_sd_btn-write').click(); await type(page, ' Latest.');
    await page.evaluate(() => SDocs.saveCloudNow());
    expect((await saved(f, doc)).markdown).toContain('Local paragraph. Latest.');
  } finally { await f.close(); }
});

test('a delayed save response cannot overwrite more recent typing', async ({ page }) => {
  const { f, doc } = await setup(page);
  let pending;
  try {
    await page.locator('#_sd_btn-write').click(); await type(page, ' First.');
    pending = await hold(page, '**/documents/' + doc.id + '/revisions');
    await page.evaluate(() => { SDocs.flushWriteChanges(); window.editSave = SDocs.saveCloudNow(); });
    await pending.started; await type(page, ' Second.'); pending.release();
    await page.evaluate(() => window.editSave);
    await expect(page.locator('#_sd_write p').first()).toHaveText('Local paragraph. First. Second.');
    await page.locator('#_sd_btn-read').click(); await page.evaluate(() => SDocs.saveCloudNow());
    expect((await saved(f, doc)).markdown).toContain('Local paragraph. First. Second.');
  } finally { if (pending) pending.release(); await f.close(); }
});

test('typing while a remote refresh is in flight survives and merges with the remote edit', async ({ page }) => {
  const { f, doc } = await setup(page);
  let pending;
  try {
    await page.locator('#_sd_btn-write').click();
    const edit = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
      base_revision_id:doc.current_revision_id, edits:[{old_text:'Remote paragraph.',new_text:'Remote paragraph updated.'}], idempotency_key:'remote-edit' });
    expect(edit.status).toBe(201);
    pending = await hold(page, '**/documents/' + doc.id);
    await page.evaluate(() => { window.remoteRefresh = SDocs.checkCloudNow(); }); await pending.started;
    await type(page, ' Keep this.'); pending.release(); await page.evaluate(() => window.remoteRefresh);
    await expect(page.locator('#_sd_write p').first()).toHaveText('Local paragraph. Keep this.');
    await page.locator('#_sd_btn-read').click(); await page.evaluate(() => SDocs.saveCloudNow());
    const body = yaml.parseFrontMatter((await saved(f, doc)).markdown).body;
    expect(body).toContain('Local paragraph. Keep this.'); expect(body).toContain('Remote paragraph updated.');
    await expect(page.locator('#_sd_rendered')).toContainText('Remote paragraph updated.');
  } finally { if (pending) pending.release(); await f.close(); }
});

test('a save failure leaves typed content available and retryable', async ({ page }) => {
  const { f, doc } = await setup(page);
  try {
    await page.locator('#_sd_btn-write').click(); await type(page, ' Keep on failure.');
    const url = '**/documents/' + doc.id + '/revisions';
    let release, received;
    const gate = new Promise(resolve => { release=resolve; }), started = new Promise(resolve => { received=resolve; });
    await page.route(url, async route => { received(); await gate; await route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}); });
    await page.evaluate(() => { window.failedSave=SDocs.saveCloudNow().then(() => false, () => true); });
    await started; await type(page, ' Newer text.'); release();
    expect(await page.evaluate(() => window.failedSave)).toBe(true);
    expect(await page.evaluate(() => SDocs.currentBody)).toContain('Newer text.');
    await page.locator('#_sd_btn-read').click();
    await expect(page.locator('#_sd_rendered')).toContainText('Keep on failure. Newer text.');
    await page.unroute(url); await page.evaluate(() => SDocs.saveCloudNow());
    expect((await saved(f, doc)).markdown).toContain('Keep on failure.');
  } finally { await f.close(); }
});

test('typing during a combined save rebases once without duplicating the submitted paragraph', async ({ page }) => {
  const { f, doc } = await setup(page); let pending;
  try {
    await page.locator('#_sd_btn-write').click(); await type(page, ' First.');
    expect((await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
      base_revision_id:doc.current_revision_id, edits:[{old_text:'Remote paragraph.',new_text:'Remote paragraph updated.'}], idempotency_key:'remote-during-save' })).status).toBe(201);
    pending = await hold(page, '**/documents/' + doc.id + '/revisions');
    await page.evaluate(() => { SDocs.flushWriteChanges(); window.combinedSave = SDocs.saveCloudNow(); });
    await pending.started; await type(page, ' Second.'); pending.release(); await page.evaluate(() => window.combinedSave);
    const body = yaml.parseFrontMatter((await saved(f, doc)).markdown).body;
    expect(body).toBe('# Working copy\n\nLocal paragraph. First. Second.\n\nRemote paragraph updated.\n');
    await expect(page.locator('#_sd_write')).toContainText('Remote paragraph updated.');
  } finally { if (pending) pending.release(); await f.close(); }
});

test('two browser tabs can save independent edits without losing either edit', async ({ page }) => {
  const { f, doc } = await setup(page); const other = await page.context().newPage();
  try {
    await other.goto(f.origin + '/docs?cloud-document=' + doc.id); await expect(other.locator('#_sd_rendered h1')).toHaveText('Working copy');
    await page.locator('#_sd_btn-write').click(); await other.locator('#_sd_btn-write').click();
    await type(page, ' From first tab.');
    await other.locator('#_sd_write > p:last-of-type').evaluate(el => { const r=document.createRange();r.selectNodeContents(el);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);document.getElementById('_sd_write').focus(); });
    await other.keyboard.insertText(' From second tab.');
    await Promise.all([page.evaluate(() => SDocs.saveCloudNow()), other.evaluate(() => SDocs.saveCloudNow())]);
    expect(yaml.parseFrontMatter((await saved(f, doc)).markdown).body).toBe('# Working copy\n\nLocal paragraph. From first tab.\n\nRemote paragraph. From second tab.\n');
    await page.evaluate(() => SDocs.checkCloudNow()); await other.evaluate(() => SDocs.checkCloudNow());
    await expect(page.locator('#_sd_write')).toContainText('From second tab.');
    await expect(other.locator('#_sd_write')).toContainText('From first tab.');
  } finally { await other.close(); await f.close(); }
});

test('a permission-denied save retains edits and reports failure without replacing the document', async ({ page }) => {
  const { f, doc } = await setup(page);
  try {
    await page.locator('#_sd_btn-write').click(); await type(page, ' Unsaved text.');
    await page.route('**/documents/' + doc.id + '/revisions', route => route.fulfill({status:403,contentType:'application/json',body:'{"error":"forbidden"}'}));
    expect(await page.evaluate(() => SDocs.saveCloudNow().then(() => false, () => true))).toBe(true);
    await expect(page.locator('#_sd_write')).toContainText('Unsaved text.');
    expect((await saved(f, doc)).markdown).not.toContain('Unsaved text.');
  } finally { await f.close(); }
});

test('a delayed tag change preserves typing made while the tag request is in flight', async ({ page }) => {
  const { f, doc } = await setup(page); let pending;
  try {
    await page.locator('#_sd_btn-write').click();
    await page.getByRole('button', {name:'Edit Cloud tags',exact:true}).click();
    await page.locator('.sdoc-cloud-lab-tag-form input').fill('editing');
    pending = await hold(page, '**/documents/' + doc.id + '/tags');
    await page.locator('.sdoc-cloud-lab-tag-form input').press('Enter'); await pending.started;
    await type(page, ' Keep while tagging.'); pending.release();
    await expect(page.locator('.fic-row-cloud .sdoc-cloud-lab-tag')).toContainText(['#editing']);
    await page.evaluate(() => SDocs.saveCloudNow());
    const document = await saved(f, doc);
    expect(document.tags).toContain('editing'); expect(document.markdown).toContain('Keep while tagging.');
  } finally { if (pending) pending.release(); await f.close(); }
});

test('typing during the first upload is saved after Cloud takes ownership', async ({ page }) => {
  const { f } = await setup(page); let pending;
  try {
    await page.goto(f.origin + '/docs');
    await page.waitForFunction(() => SDocs._appReady && window.SDocsCloudAccountSelection);
    await page.evaluate(id => { SDocsCloudAccountSelection.remember(localStorage,id); SDocs._isDefaultState=false; SDocs.loadText('# First upload\n\nLocal paragraph.\n'); SDocs.renderFileInfoCard(); SDocs.setMode('write'); },f.team.workspaceId);
    pending = await hold(page, '**/account/documents');
    await page.getByRole('button',{name:'Add to Cloud',exact:true}).click(); await pending.started;
    await type(page,' Typed during first upload.');
    await expect.poll(() => page.evaluate(() => SDocs.currentBody)).toContain('Typed during first upload.');
    pending.release();
    await page.waitForFunction(() => Boolean(SDocs.cloudDocument?.id));
    await page.evaluate(() => SDocs.saveCloudNow());
    const id = await page.evaluate(() => SDocs.cloudDocument.id);
    expect((await f.api('bob','/api/cloud/v1/documents/' + id)).data.document.markdown).toContain('Typed during first upload.');
  } finally { if (pending) pending.release(); await f.close(); }
});

test('a first-upload response cannot attach a different document opened while it was waiting', async ({ page }) => {
  const { f } = await setup(page); let pending;
  try {
    await page.goto(f.origin + '/docs'); await page.waitForFunction(() => SDocs._appReady && window.SDocsCloudAccountSelection);
    await page.evaluate(id => { SDocsCloudAccountSelection.remember(localStorage,id); SDocs._isDefaultState=false; SDocs.loadText('# First upload\n\nLocal paragraph.\n'); SDocs.renderFileInfoCard(); SDocs.setMode('write'); },f.team.workspaceId);
    pending = await hold(page, '**/account/documents');
    await page.getByRole('button',{name:'Add to Cloud',exact:true}).click(); await pending.started;
    await page.evaluate(() => SDocs.loadText('# Different document\n\nKeep this separate.\n'));
    const response = page.waitForResponse(r => r.url().endsWith('/account/documents') && r.request().method()==='POST');
    pending.release(); await response; await page.waitForTimeout(100);
    expect(await page.evaluate(() => SDocs.cloudDocument)).toBeFalsy();
    await expect(page.locator('#_sd_write')).toContainText('Keep this separate.');
  } finally { if (pending) pending.release(); await f.close(); }
});
