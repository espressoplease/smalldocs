const { test, expect } = require('@playwright/test');
const contrast = require('../cli/shared/sdocs-contrast');

const slides = [
  'grid 100 56.25\nr 6 5 88 10 text=title | Delivery readiness\nr 6 22 42 26 fill=#edf3fa | ## Budget\n\n  Keep the allocation readable.\nr 52 22 42 26 fill=#eef5ed | ## Review\n\n  Confirm ownership.',
  'grid 100 56.25 bg=#ffffff\nr 6 5 88 10 text=title | Fixed white canvas\nr 6 22 88 26 fill=#faf1e8 | 1. Confirm the allocation.\n\n  2. Name the reviewer.',
  'grid 100 56.25 bg=#0f172a\nr 6 5 88 10 | ## Fixed dark canvas\nr 6 22 42 26 fill=#eef5ed | A pale card\nc 74 34 16 fill=#eef5ed | A pale circle',
  'grid 100 56.25\nr 0 0 100 56.25 fill=#ffffff layer=bottom\nr 6 5 88 10 | Text over a white backdrop\nr 6 22 88 26 fill=#11182780 | Text over a translucent card',
  'grid 100 56.25 bg=$background\nr 6 5 88 10 color=$color | ## Theme references\nr 6 22 88 26 fill=#fff color=#102030 | **Body**, [a link](https://example.com), and `code`.',
  'grid 100 56.25 bg=#111827\nr 5 5 90 46 fill=#fff | ## Nested content\n\n  > A quotation\n\n  ```js\n  const ready = true;\n  ```\n\n  | Name | Value |\n  |---|---|\n  | Hosting | 100 |',
  'grid 100 56.25 bg=$h1.color\nr 6 8 88 25 | Canvas from a foreground reference',
];
const deck = slides.map(source => '~~~slide\n' + source + '\n~~~').join('\n\n');
const rich = '# Theme audit\n\nA [readable link](https://example.com) and `inline code`.\n\n> A quotation.\n\n| Name | Value |\n|---|---|\n| Hosting | 100 |\n| Research | 200 |\n\n```js\nconst ready = true; // a comment\n```\n\n```cells\nItem,Amount\nHosting,100\nResearch,200\nTotal,=SUM(B2:B3)\n```\n\n```chart\n{"type":"bar","title":"Budget","labels":["Hosting","Research"],"values":[100,200]}\n```\n\n```mermaid\nflowchart LR\nA[Draft] --> B[Review]\n```\n\n```mermaid\nsequenceDiagram\nparticipant Writer\nparticipant Reviewer\nWriter->>Reviewer: Review draft\nReviewer-->>Writer: Feedback\n```\n\n$$x^2 + y^2 = z^2$$\n\n' + deck;

async function load(page, markdown = rich) {
  await page.goto('/docs');
  await page.waitForFunction(() => window.SDocs?._appReady);
  await page.evaluate(markdown => {
    SDocs.loadText(markdown); SDocs.setAllSectionsOpen(true); SDocs.setMode('read');
  }, markdown);
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.__themeErrors = errors;
});
test.afterEach(async ({ page }) => { expect(page.__themeErrors).toEqual([]); });
async function theme(page, value) {
  await page.evaluate(value => SDocs.switchThemeAndUpdate(value), value);
  await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().map(a => a.finished)); });
}
function ratio(fg, bg) { return contrast.contrastRatio(fg, bg); }

// Measure the pixels' colour pair through nested transparent backgrounds and
// shadow hosts. This reads output, not the renderer's contrast helper.
async function textPairs(page, selector) {
  return page.evaluate(selector => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    function rgba(value) {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
      const c = ctx.getImageData(0, 0, 1, 1).data; return [c[0], c[1], c[2], c[3] / 255];
    }
    function over(a, b) { return a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3])).concat(1); }
    function hex(c) { return '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
    const result = [];
    function visit(el, bg) {
      if (el.classList.contains('shape-text')) {
        const svg = el.parentElement.querySelector('svg[data-shape-idx="' + el.dataset.shapeIdx + '"]');
        const painted = svg && svg.querySelector('circle,ellipse,polygon,path,rect');
        if (painted) bg = over(rgba(getComputedStyle(painted).fill), bg);
      }
      const css = getComputedStyle(el); bg = over(rgba(css.backgroundColor), bg);
      if (css.display === 'none' || css.visibility === 'hidden' || el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return;
      if (Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()) && !el.closest('button')) {
        const foreground = el.localName === 'text' || el.localName === 'tspan' ? css.fill : css.color;
        result.push({ text: el.textContent.trim().slice(0, 70), fg: hex(over(rgba(foreground), bg)), bg: hex(bg) });
      }
      Array.from(el.children).forEach(child => visit(child, bg));
      if (el.shadowRoot) Array.from(el.shadowRoot.children).forEach(child => visit(child, bg));
    }
    document.querySelectorAll(selector).forEach(el => {
      const parents = []; let p = el.parentElement;
      while (p) { parents.unshift(p); p = p.parentElement || p.getRootNode()?.host; }
      let bg = [255, 255, 255, 1]; parents.forEach(p => { bg = over(rgba(getComputedStyle(p).backgroundColor), bg); });
      visit(el, bg);
    });
    return result;
  }, selector);
}

