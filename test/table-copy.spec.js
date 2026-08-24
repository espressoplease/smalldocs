const { test, expect } = require('@playwright/test');

const TABLE = [
  '| Name | Notes |',
  '|---|---|',
  '| Ada | Hello, world |',
  '| Grace | Said "yes" |',
].join('\n');

async function loadTable(page) {
  await page.addInitScript(() => {
    window.__copiedText = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text) => { window.__copiedText = text; return Promise.resolve(); } },
      configurable: true,
    });
  });
  await page.goto('/docs');
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((markdown) => window.SDocs.loadText(markdown, 'table-copy-test.md'), TABLE);
}

async function copiedText(page) {
  return page.evaluate(() => window.__copiedText);
}

test('markdown tables expose one persistent copy control above the table', async ({ page }) => {
  await loadTable(page);
  const wrap = page.locator('#_sd_rendered .md-table-scroll');
  const toolbar = wrap.locator(':scope > .md-table-toolbar');
  const copy = toolbar.locator('.table-copy-btn');
  await expect(toolbar).toHaveCount(1);
  await expect(copy).toHaveCount(1);
  await expect(copy).toHaveAttribute('aria-label', 'Copy table as CSV');
  await expect(copy).toHaveCSS('opacity', '0.7');
});

test('table copy writes CSV and uses tick feedback', async ({ page }) => {
  await loadTable(page);
  const copy = page.locator('.table-copy-btn');
  await copy.click();
  await expect.poll(() => copiedText(page)).toBe(
    'Name,Notes\nAda,"Hello, world"\nGrace,"Said ""yes"""'
  );
  await expect(copy.locator('polyline')).toHaveCount(1);
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
});

test('table copy controls do not change cell padding', async ({ page }) => {
  await loadTable(page);
  const paddings = await page.locator('#_sd_rendered table :is(th, td)').evaluateAll((cells) =>
    cells.map((cell) => ({ left: getComputedStyle(cell).paddingLeft, right: getComputedStyle(cell).paddingRight }))
  );
  expect(paddings.every((padding) => padding.left === '12px' && padding.right === '12px')).toBeTruthy();
});

test('table copy controls yield to table comment controls in comment mode', async ({ page }) => {
  await loadTable(page);
  await page.evaluate(() => window.SDocs.setMode('comment'));
  const copy = page.locator('.table-copy-btn');
  await expect(copy).toHaveCSS('opacity', '0');
  await expect(copy).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.md-table-toolbar')).toHaveCSS('height', '0px');
  await expect(page.locator('.sdoc-table-table-add')).toHaveCount(1);
});
