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
