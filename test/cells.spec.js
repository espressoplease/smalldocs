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
  // The value field is now a real formula-bar <input>.
  expect(await page.locator('.sdoc-cells-focus-value').inputValue()).toBe('100');
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

test('fullscreen shows Sum / Avg / Count beside the selection address', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b', '10,20', '30,40', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await page.locator('.sdoc-cells-expand').click();
  await page.waitForSelector('.sdoc-cells-focus');
  // No stats for a single cell (the element collapses to nothing).
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  expect((await page.locator('.sdoc-cells-focus-stats').innerText()).trim()).toBe('');
  // Drag the 2x2 numeric block (10,20,30,40).
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="0"]').hover();
  await page.mouse.down();
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="2"][data-c="1"]').hover();
  await page.mouse.up();
  // The stats live in the header bar, immediately right of the name box.
  const stats = page.locator('.sdoc-cells-focus-bar .sdoc-cells-focus-stats');
  const text = await stats.innerText();
  expect(text).toContain('Sum');
  expect(text).toContain('100');     // 10+20+30+40
  expect(text).toContain('Avg');
  expect(text).toContain('25');      // 100 / 4
  expect(text).toMatch(/Count\D*4/);
  const nameBox = await page.locator('.sdoc-cells-focus-name').boundingBox();
  const statsBox = await stats.boundingBox();
  expect(statsBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width - 1);
  // The old footer row is gone.
  expect(await page.locator('.sdoc-cells-focus-status').count()).toBe(0);
});

test('fullscreen stats include computed formula values in the selection', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', 'Total,=SUM(B2:B3)', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await page.locator('.sdoc-cells-expand').click();
  await page.waitForSelector('.sdoc-cells-focus');
  // Select B2:B4 - two plain numbers and one computed cell (10, 20, 30).
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="3"][data-c="1"]')
    .click({ modifiers: ['Shift'] });
  const stats = page.locator('.sdoc-cells-focus-stats');
  await expect(stats).toContainText('Sum 60');     // 10 + 20 + computed 30
  await expect(stats).toContainText('Avg 20');
  await expect(stats).toContainText('Max 30');     // the computed value, not text
  await expect(stats).toContainText('Count 3');
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

test('sorting a formula column orders by computed values, with no #CIRC! errors', async ({ page }) => {
  await loadDoc(page, [
    FENCE + 'cells',
    'Item,Qty,Price,Total',
    'Laptop,12,1100,=B2*C2',     // 13200
    'Monitor,30,280,=B3*C3',     // 8400
    'Keyboard,45,90,=B4*C4',     // 4050
    'Dock,18,210,=B5*C5',        // 3780
    'Total,,,=SUM(D2:D5)',       // 29430 - a summary row, pinned to the bottom
    FENCE,
  ].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const sortBtn = () => page.locator('.sdoc-cells-colhead[data-c="3"] .sdoc-cells-sort');
  // Ascending by computed Total. The Total row (a range formula, =SUM) is a
  // summary of the others - it stays pinned at the bottom, outside the sort.
  await sortBtn().click();
  expect(await page.locator('.sdoc-cells-cell[data-c="0"]').allInnerTexts())
    .toEqual(['Item', 'Dock', 'Keyboard', 'Monitor', 'Laptop', 'Total']);
  // Each value travelled with its row: Dock still shows 3,780, Laptop 13,200.
  await expect(page.locator('.sdoc-cells-cell[data-r="1"][data-c="3"]')).toHaveText('3,780');
  await expect(page.locator('.sdoc-cells-cell[data-r="4"][data-c="3"]')).toHaveText('13,200');
  // Nothing went circular from evaluating against a reordered view.
  expect(await page.locator('.is-formula-error').count()).toBe(0);
  // Descending flips the data rows; the Total row still holds the bottom.
  await sortBtn().click();
  expect(await page.locator('.sdoc-cells-cell[data-c="0"]').allInnerTexts())
    .toEqual(['Item', 'Laptop', 'Monitor', 'Keyboard', 'Dock', 'Total']);
  await expect(page.locator('.sdoc-cells-cell[data-r="5"][data-c="3"]')).toHaveText('29,430');
  expect(await page.locator('.is-formula-error').count()).toBe(0);
});

test('the sheet wrapper hugs the grid - no white gap right of the last column', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  // The scroller is sized on a rAF + ResizeObserver; poll until it settles.
  await expect(async () => {
    const gap = await page.evaluate(() => {
      const wrap = document.querySelector('.sdoc-cells');
      const lastCol = wrap.querySelector('.sdoc-cells-colhead[data-c="1"]');
      return wrap.getBoundingClientRect().right - lastCol.getBoundingClientRect().right;
    });
    // Only the 1px wrapper border + sub-pixel rounding may remain.
    expect(gap).toBeLessThanOrEqual(2.5);
  }).toPass({ timeout: 5000 });
});

