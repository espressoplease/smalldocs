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
    await expect(page.locator('.sdoc-slide .sd-shape-stage .shape-rect .shape-md .inner').first()).toContainText('Hello');
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

  test('inline shape with color=#fff renders white text (host CSS must not bleed)', async ({ page }) => {
    // This is the regression test for the thumbnail/fullscreen discrepancy —
    // when the main SDocs doc renders a slide, its document-level paragraph
    // color must not override the shape\'s declared text colour.
    await loadDocWithSlide(page, 'grid 100 56.25\nr 10 10 80 40 fill=#0f172a color=#fff | Q4 review');
    const color = await page.locator('.sdoc-slide .shape-rect').evaluate((el) => {
      // Grab the color of the deepest text-bearing child (the <p> marked creates).
      var p = el.querySelector('.shape-md p') || el.querySelector('.shape-md') || el;
      return getComputedStyle(p).color;
    });
    expect(color).toBe('rgb(255, 255, 255)');
  });

  test('every shape\'s font-to-stage ratio matches between inline and fullscreen', async ({ page }) => {
    // Strict parity test. Fullscreen copies inline's cqh values directly
    // rather than re-running autofit, so the ratio must be identical for
    // every shape (not just close). Guards against future changes where
    // fullscreen re-renders and autofit drift returns.
    const md = [
      '```slide',
      'grid 100 56.25',
      'r 0 0 100 22 #bar fill=#0f172a color=#fff |',
      '  # Welcome to slides',
      'r 10 30 80 18 #body color=#1e293b |',
      '  Grid-based slides in plain markdown.',
      '',
      '  Rendered identically in the thumbnail and at fullscreen.',
      '```',
    ].join('\n');
    await page.goto(BASE + '/');
    await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
    await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
    await page.waitForTimeout(400);
    const inlineRatios = await page.evaluate(() => {
      const stage = document.querySelector('.sdoc-slide .sd-shape-stage');
      const sh = stage.getBoundingClientRect().height;
      return Array.from(stage.querySelectorAll('.shape-rect')).map(r => ({
        id: r.dataset.id,
        ratio: parseFloat(getComputedStyle(r).fontSize) / sh,
      }));
    });
    await page.locator('.sdoc-slide').first().click();
    await page.waitForTimeout(500);
    const fullRatios = await page.evaluate(() => {
      const stage = document.querySelector('.sdoc-present-stage');
      const sh = stage.getBoundingClientRect().height;
      return Array.from(stage.querySelectorAll('.shape-rect')).map(r => ({
        id: r.dataset.id,
        ratio: parseFloat(getComputedStyle(r).fontSize) / sh,
      }));
    });
    for (const i of inlineRatios) {
      const f = fullRatios.find(x => x.id === i.id);
      expect(f).toBeTruthy();
      const diff = Math.abs(i.ratio - f.ratio) / Math.max(i.ratio, f.ratio);
      expect(diff).toBeLessThan(0.005);
    }
  });

  test('inline thumbnail and fullscreen font-size are proportional (no host margin bleed)', async ({ page }) => {
    // When SDocs paragraph margins leak into a slide, auto-fit picks a smaller
    // font because there's less vertical room. After reset, the relative
    // font-size-to-stage-height ratio should match between thumbnail and
    // fullscreen within a small tolerance.
    await loadDocWithSlide(page, 'grid 100 56.25\nr 4 4 92 10 fill=#0f172a color=#fff | Q4 review');
    const thumbRatio = await page.evaluate(() => {
      const stage = document.querySelector('.sdoc-slide .sd-shape-stage');
      const rect = stage.querySelector('.shape-rect');
      const p = rect.querySelector('.shape-md p, .shape-md');
      const fs = parseFloat(getComputedStyle(p).fontSize);
      const sh = stage.getBoundingClientRect().height;
      return fs / sh;
    });
    // Click to open fullscreen
    await page.locator('.sdoc-slide').click();
    await page.waitForTimeout(80);
    const fullRatio = await page.evaluate(() => {
      const stage = document.querySelector('.sdoc-present-stage');
      const rect = stage.querySelector('.shape-rect');
      const p = rect.querySelector('.shape-md p, .shape-md');
      const fs = parseFloat(getComputedStyle(p).fontSize);
      const sh = stage.getBoundingClientRect().height;
      return fs / sh;
    });
    const diff = Math.abs(thumbRatio - fullRatio);
    // Tolerance: 10% relative.
    expect(diff / Math.max(thumbRatio, fullRatio)).toBeLessThan(0.1);
  });
});
