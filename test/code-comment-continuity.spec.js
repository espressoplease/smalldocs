// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Comment-mode continuity between the reader and the fullscreen viewer.
 *
 * - In prose comment mode, expanding a code block lands you in the viewer's
 *   comment mode.
 * - Closing the viewer while commenting lands the reader in comment mode.
 */

const DOC = '```ruby\nclass A\n  def run\n    1\n  end\nend\n```\n';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocs.setMode);
  await page.evaluate((body) => {
    window.SDocs.currentBody = body;
    window.SDocs.currentMeta = {};
    window.SDocs.render();
  }, DOC);
});

test('expanding a code block from prose comment mode opens the viewer in comment mode', async ({ page }) => {
  await page.evaluate(() => window.SDocs.setMode('comment'));
  await expect(page.locator('body.comment-mode')).toBeVisible();
  await page.locator('#_sd_rendered .pre-wrapper .expand-btn').click();
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await expect(page.locator('.sdoc-code-focus.sdoc-cc-on')).toBeVisible();
});

test('closing the viewer while commenting lands the reader in comment mode', async ({ page }) => {
  await page.evaluate(() => window.SDocs.setMode('read'));
  await expect(page.locator('body.comment-mode')).toHaveCount(0);
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre')));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  // turn on comment mode inside the viewer, then close
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-code-focus.sdoc-cc-on')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdoc-code-focus')).toHaveCount(0);
  // the reader is now in comment mode
  await expect(page.locator('body.comment-mode')).toBeVisible();
});

test('expanding when NOT in comment mode opens the viewer in read mode', async ({ page }) => {
  await page.evaluate(() => window.SDocs.setMode('read'));
  await page.locator('#_sd_rendered .pre-wrapper .expand-btn').click();
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await expect(page.locator('.sdoc-code-focus.sdoc-cc-on')).toHaveCount(0);
});
