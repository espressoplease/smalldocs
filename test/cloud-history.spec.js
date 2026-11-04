const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const crypto = require('crypto');
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { page.__historyErrors = []; page.on('pageerror', error => page.__historyErrors.push(error.message)); });
test.afterEach(async ({ page }) => { expect(page.__historyErrors).toEqual([]); });

async function setup(page, markdown = '# History\n\nOriginal paragraph.\n') {
  const f = await startFixture({ singlePlan: true });
  const issued = f.auth.issueDeviceAuthorization({ displayName: 'Writing assistant' });
  f.auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: f.users.bob.id });
  const credential = f.auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
  const doc = await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
    credentialId: credential.credentialId, editReason: 'Apply the requested document update', filename: 'history.md', markdown, idempotencyKey: 'history-create' });
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id); await expect(page.locator('#_sd_rendered h1')).toHaveText('History');
  async function agent(markdown, editReason = 'Clarify the delivery plan') {
    const current = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document;
    const response = await fetch(f.origin + '/api/cloud/v1/documents/' + doc.id + '/revisions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + credential.accessToken, Origin: f.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, target_revision_id: current.current_revision_id, idempotency_key: crypto.randomUUID(), edit_reason: editReason, edit_session_id: crypto.randomUUID() }),
    });
    expect(response.status).toBe(201); return (await response.json()).document;
  }
  return { f, doc, agent };
}
async function append(page, text) {
  await page.locator('#_sd_write > p').last().evaluate(node => { const r = document.createRange(); r.selectNodeContents(node); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); SDocs.writeEl.focus(); });
  await page.keyboard.insertText(text); await page.evaluate(() => SDocs.saveCloudNow());
}
function historyButton(page) { return page.getByRole('button', { name: 'Document history', exact: true }); }