test('column letter stays centred; the sort control sits on the right edge', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Name,Score', 'Bea,30', 'Al,10', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const head = page.locator('.sdoc-cells-colhead[data-c="1"]');
  const headBox = await head.boundingBox();
  const labelBox = await head.locator('.sdoc-cells-colhead-label').boundingBox();
  // The letter's centre matches the header's centre - the sort control must
  // not push it sideways (it is absolutely positioned, out of the flow).
  const headCx = headBox.x + headBox.width / 2;
  const labelCx = labelBox.x + labelBox.width / 2;
  expect(Math.abs(headCx - labelCx)).toBeLessThan(2);
  // The sort control hugs the right side of the header.
  const sortBox = await head.locator('.sdoc-cells-sort').boundingBox();
  expect(sortBox.x).toBeGreaterThan(headCx);
  // Hovering shows a readable arrow, not a tiny glyph: at least 11px square.
  await head.hover();
  const arrow = await head.locator('.sdoc-cells-sort-next svg').boundingBox();
  expect(arrow.width).toBeGreaterThanOrEqual(11);
  expect(arrow.height).toBeGreaterThanOrEqual(11);
});

test('sort control previews the next state on hover (asc -> desc -> clear)', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Name,Score', 'Bea,30', 'Al,10', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const head = () => page.locator('.sdoc-cells-colhead[data-c="1"]');
  // Resting, unsorted: nothing rendered as the "current" state.
  expect(await head().locator('.sdoc-cells-sort-cur svg').count()).toBe(0);
  // Hover: preview shows what a click will do - sort ascending (up arrow).
  await head().hover();
  await expect(head().locator('.sdoc-cells-sort-next svg.sdoc-cells-sort-up')).toBeVisible();
  // Click -> sorted ascending. Move the mouse away: the up arrow stays as the
  // current-state indicator.
  await head().locator('.sdoc-cells-sort').click();
  await page.mouse.move(0, 0);
  await expect(head().locator('.sdoc-cells-sort-cur svg.sdoc-cells-sort-up')).toBeVisible();
  // Hover again: preview = descending (down arrow).
  await head().hover();
  await expect(head().locator('.sdoc-cells-sort-next svg.sdoc-cells-sort-down')).toBeVisible();
  // Click -> descending; resting shows the down arrow, hover previews "clear".
  await head().locator('.sdoc-cells-sort').click();
  await page.mouse.move(0, 0);
  await expect(head().locator('.sdoc-cells-sort-cur svg.sdoc-cells-sort-down')).toBeVisible();
  await head().hover();
  await expect(head().locator('.sdoc-cells-sort-next svg.sdoc-cells-sort-clear')).toBeVisible();
  // Click -> sort cleared: back to no current-state arrow.
  await head().locator('.sdoc-cells-sort').click();
  await page.mouse.move(0, 0);
  expect(await head().locator('.sdoc-cells-sort-cur svg').count()).toBe(0);
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

// Formulas: a cell whose raw starts with '=' shows its computed result while
// the model keeps the formula (for copy / export). Errors surface as a short
// #CODE! in red.
test('a =formula cell renders its computed value', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells',
    'Item,Qty', 'A,10', 'B,15', 'Total,=SUM(B2:B3)', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const total = page.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]');
  await expect(total).toHaveText('25');
  await expect(total).toHaveClass(/is-formula/);
  // raw formula preserved on the model for copy-out
  expect(await page.evaluate(() => {
    return document.querySelector('.sdoc-cells')._cellsModel.cells[3][1].raw;
  })).toBe('=SUM(B2:B3)');
});

