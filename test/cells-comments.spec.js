const { test, expect } = require('@playwright/test');

const sheet = '```cells Sales\nProduct,Revenue,Cost\nNorth,100,60\nSouth,300,100\nWest,200,80\n```';
const second = '```cells Costs\nItem,Amount\nHosting,40\nSupport,70\n```';
async function load(page, md = sheet) {
  await page.goto('/docs');
  await page.waitForFunction(() => window.SDocs && SDocs._appReady);
  await page.evaluate(markdown => { SDocs.loadText(markdown); SDocs.setMode('comment'); SDocs.setAllSectionsOpen(true); }, md);
  await expect(page.locator('.sdoc-cells-grid').first()).toBeVisible();
}
async function save(page, wrapper, text) {
  await wrapper.getByRole('button', { name: 'Comment on selected cells', exact: true }).click();
  const input = page.locator('.sdoc-cells-comment-card.sdoc-card-edit .sdoc-card-input');
  await input.fill(text);
  await page.locator('.sdoc-cells-comment-card.sdoc-card-edit .sdoc-card-save').click();
  await expect(page.locator('.sdoc-cells-comment-card .sdoc-card-body').first()).toHaveText(text);
}

test('cell feedback keeps formulas and grid shape unchanged, then edit/resolve/delete work', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await load(page, sheet + '\n\n```cells Totals\nTotal,=Sales!B2+Sales!B3\n```');
  const wrapper = page.locator('.sdoc-cells').first();
  const before = await wrapper.locator('.sdoc-cells-cell').allTextContents();
  const originalWidth = (await wrapper.boundingBox()).width;
  await wrapper.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await save(page, wrapper, 'Check North revenue.');
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0].kind)).toBe('cells');
  await expect(wrapper.locator('.sdoc-cells-commented')).toHaveText('100');
  expect(await wrapper.locator('.sdoc-cells-cell').allTextContents()).toEqual(before);
  expect((await wrapper.boundingBox()).width).toBeCloseTo(originalWidth, 0);
  expect(await wrapper.locator('.sdoc-cells-grid .sdoc-card').count()).toBe(0);
  await wrapper.locator('.sdoc-card-body').click();
  await wrapper.locator('.sdoc-card-input').fill('Use audited revenue.');
  await wrapper.locator('.sdoc-card-save').click();
  await expect(wrapper.locator('.sdoc-card-body')).toHaveText('Use audited revenue.');
  await wrapper.getByRole('button', { name: 'Resolve comment', exact: true }).click();
  await expect(wrapper.locator('.sdoc-thread-status')).toHaveText('Resolved');
  await wrapper.getByRole('button', { name: 'Reopen comment', exact: true }).click();
  await wrapper.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await expect(page.locator('.sdoc-cells-comment-card')).toHaveCount(0);
  await expect(wrapper.locator('.sdoc-cells-commented')).toHaveCount(0);
  expect(await wrapper.locator('.sdoc-cells-cell').allTextContents()).toEqual(before);
  expect(errors).toEqual([]);
});

test('a sorted range refers only to selected source rows and follows them when unsorted', async ({ page }) => {
  await load(page);
  const wrapper = page.locator('.sdoc-cells');
  await wrapper.locator('.sdoc-cells-sort[data-c="1"]').click();
  await wrapper.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await page.keyboard.down('Shift'); await wrapper.locator('.sdoc-cells-cell[data-r="2"][data-c="2"]').click(); await page.keyboard.up('Shift');
  await save(page, wrapper, 'Compare these two regions.');
  const c = await page.evaluate(() => SDocs.currentMeta.comments[0]);
  expect(c.cells_rows).toEqual([1, 3]);
  expect(c.cell_values).toEqual([['100', '60'], ['200', '80']]);
  await expect(wrapper.locator('.sdoc-table-target-label')).toHaveText('Sales B2:C2, B4:C4');
  expect(await wrapper.locator('.sdoc-cells-commented').allTextContents()).toEqual(['100', '60', '200', '80']);
  // A save restores the source grid order. The same four source cells stay marked.
  await wrapper.locator('.sdoc-cells-sort[data-c="1"]').click();
  expect(await wrapper.locator('.sdoc-cells-commented').allTextContents()).toEqual(['100', '60', '200', '80']);
});

