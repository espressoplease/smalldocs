// @ts-check
//
// Mermaid integration tests. These hit the real CDN (jsdelivr) since
// Mermaid lazy-loads on first encounter; if the network is offline the
// CDN-dependent tests will fail. The placeholder-replacement tests do
// not require network and run regardless.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function loadDoc(page, markdown) {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((md) => window.SDocs.loadText(md), markdown);
}

// ── Render: full pipeline (network-dependent) ───────────

test('renders ```mermaid fence as an SVG', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n  B --> C\n```');
  // Mermaid CDN load + render is async. Wait for the SVG to appear.
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  const svgCount = await page.locator('.sdoc-mermaid-stage svg').count();
  expect(svgCount).toBe(1);
});

test('renders multiple diagrams in one document', async ({ page }) => {
  await loadDoc(page, [
    '```mermaid', 'graph TD', '  A --> B', '```',
    '',
    '```mermaid', 'sequenceDiagram', '  Alice->>Bob: hi', '```'
  ].join('\n'));
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  // Wait for both to land.
  await page.waitForFunction(() => document.querySelectorAll('.sdoc-mermaid-stage svg').length >= 2,
    null, { timeout: 10000 });
  expect(await page.locator('.sdoc-mermaid-stage svg').count()).toBe(2);
});

test('replaces the original <pre> (no raw mermaid source visible)', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  ROOTNODE --> CHILD\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  const preCount = await page.locator('#_sd_rendered code.language-mermaid').count();
  expect(preCount).toBe(0);
});

// ── Slide-embedded diagram reveal (collapsed section / slow render) ──

test('diagram inside a slide reveals after its collapsed section expands', async ({ page }) => {
  const md = [
    '## Diagrams',
    '',
    '~~~slide',
    'grid 100 56.25',
    'r 8 10 84 36 align=center valign=center |',
    '  ```mermaid',
    '  flowchart LR',
    '    A --> B --> C',
    '  ```',
    '~~~',
  ].join('\n');
  await loadDoc(page, md);

  // The slide sits in a section that is collapsed by default, so its shape
  // wrapper measures 0x0. The embedded SVG renders but starts hidden. Wait
  // well past the old bounded reveal poll (~4s) so a regression can't pass
  // by luck - the SVG must still be revealed once the section is expanded.
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.SDocs.expandAllSections && window.SDocs.expandAllSections());

  await page.waitForFunction(() => {
    const host = document.querySelector('#_sd_rendered .shape-md');
    const svg = host && host.shadowRoot && host.shadowRoot.querySelector('svg.sdoc-mermaid-svg');
    return !!svg && getComputedStyle(svg).visibility === 'visible';
  }, null, { timeout: 6000 });

  const visible = await page.evaluate(() => {
    const host = document.querySelector('#_sd_rendered .shape-md');
    const svg = host && host.shadowRoot && host.shadowRoot.querySelector('svg.sdoc-mermaid-svg');
    return !!svg && getComputedStyle(svg).visibility === 'visible';
  });
  expect(visible).toBe(true);
});

// ── Theme: re-render on theme toggle (no stale baked-in colors) ──────

test('theme toggle re-themes an already-rendered diagram', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg .node', { timeout: 10000 });

  const fillOf = () => page.evaluate(() => {
    const el = document.querySelector(
      '.sdoc-mermaid-stage svg .node rect, .sdoc-mermaid-stage svg .node polygon, .sdoc-mermaid-stage svg .node path'
    );
    return el ? getComputedStyle(el).fill : null;
  });

  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('dark'));
  await page.waitForTimeout(900);
  const darkFill = await fillOf();

  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('light'));
  await page.waitForTimeout(900);
  const lightFill = await fillOf();

  // Node fill is derived from the page background, which differs between
  // themes. Without a re-render the SVG keeps its baked-in fill and the two
  // are identical (the bug).
  expect(darkFill).not.toBe(null);
  expect(lightFill).not.toBe(darkFill);
});

// ── Security: XSS through diagram source ──────────────────

test('XSS: <script> in label is escaped, no script element survives', async ({ page }) => {
  let alertFired = false;
  page.on('dialog', async (d) => { alertFired = true; await d.dismiss(); });
  await loadDoc(page,
    '```mermaid\ngraph TD\n  A["<script>alert(1)</script>"] --> B\n```');
  await page.waitForSelector('.sdoc-mermaid', { timeout: 10000 });
  // Allow Mermaid render to complete or fail (strict mode often rejects this)
  await page.waitForTimeout(2000);
  const hasScript = await page.locator('.sdoc-mermaid script').count();
  expect(hasScript).toBe(0);
  expect(alertFired).toBe(false);
});