for (const mode of ['light', 'dark']) {
  test(mode + ': fixed and inherited slide surfaces, nested text and thumbnails remain readable', async ({ page }) => {
    await load(page, '# Slides\n\n' + deck);
    await theme(page, mode);
    await expect(page.locator('.sdoc-slide')).toHaveCount(slides.length);
    // Exclude backdrop-overlaid slide 4 from generic DOM background walking:
    // its painted background is a sibling, rather than an ancestor.
    const pairs = await textPairs(page, '.sdoc-slide:not([data-slide-index="3"]) .sd-shape-stage');
    const failures = pairs.filter(p => ratio(p.fg, p.bg) < 4.5);
    expect(failures).toEqual([]);
    await expect(page.locator('.sdoc-slide[data-slide-index="2"] .shape-text .sd-shape-copy-btn')).toHaveClass(/is-light/);
    await expect(page.locator('.sdoc-slide[data-slide-index="6"]')).toHaveClass(new RegExp(mode === 'dark' ? 'sdoc-slide-light-ui' : 'sdoc-slide-dark-ui'));
    await page.evaluate(() => SDocPresent.open(0));
    await expect(page.locator('.sdoc-present')).toBeVisible();
    const palettes = await page.evaluate(() => {
      function palette(root) {
        const stage = root.querySelector('.sd-shape-stage');
        return { bg: getComputedStyle(stage).backgroundColor, text: Array.from(stage.querySelectorAll('.shape-md')).map(host => {
          const el = host.shadowRoot.querySelector('h1,h2,p,li'); return el && getComputedStyle(el).color;
        }) };
      }
      return { inline: Array.from(document.querySelectorAll('.sdoc-slide')).map(palette),
        rail: Array.from(document.querySelectorAll('.sdoc-present-thumb')).map(palette), active: palette(document.querySelector('.sdoc-present-stage')) };
    });
    expect(palettes.rail).toEqual(palettes.inline);
    expect(palettes.active).toEqual(palettes.inline[0]);
  });
}

test('rapid toggles update an open presentation and preserve body, anchors and slide position', async ({ page }) => {
  await load(page, '# Slides\n\n' + deck);
  await page.evaluate(() => SDocPresent.open(1));
  await page.locator('.sdoc-present-thumb').nth(2).focus();
  const original = await page.evaluate(() => SDocs.currentBody);
  for (let i = 0; i < 6; i++) await theme(page, i % 2 ? 'light' : 'dark');
  await theme(page, 'dark');
  await expect(page.locator('.sdoc-present-thumb.active')).toHaveAttribute('data-slide-index', '1');
  await expect(page.locator('.sdoc-present-thumb').nth(2)).toBeFocused();
  const palettes = await page.evaluate(() => ['.sdoc-slide .sd-shape-stage', '.sdoc-present-thumb .sd-shape-stage'].map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor));
  expect(palettes).toEqual(['rgb(44, 42, 38)', 'rgb(44, 42, 38)']);
  expect(await page.evaluate(() => SDocs.currentBody)).toBe(original);
  await page.evaluate(() => SDocPresent.close());
});

test('prose, tables, cells, charts, math and diagram labels stay legible after repeated toggles', async ({ page }) => {
  await load(page);
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('.sdoc-mermaid-stage > svg')).toHaveCount(2);
  for (const mode of ['dark', 'light', 'dark']) {
    await theme(page, mode);
    const expected = await page.evaluate(() => getComputedStyle(SDocs.renderedEl).getPropertyValue('--md-chart-text').trim());
    await expect.poll(() => page.evaluate(() => Chart.getChart(document.querySelector('canvas')).options.plugins.title.color.toLowerCase())).toBe(expected.toLowerCase());
    const pairs = await textPairs(page, '#_sd_rendered > h1, #_sd_rendered > p, #_sd_rendered > blockquote, #_sd_rendered > .md-table-scroll, #_sd_rendered > .pre-wrapper, .sdoc-cells-cell, .katex, #_sd_rendered > .sdoc-mermaid');
    expect(pairs.length).toBeGreaterThan(25);
    expect(pairs.filter(p => ratio(p.fg, p.bg) < 4.5)).toEqual([]);
  }
});