test('the icon starts hidden, appears after an agent update, and pulses only for a new update', async ({ page }) => {
  const { f, agent } = await setup(page);
  try {
    await expect(historyButton(page)).toBeHidden(); await page.locator('#_sd_btn-write').click(); await append(page, ' Human edit.'); await page.locator('#_sd_btn-read').click(); await expect(historyButton(page)).toBeHidden();
    await agent('# History\n\nUpdated by the assistant.\n'); await page.evaluate(() => SDocs.checkCloudNow());
    await expect(historyButton(page)).toBeVisible(); await expect(historyButton(page)).toHaveClass(/is-updated/); await expect(historyButton(page)).toContainText('Updated');
    await expect(historyButton(page)).toHaveAttribute('data-tip', /History: last updated/);
    await historyButton(page).hover(); await expect(page.locator('#_sd_tooltip.show')).toContainText('History: last updated');
    await page.reload(); await expect(historyButton(page)).toBeVisible(); await expect(historyButton(page)).not.toHaveClass(/is-updated/);
  } finally { await f.close(); }
});
test('one browser editing visit is grouped and the next visit is a separate update', async ({ page }) => {
  const { f, doc, agent } = await setup(page);
  try {
    await agent('# History\n\nAgent paragraph.\n'); await page.evaluate(() => SDocs.checkCloudNow());
    await page.locator('#_sd_btn-write').click(); await append(page, ' First.'); await append(page, ' Second.'); await page.locator('#_sd_btn-read').click();
    await historyButton(page).click(); await expect(page.locator('#_sd_history-panel')).toBeVisible(); await expect(page.locator('#_sd_history-panel')).toContainText('2 saves');
    let data = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/history')).data; expect(data.entries.map(e => e.kind)).toEqual(['browser', 'agent', 'created']); expect(data.entries[0].save_count).toBe(2);
    await page.locator('#_sd_btn-write').click(); await append(page, ' Third.'); await page.locator('#_sd_btn-read').click();
    data = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/history')).data; expect(data.entries.slice(0, 2).map(e => e.kind)).toEqual(['browser', 'browser']);
  } finally { await f.close(); }
});
test('opening an update fetches its two versions and displays a safe text comparison', async ({ page }) => {
  const { f, agent } = await setup(page);
  try {
    await agent('# History\n\nChanged paragraph. <img src=x onerror=alert(1)>\n'); await page.evaluate(() => SDocs.checkCloudNow());
    const reads = []; page.on('request', request => { if (/\/revisions\//.test(request.url())) reads.push(request.url()); });
    await historyButton(page).click(); await expect(page.locator('#_sd_history-panel')).toContainText('Agent / CLI update'); expect(reads).toHaveLength(0);
    await page.getByRole('button', { name: /Agent \/ CLI update/ }).click(); await page.getByRole('button', { name: 'View changes', exact: true }).click(); await expect(page.locator('.sdoc-history-diff-line.removed')).toContainText('Original paragraph.');
    await expect(page.locator('.sdoc-history-diff-line.added')).toContainText('Changed paragraph.'); expect(reads).toHaveLength(2); await expect(page.locator('.sdoc-history-diff img')).toHaveCount(0);
    await expect(page.locator('.sdoc-share-disclosure.open .sdoc-history-comparison')).toContainText('Lines added: 1. Lines removed: 1.');
  } finally { await f.close(); }
});
test('history uses the same mobile sheet and follows the document theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { f, agent } = await setup(page);
  try {
    await agent('# History\n\nAgent paragraph.\n'); await page.evaluate(() => { SDocs.checkCloudNow(); SDocs.switchThemeAndUpdate('dark'); });
    await expect(historyButton(page)).toBeVisible(); await historyButton(page).click(); await expect(page.locator('#_sd_history-panel')).toBeVisible();
    const rect = await page.locator('#_sd_right').boundingBox(); expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(391);
    await page.getByRole('button', { name: 'Close history panel', exact: true }).click(); await expect(page.locator('#_sd_history-panel')).toBeHidden();
  } finally { await f.close(); }
});
test('older updates paginate without loading document contents', async ({ page }) => {
  const { f, doc } = await setup(page);
  try {
    let current = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document;
    for (let n = 0; n < 24; n++) current = await f.store.saveRevision({ userId: f.users.bob.id, documentId: doc.id, expectedHeadRevisionId: current.current_revision_id,
      credentialId: 'assistant', editReason: 'Apply the requested document update', markdown: '# History\n\nUpdate ' + n, idempotencyKey: 'page-' + n });
    await page.evaluate(() => SDocs.checkCloudNow()); const reads = [];
    page.on('request', request => { if (/\/revisions\//.test(request.url())) reads.push(request.url()); });
    await historyButton(page).click(); await expect(page.locator('.sdoc-history-entry')).toHaveCount(20);
    await page.getByRole('button', { name: 'Load older updates', exact: true }).click(); await expect(page.locator('.sdoc-history-entry')).toHaveCount(25); expect(reads).toHaveLength(0);
  } finally { await f.close(); }
});
test('an update arriving with the panel open refreshes the list', async ({ page }) => {
  const { f, agent } = await setup(page);
  try {
    await agent('# History\n\nFirst agent update.\n'); await page.evaluate(() => SDocs.checkCloudNow()); await historyButton(page).click();
    await expect(page.getByRole('button', { name: /Agent \/ CLI update/ })).toHaveCount(1);
    await agent('# History\n\nSecond agent update.\n'); await page.evaluate(() => SDocs.checkCloudNow());
    await expect(page.getByRole('button', { name: /Agent \/ CLI update/ })).toHaveCount(2);
  } finally { await f.close(); }
});
test('large comparisons page their lines while the reader stays interactive', async ({ page }) => {
  const before = '# History\n\n' + Array.from({ length: 200 }, (_, n) => 'Original line ' + n).join('\n') + '\n';
  const { f, agent } = await setup(page, before);
  try {
    await agent(before.replaceAll('Original line', 'Changed line')); await page.evaluate(() => SDocs.checkCloudNow()); await historyButton(page).click();
    await page.getByRole('button', { name: /Agent \/ CLI update/ }).click(); await page.getByRole('button', { name: 'View changes', exact: true }).click(); await expect(page.locator('.sdoc-history-diff-line')).toHaveCount(120);
    const more = page.getByRole('button', { name: 'Show more changes', exact: true });
    await expect(more).toBeVisible();
    for (let n = 0; n < 4 && await more.isVisible(); n++) { const count = await page.locator('.sdoc-history-diff-line').count(); await more.click(); await expect.poll(() => page.locator('.sdoc-history-diff-line').count()).toBeGreaterThan(count); }
    await expect(page.locator('.sdoc-history-diff-line.added')).toHaveCount(200); await expect(page.locator('.sdoc-history-diff-line.removed')).toHaveCount(200);
    await page.getByRole('button', { name: 'Close history panel', exact: true }).click(); await expect(page.locator('#_sd_history-panel')).toBeHidden();
  } finally { await f.close(); }
});
test('expired earlier versions show an explicit unavailable state', async ({ page }) => {
  const { f, doc, agent } = await setup(page);
  try {
    await agent('# History\n\nAgent update.\n'); const current = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document;
    await f.store.saveRevision({ userId: f.users.bob.id, documentId: doc.id, expectedHeadRevisionId: current.current_revision_id, markdown: '# History\n\nBrowser update.\n', idempotencyKey: 'retained-browser' });
    f.store.pruneRevisions({ documentId: doc.id, retainAfterMs: Date.now() + 1000 }); await page.evaluate(() => SDocs.checkCloudNow());
    await historyButton(page).click(); await page.getByRole('button', { name: /Edited in browser/ }).click(); await page.getByRole('button', { name: 'View changes', exact: true }).click(); await expect(page.locator('#_sd_history-panel')).toContainText('One of these versions is no longer available.');
    await expect(page.locator('#_sd_rendered > p')).toHaveText('Browser update.');
  } finally { await f.close(); }
});
test('revocation refuses new comparisons and clears the panel on reopening', async ({ page }) => {
  const { f, doc, agent } = await setup(page);
  try {
    await agent('# History\n\nAgent update.\n'); f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [f.users.bob.id, f.users.member.id] });
    await page.context().clearCookies(); await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.member.sessionToken, url: f.origin }]); await page.reload(); await historyButton(page).click();
    let release; const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/cloud/v1/documents/*/revisions/*', async route => { await gate; await route.continue(); });
    await page.getByRole('button', { name: /Agent \/ CLI update/ }).click(); await page.getByRole('button', { name: 'View changes', exact: true }).click(); await expect(page.locator('.sdoc-share-disclosure.open')).toContainText('Loading changes...');
    f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [f.users.bob.id] }); release();
    await expect(page.locator('.sdoc-share-disclosure.open')).toContainText('One of these versions is no longer available.'); await expect(page.locator('.sdoc-history-diff-line')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close history panel', exact: true }).click(); await historyButton(page).click(); await expect(page.locator('#_sd_history-panel')).toContainText('History is unavailable for this document.'); await expect(page.locator('.sdoc-history-entry')).toHaveCount(0);
  } finally { await f.close(); }
});
test('an agent update is signalled during browser editing without losing the draft', async ({ page }) => {
  const { f, doc, agent } = await setup(page);
  try {
    await page.locator('#_sd_btn-write').click(); await append(page, ' First edit.');
    await agent('# History\n\nOriginal paragraph. First edit.\n\n## Agent notes\n\nAdded by the assistant.\n');
    await append(page, ' Second edit.'); await expect(historyButton(page)).toBeVisible(); await expect(historyButton(page)).toHaveClass(/is-updated/);
    const saved = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document; expect(saved.markdown).toContain('Second edit.'); expect(saved.markdown).toContain('Added by the assistant.');
    const events = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/history')).data.entries;
    expect(events.map(e => e.kind)).toEqual(['browser', 'agent', 'browser', 'created']);
    expect(events[0].edit_session_id).toBe(events[2].edit_session_id);
  } finally { await f.close(); }
});
test('closing the panel discards a delayed comparison before starting a worker', async ({ page }) => {
  const { f, agent } = await setup(page);
  try {
    await agent('# History\n\nChanged paragraph.\n'); await page.evaluate(() => SDocs.checkCloudNow()); await historyButton(page).click();
    let release, completed = 0; const gate = new Promise(resolve => { release = resolve; }); const workers = [];
    page.on('worker', worker => { if (worker.url().includes('sdocs-history-diff-worker')) workers.push(worker); });
    await page.route('**/api/cloud/v1/documents/*/revisions/*', async route => { await gate; await route.fulfill({ json: { ok: true, document: { markdown: 'Late result' } } }); completed++; });
    await page.getByRole('button', { name: /Agent \/ CLI update/ }).click(); await page.getByRole('button', { name: 'View changes', exact: true }).click(); await page.getByRole('button', { name: 'Close history panel', exact: true }).click(); release();
    await expect.poll(() => completed).toBe(2); await expect(page.locator('#_sd_history-panel')).toBeHidden(); expect(workers).toHaveLength(0);
  } finally { await f.close(); }
});
test('history links reopen Cloud history while private copies have no history panel', async ({ page }) => {
  const { f, doc, agent } = await setup(page);
  try {
    await agent('# History\n\nUpdated paragraph.\n');
    await page.goto(f.origin + '/docs?cloud-document=' + doc.id + '#mode=history');
    await expect(page.locator('#_sd_history-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: /Agent \/ CLI update/ })).toHaveCount(1);
    const link = await page.evaluate(() => SDocs.generateShortLink());
    await page.goto(link.url + '&mode=history');
    await page.waitForFunction(() => window.SDocs && SDocs.shortLinkId);
    await expect(historyButton(page)).toBeHidden(); await expect(page.locator('#_sd_history-panel')).toBeHidden();
    expect(await page.evaluate(() => SDocs.currentMode)).toBe('read');
  } finally { await f.close(); }
});
test('history puts the person and explanation first and leaves text differences optional', async ({ page }) => {
  const { f, agent } = await setup(page);
  try {
    await agent('# History\n\nUpdated paragraph.\n'); await page.evaluate(() => SDocs.checkCloudNow());
    const reads = []; page.on('request', request => { if (/\/revisions\//.test(request.url())) reads.push(request.url()); });
    await historyButton(page).click();
    const entry = page.locator('.sdoc-history-entry').filter({ hasText: 'Agent / CLI update' });
    await expect(entry.locator('.sdoc-history-title')).toHaveText('You');
    await expect(entry.locator('.sdoc-history-reason')).toHaveText('Clarify the delivery plan');
    await entry.getByRole('button', { expanded: false }).click();
    await expect(page.getByRole('button', { name: 'Open as new document', exact: true })).toBeVisible();
    await expect(page.locator('.sdoc-history-diff-line')).toHaveCount(0); expect(reads).toHaveLength(0);
    await page.getByRole('button', { name: 'View changes', exact: true }).click();
    await expect(page.locator('.sdoc-history-diff-line.added')).toContainText('Updated paragraph.'); expect(reads).toHaveLength(2);
    await page.getByRole('button', { name: 'Hide changes', exact: true }).click();
    await expect(page.locator('.sdoc-share-disclosure.open .sdoc-history-comparison')).toBeHidden();
  } finally { await f.close(); }
});
test('open as new document copies a selected older version into a new tab without changing the original', async ({ page }) => {
  const source = '---\ntags:\n  - delivery\nstyles:\n  fontSize: 18\n---\n# History\n\nOriginal paragraph.\n';
  const { f, doc, agent } = await setup(page, source);
  try {
    await agent(source.replace('Original', 'First updated')); const latest = await agent(source.replace('Original', 'Latest updated'));
    await page.evaluate(() => SDocs.checkCloudNow()); await historyButton(page).click();
    await page.locator('.sdoc-history-entry').filter({ hasText: 'Agent / CLI update' }).nth(1).getByRole('button', { expanded: false }).click();
    const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const copy = await opening; await expect(copy.locator('#_sd_rendered h1')).toHaveText('History');
    await expect(copy.locator('#_sd_rendered > p')).toHaveText('First updated paragraph.');
    const copied = await copy.evaluate(() => ({ id: SDocs.cloudDocument.id, tags: SDocs.cloudDocument.tags, revision: SDocs.cloudDocument.revision_number }));
    expect(copied.id).not.toBe(doc.id); expect(copied.tags).toEqual(['delivery']); expect(copied.revision).toBe(1);
    const stored = (await f.api('bob', '/api/cloud/v1/documents/' + copied.id)).data.document;
    expect(stored.markdown).toBe(source.replace('Original', 'First updated'));
    expect((await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/head')).data.document.current_revision_id).toBe(latest.current_revision_id);
    const documents = f.store.db.prepare('SELECT count(*) AS n FROM cloud_documents').get().n;
    const reopening = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open copy', exact: true }).click();
    const reopened = await reopening; await expect(reopened).toHaveURL(new RegExp(copied.id));
    expect(f.store.db.prepare('SELECT count(*) AS n FROM cloud_documents').get().n).toBe(documents);
    await reopened.close(); await copy.close();
  } finally { await f.close(); }
});
test('a lost copy response can be retried without creating a second document', async ({ page }) => {
  const { f, agent } = await setup(page);
  try {
    await agent('# History\n\nUpdated paragraph.\n'); await page.evaluate(() => SDocs.checkCloudNow()); await historyButton(page).click();
    await page.locator('.sdoc-history-entry').filter({ hasText: 'Agent / CLI update' }).getByRole('button', { expanded: false }).click();
    const savedIds = [], keys = [];
    await page.route('**/revisions/*/copy', async route => {
      keys.push(route.request().postDataJSON().idempotency_key);
      const response = await route.fetch(); savedIds.push((await response.json()).document.id);
      if (savedIds.length === 1) await route.abort('failed'); else await route.fulfill({ response });
    });
    const firstPopup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const failedTab = await firstPopup; await expect(page.locator('#_sd_history-panel')).toContainText('Could not create this copy. Try again.');
    await expect.poll(() => failedTab.isClosed()).toBe(true);
    const retryPopup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const copy = await retryPopup; await expect(copy.locator('#_sd_rendered h1')).toHaveText('History');
    expect(savedIds).toHaveLength(2); expect(savedIds[0]).toBe(savedIds[1]); expect(keys[0]).toBe(keys[1]); await copy.close();
  } finally { await f.close(); }
});
test('a new update arriving during copy creation leaves the refreshed action usable', async ({ page }) => {
  const { f, agent } = await setup(page);
  try {
    await agent('# History\n\nFirst update.\n'); await page.evaluate(() => SDocs.checkCloudNow()); await historyButton(page).click();
    await page.locator('.sdoc-history-entry').filter({ hasText: 'Agent / CLI update' }).getByRole('button', { expanded: false }).click();
    let release; const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/revisions/*/copy', async route => { await gate; await route.continue(); });
    const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open as new document', exact: true }).click(); const copy = await opening;
    await agent('# History\n\nSecond update.\n'); await page.evaluate(() => SDocs.checkCloudNow());
    await expect(page.locator('.sdoc-history-entry').filter({ hasText: 'Agent / CLI update' })).toHaveCount(2);
    release(); await expect(copy.locator('#_sd_rendered > p')).toHaveText('First update.');
    await expect(page.getByRole('button', { name: 'Open copy', exact: true })).toBeEnabled(); await copy.close();
  } finally { await f.close(); }
});
test('long reasons use a preview and load the full explanation only on request', async ({ page }) => {
  const { f, agent } = await setup(page);
  try {
    const reason = 'Use the approved delivery decision. '.repeat(80) + '<img src=x onerror=alert(1)>';
    await agent('# History\n\nUpdated paragraph.\n', reason); await page.evaluate(() => SDocs.checkCloudNow());
    const reads = []; page.on('request', request => { if (/\/revisions\//.test(request.url())) reads.push(request.url()); });
    await historyButton(page).click(); const entry = page.locator('.sdoc-history-entry').filter({ hasText: 'Agent / CLI update' });
    expect((await entry.locator('.sdoc-history-reason').first().textContent()).length).toBeLessThanOrEqual(515);
    await entry.getByRole('button', { expanded: false }).click(); expect(reads).toHaveLength(0);
    await page.getByRole('button', { name: 'Read full reason', exact: true }).click();
    await expect(entry.locator('p.sdoc-history-reason')).toHaveText(reason); expect(reads).toHaveLength(1);
    await expect(entry.locator('img')).toHaveCount(0);
  } finally { await f.close(); }
});
