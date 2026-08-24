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

test('markdown tables expose table, column, and row copy controls', async ({ page }) => {
  await loadTable(page);
  const table = page.locator('#_sd_rendered table');
  await expect(table.locator('.table-copy-all')).toHaveCount(1);
  await expect(table.locator('.table-copy-column')).toHaveCount(2);
  await expect(table.locator('.table-copy-row')).toHaveCount(2);
});

test('an empty column header gets a numbered copy label', async ({ page }) => {
  await loadTable(page);
  await page.evaluate(() => window.SDocs.loadText('| | Value |\n|---|---|\n| A | B |', 'empty-header.md'));
  await expect(page.locator('.table-copy-column').first()).toHaveAttribute(
    'aria-label', 'Copy column 1 as CSV'
  );
});

test('table copy writes CSV and uses tick feedback', async ({ page }) => {
  await loadTable(page);
  const copy = page.locator('.table-copy-all');
  await copy.click();
  await expect.poll(() => copiedText(page)).toBe(
    'Name,Notes\nAda,"Hello, world"\nGrace,"Said ""yes"""'
  );
  await expect(copy.locator('polyline')).toHaveCount(1);
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
});

test('column and row controls copy only their target', async ({ page }) => {
  await loadTable(page);

  await page.locator('.table-copy-column').nth(1).click();
  await expect.poll(() => copiedText(page)).toBe(
    'Notes\n"Hello, world"\n"Said ""yes"""'
  );

  await page.locator('.table-copy-row').nth(1).click();
  await expect.poll(() => copiedText(page)).toBe('Grace,"Said ""yes"""');
});

test('hover and focus preview the complete copy target', async ({ page }) => {
  await loadTable(page);
  const preview = page.locator('#_sd_rendered .table-copy-preview');

  await page.locator('.table-copy-all').hover();
  await expect(preview).toHaveCount(6);
  await expect(page.locator('.table-copy-column').first()).toHaveCSS('opacity', '0');

  await page.locator('.table-copy-column').nth(1).hover();
  await expect(preview).toHaveCount(3);
  await expect(page.locator('.table-copy-all')).toHaveCSS('opacity', '0');

  await page.locator('.table-copy-row').nth(1).hover();
  await expect(preview).toHaveCount(2);
  await expect(page.locator('.table-copy-all')).toHaveCSS('opacity', '0');

  await page.locator('.table-copy-column').first().focus();
  await expect(preview).toHaveCount(3);
  await page.evaluate(() => document.activeElement.blur());
  await expect(preview).toHaveCount(0);
});

test('table copy controls yield to table comment controls in comment mode', async ({ page }) => {
  await loadTable(page);
  await page.evaluate(() => window.SDocs.setMode('comment'));
  const copy = page.locator('.table-copy-all');
  await expect(copy).toHaveCSS('opacity', '0');
  await expect(copy).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.sdoc-table-table-add')).toHaveCount(1);
});
