// @ts-check
//
// Cells (sheets-v1) integration tests: the ```cells fenced block renders
// to a CSS-grid sheet, replaces its source, aligns by type, pads ragged
// rows, and is XSS-safe (cell text is plain text, never markup).
//
// BASE defaults to the playwright.config server (:3000); override with
// SDOCS_TEST_BASE to run against a server on another port.
const { test, expect } = require('@playwright/test');

const BASE = process.env.SDOCS_TEST_BASE || 'http://localhost:3000';

async function loadDoc(page, markdown) {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((md) => window.SDocs.loadText(md), markdown);
}

const FENCE = '```';

test('renders a ```cells block as a grid', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Region,Q1,Q2', 'North,100,150', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('.sdoc-cells-grid').count()).toBe(1);
  // 2 rows x 3 cols (incl. the padded nothing) -> 6 data cells
  expect(await page.locator('.sdoc-cells-cell').count()).toBe(6);
});

test('shows column letters and row numbers', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b,c', '1,2,3', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('.sdoc-cells-colhead-label').allInnerTexts()).toEqual(['A', 'B', 'C']);
  expect(await page.locator('.sdoc-cells-rowhead').allInnerTexts()).toEqual(['1', '2']);
});

test('replaces the source (no raw cells code visible)', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'x,y', '1,2', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('#_sd_rendered code.language-cells').count()).toBe(0);
});

test('numbers align right, text aligns left, all vertically centred', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Label,123', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const textCell = page.locator('.sdoc-cells-cell.is-text').first();
  const numCell = page.locator('.sdoc-cells-cell.is-number').first();
  const rowHead = page.locator('.sdoc-cells-rowhead').first();
  expect(await textCell.evaluate((el) => getComputedStyle(el).justifyContent)).toBe('flex-start');
  expect(await numCell.evaluate((el) => getComputedStyle(el).justifyContent)).toBe('flex-end');
  // every cell type centres its content vertically
  for (const loc of [textCell, numCell, rowHead]) {
    expect(await loc.evaluate((el) => getComputedStyle(el).alignItems)).toBe('center');
  }
});

test('ragged rows are padded into a rectangle', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b,c', 'x', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('.sdoc-cells-cell').count()).toBe(6); // 2 x 3
  expect(await page.locator('.sdoc-cells-cell.is-empty').count()).toBe(2);
});

test('cell content is plain text - no markup injection', async ({ page }) => {
  let dialog = false;
  page.on('dialog', (d) => { dialog = true; d.dismiss(); });
  const payload = [
    FENCE + 'cells',
    'name,evil',
    '"<b>x</b>","<img src=q onerror=alert(1)>"',
    FENCE,
  ].join('\n');
  await loadDoc(page, payload);
  await page.waitForSelector('.sdoc-cells-grid');
  await page.waitForTimeout(200);
  const grid = page.locator('.sdoc-cells-grid');
  expect(await grid.locator('img').count()).toBe(0);
  expect(await grid.locator('b').count()).toBe(0);
  expect(dialog).toBe(false);
  // the markup survives as literal text in its cell (row 1, col 0)
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').innerText()).toBe('<b>x</b>');
});

test('long values wrap, <br> and embedded newlines break lines (no markup)', async ({ page }) => {
  await loadDoc(page, [
    FENCE + 'cells',
    'label,note',
    'br,one<br>two',
    'multi,"alpha',
    'beta"',
    FENCE,
  ].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const brCell = page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]');
  const multiCell = page.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]');
  // <br> becomes a newline, NOT a <br> element (still plain text)
  expect(await brCell.evaluate((el) => el.querySelectorAll('br').length)).toBe(0);
  expect(await brCell.evaluate((el) => el.textContent.includes('\n'))).toBe(true);
  // embedded CSV newline survives
  expect(await multiCell.evaluate((el) => el.textContent)).toBe('alpha\nbeta');
  // cells wrap and the column is capped (so long text wraps rather than runs wide)
  expect(await brCell.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  expect(await brCell.evaluate((el) => getComputedStyle(el).maxWidth)).not.toBe('none');
});

test('empty block renders an error, not a grid', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', '   ', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-error');
  expect(await page.locator('.sdoc-cells-grid').count()).toBe(0);
});

