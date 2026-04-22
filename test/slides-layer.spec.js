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
  test('default: rect lands in the mid sublayer (index 1)', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 2 2 12 5 fill=#dbeafe #card | Card',
    ].join('\n')));
    const rectLayer = await shapeSublayerIndex(page, '.shape-rect');
    expect(rectLayer).toBe(1); // [bottom, mid, top] → mid
  });

  test('arrows default to layer=top (heads stay above rects they connect)', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 2 2 5 5 fill=#dbeafe | A',
      'r 9 2 5 5 fill=#dbeafe | B',
      'a 7 4.5 9 4.5 stroke=#dc2626',
    ].join('\n')));
    // No explicit layer= on the arrow. It should still land in the top
    // sublayer because arrows-over-rects is almost always the intent.
    const arrowLayer = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll('.shape-svg line'))
        .find((l) => l.getAttribute('stroke') === '#dc2626');
      if (!line) return -1;
      const sublayer = line.closest('.sd-stage-sublayer');
      const parent = sublayer.parentElement;
      return Array.from(parent.querySelectorAll(':scope > .sd-stage-sublayer')).indexOf(sublayer);
    });
    expect(arrowLayer).toBe(2); // top
  });

  test('arrow with explicit layer=mid opts out of the top default', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 2 2 12 5 fill=#dbeafe',
      'a 4 4 12 4 stroke=#dc2626 layer=mid',
    ].join('\n')));
    const arrowLayer = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll('.shape-svg line'))
        .find((l) => l.getAttribute('stroke') === '#dc2626');
      if (!line) return -1;
      const sublayer = line.closest('.sd-stage-sublayer');
      const parent = sublayer.parentElement;
      return Array.from(parent.querySelectorAll(':scope > .sd-stage-sublayer')).indexOf(sublayer);
    });
    expect(arrowLayer).toBe(1); // mid
  });

  test('arrow with explicit layer=top renders in the top sublayer', async ({ page }) => {
    // Redundant with the default (since arrows default to top), but
    // proves that explicit layer=top is still accepted and correct.
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

  test('rect with layer=bottom sits below mid-layer rects', async ({ page }) => {
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
    expect(frontLayer).toBe(1); // mid
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

  test('layer=mid is equivalent to omitting the attribute', async ({ page }) => {
    await renderBody(page, slideDoc([
      'grid 16 9',
      'r 0 0 16 9 layer=mid | Mid',
    ].join('\n')));
    const idx = await shapeSublayerIndex(page, '.shape-rect');
    expect(idx).toBe(1);
  });
});
