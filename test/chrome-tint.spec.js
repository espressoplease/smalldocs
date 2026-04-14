// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Chrome tinting: when a doc specifies custom colors, the app tints the
 * top toolbar / side panel by writing inline CSS custom properties at :root.
 * On a default doc (nothing customised), no inline overrides should exist.
 *
 * Regressions this guards:
 *   - Tinting a dark-bg doc under light theme must keep panel text readable
 *     (earlier bug: dark text on dark-tinted bg).
 *   - Loading the plain landing page must leave chrome identical to tokens.css.
 */

// Read a CSS custom property value from the root element.
// Inline styles appear on documentElement.style.
async function readRootVar(page, name) {
  return page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);
}

// Resolve a color-mix expression to a concrete rgb string by probing.
async function resolveVar(page, varName) {
  return page.evaluate((v) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(' + v + ')';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, varName);
}

// Chrome returns color-mix() results as oklch(L C H). Browsers may also return
// rgb(r, g, b). Extract a 0-1 lightness/luminance from either.
function lightnessFromColor(str) {
  let m = str.match(/oklch\(\s*([\d.]+)/);
  if (m) return +m[1];
  m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
  return NaN;
}

test.describe('Chrome tinting', () => {
  test('default landing page leaves chrome untinted', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#_sd_rendered');
    // Give chrome module a chance to run
    await page.waitForTimeout(100);

    const bg = await readRootVar(page, '--bg');
    const bgPanel = await readRootVar(page, '--bg-panel');
    const text2 = await readRootVar(page, '--text-2');

    expect(bg.trim()).toBe('');
    expect(bgPanel.trim()).toBe('');
    expect(text2.trim()).toBe('');
  });

  test('dark-bg doc under light theme produces readable panel text', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#_sd_rendered');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

    // Simulate loading a doc with a deep navy background
    await page.evaluate(() => {
      window.SDocs.applyStylesFromMeta({
        background: '#0b1d36',
        color: '#e2e8f0',
        headers: { color: '#fbbf24' }
      });
    });
    await page.waitForTimeout(100);

    // Inline overrides must now be present
    const bgPanel = await readRootVar(page, '--bg-panel');
    expect(bgPanel).toContain('color-mix');

    // Resolved panel bg should be dark (tinted with navy)
    const resolvedPanelBg = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.background = 'var(--bg-panel)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    });
    expect(lightnessFromColor(resolvedPanelBg)).toBeLessThan(0.5);

    // Resolved text-2 (side-panel label color) must be light enough to read
    // against the dark-tinted panel bg.
    const resolvedText2 = await resolveVar(page, '--text-2');
    expect(lightnessFromColor(resolvedText2)).toBeGreaterThan(0.5);
  });

  test('custom bg gets cleared when a doc without custom colors loads after', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#_sd_rendered');

    // First: apply a doc with a custom bg (tints chrome)
    await page.evaluate(() => {
      window.SDocs.applyStylesFromMeta({ background: '#0b1d36', color: '#e2e8f0' });
    });
    await page.waitForTimeout(100);
    expect((await readRootVar(page, '--bg-panel')).trim()).not.toBe('');

    // Then: apply a style meta with no custom background — chrome must revert
    await page.evaluate(() => {
      window.SDocs.applyStylesFromMeta({ fontFamily: 'Inter' });
    });
    await page.waitForTimeout(100);
    expect((await readRootVar(page, '--bg-panel')).trim()).toBe('');
    expect((await readRootVar(page, '--bg')).trim()).toBe('');
  });
});
