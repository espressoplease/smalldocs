// @ts-check
// Slide PDF export coverage. Both export paths (the presentation-mode
// "Slides PDF" and the inline body PDF) render slides through
// SDocSlidePdf.drawSlide, so this spec exercises that surface end to end:
// page geometry, embedded/extractable text, and chart / mermaid / math
// blocks rasterised to images rather than dropped or left as source.
//
// CDN-dependent, like mermaid.spec.js: the font, Chart.js, Mermaid and
// KaTeX bundles load from jsdelivr. Timeouts are generous to absorb that.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

// Load a deck, trigger an export, capture the PDF bytes, and analyse each
// page with pdf.js: dimensions, selectable text, and image-paint op count.
// `which` is 'slides' (exportSlidesPdf) or 'body' (the inline PDF button).
async function exportAndAnalyze(page, md, which) {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((content) => { window.SDocs.loadText(content, 'deck.md'); }, md);
  await page.waitForTimeout(400);
  // Slides may sit inside collapsed sections; they stay in the DOM, but
  // expand them so layout-dependent rendering has real geometry.
  await page.evaluate(() => {
    document.querySelectorAll('.md-section-body').forEach((b) => b.classList.add('open'));
  });

  return page.evaluate(async (kind) => {
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    if (!window['pdfjsLib']) {
      await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
    }

    let capturedBytes = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob && blob.type === 'application/pdf') {
        blob.arrayBuffer().then((ab) => { capturedBytes = new Uint8Array(ab); });
      }
      return origCreate.call(URL, blob);
    };

    if (kind === 'slides') {
      window.SDocs.exportSlidesPdf();
    } else {
      document.getElementById('_sd_exp-pdf').click();
    }
    for (let i = 0; i < 160 && !capturedBytes; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    URL.createObjectURL = origCreate;
    const status = document.getElementById('_sd_status-text').textContent;
    if (!capturedBytes) return { status, pages: null, header: null };

    const header = String.fromCharCode(...capturedBytes.slice(0, 5));
    const pdf = await window.pdfjsLib.getDocument({ data: capturedBytes }).promise;
    const OPS = window.pdfjsLib.OPS;
    const imageOps = [OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintImageXObjectRepeat];
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      const ol = await pg.getOperatorList();
      let imageCount = 0;
      for (let k = 0; k < ol.fnArray.length; k++) {
        if (imageOps.indexOf(ol.fnArray[k]) !== -1) imageCount++;
      }
      pages.push({
        width: vp.width,
        height: vp.height,
        text: tc.items.map((it) => it.str).join('\n'),
        imageCount: imageCount,
      });
    }
    return { status, header, numPages: pdf.numPages, pages };
  }, which);
}

function deck(blocks) {
  return '# Deck\n\n' + blocks.map((b) => '~~~slide\n' + b + '\n~~~').join('\n\n') + '\n';
}

