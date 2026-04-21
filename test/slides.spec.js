// @ts-check
// Playwright tests for the slide-rendering pipeline: grid bg=, font=Npx,
// font=fixed, and the error-badge Copy button. Runs against the dev server
// via playwright.config.js.
const { test, expect } = require('@playwright/test');

async function renderBody(page, body) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((b) => { window.SDocs.currentBody = b; window.SDocs.render(); }, body);
  // Wait two frames so the renderer's rAF-based autofit/font conversion has
  // settled before assertions read font-size values.
  await page.waitForTimeout(200);
}

function slideDoc(slideBody) {
  return '# Deck\n\n```slide\n' + slideBody + '\n```\n';
}

test.describe('Slide rendering pipeline', () => {
  test('grid bg= paints the slide container background', async ({ page }) => {
    await renderBody(page, slideDoc('grid 100 56.25 bg=#0f172a\nr 10 10 80 20 color=#fff | hello'));
    const bg = await page.$eval('.sdoc-slide .sd-shape-stage', (el) => getComputedStyle(el).backgroundColor);
    // #0f172a → rgb(15, 23, 42)
    expect(bg).toBe('rgb(15, 23, 42)');
  });

  test('no grid bg= leaves stage without explicit background', async ({ page }) => {
    await renderBody(page, slideDoc('grid 100 56.25\nr 10 10 80 20 | hello'));
    const inline = await page.$eval('.sdoc-slide .sd-shape-stage', (el) => el.style.backgroundColor);
    expect(inline).toBe('');
  });

  test('font=18px emits cqh relative to 720px reference', async ({ page }) => {
    await renderBody(page, slideDoc('grid 100 56.25\nr 10 10 80 20 font=18px | caption'));
    const fs = await page.$eval('.sdoc-slide .shape-rect', (el) => el.style.fontSize);
    // 18 / 720 * 100 = 2.5cqh (allow toFixed(4) formatting variance)
    expect(fs).toMatch(/^2\.5\d*cqh$/);
  });

  test('font=24px emits a larger cqh than font=12px', async ({ page }) => {
    const body = '# Deck\n\n```slide\ngrid 100 56.25\nr 0 0 50 20 font=24px | big\nr 50 0 50 20 font=12px | small\n```\n';
    await renderBody(page, body);
    const sizes = await page.$$eval('.sdoc-slide .shape-rect', (els) => els.map((el) => parseFloat(el.style.fontSize)));
    expect(sizes.length).toBe(2);
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[0]).toBeCloseTo(24 / 720 * 100, 3);
    expect(sizes[1]).toBeCloseTo(12 / 720 * 100, 3);
  });

  test('font=fixed tags the element and converts cascade size to cqh after render', async ({ page }) => {
    await renderBody(page, slideDoc('grid 100 56.25\nr 10 10 80 20 font=fixed | fine print'));
    const info = await page.$eval('.sdoc-slide .shape-rect', (el) => ({
      autofit: el.dataset.autofit,
      mode: el.dataset.fontMode,
      fontSize: el.style.fontSize,
    }));
    expect(info.autofit).toBe('off');
    expect(info.mode).toBe('fixed');
    // Post-render pass converts cascade to cqh; value should be present and end in cqh.
    expect(info.fontSize).toMatch(/cqh$/);
  });

  test('autofit text (no font= attr) still uses cqh via binary search', async ({ page }) => {
    await renderBody(page, slideDoc('grid 100 56.25\nr 10 10 80 30 | autofit title'));
    const info = await page.$eval('.sdoc-slide .shape-rect', (el) => ({
      autofit: el.dataset.autofit || 'on',
      fontSize: el.style.fontSize,
    }));
    expect(info.autofit).toBe('on');
    expect(info.fontSize).toMatch(/cqh$/);
  });

  test('error badge lists line-numbered errors and has a Copy button', async ({ page }) => {
    // Unknown shape kind `b` + bogus grid token → at least two parser errors.
    const body = '# Deck\n\n```slide\ngrid 100 56.25\nb 10 10 80 10 | unknown kind\nr 150 10 50 10 | out of grid\n```\n';
    await renderBody(page, body);
    const badge = await page.$('.sdoc-slide-errbadge');
    expect(badge).not.toBeNull();
    const items = await page.$$eval('.sdoc-slide-errbadge-list li', (lis) => lis.map((li) => li.textContent));
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Each item starts with "line N: "
    for (const t of items) expect(t).toMatch(/^line \d+: /);
    const btn = await page.$('.sdoc-slide-errbadge-copy');
    expect(btn).not.toBeNull();
    expect(await btn.textContent()).toBe('Copy');
  });

  test('error badge Copy button writes slide index + errors + DSL fence to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const body = '# Deck\n\n```slide\ngrid 100 56.25\nb 10 10 80 10 | unknown kind\n```\n';
    await renderBody(page, body);
    await page.click('.sdoc-slide-errbadge-copy');
    // Button flips to "Copied" and the diagnostic is on the clipboard.
    await expect(page.locator('.sdoc-slide-errbadge-copy')).toHaveText('Copied');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toMatch(/^SDocs slide 1 — \d+ error/);
    expect(text).toContain('b 10 10 80 10 | unknown kind');
    expect(text).toContain('~~~slide');
  });

  test('h1Scale and pScale inject em-based overrides into the shadow root', async ({ page }) => {
    const body = '# Deck\n\n```slide\ngrid 100 56.25\nr 10 10 80 30 h1Scale=3 pScale=0.4 |\n  # Big\n  small caption\n```\n';
    await renderBody(page, body);
    // Read the shadow root's <style> to confirm the override rules exist.
    const styleText = await page.$eval('.sdoc-slide .shape-md', (host) => {
      if (!host.shadowRoot) return '';
      const s = host.shadowRoot.querySelector('style');
      return s ? s.textContent : '';
    });
    expect(styleText).toContain('h1 { font-size: 3em; }');
    expect(styleText).toContain('p { font-size: 0.4em; }');
  });

  test('invalid or missing scales are ignored', async ({ page }) => {
    const body = '# Deck\n\n```slide\ngrid 100 56.25\nr 10 10 80 30 h1Scale=bogus h2Scale=-1 |\n  # Heading\n```\n';
    await renderBody(page, body);
    const styleText = await page.$eval('.sdoc-slide .shape-md', (host) => {
      return host.shadowRoot ? host.shadowRoot.querySelector('style').textContent : '';
    });
    // Defaults (1.4em for h1, 1.2em for h2) remain; no NaNem / negative-em rules.
    expect(styleText).not.toMatch(/font-size:\s*NaNem/);
    expect(styleText).not.toMatch(/font-size:\s*-\d/);
  });

  test('error badge Copy click does not bubble to open present mode', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const body = '# Deck\n\n```slide\ngrid 100 56.25\nb 10 10 80 10 | bad\n```\n';
    await renderBody(page, body);
    await page.click('.sdoc-slide-errbadge-copy');
    await page.waitForTimeout(200);
    const presentOpen = await page.evaluate(() => document.body.classList.contains('sdoc-present-open'));
    expect(presentOpen).toBe(false);
  });
});