test('a broken formula shows an error code, not a crash', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'x,y', 'a,=1/0', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const cell = page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]');
  await expect(cell).toHaveText('#DIV/0!');
  await expect(cell).toHaveClass(/is-formula-error/);
});

// ── Fullscreen editing (client-only) ──────────────────────
async function openFullscreen(page, lines) {
  await loadDoc(page, lines.join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  await page.locator('.sdoc-cells-expand').click();
  await page.waitForSelector('.sdoc-cells-focus .sdoc-cells-grid');
  return page.locator('.sdoc-cells-focus');
}

test('fullscreen: typing opens the editor and edits the cell', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await page.keyboard.press('9');                       // a printable key starts editing
  const editor = page.locator('.sdoc-cells-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('9');                // seeded with the typed char
  await editor.fill('99');
  await page.keyboard.press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('99');
});

test('fullscreen: double-click edits, keeping the existing value', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').dblclick();
  const editor = page.locator('.sdoc-cells-editor');
  await expect(editor).toHaveValue('20');
  await editor.fill('25');
  await page.keyboard.press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]')).toHaveText('25');
});

test('fullscreen: the formula bar commits a =formula that recalcs', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click();
  await fs.locator('.sdoc-cells-focus-value').fill('=SUM(B2:B3)');
  await fs.locator('.sdoc-cells-focus-value').press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]')).toHaveText('30');
});

test('fullscreen: undo reverts an edit', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();
  await page.locator('.sdoc-cells-editor').fill('7');
  await page.keyboard.press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('7');
  await page.locator('.sdoc-cells-focus .sdoc-cells-grid').focus();
  await page.keyboard.press('Control+z');
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('10');
});

test('fullscreen: Delete clears a selected cell', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').click();
  await page.keyboard.press('Delete');
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]')).toHaveText('');
});

test('fullscreen: edits show in the inline grid after close', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();
  await page.locator('.sdoc-cells-editor').fill('55');
  await page.keyboard.press('Enter');
  await page.locator('.sdoc-cells-focus-close').click();
  await expect(page.locator('#_sd_rendered .sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('55');
});

// ── Drag-to-fill (the fill handle) ─────────────────────────
test('fill handle: appears on the selection corner in fullscreen', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  // The handle sits inside the selection's bottom-right cell.
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"] .sdoc-cells-fill-handle')).toBeVisible();
  // Extending the selection moves it to the new corner.
  await fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').click({ modifiers: ['Shift'] });
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"] .sdoc-cells-fill-handle')).toBeVisible();
  expect(await fs.locator('.sdoc-cells-fill-handle').count()).toBe(1);
});

test('fill handle: dragging a formula down fills it with shifted references', async ({ page }) => {
  const fs = await openFullscreen(page, [
    FENCE + 'cells',
    'Item,Qty,Price,Total',
    'Laptop,12,1100,=B2*C2',
    'Monitor,30,280,',
    'Keyboard,45,90,',
    FENCE,
  ]);
  // Select D2 (the formula) and drag its fill handle down to D4.
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="3"]').click();
  const handle = fs.locator('.sdoc-cells-fill-handle');
  const hb = await handle.boundingBox();
  const target = await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="3"]').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await page.mouse.up();
  // D3 = B3*C3 = 30*280 = 8400; D4 = B4*C4 = 45*90 = 4050
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="3"]')).toHaveText('8,400');
  await expect(fs.locator('.sdoc-cells-cell[data-r="3"][data-c="3"]')).toHaveText('4,050');
  // The originals are untouched.
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="3"]')).toHaveText('13,200');
});

