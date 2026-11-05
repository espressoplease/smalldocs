const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const fs = require('fs'), path = require('path');
const yaml = require('../cli/shared/sdocs-yaml');
const rich = fs.readFileSync(path.join(__dirname, 'fixtures/rich-edit-mode.md'), 'utf8');
test.use({ serviceWorkers: 'block' });

async function load(page, source = '# Working copy\n\nOriginal paragraph.\n') {
  await page.goto('/docs'); await page.waitForFunction(() => SDocs._appReady);
  await page.evaluate(source => { SDocs._isDefaultState = false; SDocs.loadText(source); SDocs.setAllSectionsOpen(true); SDocs.setMode('write'); }, source);
  await page.evaluate(() => SDocs.richWrite.ready);
}
async function append(page, text) {
  await page.locator('#_sd_write > p').last().evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); SDocs.writeEl.focus();
  });
  if (text) await page.keyboard.insertText(text);
}
function undo(page) { return page.getByRole('button', { name: 'Undo', exact: true }); }

test('Undo is the final edit pill, matches its height, and starts disabled', async ({ page }) => {
  await load(page); await expect(undo(page)).toBeVisible(); await expect(undo(page)).toBeDisabled();
  const geometry = await page.locator('#_sd_write-toolbar').evaluate(toolbar => {
    const pills = Array.from(toolbar.querySelectorAll('.sdoc-toolbar-pill'));
    return { last: pills.at(-1).getAttribute('aria-label'), heights: pills.map(node => node.getBoundingClientRect().height) };
  });
  expect(geometry.last).toBe('Edit history'); expect(new Set(geometry.heights).size).toBe(1);
});
test('clicking Undo restores the last typing, retains keyboard redo, and updates its disabled state', async ({ page }) => {
  await load(page); await append(page, ' More text.'); await expect(undo(page)).toBeEnabled(); await undo(page).click();
  await expect(page.locator('#_sd_write > p')).toHaveText('Original paragraph.'); await expect(undo(page)).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+Shift+z'); await expect(page.locator('#_sd_write > p')).toHaveText('Original paragraph. More text.'); await expect(undo(page)).toBeEnabled();
  await undo(page).click(); await page.locator('#_sd_btn-read').click(); expect(await page.evaluate(() => SDocs.currentBody)).toBe('# Working copy\n\nOriginal paragraph.\n');
});
test('Undo reverses a toolbar structure change without changing list numbering', async ({ page }) => {
  await load(page, '# Working copy\n\n7. First item.\n8. Last item.\n\nOriginal paragraph.\n'); await append(page, '');
  await page.locator('#_sd_wb-bq').click(); await expect(page.locator('#_sd_write blockquote')).toContainText('Original paragraph.'); await undo(page).click();
  await expect(page.locator('#_sd_write blockquote')).toHaveCount(0); await expect(page.locator('#_sd_write ol')).toHaveAttribute('start', '7');
});
test('Undo commits and reverses an active diagram draft, leaving every rich object rendered', async ({ page }) => {
  await load(page, rich); await page.getByRole('button', { name: 'Edit diagram text: Review', exact: true }).click();
  await page.getByRole('textbox', { name: 'Diagram text', exact: true }).fill('Changed review'); await expect(undo(page)).toBeEnabled(); await undo(page).click(); await page.evaluate(() => SDocs.richWrite.ready);
  await expect(page.getByRole('textbox', { name: 'Diagram text', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Edit diagram text: Review', exact: true })).toBeVisible();
  await expect(page.locator('#_sd_write .sdoc-cells-grid')).toHaveCount(2); await expect(page.locator('#_sd_write .sdoc-slide')).toHaveCount(1);
});
test('Undo reverses a committed spreadsheet edit and recalculates the workbook', async ({ page }) => {
  await load(page, rich); const cells = page.locator('#_sd_write .sdoc-cells'); await cells.first().locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();
  await page.locator('.sdoc-cells-editor').fill('175'); await page.locator('.sdoc-cells-editor').press('Enter'); await expect(undo(page)).toBeEnabled(); await undo(page).click(); await page.evaluate(() => SDocs.richWrite.ready);
  await expect(cells.first().locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('100'); await expect(cells.last().locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('300');
});
test('Undo reverses active slide typing while preserving the slide layout', async ({ page }) => {
  await load(page, rich); const title = page.locator('#_sd_write .sdoc-slide [data-shape-idx="0"] .inner');
  await title.click(); await title.press('ControlOrMeta+a'); await title.press('Backspace'); await title.pressSequentially('Changed title'); await undo(page).click(); await page.evaluate(() => SDocs.richWrite.ready);
  await expect(page.locator('#_sd_write .sdoc-slide')).toContainText('Delivery readiness'); await page.locator('#_sd_btn-read').click(); expect(await page.evaluate(() => SDocs.currentBody)).toContain('r 5 5 90 12 text=title | Delivery readiness');
});
test('opening another document and starting another edit session clears Undo history', async ({ page }) => {
  await load(page); await append(page, ' First edit.'); await expect(undo(page)).toBeEnabled(); await page.evaluate(() => SDocs.loadText('# Other document\n\nOther paragraph.\n'));
  await expect(undo(page)).toBeDisabled(); await append(page, ' Second edit.'); await expect(undo(page)).toBeEnabled(); await page.locator('#_sd_btn-read').click(); await page.locator('#_sd_btn-write').click(); await expect(undo(page)).toBeDisabled();
  await expect(page.locator('#_sd_write > p')).toHaveText('Other paragraph. Second edit.');
});
test('mobile Undo stays reachable without adding a third row of edit pills', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page); await append(page, ' More text.'); await undo(page).click(); await expect(page.locator('#_sd_write > p')).toHaveText('Original paragraph.');
  const rows = await page.locator('#_sd_write-toolbar .sdoc-toolbar-pill').evaluateAll(pills => pills.map(node => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(rows).size).toBeLessThanOrEqual(2);
});
test('Undo uses ordinary Cloud autosave and keeps the same document and its metadata', async ({ page }) => {
  const f = await startFixture({ singlePlan: true });
  try {
    const created = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', { account_id: f.team.workspaceId, filename: 'undo.md', markdown: yaml.serializeFrontMatter({ tags: ['editing'] }) + '\n# Working copy\n\nOriginal paragraph.\n', idempotency_key: 'undo-fixture' });
    expect(created.status).toBe(201); const doc = created.data.document;
    await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]); await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
    await expect(page.locator('#_sd_rendered h1')).toHaveText('Working copy'); await page.locator('#_sd_btn-write').click(); await append(page, ' More text.'); await page.evaluate(() => SDocs.saveCloudNow());
    const edited = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document; expect(edited.markdown).toContain('More text.'); await undo(page).click(); await page.evaluate(() => SDocs.saveCloudNow());
    const restored = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document; expect(restored.id).toBe(doc.id); expect(restored.markdown).not.toContain('More text.'); expect(restored.tags).toContain('editing'); expect(restored.current_revision_id).not.toBe(edited.current_revision_id);
    await page.reload(); await expect(page.locator('#_sd_rendered > p')).toHaveText('Original paragraph.');
  } finally { await f.close(); }
});
