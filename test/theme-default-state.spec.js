// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Toggling theme on the default landing page must not be treated as a
 * document edit, and the brand remains a normal homepage link.
 */
test.describe('Theme toggle on default state', () => {
  test('dark-mode toggle keeps default state and empty hash', async ({ page }) => {
    await page.goto(BASE + '/docs');
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

  test('logo remains a homepage link after theme toggle', async ({ page }) => {
    await page.goto(BASE + '/docs');
    await page.waitForSelector('#_sd_btn-theme');
    await page.click('#_sd_btn-theme');
    await page.waitForTimeout(600);

    await expect(page.locator('#_sd_toolbar-brand')).toHaveAttribute('href', '/');
  });
});
