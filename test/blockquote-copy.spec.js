const { test, expect } = require('@playwright/test');

async function loadDoc(page, markdown) {
  await page.goto('/docs');
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((md) => {
    window.SDocs.loadText(md, 'quote-copy-test.md');
  }, markdown);
}

test('blockquote uses the larger default size and has a copy button', async ({ page }) => {
  await loadDoc(page, '> A larger quote');
  const quote = page.locator('#_sd_rendered blockquote');
  await expect(quote).toHaveCSS('font-size', '16.8px');
  await expect(quote.locator('.quote-copy-btn')).toHaveCount(1);
});

test('blockquote copy preserves paragraph breaks without button text', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedText = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text) => { window.__copiedText = text; return Promise.resolve(); } },
      configurable: true
    });
  });
  await loadDoc(page, '> First paragraph.\n>\n> Second paragraph.');
  const copy = page.locator('.quote-copy-btn');
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.__copiedText))
    .toBe('First paragraph.\n\nSecond paragraph.');
  await expect(copy.locator('polyline')).toHaveCount(1);
  await page.waitForTimeout(1600);
  await expect(copy.locator('polyline')).toHaveCount(0);
});
