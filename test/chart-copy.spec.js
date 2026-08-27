const { test, expect } = require('@playwright/test');

const CHART = [
  '# Chart copy',
  '',
  '```chart',
  '{"type":"bar","title":"Revenue","labels":["Q1","Q2"],"values":[12,18]}',
  '```',
].join('\n');

async function loadChart(page) {
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
        },
      },
      configurable: true,
    });
  });
  await page.goto('/docs');
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((markdown) => window.SDocs.loadText(markdown, 'chart-copy-test.md'), CHART);
  await page.waitForSelector('.sdoc-chart canvas', { timeout: 15000 });
}

test('charts expose persistent JSON and PNG controls in a transparent top bar', async ({ page }) => {
  await loadChart(page);
  const toolbar = page.locator('.sdoc-chart-toolbar');
  const json = toolbar.locator('.chart-copy-json-btn');
  const png = toolbar.locator('.chart-copy-png-btn');

  await expect(toolbar).toHaveCount(1);
  await expect(toolbar.locator('.chart-copy-btn')).toHaveCount(2);
  await expect(json).toHaveAttribute('aria-label', 'Copy chart as JSON');
  await expect(png).toHaveAttribute('aria-label', 'Copy chart as PNG');
  await expect(json.locator('.chart-copy-label')).toHaveText('JSON');
  await expect(png.locator('.chart-copy-label')).toHaveText('PNG');
  await expect(toolbar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(json).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(png).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(json).toHaveCSS('opacity', '0.7');
  expect(parseFloat(await toolbar.evaluate((element) => getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(0);
  expect(parseFloat(await toolbar.evaluate((element) => getComputedStyle(element).borderTopRightRadius))).toBeGreaterThan(0);
});

test('chart JSON copy writes the current source and uses tick feedback', async ({ page }) => {
  await loadChart(page);
  const button = page.locator('.chart-copy-json-btn');
  await button.click();
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe([
    '{',
    '  "type": "bar",',
    '  "title": "Revenue",',
    '  "labels": [',
    '    "Q1",',
    '    "Q2"',
    '  ],',
    '  "values": [',
    '    12,',
    '    18',
    '  ]',
    '}',
  ].join('\n'));
  await expect(button.locator('polyline')).toHaveCount(1);
  await expect(button.locator('.chart-copy-label')).toHaveText('JSON');
  await page.waitForTimeout(1600);
  await expect(button.locator('polyline')).toHaveCount(0);
});

test('chart PNG copy writes the rendered canvas and uses tick feedback', async ({ page }) => {
  await loadChart(page);
  const button = page.locator('.chart-copy-png-btn');
  await button.click();
  await expect.poll(() => page.evaluate(() => ({
    type: window.__copiedPngPart && window.__copiedPngPart.type,
    size: window.__copiedPngPart && window.__copiedPngPart.size,
  }))).toEqual({ type: 'image/png', size: expect.any(Number) });
  expect(await page.evaluate(() => window.__copiedPngPart.size)).toBeGreaterThan(0);
  await expect(button.locator('polyline')).toHaveCount(1);
  await expect(button.locator('.chart-copy-label')).toHaveText('PNG');
  await page.waitForTimeout(1600);
  await expect(button.locator('polyline')).toHaveCount(0);
});

test('chart copy chrome remains transparent across light and dark themes', async ({ page }) => {
  await loadChart(page);
  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('light'));
  await expect(page.locator('.sdoc-chart-toolbar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.locator('#_sd_btn-theme').click();
  await expect(page.locator('.sdoc-chart-toolbar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.chart-copy-json-btn')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.chart-copy-png-btn')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
