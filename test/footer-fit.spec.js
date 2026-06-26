// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Footer status-bar fit.
 *
 * #_sd_statusbar is one fixed-height line (24px) and must NEVER wrap: a
 * wrapped line would overflow the bar and collide with the document above.
 * The right-hand link cluster (#_sd_sb-links) is `nowrap`, and fitFooter()
 * (in index.html) drops the lowest-priority items only when the line
 * actually overflows - re-measured on resize and whenever the content
 * changes. This is content-aware on purpose: the doc-page footer (short
 * "sdoc upgrade" chip) is far narrower than the homepage footer (long curl
 * command), so a fixed width breakpoint would drop items too early for the
 * narrower variant.
 *
 * This spec pins the invariants that must hold at every width, for both
 * variants:
 *   - the bar stays one line,
 *   - the visible items fit (their widths + gaps <= available width),
 *   - #sb-private and #sb-terms are never dropped,
 *   - items drop in priority order (the hidden set is a prefix of
 *     FOOTER_DROP_ORDER - you never hide a higher-priority item while a
 *     lower-priority one is still shown).
 * Plus: the CLI block now survives far narrower than the old 999px drop.
 */

// Must match FOOTER_DROP_ORDER in index.html.
const DROP_ORDER = ['_sd_cli-install-wrap', 'sb-trust', 'sb-cli', 'sb-discord', 'sb-github', 'sb-business'];
const ALWAYS = ['sb-private', 'sb-terms'];

const WIDTHS = [];
for (let w = 1280; w >= 770; w -= 15) WIDTHS.push(w);

async function measure(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('_sd_statusbar');
    if (!bar || getComputedStyle(bar).display === 'none') return { hidden: true };
    const links = document.getElementById('_sd_sb-links');
    const gap = parseFloat(getComputedStyle(links).gap) || 0;
    // Sum visible direct children's natural widths + gaps; compare with the
    // width the cluster actually has. This is the true fit signal (the
    // cluster shrinks and items spill left, invisible to scrollWidth).
    let used = 0, n = 0;
    for (const k of links.children) {
      if (getComputedStyle(k).display === 'none') continue;
      used += k.getBoundingClientRect().width; n++;
    }
    if (n > 1) used += gap * (n - 1);
    // getClientRects() is empty when an ancestor is display:none, so this
    // reflects real on-screen visibility (matters for the install chip,
    // which lives inside #sb-cli).
    const shown = {};
    [...DROP_ORDER_GLOBAL, ...ALWAYS_GLOBAL].forEach((id) => {
      const el = document.getElementById(id);
      shown[id] = !!(el && el.getClientRects().length > 0);
    });
    return {
      hidden: false,
      barH: Math.round(bar.getBoundingClientRect().height),
      overflowPx: Math.round(used - links.clientWidth),
      shown,
    };
  });
}

// Expose the id lists to the page-evaluate closure.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(([drop, always]) => {
    window.DROP_ORDER_GLOBAL = drop;
    window.ALWAYS_GLOBAL = always;
  }, [DROP_ORDER, ALWAYS]);
});

function assertInvariants(m, w) {
  expect(m.hidden, `bar visible at ${w}px`).toBe(false);
  expect(m.barH, `one line at ${w}px`).toBeLessThanOrEqual(29);
  expect(m.overflowPx, `fits at ${w}px`).toBeLessThanOrEqual(1);
  for (const id of ALWAYS) expect(m.shown[id], `${id} kept at ${w}px`).toBe(true);
  // Priority order: items drop from the front of FOOTER_DROP_ORDER, so the
  // hidden set is a prefix and the shown items form the suffix. Once a
  // shown item appears, no later item may be hidden.
  let shownSeen = false;
  for (const id of DROP_ORDER) {
    if (m.shown[id]) shownSeen = true;
    else if (shownSeen) {
      throw new Error(`priority violated at ${w}px: ${id} hidden while an earlier-dropping item is still shown`);
    }
  }
}

test('homepage footer fits and drops in order across the range', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(120);
    assertInvariants(await measure(page), w);
  }
});

test('doc-page footer keeps the CLI affordance far longer', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  // Reproduce the doc-page content (set live by the footer script on #md= pages).
  await page.evaluate(() => {
    document.getElementById('_sd_cli-install-cmd').textContent = 'sdoc upgrade';
    document.getElementById('_sd_cli-prompt-label').textContent = 'Copy update prompt';
    document.getElementById('_sd_cli-lead').textContent = 'CLI update released 6 hours ago:';
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(200);

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(120);
    assertInvariants(await measure(page), w);
  }

  // The whole point of the change: at 860px the CLI block (lead + prompt
  // chip) is still present - the old fixed breakpoint dropped it at 999px.
  // (With the 28px bar / 11.5px footer text it now drops around 820px, still
  // far below the old 999px.)
  await page.setViewportSize({ width: 860, height: 900 });
  await page.waitForTimeout(120);
  const m = await measure(page);
  expect(m.shown['sb-cli'], 'CLI block still shown at 860px on a doc page').toBe(true);
});
