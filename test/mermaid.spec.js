// @ts-check
//
// Mermaid integration tests. These hit the real CDN (jsdelivr) since
// Mermaid lazy-loads on first encounter; if the network is offline the
// CDN-dependent tests will fail. The placeholder-replacement tests do
// not require network and run regardless.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000/new';

async function loadDoc(page, markdown) {
  await page.goto(BASE);
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((md) => {
    window.SDocs.setMode('read', true);
    window.SDocs.loadText(md, 'mermaid.md');
  }, markdown);
  await page.waitForSelector('#_sd_rendered', { state: 'visible' });
}

async function expectRenderedDiagram(page) {
  await expect(page.locator('.sdoc-mermaid-stage svg.sdoc-mermaid-svg')).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator('.sdoc-mermaid-error')).toHaveCount(0);
}

async function sanitizeSvgFixture(page, source) {
  return page.evaluate((svg) => {
    const sanitizer = window.SDocMermaidCore.create({ window, document, sdocs: {} });
    try {
      const clean = sanitizer.sanitizeSvg(svg);
      const parsed = new DOMParser().parseFromString(clean, 'image/svg+xml');
      if (parsed.querySelector('parsererror')) throw new Error('Sanitizer returned invalid SVG');
      const root = parsed.documentElement;
      const attributes = node => Object.fromEntries(Array.from(node.attributes, attr => [attr.name, attr.value]));
      return {
        rootAttributes: attributes(root),
        childAttributes: root.querySelector('g') ? attributes(root.querySelector('g')) : null,
        images: Array.from(root.querySelectorAll('img'), attributes),
        frames: root.querySelectorAll('iframe').length,
        forms: root.querySelectorAll('form, input').length,
        svgStyles: root.querySelectorAll(':scope > style').length,
        labelStyles: root.querySelectorAll('foreignObject style').length,
        text: root.textContent,
      };
    } finally { sanitizer.destroy(); }
  }, source);
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

// ── Multi-line subgraph titles must not lap over their nodes ─────────
// Mermaid sizes a subgraph title's <foreignObject> for the real (multi-line)
// label but offsets the cluster's nodes by a one-line allowance, so a `<br/>`
// title renders into the top row of nodes. fixClusterTitleOverlap() lifts the
// title clear of the nodes after render.

test('two-line subgraph title clears its nodes', async ({ page }) => {
  await loadDoc(page, [
    '```mermaid',
    'flowchart LR',
    '  subgraph A["Terraform builds this<br/>(the cloud plumbing)"]',
    '    a1[DNS]',
    '    a2[Load Balancer]',
    '    a3[WAF firewall]',
    '  end',
    '  subgraph B["Kubernetes / Flux builds this<br/>(what runs inside)"]',
    '    b1[Traefik router]',
    '    b2[Istio router]',
    '  end',
    '  A --> B',
    '```'
  ].join('\n'));
  await page.waitForSelector('svg.sdoc-mermaid-svg', { timeout: 10000 });
  await page.waitForTimeout(800); // let the post-render lift settle

  const overlaps = await page.evaluate(() => {
    const svg = document.querySelector('svg.sdoc-mermaid-svg');
    const nodes = Array.from(svg.querySelectorAll('g.node')).map((n) => n.getBoundingClientRect());
    return Array.from(svg.querySelectorAll('g.cluster')).map((cluster) => {
      const fo = cluster.querySelector('g.cluster-label foreignObject');
      const box = cluster.querySelector('rect').getBoundingClientRect();
      const titleBottom = fo.getBoundingClientRect().bottom;
      // Topmost node whose centre sits inside this cluster's box.
      let topNode = Infinity;
      nodes.forEach((nb) => {
        const cx = (nb.left + nb.right) / 2, cy = (nb.top + nb.bottom) / 2;
        if (cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom) {
          if (nb.top < topNode) topNode = nb.top;
        }
      });
      // Positive => title overlaps the node; we want it <= 0 (a gap).
      return topNode === Infinity ? -1 : titleBottom - topNode;
    });
  });

  expect(overlaps.length).toBe(2);
  for (const o of overlaps) {
    expect(o).toBeLessThanOrEqual(0);
  }
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

test('theme toggle re-themes a diagram embedded in a slide', async ({ page }) => {
  const md = [
    '## Diagrams',
    '',
    '~~~slide',
    'grid 100 56.25',
    'r 8 10 84 36 align=center valign=center |',
    '  ```mermaid',
    '  flowchart LR',
    '    A --> B',
    '  ```',
    '~~~',
  ].join('\n');

  // Render while the page is dark so the slide diagram bakes in dark fills.
  await page.goto(BASE);
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate(() => window.SDocs.setMode('read', true));
  await page.waitForSelector('#_sd_rendered', { state: 'visible' });
  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('dark'));
  await page.evaluate((m) => window.SDocs.loadText(m), md);
  await page.evaluate(() => window.SDocs.expandAllSections && window.SDocs.expandAllSections());

  const slideFill = () => page.evaluate(() => {
    const host = document.querySelector('#_sd_rendered .shape-md');
    const n = host && host.shadowRoot && host.shadowRoot.querySelector(
      'svg.sdoc-mermaid-svg .node rect, svg.sdoc-mermaid-svg .node polygon, svg.sdoc-mermaid-svg .node path'
    );
    return n ? getComputedStyle(n).fill : null;
  });

  await page.waitForFunction(() => {
    const host = document.querySelector('#_sd_rendered .shape-md');
    return !!(host && host.shadowRoot && host.shadowRoot.querySelector('svg.sdoc-mermaid-svg .node'));
  }, null, { timeout: 10000 });
  const darkFill = await slideFill();

  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('light'));
  await page.waitForTimeout(1500);
  const lightFill = await slideFill();

  // The slide diagram must re-theme along with the rest of the page.
  expect(darkFill).not.toBe(null);
  expect(lightFill).not.toBe(darkFill);
});

// ── Security: XSS through diagram source ──────────────────

test('XSS: <script> in label is escaped, no script element survives', async ({ page }) => {
  let alertFired = false;
  page.on('dialog', async (d) => { alertFired = true; await d.dismiss(); });
  await loadDoc(page,
    '```mermaid\ngraph TD\n  A["<script>alert(1)</script>"] --> B\n```');
  await expectRenderedDiagram(page);
  const hasScript = await page.locator('.sdoc-mermaid script').count();
  expect(hasScript).toBe(0);
  expect(alertFired).toBe(false);
});

test('post-sanitize strips empty event attributes from HTML image labels', async ({ page }) => {
  await loadDoc(page, '```mermaid\nflowchart TD\n  A[Hello] --> B[World]\n```');
  await expectRenderedDiagram(page);
  const result = await sanitizeSvgFixture(page,
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">' +
    '<img alt="Kept image" onerror=""/><p>Kept label</p></div></foreignObject></svg>');
  expect(result.images).toHaveLength(1);
  expect(result.images[0].alt).toBe('Kept image');
  expect(result.images[0]).not.toHaveProperty('onerror');
  expect(result.text).toContain('Kept label');
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

test('post-sanitize removes inert iframe containers from foreignObject labels', async ({ page }) => {
  await loadDoc(page, '```mermaid\nflowchart TD\n  A[Hello] --> B[World]\n```');
  await expectRenderedDiagram(page);
  // Exercise the exported sanitizer directly. Mermaid escaping or a parse
  // failure must not substitute for coverage of this second layer.
  const result = await sanitizeSvgFixture(page,
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">' +
    '<iframe title="Inactive fixture" srcdoc="Plain fixture text"></iframe><p>Kept label</p>' +
    '</div></foreignObject></svg>');
  expect(result.frames).toBe(0);
  expect(result.text).toContain('Kept label');
});

test('XSS: <style> inside foreignObject is stripped, SVG-level <style> kept', async ({ page }) => {
  await loadDoc(page, '```mermaid\nflowchart TD\n  A[Hello] --> B[World]\n```');
  await expectRenderedDiagram(page);
  const result = await sanitizeSvgFixture(page,
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.node { fill: red; }</style>' +
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">' +
    '<style>.label { color: blue; }</style><p class="label">Kept label</p></div></foreignObject></svg>');
  expect(result.svgStyles).toBe(1);
  expect(result.labelStyles).toBe(0);
  expect(result.text).toContain('Kept label');
});

test('post-sanitize removes inert form/input containers and preserves label text', async ({ page }) => {
  await loadDoc(page, '```mermaid\nflowchart TD\n  A[Hello] --> B[World]\n```');
  await expectRenderedDiagram(page);
  const result = await sanitizeSvgFixture(page,
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">' +
    '<form><input value="Fixture"/></form><p>Kept label</p></div></foreignObject></svg>');
  expect(result.forms).toBe(0);
  expect(result.text).toContain('Kept label');
});

test('post-sanitize applies the existing attribute policy to SVG roots and descendants', async ({ page }) => {
  await loadDoc(page, '```mermaid\nflowchart TD\n  A[Hello] --> B[World]\n```');
  await expectRenderedDiagram(page);
  const inertAttributes = 'onload="" srcdoc="Fixture" formaction="/fixture" action="/fixture" ping="/fixture" background="fixture"';
  const result = await sanitizeSvgFixture(page,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" style="color: red" ' + inertAttributes + '>' +
    '<g id="node" style="fill: blue" ' + inertAttributes + '><title>Kept label</title></g></svg>');
  for (const attributes of [result.rootAttributes, result.childAttributes]) {
    for (const name of ['onload', 'srcdoc', 'formaction', 'action', 'ping', 'background']) {
      expect(attributes).not.toHaveProperty(name);
    }
  }
  expect(result.rootAttributes.viewBox).toBe('0 0 100 50');
  expect(result.rootAttributes.style).toBe('color: red');
  expect(result.childAttributes.style).toBe('fill: blue');
  expect(result.text).toContain('Kept label');
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

test('%%{init: securityLevel:loose}%% directive is stripped before rendering', async ({ page }) => {
  await loadDoc(page, '```mermaid\nflowchart TD\n  A[Hello] --> B[World]\n```');
  await expectRenderedDiagram(page);
  await page.evaluate(() => {
    const render = window.mermaid.render;
    window.__mermaidRenderedSource = '';
    window.mermaid.render = function (id, source, container) {
      window.__mermaidRenderedSource = source;
      return render.call(this, id, source, container);
    };
  });
  await page.evaluate((source) => window.SDocs.loadText(source, 'mermaid.md'), [
    '```mermaid',
    '%%{init: {"securityLevel":"loose"}}%%',
    'graph TD',
    '  A[Hello] --> B[World]',
    '```'
  ].join('\n'));
  await expectRenderedDiagram(page);
  const renderedSource = await page.evaluate(() => window.__mermaidRenderedSource);
  expect(renderedSource).toContain('A[Hello] --> B[World]');
  expect(renderedSource).not.toContain('%%{init:');
  expect(await page.evaluate(() => window.mermaid.mermaidAPI.getConfig().securityLevel)).toBe('strict');
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
  expect(await page.locator('.sdoc-mermaid-focus-stage > .sdoc-mermaid-focus-svg-wrap > svg').count()).toBe(1);
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

test('focus mode: fit button restores the fitted transform', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  const fitted = await page.locator('.sdoc-mermaid-focus-svg-wrap').getAttribute('style');
  await page.click('[data-act="zoomin"]');
  await page.click('[data-act="fit"]');
  const restored = await page.locator('.sdoc-mermaid-focus-svg-wrap').getAttribute('style');
  expect(restored).toBe(fitted);
});

test('focus mode: zoom in button increases scale', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  const before = await page.locator('.sdoc-mermaid-focus-svg-wrap').getAttribute('style');
  await page.click('[data-act="zoomin"]');
  const after = await page.locator('.sdoc-mermaid-focus-svg-wrap').getAttribute('style');
  expect(after).not.toBe(before);
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
  await expect(page.locator('[data-act="copy-png"] polyline')).toHaveCount(1, { timeout: 3000 });
});

test('focus mode: dragging the stage updates the SVG transform', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.sdoc-mermaid .sdoc-mermaid-zoom-btn').click();
  });
  await page.waitForSelector('.sdoc-mermaid-focus', { timeout: 4000 });
  await page.click('[data-act="fit"]');
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
