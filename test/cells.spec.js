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
  expect(await page.locator('.sdoc-cells-colhead').allInnerTexts()).toEqual(['A', 'B', 'C']);
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

test('export inlines the grid as a real table', async ({ page }) => {
  await loadDoc(page, [FENCE + 'cells', 'Region,Q1', 'North,100', FENCE].join('\n'));
  await page.waitForSelector('.sdoc-cells-grid');
  const html = await page.evaluate(() => window.SDocs.buildExportHTML([]));
  expect(html).toContain('<table>');
  expect(html).toContain('North');
  expect(html).not.toContain('sdoc-cells-grid');
});
