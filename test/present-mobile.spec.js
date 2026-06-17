// @ts-check
//
// Touch + responsive-chrome layer for presentation mode (sdocs-present-mobile.js).
// Runs in an emulated touch + landscape context so the module's
// matchMedia('(pointer: coarse)') gate is satisfied. The zoom/pan/clamp math is
// unit-tested in test/test-zoom-math.js; this spec proves the WIRING: the
// landscape outfit applies, swipe changes slide, pinch zooms, tap toggles
// chrome, and a slide change resets zoom.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

// Landscape phone: touch, mobile, wide-and-short viewport.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

async function loadDeck(page, slides) {
  const md = '# Deck\n\n' + slides.map((d) => '```slide\n' + d + '\n```').join('\n\nx\n\n');
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(200);
}

async function openPresent(page) {
  await page.locator('.sdoc-slide-present').first().click();
  await expect(page.locator('.sdoc-present')).toHaveCount(1);
  await page.waitForTimeout(120);
}

// Dispatch a synthetic touch sequence on the stage-wrap. `frames` is an array
// of { type, touches:[[x,y],...] }. Returns the stage's transform string.
async function touchSeq(page, frames) {
  return await page.evaluate(async (frames) => {
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const wrap = document.querySelector('.sdoc-present-stage-wrap');
    const stage = document.querySelector('.sdoc-present-stage');
    const mk = (i, x, y) => new Touch({ identifier: i, target: wrap, clientX: x, clientY: y, pageX: x, pageY: y });
    for (const f of frames) {
      const touches = f.touches.map((p, i) => mk(i + 1, p[0], p[1]));
      const changed = f.changed ? f.changed.map((p, i) => mk(i + 1, p[0], p[1])) : touches;
      wrap.dispatchEvent(new TouchEvent(f.type, {
        bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed
      }));
    }
    await nextFrame(); // let the rAF-batched transform write flush
    return stage ? stage.style.transform : '';
  }, frames);
}

function scaleOf(transform) {
  const m = /scale\(([-\d.eE]+)\)/.exec(transform || '');
  return m ? parseFloat(m[1]) : 1;
}

test('the touch layer activates (pointer:coarse) and applies the landscape outfit', async ({ page }) => {
  await loadDeck(page, ['grid 100 56.25\nr 5 5 90 90 | A', 'grid 100 56.25\nr 5 5 90 90 | B']);
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(coarse, 'emulated context must report a coarse pointer').toBeTruthy();
  await openPresent(page);
  const modal = page.locator('.sdoc-present');
  await expect(modal).toHaveClass(/pm-landscape/);
  // Rail hidden, topbar overlaid (not a reserved grid track).
  await expect(page.locator('.sdoc-present-rail')).toBeHidden();
  const pos = await page.locator('.sdoc-present-topbar').evaluate((el) => getComputedStyle(el).position);
  expect(pos).toBe('absolute');
});

test('swipe left advances to the next slide', async ({ page }) => {
  await loadDeck(page, ['grid 100 56.25\nr 5 5 90 90 | First', 'grid 100 56.25\nr 5 5 90 90 | Second']);
  await openPresent(page);
  const inner = page.locator('.sdoc-present-stage .shape-rect .shape-md .inner').first();
  await expect(inner).toContainText('First');
  await touchSeq(page, [
    { type: 'touchstart', touches: [[640, 195]] },
    { type: 'touchmove', touches: [[500, 195]] },
    { type: 'touchmove', touches: [[200, 195]] },
    { type: 'touchend', touches: [], changed: [[200, 195]] },
  ]);
  await page.waitForTimeout(320); // commit animation (200ms) + render
  await expect(inner).toContainText('Second');
});

test('pinch-out zooms the slide in', async ({ page }) => {
  await loadDeck(page, ['grid 100 56.25\nr 5 5 90 90 | Zoom me']);
  await openPresent(page);
  const t = await touchSeq(page, [
    { type: 'touchstart', touches: [[400, 195], [444, 195]] },
    { type: 'touchmove', touches: [[300, 195], [560, 195]] },
    { type: 'touchmove', touches: [[200, 195], [660, 195]] },
  ]);
  expect(scaleOf(t)).toBeGreaterThan(1.2);
});

test('single tap toggles the chrome; tapping again restores it', async ({ page }) => {
  await loadDeck(page, ['grid 100 56.25\nr 5 5 90 90 | Tap']);
  await openPresent(page);
  const modal = page.locator('.sdoc-present');
  await expect(modal).not.toHaveClass(/pm-chrome-hidden/);
  // A tap = touchstart + touchend at the same point, under the tap timeout.
  await touchSeq(page, [
    { type: 'touchstart', touches: [[420, 195]] },
    { type: 'touchend', touches: [], changed: [[420, 195]] },
  ]);
  await page.waitForTimeout(330); // single-tap resolves after the double-tap window
  await expect(modal).toHaveClass(/pm-chrome-hidden/);
  await touchSeq(page, [
    { type: 'touchstart', touches: [[420, 195]] },
    { type: 'touchend', touches: [], changed: [[420, 195]] },
  ]);
  await page.waitForTimeout(330);
  await expect(modal).not.toHaveClass(/pm-chrome-hidden/);
});

test.describe('narrow portrait topbar', () => {
  // A genuinely narrow portrait phone: the full control cluster is wider than
  // the page, which used to overrun the viewport and wrap the copy label.
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 780 } });

  test('topbar fits the page and scrolls instead of overflowing / wrapping', async ({ page }) => {
    const many = Array.from({ length: 20 }, (_, i) => 'grid 100 56.25\nr 5 5 90 90 | S' + (i + 1));
    await loadDeck(page, many);
    await openPresent(page);
    await page.evaluate(() => window.SDocPresent.go(17)); // copy label -> "slide 18"
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const tb = document.querySelector('.sdoc-present-topbar');
      const copy = document.querySelector('.sdoc-present-copy-btn');
      return {
        vw: window.innerWidth,
        clientW: tb.clientWidth,
        scrollW: tb.scrollWidth,
        overflowX: getComputedStyle(tb).overflowX,
        copyH: copy.offsetHeight,
        hasOverflow: tb.classList.contains('has-overflow'),
      };
    });
    // The bar is clipped to the page, not wider than it.
    expect(m.clientW).toBeLessThanOrEqual(m.vw + 1);
    // Excess content becomes horizontal scroll, like the inline toolbar.
    expect(m.overflowX).toBe('auto');
    expect(m.scrollW).toBeGreaterThan(m.clientW);
    expect(m.hasOverflow).toBeTruthy();
    // The copy label stays on one line (a wrapped label is taller than ~32px).
    expect(m.copyH).toBeLessThan(32);
  });
});

test('changing slide resets zoom to fit', async ({ page }) => {
  await loadDeck(page, ['grid 100 56.25\nr 5 5 90 90 | One', 'grid 100 56.25\nr 5 5 90 90 | Two']);
  await openPresent(page);
  // Zoom in via pinch.
  const zoomed = await touchSeq(page, [
    { type: 'touchstart', touches: [[400, 195], [444, 195]] },
    { type: 'touchmove', touches: [[260, 195], [600, 195]] },
  ]);
  expect(scaleOf(zoomed)).toBeGreaterThan(1.2);
  // Advance via keyboard; zoom must snap back to fit on the new slide.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  const t = await page.locator('.sdoc-present-stage').evaluate((el) => el.style.transform);
  expect(scaleOf(t)).toBeLessThanOrEqual(1.01);
});
