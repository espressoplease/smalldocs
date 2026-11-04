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
    window.__copiedPngPart = null;
    window.ClipboardItem = function (parts) { this.parts = parts; };
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text) => { window.__copiedText = text; return Promise.resolve(); },
        write: (items) => {
          window.__copiedPngPart = items[0].parts['image/png'];
          return Promise.resolve();
        }
      },
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

async function copiedPngInfo(page) {
  return page.evaluate(async () => {
    const bitmap = await createImageBitmap(window.__copiedPngPart);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += Math.max(4, Math.floor(pixels.length / 400 / 4) * 4)) {
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`);
    }
    bitmap.close();
    return { width: canvas.width, height: canvas.height, colors: colors.size };
  });
}

test('markdown tables expose one persistent copy control above the table', async ({ page }) => {
  await loadTable(page);
  const wrap = page.locator('#_sd_rendered .md-table-scroll');
  const toolbar = wrap.locator(':scope > .md-table-toolbar');
  const csvCopy = toolbar.locator('.table-copy-csv-btn');
  const pngCopy = toolbar.locator('.table-copy-png-btn');
  await expect(toolbar).toHaveCount(1);
  await expect(toolbar.locator('.table-copy-btn')).toHaveCount(2);
  await expect(csvCopy).toHaveAttribute('aria-label', 'Copy table as CSV');
  await expect(pngCopy).toHaveAttribute('aria-label', 'Copy table as PNG');
  await expect(csvCopy.locator('.table-copy-label')).toHaveText('CSV');
  await expect(pngCopy.locator('.table-copy-label')).toHaveText('PNG');
  await expect(csvCopy).toHaveCSS('opacity', '0.7');
  await expect(toolbar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(toolbar).toHaveCSS('border-top-left-radius', '6px');
  await expect(toolbar).toHaveCSS('border-top-right-radius', '6px');
  await expect(csvCopy).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(pngCopy).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('table colors and copy chrome switch between light and dark defaults', async ({ page }) => {
  await loadTable(page);
  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('light'));
  await page.locator('#_sd_btn-theme').click();
  await expect(page.locator('#_sd_rendered thead th').first()).toHaveCSS('background-color', 'rgb(44, 41, 38)');
  await expect(page.locator('#_sd_rendered tbody tr').first().locator('td').first()).toHaveCSS('background-color', 'rgb(44, 42, 38)');
  await expect(page.locator('#_sd_rendered tbody tr').nth(1).locator('td').first()).toHaveCSS('background-color', 'rgb(36, 34, 32)');
  await expect(page.locator('#_sd_rendered tbody td').first()).toHaveCSS('color', 'rgb(231, 229, 226)');
  await expect(page.locator('.md-table-toolbar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.table-copy-csv-btn')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.table-copy-png-btn')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await page.locator('#_sd_btn-theme').click();
  await expect(page.locator('#_sd_rendered thead th').first()).toHaveCSS('background-color', 'rgb(244, 241, 237)');
  await expect(page.locator('#_sd_rendered tbody tr').first().locator('td').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#_sd_rendered tbody tr').nth(1).locator('td').first()).toHaveCSS('background-color', 'rgb(250, 250, 248)');
  await expect(page.locator('#_sd_rendered tbody td').first()).toHaveCSS('color', 'rgb(28, 25, 23)');
});

test('table colors retain separate light and dark overrides', async ({ page }) => {
  await loadTable(page);
  await page.evaluate(() => {
    window.SDocs.switchThemeAndUpdate('light');
    const header = document.getElementById('_sd_ctrl-table-header-bg');
    header.value = '#123456';
    header.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await page.locator('#_sd_btn-theme').click();
  await page.evaluate(() => {
    const header = document.getElementById('_sd_ctrl-table-header-bg');
    header.value = '#abcdef';
    header.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await page.locator('#_sd_btn-theme').click();
  await expect(page.locator('#_sd_rendered thead th').first()).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.locator('#_sd_btn-theme').click();
  await expect(page.locator('#_sd_rendered thead th').first()).toHaveCSS('background-color', 'rgb(171, 205, 239)');
});

test('table copy writes CSV and uses tick feedback', async ({ page }) => {
  await loadTable(page);
  const copy = page.locator('.table-copy-csv-btn');
  await copy.click();
  await expect.poll(() => copiedText(page)).toBe(
    'Name,Notes\nAda,"Hello, world"\nGrace,"Said ""yes"""'
  );
  await expect(copy.locator('polyline')).toHaveCount(1);
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
});

test('table PNG copy writes a rendered image and uses tick feedback', async ({ page }) => {
  await loadTable(page);
  const copy = page.locator('.table-copy-png-btn');
  await copy.click();
  await expect.poll(() => page.evaluate(() => ({
    type: window.__copiedPngPart && window.__copiedPngPart.type,
    size: window.__copiedPngPart && window.__copiedPngPart.size
  }))).toEqual({ type: 'image/png', size: expect.any(Number) });
  expect(await page.evaluate(() => window.__copiedPngPart.size)).toBeGreaterThan(0);
  const image = await copiedPngInfo(page);
  expect(image.width).toBeGreaterThan(200);
  expect(image.height).toBeGreaterThan(100);
  expect(image.colors).toBeGreaterThan(2);
  await expect(copy.locator('polyline')).toHaveCount(1);
  await expect(copy.locator('.table-copy-label')).toHaveText('PNG');
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

test('column controls expand upward on header hover without reserving a blank strip or covering preceding text', async ({ page }) => {
  await loadTable(page);
  await page.evaluate(markdown => SDocs.loadText('Before the table.\n\n' + markdown + '\n\nAfter the table.'), TABLE);
  const wrapper = page.locator('#_sd_rendered .md-table-scroll');
  const toolbar = wrapper.locator('.md-table-toolbar');
  const header = wrapper.locator('thead');
  const after = page.locator('#_sd_rendered p').filter({ hasText: 'After the table.' });
  const before = page.locator('#_sd_rendered p').filter({ hasText: 'Before the table.' });
  await expect(toolbar).toHaveCSS('height', '35px');
  const initial = { wrapper: await wrapper.boundingBox(), header: await header.boundingBox(), after: await after.boundingBox() };
  // The whole-table buttons remain stationary until a header is visited.
  await toolbar.locator('.table-copy-csv-btn').hover();
  await expect(toolbar).toHaveCSS('height', '35px');
  await header.locator('th').last().hover();
  await expect(toolbar).toHaveCSS('height', '63px');
  expect((await wrapper.boundingBox()).y).toBeLessThan(initial.wrapper.y);
  const previous = await before.boundingBox();
  expect((await wrapper.boundingBox()).y).toBeGreaterThanOrEqual(previous.y + previous.height);
  const shift = (await header.boundingBox()).y - initial.header.y;
  expect(shift).toBeGreaterThanOrEqual(0);
  expect(shift).toBeLessThan(28);
  expect((await after.boundingBox()).y).toBeCloseTo(initial.after.y + shift, 0);
  const column = header.getByRole('button', { name: 'Copy column', exact: true }).last();
  await column.click();
  await expect.poll(() => copiedText(page)).toBe('Notes\n"Hello, world"\n"Said ""yes"""');
  // Crossing to CSV must not collapse the strip and move the target away.
  await toolbar.locator('.table-copy-csv-btn').click();
  await expect(toolbar).toHaveCSS('height', '63px');
  await expect.poll(() => copiedText(page)).toBe('Name,Notes\nAda,"Hello, world"\nGrace,"Said ""yes"""');
  await after.click();
  await expect(toolbar).toHaveCSS('height', '35px');
  expect((await header.boundingBox()).y).toBeCloseTo(initial.header.y, 0);
});

test('keyboard focus reveals the column strip and leaving the table collapses it', async ({ page }) => {
  await loadTable(page);
  const toolbar = page.locator('#_sd_rendered .md-table-toolbar');
  const column = page.locator('thead th').first().getByRole('button', { name: 'Copy column', exact: true });
  await expect(toolbar).toHaveCSS('height', '35px');
  await column.focus();
  await expect(toolbar).toHaveCSS('height', '63px');
  await page.keyboard.press('Enter');
  await expect.poll(() => copiedText(page)).toBe('Name\nAda\nGrace');
  await page.locator('#_sd_btn-theme').focus();
  await expect(toolbar).toHaveCSS('height', '35px');
});

test('table copy controls yield to table comment controls in comment mode', async ({ page }) => {
  await loadTable(page);
  await page.evaluate(() => window.SDocs.setMode('comment'));
  const copies = page.locator('.table-copy-btn');
  await expect(copies).toHaveCount(2);
  await expect(copies.first()).toHaveCSS('opacity', '0');
  await expect(copies.first()).toHaveCSS('pointer-events', 'none');
  await expect(copies.last()).toHaveCSS('opacity', '0');
  await expect(copies.last()).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.md-table-toolbar')).toHaveCSS('height', '0px');
  await expect(page.locator('.sdoc-table-table-add')).toHaveCount(1);
});

test('hover and keyboard copy a cell, row or column without changing source or including controls', async ({ page }) => {
  await loadTable(page);
  const cell = page.locator('tbody tr').first().locator('td').nth(1);
  await expect(cell.getByRole('button', { name: 'Copy cell', exact: true })).toHaveCSS('opacity', '0');
  await cell.hover();
  const copyCell = cell.getByRole('button', { name: 'Copy cell', exact: true });
  await copyCell.click();
  await expect.poll(() => copiedText(page)).toBe('"Hello, world"');
  await expect(copyCell.locator('polyline')).toHaveCount(1);
  const row = page.locator('tbody tr').first();
  await row.hover();
  const copyRow = row.getByRole('button', { name: 'Copy row', exact: true });
  await copyRow.hover();
  await expect(row.locator('.sdoc-table-copy-preview')).toHaveCount(2);
  await copyRow.click();
  await expect.poll(() => copiedText(page)).toBe('Ada,"Hello, world"');
  const copyColumn = page.locator('thead th').last().getByRole('button', { name: 'Copy column', exact: true });
  await copyColumn.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => copiedText(page)).toBe('Notes\n"Hello, world"\n"Said ""yes"""');
  expect(await page.evaluate(() => SDocs.currentBody)).toBe(TABLE);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => SDocs.setMode('comment'));
    await expect(page.locator('.table-part-copy-btn').first()).toHaveCSS('visibility', 'hidden');
    await page.evaluate(() => SDocs.setMode('read'));
    await expect(page.locator('.table-part-copy-btn')).toHaveCount(11);
  }
  await page.locator('.table-copy-csv-btn').click();
  await expect.poll(() => copiedText(page)).toBe('Name,Notes\nAda,"Hello, world"\nGrace,"Said ""yes"""');
});

test('formatted values, empty cells and horizontally scrolled table parts copy on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadTable(page);
  const markdown = '| **Service** | Region | Long ownership label | Notes |\n|---|---|---|---|\n| [API](https://example.org) | Europe | Platform | Check `input` and \\| values |\n| Worker | America | Operations | |\n';
  await page.evaluate(body => { SDocs.loadText(body); SDocs.setAllSectionsOpen(true); }, markdown);
  await page.locator('.md-table-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
  const cell = page.locator('tbody tr').first().locator('td').last();
  await cell.hover(); await cell.getByRole('button', { name: 'Copy cell', exact: true }).click();
  await expect.poll(() => copiedText(page)).toBe('Check input and | values');
  const empty = page.locator('tbody tr').last().locator('td').last();
  await empty.hover(); await empty.getByRole('button', { name: 'Copy cell', exact: true }).click();
  await expect.poll(() => copiedText(page)).toBe('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => SDocs.currentBody)).toBe(markdown);
});

test('failed part copies report failure without a success tick or source mutation', async ({ page }) => {
  await loadTable(page);
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('Denied')); });
  const cell = page.locator('tbody td').first(); await cell.hover();
  const copy = cell.locator('.table-copy-cell-btn');
  await copy.click();
  await expect(copy).toHaveAttribute('title', 'Copy failed. Try again.');
  await expect(page.getByRole('status').filter({ hasText: 'Copy failed. Try again.' })).toBeVisible();
  await expect(copy.locator('polyline')).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await copy.click();
  await expect(page.getByRole('status').filter({ hasText: 'Not supported' })).toBeVisible();
  expect(await page.evaluate(() => SDocs.currentBody)).toBe(TABLE);
});

test.describe('touch table copies', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('a header tap exposes its column copy control', async ({ page }) => {
    await loadTable(page);
    const toolbar = page.locator('#_sd_rendered .md-table-toolbar');
    await expect(toolbar).toHaveCSS('height', '35px');
    await page.locator('thead th').last().tap();
    await expect(toolbar).toHaveCSS('height', '63px');
    await page.locator('thead th').last().getByRole('button', { name: 'Copy column', exact: true }).tap();
    await expect.poll(() => copiedText(page)).toBe('Notes\n"Hello, world"\n"Said ""yes"""');
  });
});
