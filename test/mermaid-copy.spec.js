const { test, expect } = require('@playwright/test');

async function loadDoc(page, markdown) {
  await page.goto('/docs');
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((md) => window.SDocs.loadText(md), markdown);
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
}

async function stubTextClipboard(page) {
  await page.addInitScript(() => {
    window.__copiedText = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text) => { window.__copiedText = text; return Promise.resolve(); } },
      configurable: true
    });
  });
}

async function stubPngClipboard(page) {
  await page.addInitScript(() => {
    window.__copiedPng = false;
    window.__copiedPngPart = null;
    window.ClipboardItem = function (parts) { this.parts = parts; };
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: (items) => {
        window.__copiedPng = true;
        window.__copiedPngPart = items[0].parts['image/png'];
        return Promise.resolve();
      } },
      configurable: true
    });
  });
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

test('inline Mermaid source copy copies the underlying text', async ({ page }) => {
  await stubTextClipboard(page);
  const source = 'graph TD\n  API --> Worker';
  await loadDoc(page, '```mermaid\n' + source + '\n```');
  const copy = page.locator('.sdoc-mermaid-copy-btn');
  await expect(copy.locator('.sdoc-mermaid-tool-action-label')).toHaveText('Source');
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(source);
  await expect(copy.locator('polyline')).toHaveCount(1);
  await expect(copy.locator('.sdoc-mermaid-tool-action-label')).toHaveText('Source');
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
  await expect(copy.locator('.sdoc-mermaid-tool-action-label')).toHaveText('Source');
});

test('fullscreen Source action copies the Mermaid source', async ({ page }) => {
  await stubTextClipboard(page);
  const source = 'sequenceDiagram\n  User->>Agent: discuss architecture';
  await loadDoc(page, '```mermaid\n' + source + '\n```');
  await page.locator('.sdoc-mermaid-zoom-btn').click();
  const copy = page.locator('[data-act="copy-text"]');
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(source);
  await expect(copy.locator('polyline')).toHaveCount(1);
  await expect(copy.locator('.sdoc-mermaid-focus-action-label')).toHaveText('Source');
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
  await expect(copy.locator('.sdoc-mermaid-focus-action-label')).toHaveText('Source');
});

test('fullscreen PNG action uses tick feedback and restores its copy icon', async ({ page }) => {
  await stubPngClipboard(page);
  await loadDoc(page, '```mermaid\ngraph TD\n  API --> Worker\n```');
  await page.locator('.sdoc-mermaid-zoom-btn').click();
  const copy = page.locator('[data-act="copy-png"]');
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.__copiedPng)).toBe(true);
  await expect(copy.locator('polyline')).toHaveCount(1);
  await expect(copy.locator('.sdoc-mermaid-focus-action-label')).toHaveText('PNG');
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
  await expect(copy.locator('.sdoc-mermaid-focus-action-label')).toHaveText('PNG');
});

test('inline PNG action copies the rendered diagram and restores its copy icon', async ({ page }) => {
  await stubPngClipboard(page);
  await loadDoc(page, '```mermaid\ngraph TD\n  API --> Worker\n```');
  const copy = page.locator('.sdoc-mermaid-png-btn');
  await expect(copy).toHaveAttribute('aria-label', 'Copy diagram as PNG');
  await expect(copy.locator('.sdoc-mermaid-tool-action-label')).toHaveText('PNG');
  await copy.click();
  await expect.poll(() => page.evaluate(() => ({
    copied: window.__copiedPng,
    type: window.__copiedPngPart && window.__copiedPngPart.type,
    size: window.__copiedPngPart && window.__copiedPngPart.size
  }))).toEqual({ copied: true, type: 'image/png', size: expect.any(Number) });
  expect(await page.evaluate(() => window.__copiedPngPart.size)).toBeGreaterThan(0);
  const image = await copiedPngInfo(page);
  expect(image.width).toBeGreaterThan(100);
  expect(image.height).toBeGreaterThan(50);
  expect(image.colors).toBeGreaterThan(2);
  await expect(copy.locator('polyline')).toHaveCount(1);
  await expect(copy.locator('.sdoc-mermaid-tool-action-label')).toHaveText('PNG');
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
  await expect(copy.locator('.sdoc-mermaid-tool-action-label')).toHaveText('PNG');
});

test('code, quote, and Mermaid copy controls use the same color', async ({ page }) => {
  await loadDoc(page, [
    '```js',
    'const ready = true;',
    '```',
    '',
    '> A quoted architecture note.',
    '',
    '```mermaid',
    'graph TD',
    '  API --> Worker',
    '```'
  ].join('\n'));

  const styles = await page.evaluate(() => {
    const values = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return { color: style.color, borderColor: style.borderColor };
    };
    return {
      code: values('.pre-wrapper .copy-btn'),
      quote: values('.quote-copy-btn'),
      mermaid: values('.sdoc-mermaid-copy-btn')
    };
  });
  expect(styles.quote).toEqual(styles.code);
  expect(styles.mermaid).toEqual(styles.code);

  await page.locator('.sdoc-mermaid-zoom-btn').click();
  const fullscreen = await page.locator('[data-act="copy-text"]').evaluate((btn) => {
    const style = getComputedStyle(btn);
    return { color: style.color, borderColor: style.borderColor };
  });
  expect(fullscreen).toEqual(styles.code);
});