test('multiple sheets keep notes scoped, survive YAML roundtrip and mode changes', async ({ page }) => {
  await load(page, sheet + '\n\n' + second);
  const wrapper = page.locator('.sdoc-cells').nth(1);
  await wrapper.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await save(page, wrapper, 'Confirm hosting cost.');
  await expect(page.locator('.sdoc-cells').first().locator('.sdoc-cells-comment-card')).toHaveCount(0);
  await page.evaluate(() => {
    const text = SDocYaml.serializeFrontMatter(SDocs.currentMeta) + '\n' + SDocs.currentBody;
    SDocs.loadText(text); SDocs.setMode('read'); SDocs.setMode('comment');
  });
  await expect(page.locator('.sdoc-cells').nth(1).locator('.sdoc-cells-commented')).toHaveText('40');
  await expect(page.locator('.sdoc-cells-comment-orphan')).toHaveCount(0);
});

test('duplicate sheet content uses the source position only while document is unchanged', async ({ page }) => {
  await load(page, sheet + '\n\n' + sheet);
  const wrapper = page.locator('.sdoc-cells').nth(1);
  await wrapper.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await save(page, wrapper, 'This second copy.');
  await expect(page.locator('.sdoc-cells').first().locator('.sdoc-cells-comment-card')).toHaveCount(0);
  await expect(page.locator('.sdoc-cells').nth(1).locator('.sdoc-cells-comment-card')).toHaveCount(1);
  await page.evaluate(() => { SDocs.currentBody = 'An unrelated edit.\n\n' + SDocs.currentBody; SDocs.syncAll('comment'); });
  await expect(page.locator('.sdoc-cells-comment-orphan')).toHaveCount(1);
  await expect(page.locator('.sdoc-card-orphan-badge')).toHaveText('anchor ambiguous');
});

test('fullscreen cell comments remain usable and match inline feedback', async ({ page }) => {
  await load(page, sheet + '\n\n' + second);
  await page.locator('.sdoc-cells').first().getByRole('button', { name: /Expand|fullscreen/i }).click();
  const focus = page.locator('.sdoc-cells-focus');
  await expect(focus).toBeVisible();
  const grid = focus.locator('.sdoc-cells');
  await grid.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await save(page, focus, 'Fullscreen review.');
  await expect(focus.locator('.sdoc-cells-comment-card .sdoc-card-body')).toHaveText('Fullscreen review.');
  await expect(focus.locator('.sdoc-cells-commented')).toHaveText('100');
  await focus.getByRole('button', { name: /Close/i }).click();
  await expect(page.locator('.sdoc-cells').first().locator('.sdoc-card-body')).toHaveText('Fullscreen review.');
});

test('mobile range cards stay outside the grid and fit the sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 }); await load(page);
  const wrapper = page.locator('.sdoc-cells');
  await wrapper.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await save(page, wrapper, 'Compare the region against last quarter before approval.');
  const card = wrapper.locator('.sdoc-cells-comment-card'), scroll = wrapper.locator('.sdoc-cells-scroll');
  const cb = await card.boundingBox(), sb = await scroll.boundingBox();
  expect(cb.y).toBeGreaterThanOrEqual(sb.y + sb.height);
  expect(cb.x + cb.width).toBeLessThanOrEqual(390);
});

test('comment navigation reveals the matching sheet in an inline workbook', async ({ page }) => {
  await load(page, '---\ncells-tabs: tabbed\n---\n' + sheet + '\n\n' + second);
  await page.getByRole('tab', { name: 'Costs', exact: true }).click();
  const costs = page.locator('.sdoc-cells').nth(1);
  await costs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await save(page, costs, 'Check this expense.');
  await page.getByRole('tab', { name: 'Sales', exact: true }).click();
  await expect(costs).not.toBeVisible();
  await page.evaluate(() => SDocs.commentsUi.focusComment('c1'));
  await expect(costs).toBeVisible();
  await expect(costs.locator('.sdoc-card[data-c="c1"]')).toBeVisible();
});

test('fullscreen comments survive switching sheets after a save', async ({ page }) => {
  await load(page, sheet + '\n\n' + second);
  await page.locator('.sdoc-cells').first().getByRole('button', { name: /Expand|fullscreen/i }).click();
  const focus = page.locator('.sdoc-cells-focus');
  await focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await save(page, focus, 'Review revenue.');
  await focus.getByRole('tab', { name: 'Costs', exact: true }).click();
  await focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await focus.getByRole('button', { name: 'Comment on selected cells', exact: true }).click();
  await focus.locator('.sdoc-card-input').fill('Review hosting.');
  await focus.locator('.sdoc-card-save').click();
  await expect(focus.locator('.sdoc-card-body')).toHaveText('Review hosting.');
  await focus.getByRole('tab', { name: 'Sales', exact: true }).click();
  await expect(focus.locator('.sdoc-card-body')).toHaveText('Review revenue.');
  const comments = await page.evaluate(() => SDocs.currentMeta.comments);
  expect(comments.map(c => c.sheet_name)).toEqual(['Sales', 'Costs']);
});