test('fill handle: dragging two numbers down continues the series', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Week,Sales', '1,100', '2,200', FENCE]);
  // Select A2:A3 (1, 2) and drag down two rows -> 3, 4.
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  await fs.locator('.sdoc-cells-cell[data-r="2"][data-c="0"]').click({ modifiers: ['Shift'] });
  const handle = fs.locator('.sdoc-cells-fill-handle');
  const hb = await handle.boundingBox();
  const target = await fs.locator('.sdoc-cells-cell[data-r="4"][data-c="0"]').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(fs.locator('.sdoc-cells-cell[data-r="3"][data-c="0"]')).toHaveText('3');
  await expect(fs.locator('.sdoc-cells-cell[data-r="4"][data-c="0"]')).toHaveText('4');
});

test('fill handle: a fill is undoable', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  const handle = fs.locator('.sdoc-cells-fill-handle');
  const hb = await handle.boundingBox();
  const target = await fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]')).toHaveText('10');
  await page.locator('.sdoc-cells-focus .sdoc-cells-grid').focus();
  await page.keyboard.press('Control+z');
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]')).toHaveText('');
});

// ── Copy / paste with formula adjustment ──────────────────
// Clipboard events are synthesized (DataTransfer + ClipboardEvent) so the
// tests exercise the handlers without OS clipboard permissions.
async function copySelection(page) {
  return page.evaluate(() => {
    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return dt.getData('text/plain');
  });
}
async function pasteText(page, text) {
  return page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
  }, text);
}

test('copy a formula cell, paste onto a selection: references adjust per cell', async ({ page }) => {
  const fs = await openFullscreen(page, [
    FENCE + 'cells',
    'Item,Qty,Price,Total',
    'Laptop,12,1100,=B2*C2',
    'Monitor,30,280,',
    'Keyboard,45,90,',
    FENCE,
  ]);
  // Copy D2 (the formula).
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="3"]').click();
  const copied = await copySelection(page);
  expect(copied).toBe('=B2*C2');
  // Select D3:D4 and paste - each cell gets the formula shifted to its row.
  await fs.locator('.sdoc-cells-cell[data-r="2"][data-c="3"]').click();
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="3"]').click({ modifiers: ['Shift'] });
  await pasteText(page, copied);
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="3"]')).toHaveText('8,400');   // B3*C3
  await expect(fs.locator('.sdoc-cells-cell[data-r="3"][data-c="3"]')).toHaveText('4,050');   // B4*C4
});

test('copy a block of cells, paste at a new anchor: formulas shift by the move', async ({ page }) => {
  const fs = await openFullscreen(page, [
    FENCE + 'cells',
    'A,B,C',
    '10,20,=A2+B2',
    '30,40,',
    FENCE,
  ]);
  // Copy A2:C2 (10, 20, =A2+B2).
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="2"]').click({ modifiers: ['Shift'] });
  const copied = await copySelection(page);
  expect(copied).toBe('10\t20\t=A2+B2');
  // Paste at A3: the block lands there, the formula becomes =A3+B3 -> 70.
  await fs.locator('.sdoc-cells-cell[data-r="2"][data-c="0"]').click();
  await pasteText(page, copied);
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="0"]')).toHaveText('10');
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="2"]')).toHaveText('30');      // 10+20 of the pasted row
});

test('pasting external (non-copied) text still works as plain values', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'a,b', '1,2', FENCE]);
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  await pasteText(page, '7\t8\n9\t10');
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]')).toHaveText('7');
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('8');
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="0"]')).toHaveText('9');
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]')).toHaveText('10');
});

