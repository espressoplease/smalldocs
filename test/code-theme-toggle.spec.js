// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Viewer-local light/dark toggle in the fullscreen code view
 * (sdocs-code-focus.js: applyFocusTheme / initFocusTheme + the [data-act="theme"]
 * topbar button).
 *
 * The toggle flips the code viewer's own surface between light and dark WITHOUT
 * changing the document's theme (html[data-theme]). The choice is remembered in
 * localStorage and re-applied on the next open; with no saved choice the viewer
 * follows the document theme.
 */

const RUBY = [
  'class PriceCache',
  '  CACHE_TTL = 300',
  '',
  '  def fetch(symbol)',
  '    @store[symbol]',
  '  end',
  'end',
].join('\n');

async function openCode(page, lang, code) {
  await page.evaluate(({ lang, code }) => {
    window.SDocs.currentBody = '```' + lang + '\n' + code + '\n```\n';
    window.SDocs.currentMeta = {};
    window.SDocs.render();
    var pre = document.querySelector('#_sd_rendered pre');
    window.SDocs.codeFocus.open(pre);
  }, { lang, code });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await page.locator('.sdoc-cl-code .hljs-keyword').first().waitFor({ timeout: 5000 }).catch(() => {});
}

// The modal surface colour, as a lightness check: pull --sdoc-focus-bg off the
// modal and report whether it reads dark (the canonical dark surface #1a1816).
async function surfaceIsDark(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.sdoc-code-focus');
    const bg = getComputedStyle(m).getPropertyValue('--sdoc-focus-bg').trim().toLowerCase();
    return bg === '#1a1816';
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocs.render);
  // Start each test from a clean, light document with no remembered viewer theme.
  await page.evaluate(() => {
    try { localStorage.removeItem('sdocs:codeFocusTheme'); } catch (e) {}
    document.documentElement.setAttribute('data-theme', 'light');
  });
});

test('a light document opens the viewer light, with a moon (switch-to-dark) button', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  expect(await surfaceIsDark(page)).toBe(false);
  // Moon glyph = "switch to dark"; lucide moon is the only path with the arc "a6 6".
  const label = await page.locator('.sdoc-code-focus [data-act="theme"]').getAttribute('aria-label');
  expect(label).toMatch(/dark/i);
});

test('clicking the toggle darkens the viewer but leaves the document theme alone', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await page.locator('.sdoc-code-focus [data-act="theme"]').click();
  expect(await surfaceIsDark(page)).toBe(true);
  // The document itself stays light.
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  // The button now offers to switch back to light.
  const label = await page.locator('.sdoc-code-focus [data-act="theme"]').getAttribute('aria-label');
  expect(label).toMatch(/light/i);
});

test('the toggle round-trips back to light', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  const btn = page.locator('.sdoc-code-focus [data-act="theme"]');
  await btn.click();
  expect(await surfaceIsDark(page)).toBe(true);
  await btn.click();
  expect(await surfaceIsDark(page)).toBe(false);
});

test('the viewer-local choice is remembered across a close and reopen', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await page.locator('.sdoc-code-focus [data-act="theme"]').click();
  expect(await surfaceIsDark(page)).toBe(true);
  // Reopen over the same source; the dark choice should be re-applied.
  await page.evaluate(() => window.SDocs.codeFocus.close());
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre')));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  expect(await surfaceIsDark(page)).toBe(true);
  // And the document is still light underneath.
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
});

test('annotation cards follow the viewer-local theme, not the document', async ({ page }) => {
  await page.evaluate(({ code }) => {
    window.SDocs.currentBody = '```ruby\n' + code + '\n```\n';
    window.SDocs.currentMeta = { annotations: [{ line: 2, endLine: 2, text: 'a note' }] };
    window.SDocs.render();
    window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  }, { code: RUBY });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await expect(page.locator('.sdoc-ann-card')).toBeVisible();
  const lightCardBg = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.sdoc-ann-card')).backgroundColor);
  await page.locator('.sdoc-code-focus [data-act="theme"]').click();
  const darkCardBg = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.sdoc-ann-card')).backgroundColor);
  // The card background changes when the viewer flips, even though the document
  // theme never did.
  expect(darkCardBg).not.toBe(lightCardBg);
});
