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

test('inline Mermaid source copy copies the underlying text', async ({ page }) => {
  await stubTextClipboard(page);
  const source = 'graph TD\n  API --> Worker';
  await loadDoc(page, '```mermaid\n' + source + '\n```');
  const copy = page.locator('.sdoc-mermaid-copy-btn');
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(source);
  await expect(copy.locator('polyline')).toHaveCount(1);
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
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
