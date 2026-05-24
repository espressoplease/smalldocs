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

  test('shape whose only content is a code block auto-applies padding=0', async ({ page }) => {
    const md = [
      '~~~slide',
      'grid 100 56.25',
      'r 10 10 80 40 #c fill=#f1f5f9 color=#0f172a |',
      '  ```',
      '  code line one',
      '  code line two',
      '  ```',
      '~~~',
    ].join('\n');
    await loadDoc(page, md);
    // Shape rect has zero padding (default is 5% of min dim).
    const padding = await page.locator('.sdoc-slide .shape-rect').evaluate(el => ({
      top: parseFloat(getComputedStyle(el).paddingTop),
      left: parseFloat(getComputedStyle(el).paddingLeft),
    }));
    expect(padding.top).toBe(0);
    expect(padding.left).toBe(0);
    // Shape-md host has the code-only class.
    await expect(page.locator('.sdoc-slide .shape-md.shape-md-code-only')).toHaveCount(1);
    // Inside the shadow, the pre has a transparent background — no double-tone.
    const preBg = await page.locator('.sdoc-slide .shape-md.shape-md-code-only').evaluate(host => {
      const pre = host.shadowRoot.querySelector('pre');
      return getComputedStyle(pre).backgroundColor;
    });
    expect(preBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test('shape with heading + code block still uses default padding', async ({ page }) => {
    const md = [
      '~~~slide',
      'grid 100 56.25',
      'r 10 10 80 40 #mixed fill=#f1f5f9 color=#0f172a |',
      '  ## Example',
      '  ```',
      '  code here',
      '  ```',
      '~~~',
    ].join('\n');
    await loadDoc(page, md);
    const padding = await page.locator('.sdoc-slide .shape-rect').evaluate(el => ({
      top: parseFloat(getComputedStyle(el).paddingTop),
      left: parseFloat(getComputedStyle(el).paddingLeft),
    }));
    // Mixed content → padding is not zero (default 5% of min dim).
    expect(padding.top).toBeGreaterThan(0);
    expect(padding.left).toBeGreaterThan(0);
    // No code-only class on the host.
    await expect(page.locator('.sdoc-slide .shape-md.shape-md-code-only')).toHaveCount(0);
  });

  test('explicit padding= attribute always wins over code-only default', async ({ page }) => {
    const md = [
      '~~~slide',
      'grid 100 56.25',
      'r 10 10 80 40 #c fill=#f1f5f9 color=#0f172a padding=3 |',
      '  ```',
      '  code',
      '  ```',
      '~~~',
    ].join('\n');
    await loadDoc(page, md);
    const padding = await page.locator('.sdoc-slide .shape-rect').evaluate(el => parseFloat(getComputedStyle(el).paddingTop));
    // Explicit padding=3 (grid units) resolves to non-zero pixels.
    expect(padding).toBeGreaterThan(0);
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