test('XSS: img onerror in label does not execute', async ({ page }) => {
  let alertFired = false;
  page.on('dialog', async (d) => { alertFired = true; await d.dismiss(); });
  await loadDoc(page,
    '```mermaid\ngraph TD\n  A["<img src=x onerror=alert(1)>"] --> B\n```');
  await page.waitForSelector('.sdoc-mermaid', { timeout: 10000 });
  await page.waitForTimeout(2000);
  expect(alertFired).toBe(false);
});

test('foreignObject is allowed (htmlLabels:true) but stays empty when no HTML wrapping needed', async ({ page }) => {
  // With htmlLabels:true Mermaid emits foreignObject for label content.
  // We allow them through sanitize (otherwise wrapped labels disappear);
  // dangerous children inside are still stripped (covered by other tests).
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  const fo = await page.locator('.sdoc-mermaid foreignObject').count();
  expect(fo).toBeGreaterThan(0);
});

test('XSS: foreignObject smuggling iframe srcdoc neutralised', async ({ page }) => {
  let alertFired = false;
  page.on('dialog', async (d) => { alertFired = true; await d.dismiss(); });
  // Mermaid's strict mode escapes user labels, so a pure label-injection
  // attempt is already neutralised. This test confirms the *post-sanitize*
  // layer holds: even if Mermaid (or a future bug) emits an iframe inside
  // a foreignObject, our sanitizeSvg strips iframe entirely.
  await loadDoc(page, '```mermaid\nflowchart TD\n  A["<iframe srcdoc=\\"<script>alert(1)</script>\\">"] --> B\n```');
  await page.waitForSelector('.sdoc-mermaid', { timeout: 10000 });
  await page.waitForTimeout(2000);
  expect(alertFired).toBe(false);
  expect(await page.locator('.sdoc-mermaid iframe').count()).toBe(0);
});

test('XSS: <style> inside foreignObject is stripped, SVG-level <style> kept', async ({ page }) => {
  await loadDoc(page, '```mermaid\nflowchart TD\n  A[Hello] --> B[World]\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.waitForTimeout(700);
  // SVG-level <style> must survive (Mermaid's node fill/stroke CSS lives there)
  const svgStyle = await page.locator('.sdoc-mermaid-stage svg > style').count();
  expect(svgStyle).toBeGreaterThan(0);
  // Style inside foreignObject must NEVER survive (CSS @import is a network exfil)
  const foStyle = await page.locator('.sdoc-mermaid-stage foreignObject style').count();
  expect(foStyle).toBe(0);
});

test('XSS: form/input inside HTML labels stripped (no phishing UI)', async ({ page }) => {
  await loadDoc(page, '```mermaid\nflowchart TD\n  A["<form action=\\"//evil\\"><input name=p></form>"] --> B\n```');
  await page.waitForSelector('.sdoc-mermaid', { timeout: 10000 });
  await page.waitForTimeout(2000);
  expect(await page.locator('.sdoc-mermaid form, .sdoc-mermaid input').count()).toBe(0);
});

test('explicit <br/> in label produces multi-line foreignObject', async ({ page }) => {
  // We deliberately don't auto-wrap (max-width tricked Mermaid's measure
  // into single-word-per-line layouts that read worse than overflow). The
  // contract: authors get clean line breaks via explicit <br/>, and
  // htmlLabels:true ensures those breaks render through HTML rather than
  // being ignored as they were with SVG <text> labels.
  await loadDoc(page, '```mermaid\nflowchart TD\n  A[Short] --> B["First line<br/>Second line<br/>Third line"]\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.waitForTimeout(900);
  const longLabelHeight = await page.evaluate(() => {
    const fos = document.querySelectorAll('.sdoc-mermaid-stage foreignObject');
    let maxH = 0;
    fos.forEach(fo => { maxH = Math.max(maxH, parseFloat(fo.getAttribute('height') || '0')); });
    return maxH;
  });
  expect(longLabelHeight).toBeGreaterThan(40);
});

test('XSS: %%{init: securityLevel:loose}%% directive is stripped', async ({ page }) => {
  // If the directive survived, Mermaid would re-init with 'loose' which
  // permits HTML in labels. We strip the directive in source before render,
  // so labels should still be escaped.
  let alertFired = false;
  page.on('dialog', async (d) => { alertFired = true; await d.dismiss(); });
  await loadDoc(page, [
    '```mermaid',
    '%%{init: {"securityLevel":"loose"}}%%',
    'graph TD',
    '  A["<img src=x onerror=alert(1)>"] --> B',
    '```'
  ].join('\n'));
  await page.waitForSelector('.sdoc-mermaid', { timeout: 10000 });
  await page.waitForTimeout(2000);
  expect(alertFired).toBe(false);
  // No img with onerror should have survived
  const dangerous = await page.locator('.sdoc-mermaid img[onerror]').count();
  expect(dangerous).toBe(0);
});

// ── DoS / resource budget ─────────────────────────────────

test('source-size cap: > 64 KB diagram source renders an error', async ({ page }) => {
  const huge = 'A --> B\n'.repeat(8200); // ~65 KB
  await loadDoc(page, '```mermaid\ngraph TD\n' + huge + '```');
  await page.waitForSelector('.sdoc-mermaid', { timeout: 10000 });
  // Either an explicit error wrapper, or no SVG. Both are acceptable - what
  // matters is that we did NOT spend 30 seconds laying out a giant graph.
  const isError = await page.locator('.sdoc-mermaid-error').count();
  const hasSvg = await page.locator('.sdoc-mermaid-stage svg').count();
  expect(isError).toBeGreaterThan(0);
  expect(hasSvg).toBe(0);
});

// ── Theme + structure ─────────────────────────────────────

test('diagram wrapper carries .sdoc-mermaid class', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  const wrap = await page.locator('.sdoc-mermaid').count();
  expect(wrap).toBe(1);
});

// ── Focus mode (pan/zoom modal) ───────────────────────────

test('focus mode: zoom button appears on rendered diagram', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  // Button is hidden until hover; check existence, not visibility.
  const btn = await page.locator('.sdoc-mermaid .sdoc-mermaid-zoom-btn').count();
  expect(btn).toBe(1);
});

