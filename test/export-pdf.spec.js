// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

const CHART_DOC = '# Export Test\n\nSome text.\n\n```chart\n{"type":"bar","title":"Revenue","labels":["Q1","Q2","Q3","Q4"],"values":[12,18,15,22]}\n```\n\nMore text after chart.';

// Use a served image path (server serves /public/*)
const IMAGE_DOC = '# Image Test\n\n![Alt text](/public/images/examples.png)\n';

const CHART_AND_IMAGE = '# Full Test\n\n![Logo](/public/images/examples.png)\n\n```chart\n{"type":"pie","title":"Split","labels":["A","B","C"],"values":[40,35,25]}\n```\n\nEnd.';

async function loadDoc(page, md) {
  await page.goto(BASE);
  await page.waitForTimeout(1000);
  await page.evaluate((content) => {
    window.SDocs.loadText(content, 'test.md');
  }, md);
  await page.waitForTimeout(3000); // wait for Chart.js CDN + render
}

async function getExportHTML(page) {
  return page.evaluate(() => {
    // Expand collapsed sections so charts render (mirrors exportPDF flow)
    var closed = window.SDocs.expandAllSections();
    return new Promise(function(resolve) {
      requestAnimationFrame(function() { setTimeout(function() {
        var html = window.SDocs.buildExportHTML();
        window.SDocs.restoreSections(closed);
        resolve(html);
      }, 150); });
    });
  });
}

// ═══════════════════════════════════════════════════
//  CHART EXPORT
// ═══════════════════════════════════════════════════

test.describe('PDF export — charts', () => {
  test('charts are converted to inline images', async ({ page }) => {
    await loadDoc(page, CHART_DOC);
    const html = await getExportHTML(page);
    // Should contain a data URL image, not a <canvas>
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('<canvas');
  });

  test('chart menu UI is removed', async ({ page }) => {
    await loadDoc(page, CHART_DOC);
    const html = await getExportHTML(page);
    expect(html).not.toContain('chart-menu-btn');
    expect(html).not.toContain('chart-menu');
  });

  test('chart wrapper div is preserved', async ({ page }) => {
    await loadDoc(page, CHART_DOC);
    const html = await getExportHTML(page);
    expect(html).toContain('sdoc-chart');
  });
});

// ═══════════════════════════════════════════════════
//  IMAGE EXPORT
// ═══════════════════════════════════════════════════

test.describe('PDF export — images', () => {
  test('same-origin images are inlined as data URLs', async ({ page }) => {
    await loadDoc(page, IMAGE_DOC);
    // Wait for image to load in the rendered view
    await page.waitForFunction(() => {
      var img = document.querySelector('#rendered img');
      return img && img.naturalWidth > 0;
    }, { timeout: 8000 });
    const html = await getExportHTML(page);
    expect(html).toContain('data:image/png;base64,');
    // Original relative src should be replaced
    expect(html).not.toContain('src="/public/images/examples.png"');
  });
});

// ═══════════════════════════════════════════════════
//  COMBINED
// ═══════════════════════════════════════════════════

