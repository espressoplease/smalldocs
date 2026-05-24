// @ts-check
//
// Pixel-level regression tests. The purpose is to catch cases where a rect's
// *rendered* height/width drifts from its declared grid units — which is what
// happened with the padding: 8% bug. DOM styles looked correct, but the actual
// bounding boxes were dominated by padding.
//
// Rule: for every declared rect, rendered (width, height) must equal
// (w / grid.w * stage.w, h / grid.h * stage.h) within 1px.
const { test, expect } = require('@playwright/test');

async function measureRects(page) {
  return page.evaluate(() => {
    const stage = document.getElementById('stage');
    const sb = stage.getBoundingClientRect();
    const rects = Array.from(document.querySelectorAll('#stage .shape-rect')).map(el => {
      const b = el.getBoundingClientRect();
      return {
        id: el.dataset.id || null,
        left: b.left - sb.left,
        top: b.top - sb.top,
        width: b.width,
        height: b.height,
      };
    });
    return { stageWidth: sb.width, stageHeight: sb.height, rects };
  });
}

test('rect bounding boxes match declared grid coords within 1px', async ({ page }) => {
  await page.goto('http://localhost:3000/shapes');
  await page.waitForSelector('#stage');
  await page.evaluate(() => {
    const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('dsl'));
    ta.value = [
      'grid 400 225',
      'r 0 0 400 24 #bar',
      'r 18 40 84 34 #web',
      'r 150 54 96 52 #queue',
      'r 308 118 56 16 #dblabel',
    ].join('\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const { stageWidth, stageHeight, rects } = await measureRects(page);
  const expected = {
    bar:     { x: 0,   y: 0,   w: 400, h: 24 },
    web:     { x: 18,  y: 40,  w: 84,  h: 34 },
    queue:   { x: 150, y: 54,  w: 96,  h: 52 },
    dblabel: { x: 308, y: 118, w: 56,  h: 16 },
  };
  const gw = 400, gh = 225;
  for (const r of rects) {
    const ex = expected[r.id];
    expect(r.left).toBeCloseTo(ex.x / gw * stageWidth, 0);
    expect(r.top).toBeCloseTo(ex.y / gh * stageHeight, 0);
    expect(r.width).toBeCloseTo(ex.w / gw * stageWidth, 0);
    expect(r.height).toBeCloseTo(ex.h / gh * stageHeight, 0);
  }
});

test('rectangles with very different declared heights render at different pixel heights', async ({ page }) => {
  // The padding: 8% bug made every rect the same ~127px tall regardless of
  // declared height. Guard against any regression where rect heights collapse
  // to a single uniform size.
  await page.goto('http://localhost:3000/shapes');
  await page.waitForSelector('#stage');
  await page.evaluate(() => {
    const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('dsl'));
    ta.value = [
      'grid 400 225',
      'r 0 0   400 20  #thin',
      'r 0 30  400 60  #medium',
      'r 0 100 400 120 #tall',
    ].join('\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const { rects } = await measureRects(page);
  const byId = Object.fromEntries(rects.map(r => [r.id, r]));
  // Ratios should roughly match declared 20:60:120 = 1:3:6
  expect(byId.medium.height / byId.thin.height).toBeGreaterThan(2.5);
  expect(byId.medium.height / byId.thin.height).toBeLessThan(3.5);
  expect(byId.tall.height / byId.thin.height).toBeGreaterThan(5.5);
  expect(byId.tall.height / byId.thin.height).toBeLessThan(6.5);
});