test('focus mode: clicking zoom button opens fullscreen modal', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  // Force the button visible (CSS opacity:0 until hover) by calling click via JS
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  expect(await page.locator('.sdoc-mermaid-focus svg').count()).toBe(1);
  expect(await page.locator('body.sdoc-mermaid-focus-open').count()).toBe(1);
});

test('focus mode: ESC closes the modal', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sdoc-mermaid-focus', { state: 'detached', timeout: 2000 });
  expect(await page.locator('body.sdoc-mermaid-focus-open').count()).toBe(0);
});

test('focus mode: 100% button sets scale to 1', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  await page.click('[data-act="100"]');
  const text = await page.locator('.sdoc-mermaid-focus-zoom').textContent();
  expect(text).toBe('100%');
});

test('focus mode: zoom in button increases scale', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  await page.click('[data-act="100"]');
  await page.click('[data-act="zoomin"]');
  const text = await page.locator('.sdoc-mermaid-focus-zoom').textContent();
  // 1.0 * 1.25 = 1.25 → "125%"
  expect(text).toBe('125%');
});

test('focus mode: Save PNG triggers a download', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
  await page.click('[data-act="save-png"]');
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toBe('diagram.png');
});

test('focus mode: Copy PNG button is wired and shows feedback', async ({ page }) => {
  // Stub ClipboardItem + clipboard.write so the test environment doesn't
  // need real clipboard permissions. We're checking that the button calls
  // through and updates its own label - the SVG→PNG path is exercised by
  // the Save PNG test above.
  await page.addInitScript(() => {
    window.ClipboardItem = function (parts) { this.parts = parts; };
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: () => Promise.resolve() },
      configurable: true
    });
  });
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  await page.click('[data-act="copy-png"]');
  await expect(page.locator('[data-act="copy-png"]')).toHaveText('Copied', { timeout: 3000 });
});

test('focus mode: dragging the stage updates the SVG transform', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  await page.click('[data-act="100"]');
  const before = await page.locator('.sdoc-mermaid-focus-svg-wrap').getAttribute('style');
  // Drag the stage 200px right
  const box = await page.locator('.sdoc-mermaid-focus-stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator('.sdoc-mermaid-focus-svg-wrap').getAttribute('style');
  expect(after).not.toBe(before);
  expect(after).toMatch(/translate\(/);
});

test('non-mermaid code blocks are not affected', async ({ page }) => {
  await loadDoc(page, [
    '```js',
    'console.log("hi");',
    '```',
    '',
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```'
  ].join('\n'));
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  const jsBlock = await page.locator('code.language-js').count();
  expect(jsBlock).toBe(1);
});
