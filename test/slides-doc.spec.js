// @ts-check
// Slide blocks in main SDocs documents get replaced by thumbnails.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function loadDocWithSlide(page, dsl) {
  const md = '# Test doc\n\n```slide\n' + dsl + '\n```\n\nparagraph after\n';
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((body) => {
    window.SDocs.currentBody = body;
    window.SDocs.render();
  }, md);
  await page.waitForTimeout(300);
}

test.describe('slide blocks in documents', () => {
  test('```slide block is replaced with a .sdoc-slide thumbnail', async ({ page }) => {
    await loadDocWithSlide(page, 'grid 100 56.25\nr 10 10 80 40 | Hello');
    // The raw <code class="language-slide"> should be gone
    await expect(page.locator('code.language-slide')).toHaveCount(0);
    // A .sdoc-slide container should exist
    await expect(page.locator('.sdoc-slide')).toHaveCount(1);
    // Containing a shape stage with at least one rect
    await expect(page.locator('.sdoc-slide .sd-shape-stage .shape-rect')).toHaveCount(1);
    await expect(page.locator('.sdoc-slide .sd-shape-stage .shape-rect')).toContainText('Hello');
  });

  test('slide thumbnail preserves aspect ratio from grid', async ({ page }) => {
    await loadDocWithSlide(page, 'grid 100 56.25\nr 0 0 100 56.25');
    const box = await page.locator('.sdoc-slide .sd-shape-stage').boundingBox();
    const ratio = box.width / box.height;
    expect(ratio).toBeGreaterThan(1.77);
    expect(ratio).toBeLessThan(1.78);
  });

  test('square grid produces square thumbnail', async ({ page }) => {
    await loadDocWithSlide(page, 'grid 50 50\nr 0 0 50 50');
    const box = await page.locator('.sdoc-slide .sd-shape-stage').boundingBox();
    const ratio = box.width / box.height;
    expect(ratio).toBeGreaterThan(0.98);
    expect(ratio).toBeLessThan(1.02);
  });
});
