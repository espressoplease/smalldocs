// @ts-check
// Tilde-fenced slide blocks (~~~slide ... ~~~) should work identically to
// backtick-fenced ones, with the bonus that ``` code blocks inside the slide
// content don't close the outer fence.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function loadDoc(page, md) {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(300);
}

test.describe('tilde-fenced slide blocks', () => {
  test('~~~slide renders like ```slide', async ({ page }) => {
    const md = [
      '# Test',
      '',
      '~~~slide',
      'grid 100 56.25',
      'r 10 10 80 40 | Tilde fence works',
      '~~~',
    ].join('\n');
    await loadDoc(page, md);
    await expect(page.locator('.sdoc-slide')).toHaveCount(1);
    await expect(page.locator('.sdoc-slide .shape-rect .shape-md .inner').first()).toContainText('Tilde fence works');
  });

  test('tilde-fenced slide can contain a nested ``` code block', async ({ page }) => {
    const md = [
      '# Test',
      '',
      '~~~slide',
      'grid 100 56.25',
      'r 10 10 80 40 #code fill=#f1f5f9 color=#0f172a |',
      '  ```python',
      '  def hello():',
      '      print("hi")',
      '  ```',
      '~~~',
    ].join('\n');
    await loadDoc(page, md);
    // One slide rendered, no leak
    await expect(page.locator('.sdoc-slide')).toHaveCount(1);
    // The inner code block was preserved and rendered via marked inside the shadow
    const codeText = await page.locator('.sdoc-slide .shape-md pre code').first().textContent();
    expect(codeText).toContain('def hello');
    expect(codeText).toContain('print("hi")');
  });

  test('mix: ```slide and ~~~slide in the same doc both render', async ({ page }) => {
    const md = [
      '# Test',
      '',
      '```slide',
      'grid 100 56.25',
      'r 10 10 80 40 | Backtick slide',
      '```',
      '',
      '~~~slide',
      'grid 100 56.25',
      'r 10 10 80 40 | Tilde slide',
      '~~~',
    ].join('\n');
    await loadDoc(page, md);
    await expect(page.locator('.sdoc-slide')).toHaveCount(2);
    await expect(page.locator('.sdoc-slide').nth(0).locator('.shape-md .inner')).toContainText('Backtick slide');
    await expect(page.locator('.sdoc-slide').nth(1).locator('.shape-md .inner')).toContainText('Tilde slide');
  });
});