test('truncation note sits outside the scroller so it stays pinned', async ({ page }) => {
  // A 230-col block trips the column cap and shows the note.
  const header = ['row'].concat(Array.from({ length: 230 }, (_, i) => 'c' + (i + 1))).join(',');
  await loadDoc(page, [FENCE + 'cells', header, '1,2,3', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-note');
  // The grid is inside the scroller; the note is a sibling of the scroller,
  // not a descendant of it - that is what keeps it from scrolling away.
  expect(await page.locator('.sdoc-cells > .sdoc-cells-scroll > .sdoc-cells-grid').count()).toBe(1);
  expect(await page.locator('.sdoc-cells > .sdoc-cells-note').count()).toBe(1);
  expect(await page.locator('.sdoc-cells-scroll .sdoc-cells-note').count()).toBe(0);
});

test('clicking a cell selects it and highlights its axis headers', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Region,Q1,Q2', 'North,100,150', 'South,90,95', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await expect(page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveClass(/is-active/);
  expect(await page.locator('.sdoc-cells-colhead[data-c="1"].is-active-col').count()).toBe(1);
  expect(await page.locator('.sdoc-cells-rowhead[data-r="1"].is-active-row').count()).toBe(1);
  // only one active cell at a time
  expect(await page.locator('.sdoc-cells-cell.is-active').count()).toBe(1);
});

test('arrow keys move the selection; Ctrl+arrow jumps to the far edge', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b,c,d', '1,2,3,4', '5,6,7,8', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await page.locator('.sdoc-cells-cell[data-r="0"][data-c="0"]').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sdoc-cells-cell[data-r="0"][data-c="1"]')).toHaveClass(/is-active/);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveClass(/is-active/);
  // jump to the last column (index 3)
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.locator('.sdoc-cells-cell[data-r="1"][data-c="3"]')).toHaveClass(/is-active/);
  // jump to the first row (index 0)
  await page.keyboard.press('Control+ArrowUp');
  await expect(page.locator('.sdoc-cells-cell[data-r="0"][data-c="3"]')).toHaveClass(/is-active/);
  // arrows clamp at the edge - can't go past the last column
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sdoc-cells-cell[data-r="0"][data-c="3"]')).toHaveClass(/is-active/);
});

test('click-drag selects a rectangular range', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b,c,d', '1,2,3,4', '5,6,7,8', '9,10,11,12', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const from = page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]');
  const to = page.locator('.sdoc-cells-cell[data-r="2"][data-c="2"]');
  await from.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();
  // a 2x2 range = 4 cells highlighted, axis spans 2 cols + 2 rows
  expect(await page.locator('.sdoc-cells-cell.in-range').count()).toBe(4);
  expect(await page.locator('.sdoc-cells-colhead.is-active-col').count()).toBe(2);
  expect(await page.locator('.sdoc-cells-rowhead.is-active-row').count()).toBe(2);
  // no single-cell box while a range is active
  expect(await page.locator('.sdoc-cells-cell.is-active').count()).toBe(0);
});

test('shift+arrow extends the range; a plain arrow collapses it', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b,c', '1,2,3', '4,5,6', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await page.locator('.sdoc-cells-cell[data-r="0"][data-c="0"]').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  // anchor A1 (0,0) -> focus B2 (1,1): a 2x2 range
  expect(await page.locator('.sdoc-cells-cell.in-range').count()).toBe(4);
  // a plain arrow collapses back to a single active cell
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('.sdoc-cells-cell.in-range').count()).toBe(0);
  expect(await page.locator('.sdoc-cells-cell.is-active').count()).toBe(1);
});