// ── Formula view toggle ────────────────────────────────────
test('formula view: a sheet with formulas gets a toggle that shows formula text', async ({ page }) => {
  const fs = await openFullscreen(page, [
    FENCE + 'cells', 'Item,Qty,Total', 'A,10,=B2*2', 'B,20,=B3*2', FENCE,
  ]);
  const toggle = fs.locator('.sdoc-cells-fx-toggle');
  await expect(toggle).toBeVisible();
  // Computed view first.
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="2"]')).toHaveText('20');
  // Toggle on: cells show their formula source, ready to read / edit in place.
  await toggle.click();
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="2"]')).toHaveText('=B2*2');
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="2"]')).toHaveText('=B3*2');
  // Editing in formula view edits the raw formula.
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="2"]').dblclick();
  await expect(page.locator('.sdoc-cells-editor')).toHaveValue('=B2*2');
  await page.locator('.sdoc-cells-editor').fill('=B2*3');
  await page.keyboard.press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="2"]')).toHaveText('=B2*3');
  // Toggle off: back to computed values (with the edit applied).
  await toggle.click();
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="2"]')).toHaveText('30');
});

test('formula view: a sheet without formulas has no toggle', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'a,b', '1,2', FENCE]);
  expect(await fs.locator('.sdoc-cells-fx-toggle').count()).toBe(0);
});

// ── Formula point mode (arrow keys write cell refs while typing a formula) ──
//
// Sheet used by every test:
//   row 0 (display)  Item , Qty       -> A1, B1
//   row 1            A    , 10        -> A2, B2
//   row 2            B    , 20        -> A3, B3
// The formula is typed into display cell [3][1] = B4.
const POINT_SHEET = [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE];

test('point mode: an arrow after = writes the cell ref; more arrows move it', async ({ page }) => {
  const fs = await openFullscreen(page, POINT_SHEET);
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click();
  await page.keyboard.type('=');
  const editor = page.locator('.sdoc-cells-editor');
  await page.keyboard.press('ArrowUp');                 // points at the cell above (B3)
  await expect(editor).toHaveValue('=B3');
  await page.keyboard.press('ArrowUp');                 // moves the ref, does not append
  await expect(editor).toHaveValue('=B2');
  await page.keyboard.press('ArrowLeft');               // pointer moves left, still one ref
  await expect(editor).toHaveValue('=A2');
});

test('point mode: shift+arrow extends the pointed ref into a range', async ({ page }) => {
  const fs = await openFullscreen(page, POINT_SHEET);
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click();
  await page.keyboard.type('=SUM(');
  const editor = page.locator('.sdoc-cells-editor');
  await page.keyboard.press('ArrowUp');                 // B3
  await expect(editor).toHaveValue('=SUM(B3');
  await page.keyboard.press('Shift+ArrowUp');           // extend up -> B2:B3
  await expect(editor).toHaveValue('=SUM(B2:B3');
  await page.keyboard.type(')');
  await page.keyboard.press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]')).toHaveText('30');
});

test('point mode: typing ":" locks the start, arrows then write the range end', async ({ page }) => {
  const fs = await openFullscreen(page, POINT_SHEET);
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click();
  await page.keyboard.type('=SUM(');
  const editor = page.locator('.sdoc-cells-editor');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');                 // B2 (start of range)
  await expect(editor).toHaveValue('=SUM(B2');
  await page.keyboard.type(':');
  await page.keyboard.press('ArrowDown');               // end moves down from B2 -> B3
  await expect(editor).toHaveValue('=SUM(B2:B3');
  await page.keyboard.type(')');
  await page.keyboard.press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]')).toHaveText('30');
});

test('point mode: an operator re-arms pointing for the next ref', async ({ page }) => {
  const fs = await openFullscreen(page, POINT_SHEET);
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click();
  await page.keyboard.type('=');
  const editor = page.locator('.sdoc-cells-editor');
  await page.keyboard.press('ArrowUp');                 // B3 (=20)
  await expect(editor).toHaveValue('=B3');
  await page.keyboard.type('+');                        // keeps B3, re-arms pointing
  await page.keyboard.press('ArrowUp');                 // new pointer from B4 -> B3
  await page.keyboard.press('ArrowUp');                 // -> B2 (=10)
  await expect(editor).toHaveValue('=B3+B2');
  await page.keyboard.press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]')).toHaveText('30');
});

