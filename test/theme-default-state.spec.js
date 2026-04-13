// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Regression: toggling theme on the default landing page must not be treated
 * as a document edit. Before this fix, clicking the theme button flipped
 * _isDefaultState to false and pushed a #md= hash into the URL, which in
 * turn made the logo "reset" open a new tab instead of resetting in place.
 */
test.describe('Theme toggle on default state', () => {
  test('dark-mode toggle keeps default state and empty hash', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#_sd_btn-theme');
    const before = await page.evaluate(() => ({
      hash: location.hash,
      isDefault: SDocs._isDefaultState,
      theme: document.documentElement.dataset.theme,
    }));
    expect(before.hash).toBe('');
    expect(before.isDefault).toBe(true);

    await page.click('#_sd_btn-theme');
    // Let the hash-update debounce (400ms) flush
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => ({
      hash: location.hash,
      isDefault: SDocs._isDefaultState,
      theme: document.documentElement.dataset.theme,
    }));
    expect(after.theme).not.toBe(before.theme);
    expect(after.hash).toBe('');
    expect(after.isDefault).toBe(true);
  });

  test('logo click after theme toggle resets cleanly in place', async ({ page, context }) => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#_sd_btn-theme');
    await page.click('#_sd_btn-theme');
    await page.waitForTimeout(600);

    const tabCountBefore = context.pages().length;
    await page.click('#_sd_toolbar-brand');
    await page.waitForTimeout(200);

    // The logo should not open a new tab (no real content to preserve)
    expect(context.pages().length).toBe(tabCountBefore);

    const state = await page.evaluate(() => ({
      hash: location.hash,
      isDefault: SDocs._isDefaultState,
      mode: SDocs.currentMode,
    }));
    expect(state.hash).toBe('');
    expect(state.isDefault).toBe(true);
    expect(state.mode).toBe('read');
  });
});