test('scratch cell edits do not change the document value used as comment context', async ({ page }) => {
  await load(page);
  await page.locator('.sdoc-cells').getByRole('button', { name: /Expand|fullscreen/i }).click();
  const focus = page.locator('.sdoc-cells-focus');
  await focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();
  await page.locator('.sdoc-cells-editor').fill('250');
  await page.keyboard.press('Enter');
  await focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await focus.getByRole('button', { name: 'Comment on selected cells', exact: true }).click();
  await expect(focus.locator('.sdoc-table-target-label')).toContainText('B2 in saved sheet');
  await focus.locator('.sdoc-card-input').fill('Compare this saved value.');
  await focus.locator('.sdoc-card-save').click();
  const state = await page.evaluate(() => ({ comment: SDocs.currentMeta.comments[0], body: SDocs.currentBody }));
  expect(state.comment.cell_values).toEqual([['100']]);
  expect(state.body).toContain('North,100,60');
});

test('late annotation repaint keeps an active sheet draft and its text', async ({ page }) => {
  await load(page);
  const wrapper = page.locator('.sdoc-cells');
  await wrapper.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await wrapper.getByRole('button', { name: 'Comment on selected cells', exact: true }).click();
  await wrapper.locator('.sdoc-card-input').fill('Keep this draft.');
  await page.evaluate(() => SDocs.commentsUi.render());
  await expect(wrapper.locator('.sdoc-card-input')).toHaveValue('Keep this draft.');
  await wrapper.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => SDocs.currentMeta.comments || [])).toEqual([]);
});

test('saved cell context follows a uniquely matching row after insertion', async ({ page }) => {
  await load(page);
  const wrapper = page.locator('.sdoc-cells');
  await wrapper.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').click();
  await save(page, wrapper, 'Check South.');
  await page.evaluate(() => {
    SDocs.currentBody = SDocs.currentBody.replace('North,100,60', 'East,50,20\nNorth,100,60');
    SDocs.syncAll('comment');
  });
  await expect(wrapper.locator('.sdoc-cells-commented')).toHaveText('300');
  await expect(wrapper.locator('.sdoc-table-target-label')).toHaveText('Sales B4');
  await expect(page.locator('.sdoc-cells-comment-orphan')).toHaveCount(0);
});

test('an invalid out-of-sheet saved range is shown as unplaced without expanding it', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const entry = SDocs.cellsWorkbook[0];
    const note = SDocComments.addCellsComment(SDocs.currentMeta, {
      block: 'cells:0', sheet_name: entry.name, sheet_source: entry.rawSrc,
      document_hash: SDocComments.documentFingerprint(SDocs.currentBody),
      range: { start_row: 1, start_col: 1, end_row: 1000000000, end_col: 1000000000 },
    }, { text: 'Imported target is outside the sheet.' });
    SDocs.currentMeta = note.meta; SDocs.commentsUi.render();
  });
  await expect(page.locator('.sdoc-cells-comment-orphan')).toHaveCount(1);
  await expect(page.locator('.sdoc-cells-commented')).toHaveCount(0);
});

test('a reader can start cell feedback directly from a fullscreen sheet', async ({ page }) => {
  await load(page);
  await page.evaluate(() => SDocs.setMode('read'));
  await page.locator('.sdoc-cells').getByRole('button', { name: /Expand|fullscreen/i }).click();
  const focus = page.locator('.sdoc-cells-focus');
  await focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await focus.getByRole('button', { name: 'Comment on selected cells', exact: true }).click();
  await expect(focus.locator('.sdoc-card-edit .sdoc-card-input')).toBeVisible();
  await focus.locator('.sdoc-card-input').fill('Review this without leaving the sheet.');
  await focus.locator('.sdoc-card-save').click();
  await expect(focus.locator('.sdoc-card-body')).toHaveText('Review this without leaving the sheet.');
  expect(await page.evaluate(() => document.body.classList.contains('comment-mode'))).toBe(true);
});