test('point mode: the pointed cells are highlighted on the grid', async ({ page }) => {
  const fs = await openFullscreen(page, POINT_SHEET);
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click();
  await page.keyboard.type('=SUM(');
  await page.keyboard.press('ArrowUp');                 // pointing at B3
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]')).toHaveClass(/is-ref-point/);
  await page.keyboard.press('Shift+ArrowUp');           // range B2:B3 -> both highlighted
  await expect(fs.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveClass(/is-ref-point/);
  await expect(fs.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]')).toHaveClass(/is-ref-point/);
  // committing clears the highlight
  await page.keyboard.type(')');
  await page.keyboard.press('Enter');
  expect(await fs.locator('.is-ref-point').count()).toBe(0);
});

test('point mode: arrows in plain (non-formula) text still move the caret', async ({ page }) => {
  const fs = await openFullscreen(page, POINT_SHEET);
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click();
  await page.keyboard.type('hello');
  await page.keyboard.press('ArrowLeft');               // caret moves, no ref inserted
  await page.keyboard.type('x');
  await expect(page.locator('.sdoc-cells-editor')).toHaveValue('hellxo');
});

test('point mode: works from the formula bar too', async ({ page }) => {
  const fs = await openFullscreen(page, POINT_SHEET);
  await fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click();
  const bar = fs.locator('.sdoc-cells-focus-value');
  await bar.click();
  await bar.pressSequentially('=SUM(');
  await bar.press('ArrowUp');                           // points from the active cell (B4) -> B3
  await expect(bar).toHaveValue('=SUM(B3');
  await bar.press('Shift+ArrowUp');                     // -> B2:B3
  await expect(bar).toHaveValue('=SUM(B2:B3');
  await bar.pressSequentially(')');
  await bar.press('Enter');
  await expect(fs.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]')).toHaveText('30');
});

// ── Inline stats strip (between the top bar and the grid) ──────
test('inline stats strip: opens with Sum / Avg for a range selection', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b', '10,20', '30,40', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const strip = page.locator('.sdoc-cells-stats');
  // Collapsed (closed) before any selection.
  await expect(strip).not.toHaveClass(/is-open/);
  // Select the 2x2 numeric block (10,20,30,40) by shift-click.
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  await page.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').click({ modifiers: ['Shift'] });
  await expect(strip).toHaveClass(/is-open/);
  await expect(strip).toContainText('Sum 100');
  await expect(strip).toContainText('Avg 25');
  await expect(strip).toContainText('Count 4');
  // It sits below the grid (after the scroller) so opening it never shifts
  // the cells under the pointer.
  const order = await page.evaluate(() => {
    const kids = Array.from(document.querySelector('#_sd_rendered .sdoc-cells').children);
    return kids.map((k) => k.className.split(' ')[0]);
  });
  expect(order.indexOf('sdoc-cells-stats')).toBeGreaterThan(order.indexOf('sdoc-cells-scroll'));
  // Opening / closing the strip must not move the grid: the scroller's top
  // edge stays put.
  const scrollTop = (await page.locator('#_sd_rendered .sdoc-cells-scroll').boundingBox()).y;
  await page.keyboard.press('Escape');
  await expect(strip).not.toHaveClass(/is-open/);
  expect((await page.locator('#_sd_rendered .sdoc-cells-scroll').boundingBox()).y).toBeCloseTo(scrollTop, 1);
});

test('inline stats strip: collapses for a single cell and on Escape', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'a,b', '10,20', '30,40', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const strip = page.locator('.sdoc-cells-stats');
  // Range -> open.
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  await page.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').click({ modifiers: ['Shift'] });
  await expect(strip).toHaveClass(/is-open/);
  // Collapse back to a single cell -> closed (the value is already visible in the cell).
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  await expect(strip).not.toHaveClass(/is-open/);
  // Range again, then Escape clears the selection -> closed.
  await page.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').click({ modifiers: ['Shift'] });
  await expect(strip).toHaveClass(/is-open/);
  await page.keyboard.press('Escape');
  await expect(strip).not.toHaveClass(/is-open/);
});

