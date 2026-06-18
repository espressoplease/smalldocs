// @ts-check
/**
 * iOS auto-zoom guard.
 *
 * Mobile Safari zooms the viewport whenever a focused text field computes to a
 * font-size under 16px. The comment inputs inherit the card's 0.82em (~13px),
 * so tapping into one used to yank the page in. comments.css pins the comment
 * inputs to 16px below the 768px breakpoint. This test pins that contract on a
 * phone-sized viewport (and confirms desktop is left alone).
 */
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function enterCommentModeWithBlockComposer(page) {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && !!window.SDocs.render);
  await page.evaluate(() => window.SDocs.loadText('# T\n\nA paragraph to comment on.'));
  await page.evaluate(() => {
    const btn = document.getElementById('_sd_btn-comment');
    if (btn && !document.body.classList.contains('comment-mode')) btn.click();
  });
  await page.locator('.sdoc-gutter-add').first().click({ force: true });
  return page.locator('.sdoc-card-sidecar .sdoc-card-input').first();
}

test.describe('mobile viewport (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('comment input computes to 16px so iOS does not auto-zoom', async ({ page }) => {
    const input = await enterCommentModeWithBlockComposer(page);
    const fs = await input.evaluate(el => getComputedStyle(el).fontSize);
    expect(fs).toBe('16px');
  });
});

test.describe('desktop viewport (1200px)', () => {
  test.use({ viewport: { width: 1200, height: 900 } });

  test('comment input stays at the smaller inherited size (rule is mobile-only)', async ({ page }) => {
    const input = await enterCommentModeWithBlockComposer(page);
    const fs = await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeLessThan(16);
  });
});