test.describe('Slide PDF export', () => {
  test('produces a valid PDF, one page per slide', async ({ page }) => {
    test.setTimeout(30000);
    const md = deck([
      'grid 100 56.25\nr 10 10 80 36 | First slide',
      'grid 100 56.25\nr 10 10 80 36 | Second slide',
      'grid 100 56.25\nr 10 10 80 36 | Third slide',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    expect(res.header).toBe('%PDF-');
    expect(res.numPages).toBe(3);
  });

  test('each page is sized to its own slide grid aspect', async ({ page }) => {
    test.setTimeout(30000);
    // One 16:9 slide, one 4:3 slide - a fixed page size would distort one.
    const md = deck([
      'grid 100 56.25\nr 10 10 80 36 | wide',
      'grid 100 75\nr 10 10 80 55 | tall',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.numPages).toBe(2);
    const a0 = res.pages[0].width / res.pages[0].height;
    const a1 = res.pages[1].width / res.pages[1].height;
    expect(a0).toBeCloseTo(100 / 56.25, 1); // 16:9
    expect(a1).toBeCloseTo(100 / 75, 1);    // 4:3
  });

  test('slide text is embedded and extractable', async ({ page }) => {
    test.setTimeout(30000);
    // Guards the composite-font regression where every glyph was dropped
    // because the slide page never went through wrapPageDrawText.
    const md = deck(['grid 100 56.25\nr 8 8 84 40 | Quarterly review summary']);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    const text = res.pages[0].text;
    expect(text).toContain('Quarterly');
    expect(text).toContain('review');
    expect(text).toContain('summary');
  });

  test('a chart inside a slide is rasterised to an image, not left as source', async ({ page }) => {
    test.setTimeout(45000);
    const md = deck([
      'grid 100 56.25\nr 8 8 84 40 align=center valign=center |\n  ```chart\n  {"type":"bar","labels":["Q1","Q2"],"values":[10,20]}\n  ```',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    // The chart rendered as an embedded image...
    expect(res.pages[0].imageCount).toBeGreaterThan(0);
    // ...and the raw JSON source is not sitting on the page as text.
    expect(res.pages[0].text).not.toContain('"type"');
  });

  test('a mermaid diagram inside a slide is rasterised to an image, not left as source', async ({ page }) => {
    test.setTimeout(45000);
    const md = deck([
      'grid 100 56.25\nr 8 8 84 40 align=center valign=center |\n  ```mermaid\n  flowchart LR\n    A --> B\n  ```',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    expect(res.pages[0].imageCount).toBeGreaterThan(0);
    // The diagram source ("flowchart", the --> edge) must not survive as text.
    expect(res.pages[0].text).not.toContain('flowchart');
  });

  test('math inside a slide is rasterised to an image, not left as raw TeX', async ({ page }) => {
    test.setTimeout(45000);
    const md = deck([
      'grid 100 56.25\nr 8 8 84 40 align=center valign=center |\n  $$E = mc^2$$',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    expect(res.pages[0].imageCount).toBeGreaterThan(0);
    // The raw LaTeX must not be drawn as text.
    expect(res.pages[0].text).not.toContain('mc^2');
  });

  test('the inline body PDF includes rendered slide content', async ({ page }) => {
    test.setTimeout(30000);
    // exportPDF walks the document and draws each .sdoc-slide via the same
    // drawSlide path, so slide text must land in the body PDF too.
    const md = deck(['grid 100 56.25\nr 8 8 84 40 | Inline slide payload']);
    const res = await exportAndAnalyze(page, md, 'body');
    expect(res.status).toMatch(/PDF downloaded/);
    const allText = res.pages.map((p) => p.text).join('\n');
    expect(allText).toContain('Inline');
    expect(allText).toContain('payload');
  });

  test('polyPath emits curve commands for every segment operator', async ({ page }) => {
    // Not a PDF test - guards the renderer geometry the PDF exporter reuses.
    // A regression here would turn curves back into straight lines.
    await page.goto(BASE);
    await page.waitForFunction(() => !!window.SDocShapes && !!window.SDocShapeRender);
    const result = await page.evaluate(() => {
      const S = window.SDocShapes;
      const R = window.SDocShapeRender;
      function pathFor(dsl) {
        const parsed = S.parse(dsl);
        S.resolve(parsed.shapes);
        return R.polyPath(parsed.shapes[0].points);
      }
      return {
        smooth: pathFor('p 0,0 ~ 10,0 10,10'),
        arc:    pathFor('p 0,0 ^2 10,0 10,10'),
        quad:   pathFor('p 0,0 >5,5 10,0'),
        cubic:  pathFor('p 0,0 * 3,3 7,3 10,0'),
        round:  pathFor('p (1 0,0 10,0 10,10'),
        plain:  pathFor('p 0,0 10,0 10,10'),
      };
    });
    // ~ and ^h render as quadratics.
    expect(result.smooth).toMatch(/\bQ\b/);
    expect(result.arc).toMatch(/\bQ\b/);
    // >P is a quadratic, * is a cubic.
    expect(result.quad).toMatch(/\bQ\b/);
    expect(result.cubic).toMatch(/\bC\b/);
    // (r corner rounding emits an arc command.
    expect(result.round).toMatch(/\bA\b/);
    // A plain polygon stays straight - lines only.
    expect(result.plain).not.toMatch(/[QCA]/);
  });
});