test('dragging to the right edge auto-scrolls and extends the range', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  const header = ['m'].concat(Array.from({ length: 30 }, (_, i) => 'c' + i)).join(',');
  const row = ['R'].concat(Array.from({ length: 30 }, (_, i) => String(i))).join(',');
  await loadDoc(page, [FENCE + 'cells', header, row, FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const scroll = page.locator('.sdoc-cells-scroll');
  expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  await page.locator('.sdoc-cells-cell[data-r="0"][data-c="0"]').hover();
  await page.mouse.down();
  const box = await scroll.boundingBox();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2); // hold at right edge
  await page.waitForTimeout(500);                                       // let it auto-scroll
  await page.mouse.up();

  expect(await scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const maxCol = await page.evaluate(() => {
    let m = 0;
    document.querySelectorAll('.sdoc-cells-cell.in-range').forEach((e) => { m = Math.max(m, +e.dataset.c); });
    return m;
  });
  expect(maxCol).toBeGreaterThan(5); // range swept well past the initially-visible columns
});

test('toolbar: copy whole sheet, copy selection, address + dynamic label', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loadDoc(page, [FENCE + 'cells', 'Region,Q1,Q2', 'North,100,150', 'South,90,95', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-bar');

  // Nothing selected: only the always-on copy button; no address.
  await expect(page.locator('.sdoc-cells-copy-all')).toBeVisible();
  await expect(page.locator('.sdoc-cells-copy-sel')).toBeHidden();
  expect(await page.locator('.sdoc-cells-ref').innerText()).toBe('');

  // Copy the whole sheet as CSV (values only, no axis chrome).
  await page.locator('.sdoc-cells-copy-all').click();
  expect(await page.evaluate(() => navigator.clipboard.readText()))
    .toBe('Region,Q1,Q2\nNorth,100,150\nSouth,90,95');

  // Single cell -> address + "cell" button copying that one value.
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await expect(page.locator('.sdoc-cells-copy-sel')).toBeVisible();
  expect(await page.locator('.sdoc-cells-copy-sel .sdoc-cells-copy-label').innerText()).toBe('cell');
  expect(await page.locator('.sdoc-cells-ref').innerText()).toBe('B2');
  await page.locator('.sdoc-cells-copy-sel').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('100');

  // Range -> "selection" button + A1-style address span, copies the block.
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').hover();
  await page.mouse.down();
  await page.locator('.sdoc-cells-cell[data-r="2"][data-c="2"]').hover();
  await page.mouse.up();
  expect(await page.locator('.sdoc-cells-copy-sel .sdoc-cells-copy-label').innerText()).toBe('selection');
  expect(await page.locator('.sdoc-cells-ref').innerText()).toBe('B2:C3');
  await page.locator('.sdoc-cells-copy-sel').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('100,150\n90,95');

  // Escape (with the grid focused) clears the selection: button hides, address empties.
  await page.locator('.sdoc-cells-grid').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdoc-cells-copy-sel')).toBeHidden();
  expect(await page.locator('.sdoc-cells-ref').innerText()).toBe('');
});

test('top bar height stays constant when the dynamic copy button appears', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b', '1,2', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-bar');
  const before = await page.locator('.sdoc-cells-bar').evaluate((el) => el.offsetHeight);
  await page.locator('.sdoc-cells-cell[data-r="0"][data-c="0"]').click();
  await expect(page.locator('.sdoc-cells-copy-sel')).toBeVisible();
  const after = await page.locator('.sdoc-cells-bar').evaluate((el) => el.offsetHeight);
  expect(after).toBe(before);
});

test('copy button reverts to the copy icon after the tick, even on a repeat click', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loadDoc(page, [FENCE + 'cells', 'a,b', '1,2', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-bar');
  const glyph = () => page.locator('.sdoc-cells-copy-all svg')
    .evaluate((s) => s.querySelector('rect') ? 'copy' : (s.querySelector('polyline') ? 'tick' : '?'));
  await page.locator('.sdoc-cells-copy-all').click();
  await page.waitForTimeout(150);
  expect(await glyph()).toBe('tick');
  await page.locator('.sdoc-cells-copy-all').click();   // re-click while the tick is up
  await page.waitForTimeout(1700);
  expect(await glyph()).toBe('copy');                   // must not be stuck on a tick
});

test('a baked CSV reference renders with the source filename in the bar', async ({ page }) => {
  await loadDoc(page, [
    FENCE + 'cells', 'sdoc-cells: source=report.csv', 'Region,Q1', 'North,100', FENCE,
  ].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('.sdoc-cells-ref').innerText()).toBe('report.csv');
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  expect(await page.locator('.sdoc-cells-ref').innerText()).toBe('A2 · report.csv');
});

test('an unresolved {{ref}} with no bridge shows a load-with-CLI message', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', '{{data/report.csv}}', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-error');
  expect(await page.locator('.sdoc-cells-grid').count()).toBe(0);
  expect(await page.locator('.sdoc-cells-error-msg').innerText()).toContain('data/report.csv');
});

