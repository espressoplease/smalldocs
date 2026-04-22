// @ts-check
// Tests for the layer= attribute (top | bottom | auto). The renderer
// builds three stacked sublayers on each slide; `layer=` picks which
// sublayer a shape renders into. Within a sublayer, source order still
// wins.
const { test, expect } = require('@playwright/test');

async function renderBody(page, body) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((b) => {
    const parsed = window.SDocYaml.parseFrontMatter(b);
    window.SDocs.currentMeta = parsed.meta;
    window.SDocs.currentBody = parsed.body;
    if (parsed.meta.styles) window.SDocs.applyStylesFromMeta(parsed.meta.styles);
    window.SDocs.render();
  }, body);
  await page.waitForTimeout(200);
}

function slideDoc(slideBody) {
  return '# Deck\n\n```slide\n' + slideBody + '\n```\n';
}

// DOM order of sublayers is [bottom, auto, top], so children of a later
// sublayer paint above children of an earlier one. We assert on sublayer
// index + child presence rather than screenshotting — deterministic and
// fast.
async function shapeSublayerIndex(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return -1;
    const sublayer = el.closest('.sd-stage-sublayer');
    if (!sublayer) return -1;
    const parent = sublayer.parentElement;
    return Array.from(parent.querySelectorAll(':scope > .sd-stage-sublayer')).indexOf(sublayer);
  }, selector);
}

test.describe('Slide layer= attribute', () => {
  test('default: SVG primitives are below rectangles (existing behaviour)', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 2 2 12 5 fill=#dbeafe #card | Card',
      'a 4 4 12 4 stroke=#dc2626',
    ].join('\n')));
    // Both land in the 'auto' sublayer (index 1). The SVG's z-order
    // within that sublayer: SVG element is the sublayer's first child,
    // so the rect div paints above it — matches pre-refactor behaviour.
    const rectLayer = await shapeSublayerIndex(page, '.shape-rect');
    const arrow = await page.$('.shape-svg line');
    expect(rectLayer).toBe(1);
    expect(arrow).not.toBeNull();
  });

  test('arrow with layer=top renders in the top sublayer (above all rects)', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 2 2 5 5 fill=#dbeafe | Left',
      'r 9 2 5 5 fill=#dbeafe | Right',
      'a 7 4.5 9 4.5 stroke=#dc2626 layer=top',
    ].join('\n')));
    const rectLayer = await shapeSublayerIndex(page, '.shape-rect');
    // The arrow is an SVG <line>. Find the sublayer containing the line
    // with stroke=#dc2626 (arrow's color) so we pick the right one.
    const arrowLayer = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll('.shape-svg line'))
        .find((l) => l.getAttribute('stroke') === '#dc2626');
      if (!line) return -1;
      const sublayer = line.closest('.sd-stage-sublayer');
      const parent = sublayer.parentElement;
      return Array.from(parent.querySelectorAll(':scope > .sd-stage-sublayer')).indexOf(sublayer);
    });
    expect(rectLayer).toBe(1);
    expect(arrowLayer).toBe(2); // top
    expect(arrowLayer).toBeGreaterThan(rectLayer);
  });

  test('circle with layer=top sits above a rect', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 0 0 16 9 fill=#0f172a color=#fff | # Card',
      'c 14 1 0.5 fill=#f59e0b layer=top',
    ].join('\n')));
    const rectLayer = await shapeSublayerIndex(page, '.shape-rect');
    const circleLayer = await page.evaluate(() => {
      const circle = document.querySelector('.shape-svg circle');
      if (!circle) return -1;
      const sublayer = circle.closest('.sd-stage-sublayer');
      const parent = sublayer.parentElement;
      return Array.from(parent.querySelectorAll(':scope > .sd-stage-sublayer')).indexOf(sublayer);
    });
    expect(circleLayer).toBeGreaterThan(rectLayer);
  });

  test('rect with layer=bottom sits below other rects', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 1 1 8 4 fill=#fee #back layer=bottom',
      'r 2 2 8 4 fill=#fff #front | Card content',
    ].join('\n')));
    const backLayer = await page.evaluate(() => {
      const rects = document.querySelectorAll('.shape-rect');
      // Find the rect whose inline-style background matches #fee (rgb(255,238,238))
      for (const r of rects) {
        const cs = getComputedStyle(r);
        if (cs.backgroundColor === 'rgb(255, 238, 238)') {
          const sublayer = r.closest('.sd-stage-sublayer');
          const parent = sublayer.parentElement;
          return Array.from(parent.querySelectorAll(':scope > .sd-stage-sublayer')).indexOf(sublayer);
        }
      }
      return -1;
    });
    const frontLayer = await page.evaluate(() => {
      const rects = document.querySelectorAll('.shape-rect');
      for (const r of rects) {
        const cs = getComputedStyle(r);
        if (cs.backgroundColor === 'rgb(255, 255, 255)') {
          const sublayer = r.closest('.sd-stage-sublayer');
          const parent = sublayer.parentElement;
          return Array.from(parent.querySelectorAll(':scope > .sd-stage-sublayer')).indexOf(sublayer);
        }
      }
      return -1;
    });
    expect(backLayer).toBe(0);  // bottom
    expect(frontLayer).toBe(1); // auto
  });

  test('invalid layer value surfaces an error badge', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 0 0 16 9 layer=middle | Oops',
    ].join('\n')));
    const badge = await page.$('.sdoc-slide-errbadge');
    expect(badge).not.toBeNull();
    const txt = await badge.textContent();
    expect(txt).toContain('invalid layer');
  });

  test('layer=auto is equivalent to omitting the attribute', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 0 0 16 9 layer=auto | Auto',
    ].join('\n')));
    const idx = await shapeSublayerIndex(page, '.shape-rect');
    expect(idx).toBe(1);
  });
});
