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

  test('autofit re-runs when a collapsed section opens', async ({ page }) => {
    // A slide nested under ## so it lands in a .md-section-body that's
    // closed by default. Without the ResizeObserver retry, the initial
    // autofit sees stageH=0 and leaves fontSize empty — so the rect ends
    // up at cascade size, which is much smaller than the cqh autofit would
    // have chosen.
    const body = '# Deck\n\n## Section\n\n```slide\ngrid 100 56.25\nr 10 10 80 30 | Hello\n```\n';
    await page.goto('/');
    await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
    await page.evaluate((b) => { window.SDocs.currentBody = b; window.SDocs.render(); }, body);
    await page.waitForTimeout(500);
    // At this point the section is collapsed; stage height should be 0.
    const pre = await page.$eval('.sdoc-slide .shape-rect', (el) => el.style.fontSize);
    expect(pre).toBe('');
    // Open the section — ResizeObserver should detect the transition and rerun autofit.
    await page.evaluate(() => {
      document.querySelectorAll('.md-section-body').forEach((b) => b.classList.add('open'));
    });
    await page.waitForTimeout(400);
    const post = await page.$eval('.sdoc-slide .shape-rect', (el) => el.style.fontSize);
    expect(post).toMatch(/cqh$/);
  });

  test('exportSlidesPdf builds a downloadable PDF without calling window.print', async ({ page }) => {
    const body = '# Deck\n\n```slide\ngrid 100 56.25\nr 10 10 80 30 | One\n```\n\n```slide\ngrid 100 56.25\nr 10 10 80 30 | Two\n```\n\n```slide\ngrid 100 56.25\nr 10 10 80 30 | Three\n```\n';
    await page.goto('/');
    await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
    await page.evaluate((b) => { window.SDocs.currentBody = b; window.SDocs.render(); }, body);
    await page.waitForTimeout(500);
    // Grab the Blob object directly — a.href is revoked right after .click()
    // returns, so intercepting the href alone is racy.
    await page.evaluate(() => {
      window.__printCalls = 0;
      window.print = () => { window.__printCalls++; };
      window.__capturedBlob = null;
      window.__downloadedName = null;
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (obj) {
        if (obj instanceof Blob && obj.type === 'application/pdf') {
          window.__capturedBlob = obj;
        }
        return origCreateObjectURL(obj);
      };
      const origCreateEl = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = origCreateEl(tag);
        if (tag === 'a') {
          el.click = function () { window.__downloadedName = el.download; };
        }
        return el;
      };
    });
    await page.evaluate(() => window.SDocs.exportSlidesPdf());
    await page.waitForFunction(() => !!window.__capturedBlob, { timeout: 30000 });
    const name = await page.evaluate(() => window.__downloadedName);
    expect(name).toMatch(/-slides\.pdf$/);
    const isPdf = await page.evaluate(async () => {
      const buf = await window.__capturedBlob.arrayBuffer();
      const header = new Uint8Array(buf.slice(0, 4));
      return header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
    });
    expect(isPdf).toBe(true);
    const printCalls = await page.evaluate(() => window.__printCalls);
    expect(printCalls).toBe(0);
    // No lingering print-stage or printing-slides class from the old path.
    const leftoverStage = await page.$('#_sd_print-stage');
    expect(leftoverStage).toBeNull();
    const leftoverClass = await page.evaluate(() => document.body.classList.contains('sdoc-printing-slides'));
    expect(leftoverClass).toBe(false);
  });

  test('present-mode export button toggles the side panel', async ({ page }) => {
    const body = '# Deck\n\n```slide\ngrid 100 56.25\nr 10 10 80 30 | Only slide\n```\n';
    await page.goto('/');
    await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
    await page.evaluate((b) => { window.SDocs.currentBody = b; window.SDocs.render(); }, body);
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.SDocPresent && window.SDocPresent.open(0); });
    await page.waitForTimeout(500);
    const panelBefore = await page.$('.sdoc-present-exp-panel.open');
    expect(panelBefore).toBeNull();
    await page.click('.sdoc-present-export-btn');
    await page.waitForTimeout(300);
    const panelAfter = await page.$('.sdoc-present-exp-panel.open');
    expect(panelAfter).not.toBeNull();
    // Click the export button again — should toggle it closed.
    await page.click('.sdoc-present-export-btn');
    await page.waitForTimeout(300);
    const panelClosed = await page.$('.sdoc-present-exp-panel.open');
    expect(panelClosed).toBeNull();
  });

  test('Slides PDF menu option hidden when doc has no slides', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
    await page.evaluate(() => { window.SDocs.currentBody = '# Plain doc\n\nNo slides here.\n'; window.SDocs.render(); });
    await page.waitForTimeout(300);
    await page.click('#_sd_btn-export');
    await page.waitForTimeout(200);
    const display = await page.$eval('#_sd_exp-slides-pdf', (el) => el.style.display);
    expect(display).toBe('none');
  });

  test('Slides PDF menu option visible when doc has slides', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
    await page.evaluate(() => { window.SDocs.currentBody = '# Deck\n\n```slide\ngrid 100 56.25\nr 10 10 80 30 | Hi\n```\n'; window.SDocs.render(); });
    await page.waitForTimeout(500);
    await page.click('#_sd_btn-export');
    await page.waitForTimeout(200);
    const display = await page.$eval('#_sd_exp-slides-pdf', (el) => el.style.display);
    expect(display).not.toBe('none');
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