test('a {{ref}} resolves live via the bridge, leaving the document untouched', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  // Stand in for a connected bridge that reads the referenced file.
  await page.evaluate(() => {
    window.SDocs.bridge = {
      readFile: function () { return Promise.resolve('Month,Revenue\nJan,12000\nFeb,13500\n'); },
    };
  });
  await page.evaluate((md) => window.SDocs.loadText(md),
    [FENCE + 'cells', '{{data/sales.csv}}', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('.sdoc-cells-ref').innerText()).toBe('sales.csv');
  expect(await page.locator('.sdoc-cells-cell').count()).toBe(6); // 3 rows x 2 cols
  // The document keeps its {{ref}} - the save loop is never handed baked data.
  expect(await page.evaluate(() => window.SDocs.currentBody.includes('{{data/sales.csv}}'))).toBe(true);
});

test('expand opens a fullscreen focus overlay with a name/value bar', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Region,Q1,Q2', 'North,100,150', 'South,90,95', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await page.locator('.sdoc-cells-expand').click();
  await page.waitForSelector('.sdoc-cells-focus');
  // The overlay supplies the chrome; the inline toolbar is suppressed inside it.
  expect(await page.locator('.sdoc-cells-focus .sdoc-cells-bar').count()).toBe(0);
  // Selecting a cell updates the name box + value field.
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  expect(await page.locator('.sdoc-cells-focus-name').innerText()).toBe('B2');
  expect(await page.locator('.sdoc-cells-focus-value').innerText()).toBe('100');
  // Esc closes it.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdoc-cells-focus')).toHaveCount(0);
});

test('fullscreen pads the grid with empty cells past the data', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b', '1,2', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  // Inline does NOT pad - just the 2x2 data.
  expect(await page.locator('.sdoc-cells-colhead').count()).toBe(2);
  await page.locator('.sdoc-cells-expand').click();
  await page.waitForSelector('.sdoc-cells-focus');
  // Fullscreen pads well beyond the data so the canvas fills + scrolls.
  expect(await page.locator('.sdoc-cells-focus .sdoc-cells-colhead').count()).toBeGreaterThan(10);
  const far = page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="5"][data-c="5"]');
  await expect(far).toHaveCount(1);
  await far.click();
  expect(await page.locator('.sdoc-cells-focus-name').innerText()).toBe('F6');
  expect(await page.locator('.sdoc-cells-focus-value').innerText()).toBe(''); // padded cell is empty
});

test('fullscreen shows Sum / Avg / Count for a selected range', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b', '10,20', '30,40', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await page.locator('.sdoc-cells-expand').click();
  await page.waitForSelector('.sdoc-cells-focus');
  // No stats for a single cell.
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  expect((await page.locator('.sdoc-cells-focus-status').innerText()).trim()).toBe('');
  // Drag the 2x2 numeric block (10,20,30,40).
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="0"]').hover();
  await page.mouse.down();
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="2"][data-c="1"]').hover();
  await page.mouse.up();
  const status = await page.locator('.sdoc-cells-focus-status').innerText();
  expect(status).toContain('Sum');
  expect(status).toContain('100');   // 10+20+30+40
  expect(status).toContain('Avg');
  expect(status).toContain('25');    // 100 / 4
  expect(status).toContain('Count');
  expect(status).toMatch(/Count\D*4/);
});

test('numbers display with thousands separators; negatives get a red class', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Revenue,Loss', '12000,-3500', 'Small,9', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').innerText()).toBe('12,000');
  expect(await page.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').innerText()).toBe('9'); // small, no separator
  const neg = page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]');
  expect(await neg.innerText()).toBe('-3,500');
  await expect(neg).toHaveClass(/is-negative/);
  // copy still emits the RAW value (no separators) - data integrity
  const html = await page.evaluate(() => window.SDocs.buildExportHTML([]));
  expect(html).toContain('12000');
  expect(html).not.toContain('12,000');
});

test('clicking a column header selects the whole column; a row header the whole row', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b,c', '1,2,3', '4,5,6', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  // Click column B's header -> the whole column is selected.
  await page.locator('.sdoc-cells-colhead[data-c="1"]').click();
  expect(await page.locator('.sdoc-cells-cell.in-range[data-c="1"]').count()).toBe(3);
  expect(await page.locator('.sdoc-cells-cell.in-range[data-c="0"]').count()).toBe(0);
  expect(await page.locator('.sdoc-cells-colhead.is-active-col[data-c="1"]').count()).toBe(1);
  // Click row 2's header (data-r=1) -> the whole row is selected.
  await page.locator('.sdoc-cells-rowhead[data-r="1"]').click();
  expect(await page.locator('.sdoc-cells-cell.in-range[data-r="1"]').count()).toBe(3);
  expect(await page.locator('.sdoc-cells-cell.in-range[data-r="0"]').count()).toBe(0);
});