test('an open sheet changes theme without closing the viewer', async ({ page }) => {
  await load(page, rich.split('```chart')[0]);
  await page.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
  await expect(page.locator('.sdoc-cells-focus')).toBeVisible();
  await theme(page, 'dark');
  const pairs = await textPairs(page, '.sdoc-cells-focus .sdoc-cells-cell');
  expect(pairs.length).toBeGreaterThan(4);
  expect(pairs.filter(p => ratio(p.fg, p.bg) < 4.5)).toEqual([]);
  const bg = await page.locator('.sdoc-cells-focus').evaluate(el => getComputedStyle(el).getPropertyValue('--sdoc-focus-bg').trim());
  expect(bg).toBe('#2c2a26');
});

test('spreadsheet negative amounts and formula errors remain readable in both themes', async ({ page }) => {
  await load(page, '# Calculations\n\n```cells\nItem,Amount\nLoss,-100\nInvalid,=NOPE()\n```');
  for (const mode of ['light', 'dark']) {
    await theme(page, mode);
    const pairs = await textPairs(page, '.sdoc-cells-cell, .sdoc-cells-error-msg');
    expect(pairs.length).toBeGreaterThan(4);
    expect(pairs.filter(p => ratio(p.fg, p.bg) < 4.5)).toEqual([]);
  }
});

