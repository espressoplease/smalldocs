// @ts-check
//
// Wide markdown tables on a narrow screen must scroll on their own instead of
// widening the page. sdocs-app.js wraps each rendered table in .md-table-scroll
// (overflow-x:auto); the table keeps width:100% so it still compresses, and
// only scrolls once it can't shrink past its columns' min-content.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

test.use({ viewport: { width: 360, height: 760 } });

async function render(page, md) {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
  await page.evaluate((b) => { window.SDocs.currentBody = b; window.SDocs.render(); }, md);
  await page.waitForTimeout(120);
}

const WIDE = [
  '| Column one heading | Column two heading | Column three heading | Column four heading | Column five heading |',
  '|---|---|---|---|---|',
  '| valueAAAAAAAA | valueBBBBBBBB | valueCCCCCCCC | valueDDDDDDDD | valueEEEEEEEE |',
  '| valueFFFFFFFF | valueGGGGGGGG | valueHHHHHHHH | valueIIIIIIII | valueJJJJJJJJ |',
].join('\n');

test('a wide table scrolls inside its wrapper and does not widen the page', async ({ page }) => {
  await render(page, '# Doc\n\n' + WIDE + '\n');
  const m = await page.evaluate(() => {
    const wrap = document.querySelector('#_sd_rendered .md-table-scroll');
    const rendered = document.querySelector('#_sd_rendered');
    return {
      hasWrap: !!wrap,
      tableInside: !!(wrap && wrap.querySelector(':scope > table')),
      overflowX: wrap ? getComputedStyle(wrap).overflowX : null,
      wrapScrollW: wrap ? wrap.scrollWidth : 0,
      wrapClientW: wrap ? wrap.clientWidth : 0,
      renderedScrollW: rendered.scrollWidth,
      renderedClientW: rendered.clientWidth,
    };
  });
  expect(m.hasWrap, 'table is wrapped in .md-table-scroll').toBeTruthy();
  expect(m.tableInside, 'the table sits directly inside the wrapper').toBeTruthy();
  expect(m.overflowX).toBe('auto');
  // The table is wider than the wrapper -> the wrapper scrolls.
  expect(m.wrapScrollW).toBeGreaterThan(m.wrapClientW);
  // The rendered column itself does NOT overflow -> the page won't scroll right.
  expect(m.renderedScrollW).toBeLessThanOrEqual(m.renderedClientW + 1);
});

test('a table that fits is still wrapped but does not scroll', async ({ page }) => {
  await render(page, '# Doc\n\n| A | B |\n|---|---|\n| 1 | 2 |\n');
  const m = await page.evaluate(() => {
    const wrap = document.querySelector('#_sd_rendered .md-table-scroll');
    return {
      hasWrap: !!wrap,
      overflow: wrap ? (wrap.scrollWidth - wrap.clientWidth) : -1,
    };
  });
  expect(m.hasWrap).toBeTruthy();
  expect(m.overflow).toBeLessThanOrEqual(1); // no meaningful horizontal overflow
});
