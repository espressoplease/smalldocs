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
  await page.locator('.sdoc-mermaid-copy-btn').click();
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(source);
});

test('fullscreen Source action copies the Mermaid source', async ({ page }) => {
  await stubTextClipboard(page);
  const source = 'sequenceDiagram\n  User->>Agent: discuss architecture';
  await loadDoc(page, '```mermaid\n' + source + '\n```');
  await page.locator('.sdoc-mermaid-zoom-btn').click();
  await page.locator('[data-act="copy-text"]').click();
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(source);
  await expect(page.locator('[data-act="copy-text"]')).toHaveText('Copied');
});