test.describe('PDF export — combined', () => {
  test('export includes both inlined image and chart', async ({ page }) => {
    await loadDoc(page, CHART_AND_IMAGE);
    await page.waitForFunction(() => {
      var img = document.querySelector('#rendered img');
      return img && img.naturalWidth > 0;
    }, { timeout: 8000 });
    const html = await getExportHTML(page);
    // Both should be data URLs
    const matches = html.match(/data:image\/png;base64,/g);
    expect(matches.length).toBeGreaterThanOrEqual(2); // image + chart
    expect(html).not.toContain('<canvas');
  });

  test('export is valid HTML document', async ({ page }) => {
    await loadDoc(page, CHART_AND_IMAGE);
    await page.waitForTimeout(1000);
    const html = await getExportHTML(page);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<style>');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });

  test('section toggles and copy buttons are removed', async ({ page }) => {
    await loadDoc(page, CHART_AND_IMAGE);
    await page.waitForTimeout(1000);
    const html = await getExportHTML(page);
    expect(html).not.toContain('section-toggle');
    expect(html).not.toContain('copy-btn');
    expect(html).not.toContain('header-anchor');
  });

  test('charts inside collapsed sections are captured', async ({ page }) => {
    // This is the Chart Gallery pattern: charts under H2 sections
    const galleryDoc = [
      '# Gallery',
      '',
      '## Pie Charts',
      '',
      '```chart',
      '{"type":"pie","title":"Test Pie","labels":["A","B","C"],"values":[40,35,25]}',
      '```',
      '',
      '## Bar Charts',
      '',
      '```chart',
      '{"type":"bar","title":"Test Bar","labels":["X","Y"],"values":[10,20]}',
      '```',
    ].join('\n');
    await loadDoc(page, galleryDoc);
    const html = await getExportHTML(page);
    const matches = html.match(/data:image\/png;base64,/g);
    expect(matches).toBeTruthy();
    expect(matches.length).toBe(2);
    expect(html).not.toContain('<canvas');
  });

  test('chart CSS is included in export', async ({ page }) => {
    await loadDoc(page, CHART_DOC);
    const html = await getExportHTML(page);
    expect(html).toContain('.sdoc-chart');
    expect(html).toContain('text-align: center');
  });
});

// ═══════════════════════════════════════════════════
//  COLOR & STYLE PRESERVATION
// ═══════════════════════════════════════════════════

// Markdown with styled front matter that overrides block and font colors
const STYLED_DOC = [
  '---',
  'styles:',
  '  code:',
  '    background: "#1a1a2e"',
  '    color: "#e94560"',
  '  blockquote:',
  '    background: "#0f3460"',
  '    color: "#e2e2e2"',
  '  headers:',
  '    color: "#ff6600"',
  '  p:',
  '    color: "#ccbbaa"',
  '  list:',
  '    color: "#aabb00"',
  '  link:',
  '    color: "#00ffaa"',
  '---',
  '',
  '# Styled Heading',
  '',
  'A paragraph with `inline code` in it.',
  '',
  '```',
  'code block content',
  '```',
  '',
  '> A blockquote',
  '',
  '- list item one',
  '- list item two',
  '',
  '[a link](https://example.com)',
].join('\n');

test.describe('PDF export — color preservation', () => {
  test('print-color-adjust is set for background printing', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    expect(html).toContain('print-color-adjust: exact');
    expect(html).toContain('-webkit-print-color-adjust: exact');
  });

  test('inline code background and color are preserved', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    // code rule should contain the custom colors
    expect(html).toContain('#1a1a2e'); // code bg
    expect(html).toContain('#e94560'); // code color
  });

  test('code block background is preserved', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    // pre rule should contain the custom bg
    expect(html).toContain('#1a1a2e'); // pre bg (inherits from code bg)
  });

  test('pre code uses code color not hardcoded value', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    // pre code should use the themed code color
    const preCodeMatch = html.match(/pre code\s*\{[^}]*color:\s*([^;]+)/);
    expect(preCodeMatch).toBeTruthy();
    expect(preCodeMatch[1].trim()).toBe('#e94560');
  });

  test('blockquote background and color are preserved', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    expect(html).toContain('#0f3460'); // bq bg
    expect(html).toContain('#e2e2e2'); // bq color
  });

  test('heading color is preserved', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    // h1 rule should use the custom heading color
    const h1Match = html.match(/h1\s*\{[^}]*color:\s*([^;]+)/);
    expect(h1Match).toBeTruthy();
    expect(h1Match[1].trim()).toBe('#ff6600');
  });

  test('paragraph color is preserved', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    const pMatch = html.match(/\bp\s*\{[^}]*color:\s*([^;]+)/);
    expect(pMatch).toBeTruthy();
    expect(pMatch[1].trim()).toBe('#ccbbaa');
  });

  test('list color is preserved', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    // ul/ol rule should have the list color
    const listMatch = html.match(/ul,\s*ol\s*\{[^}]*color:\s*([^;]+)/);
    expect(listMatch).toBeTruthy();
    expect(listMatch[1].trim()).toBe('#aabb00');
  });

  test('link color is preserved', async ({ page }) => {
    await loadDoc(page, STYLED_DOC);
    const html = await getExportHTML(page);
    const aMatch = html.match(/\ba\s*\{[^}]*color:\s*([^;]+)/);
    expect(aMatch).toBeTruthy();
    expect(aMatch[1].trim()).toBe('#00ffaa');
  });
});

// ═══════════════════════════════════════════════════
//  WORD EXPORT
// ═══════════════════════════════════════════════════

test.describe('Word export', () => {
  test('produces a valid OOXML docx file', async ({ page }) => {
    await loadDoc(page, CHART_DOC);
    const bytes = await page.evaluate(async () => {
      window.global = window;
      await new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@turbodocx/html-to-docx@1/dist/html-to-docx.browser.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
      var closed = window.SDocs.expandAllSections();
      await new Promise(function(r) { requestAnimationFrame(function() { setTimeout(r, 150); }); });
      var html = window.SDocs.buildExportHTML();
      window.SDocs.restoreSections(closed);
      var blob = await window.HTMLToDOCX(html, null, { orientation: 'portrait' });
      var ab = await blob.arrayBuffer();
      return Array.from(new Uint8Array(ab).slice(0, 4));
    });
    // Valid ZIP (OOXML) starts with PK\x03\x04
    expect(bytes).toEqual([0x50, 0x4B, 0x03, 0x04]);
  });

  test('docx contains document.xml (not altChunk)', async ({ page }) => {
    const md = '# Simple Test\n\nA paragraph.\n';
    await loadDoc(page, md);
    const content = await page.evaluate(async () => {
      window.global = window;
      await new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@turbodocx/html-to-docx@1/dist/html-to-docx.browser.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
      var html = window.SDocs.buildExportHTML();
      var blob = await window.HTMLToDOCX(html, null, { orientation: 'portrait' });
      var ab = await blob.arrayBuffer();
      // Convert to string to check for altChunk vs real content
      var text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(ab));
      return {
        hasDocumentXml: text.includes('word/document.xml'),
        hasAltChunk: text.includes('altChunk'),
        hasStyles: text.includes('word/styles.xml'),
      };
    });
    expect(content.hasDocumentXml).toBe(true);
    expect(content.hasAltChunk).toBe(false);
    expect(content.hasStyles).toBe(true);
  });
});
