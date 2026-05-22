// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Short-link staleness fix.
 *
 * A short link is an immutable snapshot. When /s/<id>#k=<key> is opened,
 * initShortLink sets SDocs.shortUrl / SDocs.shortLinkId and the file info card
 * shows a "Short URL" row. The address bar normalises back to /#md=... on the
 * first edit, but those two fields used to never be cleared - so the card kept
 * advertising a short URL for content the live document no longer matched.
 *
 * syncAll now drops the short-link state on any divergence (a text, style, or
 * comment edit, or a fresh document loaded over it) and re-renders the card. A
 * theme swap is a viewer preference, not a document change, so it keeps the
 * short link.
 *
 * openFreshShortLink also exercises the new long-id round trip end to end:
 * create -> store -> fetch -> decrypt all run against a freshly minted 22-char
 * id before each test asserts anything.
 */

// Open the app, build a real document, mint a short link, then open it.
// Returns the { url, id } the page is now sitting on.
async function openFreshShortLink(page) {
  await page.goto(BASE + '/');
  await page.waitForFunction(() =>
    window.SDocs && window.SDocs.shortLink && typeof window.SDocs.shortLink.create === 'function');

  const link = await page.evaluate(async () => {
    window.SDocs.loadText('# Short link test\n\nOriginal body content.');
    window.SDocs._isDefaultState = false;
    return await window.SDocs.shortLink.create();
  });

  await page.goto(link.url);
  await page.waitForFunction(() => window.SDocs && window.SDocs.shortLinkId);
  return link;
}

test('a loaded short link populates shortUrl / shortLinkId and the card row', async ({ page }) => {
  const link = await openFreshShortLink(page);

  // A new short link mints a long (22-char) id.
  expect(link.id).toHaveLength(22);

  const state = await page.evaluate(() => ({
    shortUrl: window.SDocs.shortUrl,
    shortLinkId: window.SDocs.shortLinkId,
  }));
  expect(state.shortUrl).toBeTruthy();
  expect(state.shortLinkId).toBe(link.id);
  expect(await page.locator('.fic-row-short').count()).toBeGreaterThan(0);
});

test('editing a loaded short link clears the stale short URL from the card', async ({ page }) => {
  await openFreshShortLink(page);

  // Edit through the raw textarea, the same path a real edit takes:
  // input event -> debounced syncAll('raw') -> dropShortLinkIfDiverged.
  await page.evaluate(() => {
    window.SDocs.rawEl.value += '\n\nan edit that diverges from the snapshot';
    window.SDocs.rawEl.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await page.waitForFunction(() => window.SDocs.shortUrl == null);

  const state = await page.evaluate(() => ({
    shortUrl: window.SDocs.shortUrl,
    shortLinkId: window.SDocs.shortLinkId,
  }));
  expect(state.shortUrl).toBeNull();
  expect(state.shortLinkId).toBeNull();
  expect(await page.locator('.fic-row-short').count()).toBe(0);
});

test('toggling theme keeps the short link - it is a viewer preference', async ({ page }) => {
  await openFreshShortLink(page);

  await page.click('#_sd_btn-theme');
  // updateHash debounce is 400ms; wait well past it so an erroneous clear
  // would already have happened.
  await page.waitForTimeout(900);

  const state = await page.evaluate(() => ({
    shortUrl: window.SDocs.shortUrl,
    shortLinkId: window.SDocs.shortLinkId,
  }));
  expect(state.shortUrl).toBeTruthy();
  expect(state.shortLinkId).toBeTruthy();
  expect(await page.locator('.fic-row-short').count()).toBeGreaterThan(0);
});
