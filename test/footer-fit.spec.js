// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Footer status-bar fit.
 *
 * #_sd_statusbar is one fixed-height line (24px) and must NEVER wrap: a
 * wrapped second line overflows the bar and collides with the document
 * above it. The right-hand link cluster (#_sd_sb-links) is `nowrap`, and
 * as the window narrows whole items are dropped at fixed breakpoints
 * (mobile.css) so the visible set always fits on the single line.
 *
 * This spec is the guard for those breakpoints. For every width between
 * 768px (below which the whole bar hides) and 1280px it asserts:
 *   - the bar height never grows past one line, and
 *   - the right cluster is not pushed left past the bar's content edge
 *     (the signal that it no longer fits).
 *
 * The expected drop order is also pinned, so reordering or renaming an
 * item without updating the breakpoints fails here.
 */

// Tightest width inside each band (just above the next breakpoint) plus a
// sample across the range. If a band overflows, it overflows at its top.
const WIDTHS = [
  1280, 1240, 1200, // all items (curl drops at 1199)
  1199, 1150, 1100, // curl gone (verify-server drops at 1099)
  1099, 1050, 1000, // verify-server gone (CLI drops at 999)
  999, 960, 930,    // CLI gone (Discord drops at 929)
  929, 900, 880,    // Discord gone (GitHub drops at 879)
  879, 850, 830,    // GitHub gone (For business drops at 829)
  829, 800, 770,    // only 100% private + Terms remain
];

// id -> width at/below which it must be gone.
const DROP_AT = {
  '_sd_cli-install-wrap': 1199,
  'sb-trust': 1099,
  'sb-cli': 999,
  'sb-discord': 929,
  'sb-github': 879,
  'sb-business': 829,
};
// Always present while the bar is shown (768 < w <= 1280).
const ALWAYS = ['sb-private', 'sb-terms'];

async function measure(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('_sd_statusbar');
    if (!bar || getComputedStyle(bar).display === 'none') return { hidden: true };
    const links = document.getElementById('_sd_sb-links');
    const barRect = bar.getBoundingClientRect();
    const linksRect = links.getBoundingClientRect();
    const padL = parseFloat(getComputedStyle(bar).paddingLeft);
    const shown = {};
    links.querySelectorAll('.sb-item, #_sd_cli-install-wrap').forEach((el) => {
      shown[el.id] = getComputedStyle(el).display !== 'none';
    });
    return {
      hidden: false,
      barH: Math.round(barRect.height),
      // Positive => the right-aligned cluster spilled past the content edge.
      overflowPx: Math.round((barRect.left + padL) - linksRect.left),
      shown,
    };
  });
}

test('footer never wraps or overflows across the responsive range', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(60);
    const m = await measure(page);
    expect(m.hidden, `bar should be visible at ${w}px`).toBe(false);
    expect(m.barH, `bar must stay one line at ${w}px`).toBeLessThanOrEqual(25);
    expect(m.overflowPx, `cluster must not overflow at ${w}px`).toBeLessThanOrEqual(0);

    for (const id of ALWAYS) {
      expect(m.shown[id], `${id} must be visible at ${w}px`).toBe(true);
    }
    for (const [id, dropAt] of Object.entries(DROP_AT)) {
      if (w <= dropAt) {
        expect(m.shown[id], `${id} must be hidden at ${w}px (<= ${dropAt})`).toBe(false);
      } else {
        expect(m.shown[id], `${id} must be visible at ${w}px (> ${dropAt})`).toBe(true);
      }
    }
  }
});

test('CLI band still fits with the longer doc-page lead-in', async ({ page }) => {
  // On a shared #md= page the lead-in becomes "CLI update released N ago:",
  // a few chars longer than the homepage's "CLI for you & your agents:".
  // The CLI item is only shown in the 1000-1199 band; confirm the tightest
  // point of that band (1000px) still fits with the longer text.
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const lead = document.getElementById('_sd_cli-lead');
    if (lead) lead.textContent = 'CLI update released 11 hours ago:';
  });
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(60);
  const m = await measure(page);
  expect(m.shown['sb-cli'], 'CLI item shown at 1000px').toBe(true);
  expect(m.barH).toBeLessThanOrEqual(25);
  expect(m.overflowPx, 'no overflow with longer doc-page lead-in at 1000px').toBeLessThanOrEqual(0);
});
