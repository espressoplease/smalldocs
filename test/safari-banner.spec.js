// @ts-check
//
// Playwright spec for the Safari unsupported-bridge banner.
// Simulates Safari via the userAgent context option, then checks the banner
// appears only when the page has bridge intent and stays dismissed across
// reload via the versioned localStorage key.

const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

test.describe('Safari Bridge banner', () => {
  test.use({ userAgent: SAFARI_UA });

  test('appears when a bridge URL loads in Safari', async ({ page }) => {
    // Fake bridge params - we don't need a real bridge running. The banner
    // gates on UA + intent, not on connection success.
    await page.goto(BASE + '/#bridge=127.0.0.1:9999&token=abc');
    const banner = page.locator('#_sd_safari-banner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.sd-safari-banner-text')).toContainText('Chrome or Firefox');
  });

  test('does not appear on a normal (no-bridge) page load', async ({ page }) => {
    await page.goto(BASE + '/');
    // Give the page a beat to evaluate scripts.
    await page.waitForTimeout(200);
    await expect(page.locator('#_sd_safari-banner')).toBeHidden();
  });

  test('dismiss persists across reload via localStorage', async ({ page }) => {
    await page.goto(BASE + '/#bridge=127.0.0.1:9999&token=abc');
    const banner = page.locator('#_sd_safari-banner');
    await expect(banner).toBeVisible();

    await page.locator('.sd-safari-banner-dismiss').click();
    await expect(banner).toBeHidden();

    const dismissed = await page.evaluate(
      () => localStorage.getItem('sdocs_safari_banner_dismissed_v=1')
    );
    expect(dismissed).toBe('1');

    await page.reload();
    await expect(page.locator('#_sd_safari-banner')).toBeHidden();
  });
});

test.describe('Safari Bridge banner: non-Safari UA does not see it', () => {
  // Default Playwright UA is Chromium-flavoured; the banner should never appear.
  test('no banner on bridge URL in Chromium', async ({ page }) => {
    await page.goto(BASE + '/#bridge=127.0.0.1:9999&token=abc');
    await page.waitForTimeout(200);
    await expect(page.locator('#_sd_safari-banner')).toBeHidden();
  });
});