test('Mermaid fixed fills and an open diagram viewer follow the latest toggle', async ({ page }) => {
  await load(page, '# Diagram\n\n```mermaid\nflowchart LR\nA[White card] --> B[Dark card]\nstyle A fill:#fff\nstyle B fill:#111827\n```');
  await expect(page.locator('.sdoc-mermaid-stage > svg')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open diagram in fullscreen', exact: true }).click();
  for (const mode of ['dark', 'light', 'dark']) {
    await theme(page, mode);
    await page.evaluate(() => SDocs.rethemeMermaid());
    for (const selector of ['.sdoc-mermaid-stage', '.sdoc-mermaid-focus-svg-wrap']) {
      const pairs = await page.locator(selector).evaluate(root => Array.from(root.querySelectorAll('g.node')).map(node => ({
        bg: getComputedStyle(node.querySelector('rect')).fill,
        fg: getComputedStyle(node.querySelector('.nodeLabel')).color,
      })));
      expect(pairs.length).toBe(2);
      expect(pairs.filter(p => ratio(p.fg, p.bg) < 4.5)).toEqual([]);
    }
    expect(await page.locator('.sdoc-mermaid-focus').evaluate(el => getComputedStyle(el).getPropertyValue('--sdoc-focus-fg').trim())).toBe(mode === 'dark' ? '#e7e5e2' : '#1c1917');
  }
});

test('a delayed old Mermaid render cannot overwrite the latest theme', async ({ page }) => {
  await load(page, '# Render race\n\nText.');
  await page.evaluate(() => {
    const root = document.createElement('div'); document.body.appendChild(root);
    root.innerHTML = '<pre><code class="language-mermaid">flowchart LR\nA --> B</code></pre>';
    window.themeRaceJobs = [];
    const mermaid = { initialize() {}, render() { return new Promise(resolve => window.themeRaceJobs.push(resolve)); } };
    window.themeRaceReader = SDocMermaidCore.create({ root, scope: root, sdocs: {}, loadMermaid: async () => mermaid });
    window.themeRaceFirst = window.themeRaceReader.processMermaid(root);
  });
  await expect.poll(() => page.evaluate(() => window.themeRaceJobs.length)).toBe(1);
  await page.evaluate(() => { window.themeRaceLatest = window.themeRaceReader.rethemeMermaid(); });
  await expect.poll(() => page.evaluate(() => window.themeRaceJobs.length)).toBe(2);
  const text = await page.evaluate(async () => {
    themeRaceJobs[1]({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Latest theme</text></svg>' });
    await themeRaceLatest;
    themeRaceJobs[0]({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Old theme</text></svg>' });
    await themeRaceFirst;
    const text = document.querySelector('.sdoc-mermaid-stage').textContent;
    themeRaceReader.destroy(); return text;
  });
  expect(text).toBe('Latest theme');
});

test('document and nested charts all refresh, keep slide sizing and clean up after navigation', async ({ page }) => {
  const chart = '```chart\n{"type":"bar","title":"Allocation","labels":["A","B"],"values":[100,200]}\n```';
  const source = '# Charts\n\n' + chart + '\n\n' + ['#ffffff', '#111827'].map(bg => '~~~slide\ngrid 100 56.25 bg=' + bg + '\nr 5 5 90 46 | ' + chart.replace(/\n/g, '\n  ') + '\n~~~').join('\n\n');
  await load(page, source);
  await expect.poll(() => page.locator('canvas').count()).toBe(3);
  await page.evaluate(() => SDocPresent.open(0));
  for (const mode of ['dark', 'light', 'dark']) {
    await theme(page, mode);
    await expect.poll(() => page.evaluate(() => {
      return Array.from(document.querySelectorAll('.sdoc-slide .shape-md')).flatMap(host => Array.from(host.shadowRoot.querySelectorAll('canvas'))).map(canvas => {
        const chart = Chart.getChart(canvas);
        const surface = getComputedStyle(canvas.getRootNode().host).getPropertyValue('--sdoc-shape-surface').trim();
        return { fg: chart.options.plugins.title.color, bg: surface, responsive: chart.options.responsive };
      });
    }).then(pairs => pairs.length === 2 && pairs.every(p => ratio(p.fg, p.bg) >= 4.5 && p.responsive === false))).toBe(true);
    const main = await page.locator('#_sd_rendered > .sdoc-chart canvas').evaluate(canvas => Chart.getChart(canvas).options.plugins.title.color);
    expect(main.toLowerCase()).toBe(mode === 'dark' ? '#a8a29e' : '#6b6560');
  }
  await page.evaluate(() => { SDocPresent.close(); SDocs.loadText('# Next document\n\nText.'); });
  await expect.poll(() => page.evaluate(() => Object.keys(Chart.instances).length)).toBe(0);
});

test('theme preference syncs between tabs, reloads and a mobile document', async ({ context, page }) => {
  await load(page, '# Reading\n\nA paragraph.');
  const other = await context.newPage(); await load(other, '# Another document\n\nText.');
  await theme(page, 'dark');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await other.reload(); await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await theme(other, 'light'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#_sd_btn-theme')).toBeVisible();
});

test('comment text and its anchor survive theme changes in read and comment modes', async ({ page }) => {
  await load(page, '# Review\n\nConfirm the allocation before release.');
  await page.evaluate(() => {
    const saved = SDocComments.addSelectionComment(SDocs.currentMeta, { quote: 'the allocation', block: 'p:0' },
      { text: 'Please include hosting costs.', author: 'Reviewer', color: '#ffbb00' });
    SDocs.currentMeta = saved.meta; SDocs.syncAll('comment');
  });
  const original = await page.evaluate(() => ({ body: SDocs.currentBody, comments: SDocs.currentMeta.comments }));
  for (const mode of ['comment', 'read', 'comment']) {
    await page.evaluate(mode => SDocs.setMode(mode), mode);
    for (const value of ['dark', 'light']) {
      await theme(page, value);
      await expect(page.locator('.sdoc-anchor')).toHaveCount(mode === 'comment' ? 1 : 0);
      if (mode === 'read') continue;
      const pairs = await textPairs(page, '.sdoc-card-body, .sdoc-card-author');
      expect(pairs.length).toBeGreaterThan(0);
      expect(pairs.filter(p => ratio(p.fg, p.bg) < 4.5)).toEqual([]);
    }
  }
  expect(await page.evaluate(() => ({ body: SDocs.currentBody, comments: SDocs.currentMeta.comments }))).toEqual(original);
});

test('SDK slides react to host palette changes without changing another instance', async ({ page }) => {
  await load(page, '# Host\n\nText.');
  await page.evaluate(async markdown => {
    const { render } = await import('/sdk/0.3.1/smalldocs.js');
    for (const id of ['theme-one', 'theme-two']) {
      const target = document.createElement('div'); target.id = id; document.body.appendChild(target);
      target.style.setProperty('--sdocs-background', '#ffffff'); target.style.setProperty('--sdocs-text-color', '#1c1917');
      window[id] = await render(target, markdown);
    }
  }, '# SDK\n\n' + deck);
  await page.locator('#theme-one').evaluate(el => { el.style.setProperty('--sdocs-background', '#111827'); el.style.setProperty('--sdocs-text-color', '#f5f5f4'); });
  await expect.poll(() => page.locator('#theme-one .sd-shape-stage').first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(17, 24, 39)');
  expect(await page.locator('#theme-two .sd-shape-stage').first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  const pairs = await textPairs(page, '#theme-one .sdoc-slide:nth-of-type(2) .sd-shape-stage');
  expect(pairs.filter(p => ratio(p.fg, p.bg) < 4.5)).toEqual([]);
  await page.evaluate(() => { window['theme-one'].destroy(); window['theme-two'].destroy(); });
});

test('a clean SDK customer page updates open slide and spreadsheet viewers from host CSS', async ({ page }) => {
  await page.route('**/theme-audit-customer', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="customer"></div></body></html>' }));
  await page.goto('/theme-audit-customer');
  await page.evaluate(async markdown => {
    const { render } = await import('/sdk/0.3.1/smalldocs.js');
    const target = document.getElementById('customer');
    target.style.setProperty('--sdocs-background', '#ffffff'); target.style.setProperty('--sdocs-text-color', '#1c1917');
    window.themeCustomerView = await render(target, markdown);
  }, '# SDK\n\n' + deck + '\n\n```cells\nItem,Amount\nHosting,100\n```\n\n```mermaid\nflowchart LR\nA[Draft] --> B[Review]\n```');
  expect(await page.evaluate(() => typeof window.SDocs)).toBe('undefined');
  await page.locator('.sdoc-slide-present').first().click();
  await page.locator('#customer').evaluate(el => { el.style.setProperty('--sdocs-background', '#111827'); el.style.setProperty('--sdocs-text-color', '#f5f5f4'); });
  await expect.poll(() => page.locator('.sdoc-present-stage .sd-shape-stage').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(17, 24, 39)');
  await page.locator('.sdoc-present-close').click();
  await page.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
  await page.locator('#customer').evaluate(el => { el.style.setProperty('--sdocs-background', '#ffffff'); el.style.setProperty('--sdocs-text-color', '#1c1917'); });
  await expect.poll(() => page.locator('.sdoc-cells-focus').evaluate(el => getComputedStyle(el).getPropertyValue('--sdoc-focus-bg').trim())).toBe('#ffffff');
  await page.locator('.sdoc-cells-focus-close').click();
  await page.getByRole('button', { name: 'Open diagram in fullscreen', exact: true }).click();
  await page.locator('#customer').evaluate(el => {
    el.style.setProperty('--sdocs-background', '#111827'); el.style.setProperty('--sdocs-text-color', '#f5f5f4');
    el.style.setProperty('--sdocs-code-background', '#1a1816');
  });
  await expect.poll(() => page.locator('.sdoc-mermaid-focus').evaluate(el => getComputedStyle(el).getPropertyValue('--sdoc-focus-fg').trim())).toBe('#f5f5f4');
  await page.evaluate(() => window.themeCustomerView.destroy());
  await expect(page.locator('.sdoc-cells-focus, .sdoc-present, .sdoc-mermaid-focus')).toHaveCount(0);
});

test('PowerPoint exports pair native text with the same themed canvas as the reader', async ({ page }) => {
  test.setTimeout(60000);
  await load(page, '# Export\n\n~~~slide\ngrid 100 56.25\nr 10 10 80 30 | Inherited canvas\n~~~\n\n~~~slide\ngrid 100 56.25 bg=#ffffff\nr 10 10 80 30 | Fixed canvas\n~~~');
  await theme(page, 'dark');
  const pairs = await page.evaluate(async () => {
    const original = URL.createObjectURL; let captured;
    URL.createObjectURL = blob => { captured = blob; return original(blob); };
    try {
      await SDocs.exportSlidesPptx();
      if (!captured) throw new Error('PowerPoint download was not generated');
      const zip = await JSZip.loadAsync(await captured.arrayBuffer());
      const pairs = [];
      for (const name of ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']) {
        const xml = new DOMParser().parseFromString(await zip.file(name).async('string'), 'application/xml');
        const bg = xml.getElementsByTagName('p:bg')[0].getElementsByTagName('a:srgbClr')[0].getAttribute('val');
        const fg = xml.getElementsByTagName('p:txBody')[0].getElementsByTagName('a:srgbClr')[0].getAttribute('val');
        pairs.push({ bg: '#' + bg.toLowerCase(), fg: '#' + fg.toLowerCase() });
      }
      return pairs;
    } finally { URL.createObjectURL = original; }
  });
  expect(pairs.map(p => p.bg)).toEqual(['#2c2a26', '#ffffff']);
  expect(pairs.filter(p => ratio(p.fg, p.bg) < 4.5)).toEqual([]);
});