test('inline stats strip: computed formula cells count by value', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', 'Total,=SUM(B2:B3)', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  // Select B2:B4 - two numbers and one computed cell (10, 20, 30).
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();
  await page.locator('.sdoc-cells-cell[data-r="3"][data-c="1"]').click({ modifiers: ['Shift'] });
  const strip = page.locator('.sdoc-cells-stats');
  await expect(strip).toContainText('Sum 60');
  await expect(strip).toContainText('Max 30');
  await expect(strip).toContainText('Count 3');
});

test('inline stats strip: not rendered in the fullscreen overlay', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'a,b', '10,20', '30,40', FENCE]);
  // Fullscreen has its own header stats segment; the inline strip stays inline.
  expect(await fs.locator('.sdoc-cells-stats').count()).toBe(0);
});

// ── Edited indicator + original/edited toggle ──────────────────
async function editCellFullscreen(page, fs, r, c, value) {
  await fs.locator(`.sdoc-cells-cell[data-r="${r}"][data-c="${c}"]`).dblclick();
  await page.locator('.sdoc-cells-editor').fill(value);
  await page.keyboard.press('Enter');
}

test('edited pill: hidden until a fullscreen edit, then shows "edited"', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  const pill = page.locator('#_sd_rendered .sdoc-cells-edit-pill');
  // Hidden before any edit.
  await expect(pill).toBeHidden();
  // Closing without editing keeps it hidden.
  await page.locator('.sdoc-cells-focus-close').click();
  await expect(pill).toBeHidden();
  // Edit fullscreen, close -> the pill appears, the inline grid shows the edit.
  await page.locator('#_sd_rendered .sdoc-cells-expand').click();
  await page.waitForSelector('.sdoc-cells-focus .sdoc-cells-grid');
  await editCellFullscreen(page, page.locator('.sdoc-cells-focus'), 1, 1, '99');
  await page.locator('.sdoc-cells-focus-close').click();
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText('showing edited');
  await expect(page.locator('#_sd_rendered .sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('99');
  // The pill sits in the bar's right-side action group, with the copy buttons.
  expect(await pill.evaluate((el) => el.parentElement.className)).toContain('sdoc-cells-bar-actions');
});

test('edited pill: click toggles between the edited and original data', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await editCellFullscreen(page, fs, 1, 1, '99');
  await page.locator('.sdoc-cells-focus-close').click();
  const pill = page.locator('#_sd_rendered .sdoc-cells-edit-pill');
  const cell = page.locator('#_sd_rendered .sdoc-cells-cell[data-r="1"][data-c="1"]');
  await expect(cell).toHaveText('99');
  // Toggle to the document's original data.
  await pill.click();
  await expect(pill).toHaveText('showing original');
  await expect(cell).toHaveText('10');
  // And back to the edits.
  await pill.click();
  await expect(pill).toHaveText('showing edited');
  await expect(cell).toHaveText('99');
});