test('a format: directive applies currency / percent / plain per column', async ({ page }) => {
  await loadDoc(page, [
    FENCE + 'cells',
    'format: A=plain B=$ C=%',
    'Year,Revenue,Margin',
    '2024,12000,0.23',
    FENCE,
  ].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').innerText()).toBe('2024');     // plain - no comma on the year
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').innerText()).toBe('$12,000.00'); // currency
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="2"]').innerText()).toBe('23%');        // percent
  // copy still emits the raw values
  const html = await page.evaluate(() => window.SDocs.buildExportHTML([]));
  expect(html).toContain('0.23');
  expect(html).not.toContain('23%');
});

test('clicking a sort caret sorts the view (asc -> desc -> off), header kept', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Name,Score', 'Bea,30', 'Al,10', 'Cy,20', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const caret = page.locator('.sdoc-cells-colhead[data-c="1"] .sdoc-cells-sort');
  // asc by Score: header (row 0) fixed, then 10, 20, 30
  await caret.click();
  expect(await page.locator('.sdoc-cells-cell[data-r="0"][data-c="0"]').innerText()).toBe('Name'); // header stays
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').innerText()).toBe('Al');
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').innerText()).toBe('10');
  // desc
  await caret.click();
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').innerText()).toBe('Bea');
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').innerText()).toBe('30');
  // off -> original order
  await caret.click();
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').innerText()).toBe('Bea'); // original row 1
});

test('dragging a column header resize handle widens the column', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b,c', '1,2,3', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const colB = page.locator('.sdoc-cells-colhead[data-c="1"]');
  const before = (await colB.boundingBox()).width;
  const hb = await page.locator('.sdoc-cells-colhead[data-c="1"] .sdoc-cells-resize').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 90, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = (await colB.boundingBox()).width;
  expect(after).toBeGreaterThan(before + 50);
});

test('a detected text header row is styled bold; numeric-only sheets are not', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Region,Q1', 'North,100', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await expect(page.locator('.sdoc-cells-cell[data-r="0"][data-c="0"]')).toHaveClass(/is-header/);
  expect(await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"].is-header').count()).toBe(0);
  await loadDoc(page, [FENCE + 'cells', '1,2', '3,4', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  expect(await page.locator('.sdoc-cells-cell.is-header').count()).toBe(0); // no header in numeric-only
});

test('export inlines the grid as a real table', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Region,Q1', 'North,100', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const html = await page.evaluate(() => window.SDocs.buildExportHTML([]));
  expect(html).toContain('<table>');
  expect(html).toContain('North');
  expect(html).not.toContain('sdoc-cells-grid');
});

// Regression: a sheet narrower than the page must not show a spurious
// horizontal scrollbar. The scroller now sizes to the grid (not the toolbar),
// so a small grid fits exactly; a genuinely wide grid still overflows and
// scrolls. (Polled because layout settles a frame or two after first paint.)
test('a narrow sheet has no horizontal scrollbar', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Region,Q1,Q2', 'North,100,150', 'South,90,95', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await expect(async () => {
    const over = await page.evaluate(() => {
      const el = document.querySelector('.sdoc-cells-scroll');
      return el.scrollWidth - el.clientWidth;
    });
    expect(over).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 3000 });
});

test('a sheet wider than the page still scrolls', async ({ page }) => {
  const head = Array.from({ length: 40 }, (_, i) => 'LongColHeading' + i).join(',');
  const row = Array.from({ length: 40 }, (_, i) => 'cellvalue' + i).join(',');
  await loadDoc(page, [FENCE + 'cells', head, row, FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await expect(async () => {
    const over = await page.evaluate(() => {
      const el = document.querySelector('.sdoc-cells-scroll');
      return el.scrollWidth - el.clientWidth;
    });
    expect(over).toBeGreaterThan(1);
  }).toPass({ timeout: 3000 });
});
