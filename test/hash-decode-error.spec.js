// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

test('a broken inline document shows an error and preserves its hash', async ({ page }) => {
  const brokenHash = '#md=definitely-not-a-complete-compressed-document';
  await page.goto(BASE + '/docs' + brokenHash);

  const card = page.locator('.sdoc-load-error');
  await expect(card).toBeVisible();
  await expect(card).toContainText('This link is incomplete');
  await expect(card).toContainText('sdoc upgrade');
  await expect(card).toContainText('private local bootstrap');

  // resetAllStyles() schedules a hash write before decoding starts. Wait past
  // that debounce to prove the pending write cannot replace the failed payload
  // with an empty-document hash.
  await page.waitForTimeout(700);
  expect(new URL(page.url()).hash).toBe(brokenHash);
});
