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

  test('compound shape kinds (chev/cyl/bub/tab/doc) survive as native PDF paths', async ({ page }) => {
    test.setTimeout(45000);
    // Pre-fix, the PDF dispatch only knew about r/c/e/l/a/p; chev/cyl/bub/
    // tab/doc fell through silently, the shape geometry vanished from the
    // PDF, and only the text overlay survived. We assert label text is
    // present (so the overlay still draws) AND that the page contains zero
    // embedded images for these slides — the new shapes go through native
    // page.drawSvgPath rather than rasterising.
    const md = deck([
      'grid 100 56.25\nchev 10 10 60 8 fill=#fde68a | step',
      'grid 100 56.25\ncyl 30 10 30 30 fill=#dbeafe | users',
      'grid 100 56.25\nbub 20 10 50 20 fill=#fef3c7 tail=40,38 | hello',
      'grid 100 56.25\ntab 10 10 60 30 fill=#fde68a | folder',
      'grid 100 56.25\ndoc 10 10 50 30 fill=#ffffff stroke=#475569 | report',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    expect(res.numPages).toBe(5);
    const labels = ['step', 'users', 'hello', 'folder', 'report'];
    for (let i = 0; i < labels.length; i++) {
      expect(res.pages[i].text).toContain(labels[i]);
      // Native path = zero image XObjects for these shapes (the only image
      // paint paths come from cloud/icon/charts/mermaid/math/image= fills).
      expect(res.pages[i].imageCount).toBe(0);
    }
  });

  test('cloud shape rasterises into the PDF and keeps its label', async ({ page }) => {
    test.setTimeout(45000);
    // Cloud's viewBox-relative path is baked into a <g transform>, which
    // pdf-lib's drawSvgPath cannot uniform-scale. The exporter rasterises
    // the live SVG and embeds a PNG instead.
    const md = deck([
      'grid 100 56.25\ncloud 30 10 40 30 fill=#dbeafe stroke=#1d4ed8 | sky',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    expect(res.pages[0].imageCount).toBeGreaterThan(0);
    expect(res.pages[0].text).toContain('sky');
  });

  test('icon shape rasterises into the PDF when the Lucide bundle is available', async ({ page }) => {
    test.setTimeout(45000);
    // The icon bundle (1960 Lucide icons) is lazy-loaded on first use.
    // drawSlide waits for window.SDocIcons to populate before rasterising,
    // otherwise icons would round-trip as dashed placeholders. We assert at
    // least one image XObject lands on the page; a placeholder would still
    // produce one (a rasterised dashed rect), but a totally missing dispatch
    // would produce zero.
    const md = deck([
      'grid 100 56.25\nicon 30 18 20 20 name=database color=#1d4ed8\nicon 55 18 20 20 name=cloud-upload color=#166534',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    // Two icons -> at least 2 image paints.
    expect(res.pages[0].imageCount).toBeGreaterThanOrEqual(2);
  });

  test('textAngle rotated text survives as readable text, not scrambled glyphs', async ({ page }) => {
    test.setTimeout(45000);
    // Pre-fix, rotated text was drawn glyph-by-glyph at post-rotation rects
    // using the unrotated baseline, producing scrambled output. Each glyph
    // was extractable but its position was wrong. We assert the full label
    // round-trips as one contiguous string in the PDF's text content, which
    // only happens when the rotated drawer emits a single drawText with
    // pdf-lib's `rotate` option.
    const md = deck([
      'grid 100 56.25\nr 10 10 30 36 fill=#fde68a textAngle=90 | axis label\nr 50 10 30 36 fill=#bfdbfe textAngle=-90 | other axis\nr 50 10 30 36 fill=#fecaca textAngle=180 | upside down',
    ]);
    const res = await exportAndAnalyze(page, md, 'slides');
    expect(res.status).toBe('Slides PDF downloaded');
    const text = res.pages[0].text;
    // Each rotated label appears as a single contiguous string. We don't
    // assert position; we assert non-fragmentation.
    expect(text).toContain('axis label');
    expect(text).toContain('other axis');
    expect(text).toContain('upside down');
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