test('edited pill: expanding while viewing the original reopens with the edits', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  await editCellFullscreen(page, fs, 1, 1, '99');
  await page.locator('.sdoc-cells-focus-close').click();
  const pill = page.locator('#_sd_rendered .sdoc-cells-edit-pill');
  await pill.click();                                    // viewing the original
  await expect(page.locator('#_sd_rendered .sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('10');
  // Expand: editing always resumes from the edited data, and the inline view
  // flips back to "edited" so what you see matches what you will edit.
  await page.locator('#_sd_rendered .sdoc-cells-expand').click();
  await page.waitForSelector('.sdoc-cells-focus .sdoc-cells-grid');
  await expect(page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('99');
  await expect(pill).toHaveText('showing edited');
});

test('edited pill: formulas recalc against whichever view is showing', async ({ page }) => {
  const fs = await openFullscreen(page, [
    FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', 'Total,=SUM(B2:B3)', FENCE]);
  // Edit a number the Total depends on: 10 -> 100, so Total becomes 120.
  await editCellFullscreen(page, fs, 1, 1, '100');
  await page.locator('.sdoc-cells-focus-close').click();
  const total = page.locator('#_sd_rendered .sdoc-cells-cell[data-r="3"][data-c="1"]');
  await expect(total).toHaveText('120');
  // Original view recomputes from the original inputs.
  await page.locator('#_sd_rendered .sdoc-cells-edit-pill').click();
  await expect(total).toHaveText('30');
});

test('inline stats strip: the area right of the grid is tinted and shrinks back on close', async ({ page }) => {
  // Two narrow columns + 5-digit numbers -> the stats line runs wider than
  // the grid, so the wrapper expands past the scroller.
  await loadDoc(page, [FENCE + 'cells', 'a,b', '11111,22222', '33333,44444', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const wrapper = page.locator('#_sd_rendered .sdoc-cells');
  const closedWidth = (await wrapper.boundingBox()).width;
  // Select all four numbers.
  await page.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]').click();
  await page.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').click({ modifiers: ['Shift'] });
  await expect(page.locator('.sdoc-cells-stats')).toHaveClass(/is-open/);
  // The wrapper grows to fit the stats line...
  await expect.poll(async () => (await wrapper.boundingBox()).width).toBeGreaterThan(closedWidth + 10);
  // ...and the area not covered by cells is tinted, not the page background.
  const bg = await wrapper.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  // Clearing the selection collapses the strip and the wrapper hugs the grid again.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await wrapper.boundingBox()).width, { timeout: 3000 })
    .toBeLessThan(closedWidth + 5);
});

test('edited pill: edits past the original grid grow the inline grid', async ({ page }) => {
  const fs = await openFullscreen(page, [FENCE + 'cells', 'Item,Qty', 'A,10', 'B,20', FENCE]);
  // The document is 2 columns x 3 rows. Type into column D (a new column,
  // with a gap at C) and into row 5 (a new row, with a gap at row 4).
  await fs.locator('.sdoc-cells-cell[data-r="1"][data-c="3"]').dblclick();
  await page.locator('.sdoc-cells-editor').fill('77');
  await page.keyboard.press('Enter');
  await fs.locator('.sdoc-cells-cell[data-r="4"][data-c="0"]').dblclick();
  await page.locator('.sdoc-cells-editor').fill('NewRow');
  await page.keyboard.press('Enter');
  await page.locator('.sdoc-cells-focus-close').click();
  // The inline grid now spans A-D and 5 rows, showing both edits.
  const inline = page.locator('#_sd_rendered .sdoc-cells');
  await expect(inline.locator('.sdoc-cells-colhead-label')).toHaveText(['A', 'B', 'C', 'D']);
  await expect(inline.locator('.sdoc-cells-cell[data-r="1"][data-c="3"]')).toHaveText('77');
  await expect(inline.locator('.sdoc-cells-cell[data-r="4"][data-c="0"]')).toHaveText('NewRow');
  // Toggling to the original shrinks the grid back to the document's shape...
  await page.locator('#_sd_rendered .sdoc-cells-edit-pill').click();
  await expect(inline.locator('.sdoc-cells-colhead-label')).toHaveText(['A', 'B']);
  expect(await inline.locator('.sdoc-cells-rowhead').count()).toBe(3);
  // ...and back to edited restores the extended grid.
  await page.locator('#_sd_rendered .sdoc-cells-edit-pill').click();
  await expect(inline.locator('.sdoc-cells-colhead-label')).toHaveText(['A', 'B', 'C', 'D']);
  await expect(inline.locator('.sdoc-cells-cell[data-r="4"][data-c="0"]')).toHaveText('NewRow');
});
