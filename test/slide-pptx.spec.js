// @ts-check
// Editable PowerPoint export coverage. Each new shape kind has either a
// native pptx primitive (rect/ellipse/chevron/can/wedgeRoundRectCallout/
// cloud) or rasterises into an embedded PNG (p/tab/doc/icon, chart/
// mermaid/math). The pptx file is a zip of XML; the spec exports a
// deck, unzips the bytes in-memory via JSZip (already used by PptxGenJS),
// and walks each slide's XML to assert the right shapes / images / text
// frames land per slide.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

function deck(blocks) {
  return '# Deck\n\n' + blocks.map((b) => '~~~slide\n' + b + '\n~~~').join('\n\n') + '\n';
}

// Load the deck, trigger pptx export, capture the blob, parse the zip,
// and return per-slide structural data.
async function exportAndAnalyze(page, md) {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((content) => { window.SDocs.loadText(content, 'deck.md'); }, md);
  // Off-stage rasterisation pipelines (mermaid / katex / lucide) all run
  // through their own CDN promises on first use; allow them to warm up so
  // the export captures rendered output, not source.
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('.md-section-body').forEach((b) => b.classList.add('open'));
  });

  return page.evaluate(async () => {
    let capturedBytes = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob && blob.size > 1024) {
        blob.arrayBuffer().then((ab) => { capturedBytes = new Uint8Array(ab); });
      }
      return origCreate.call(URL, blob);
    };
    await window.SDocs.exportSlidesPptx();
    for (let i = 0; i < 160 && !capturedBytes; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    URL.createObjectURL = origCreate;
    if (!capturedBytes) return { error: 'no blob captured' };
    // PptxGenJS bundles JSZip globally; reuse it to walk the produced zip.
    if (!window.JSZip) return { error: 'JSZip not present after export' };
    const zip = await window.JSZip.loadAsync(capturedBytes);
    const slideFiles = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    const slides = [];
    for (const sf of slideFiles) {
      const xml = await zip.files[sf].async('string');
      const presets = (xml.match(/<a:prstGeom prst="(\w+)"/g) || [])
        .map((m) => m.match(/"(\w+)"/)[1]);
      // <a:custGeom> is the "freeform path" shape (no prst attribute).
      // Report it as a synthetic 'custGeom' preset so tests can assert it.
      const customCount = (xml.match(/<a:custGeom>/g) || []).length;
      for (let n = 0; n < customCount; n++) presets.push('custGeom');
      slides.push({
        prsts: presets,
        picCount: (xml.match(/<p:pic>/g) || []).length,
        texts: (xml.match(/<a:t>([^<]+)<\/a:t>/g) || []).map((m) => m.match(/>([^<]+)</)[1]),
        // Rotations are stored on <a:xfrm rot="..."> in 60000ths of a degree.
        rotations: (xml.match(/<a:xfrm rot="(-?\d+)"/g) || []).map((m) => parseInt(m.match(/"(-?\d+)"/)[1])),
      });
    }
    return { slides };
  });
}

test.describe('Slide PPTX export', () => {
  test('compound shape kinds with a clean pptx preset map natively', async ({ page }) => {
    test.setTimeout(60000);
    // Default-variant chevron + cylinder + default-variant cloud all have
    // real, viewer-portable pptx presets and avoid rasterisation. `tab`
    // and `doc` look like they should map to folderCorner / foldedCorner
    // but Keynote drops them silently — rasterised for cross-viewer
    // reliability (covered separately).
    const md = deck([
      'grid 100 56.25\nchev 10 10 60 8 fill=#fde68a | step',
      'grid 100 56.25\ncyl 30 10 30 30 fill=#dbeafe | users',
      'grid 100 56.25\ncloud 30 10 40 30 fill=#dbeafe | sky',
    ]);
    const res = await exportAndAnalyze(page, md);
    expect(res.slides).toHaveLength(3);
    expect(res.slides[0].prsts).toContain('chevron');
    expect(res.slides[1].prsts).toContain('can');
    expect(res.slides[2].prsts).toContain('cloud');
    for (let i = 0; i < 3; i++) {
      expect(res.slides[i].picCount).toBe(0);
    }
  });

  test('polygons round-trip as freeform custGeom shapes (editable vertices)', async ({ page }) => {
    test.setTimeout(60000);
    const md = deck([
      'grid 100 56.25\np 10,10 50,15 40,40 fill=#ddd6fe',
    ]);
    const res = await exportAndAnalyze(page, md);
    // custGeom is the OOXML preset key for arbitrary path shapes — no
    // raster image needed.
    expect(res.slides[0].prsts).toContain('custGeom');
    expect(res.slides[0].picCount).toBe(0);
  });

  test('icon, bub, tab, doc, non-default cloud / chevron fall back to PNG', async ({ page }) => {
    test.setTimeout(75000);
    // Why each rasterises:
    //   icon  — 24x24 Lucide SVG; no native pptx equivalent.
    //   bub   — tail position needs OOXML adjustment points pptxgenjs hides.
    //   tab   — folderCorner exists but Keynote silently drops it.
    //   doc   — foldedCorner exists in OOXML but pptxgenjs doesn't expose it.
    //   chev (with notch=) — preset chevron's notch is fixed.
    //   cloud (variant=material/bootstrap) — only heroicons matches the preset.
    const md = deck([
      'grid 100 56.25\nicon 30 18 20 20 name=user color=#1d4ed8',
      'grid 100 56.25\nbub 20 10 50 20 fill=#fef3c7 tail=40,38 | hello',
      'grid 100 56.25\ntab 10 10 60 30 fill=#fde68a | folder',
      'grid 100 56.25\ndoc 10 10 60 30 fill=#ffffff stroke=#475569 | report',
      'grid 100 56.25\nchev 10 10 60 8 fill=#bfdbfe notch=0.4 | notched',
      'grid 100 56.25\ncloud 30 10 40 30 fill=#dbeafe variant=material | sky',
    ]);
    const res = await exportAndAnalyze(page, md);
    expect(res.slides).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(res.slides[i].picCount).toBeGreaterThan(0);
    }
  });

  test('text content lands as editable text frames, not rasterised', async ({ page }) => {
    test.setTimeout(60000);
    const md = deck([
      'grid 100 56.25\nr 8 8 84 40 text=title | Quarterly review',
    ]);
    const res = await exportAndAnalyze(page, md);
    expect(res.slides[0].texts.join(' ')).toContain('Quarterly');
    expect(res.slides[0].texts.join(' ')).toContain('review');
    // No image embedded — the title is real text.
    expect(res.slides[0].picCount).toBe(0);
  });

  test('chart / mermaid / math inside shapes embed as images, source stripped from text', async ({ page }) => {
    test.setTimeout(75000);
    const md = deck([
      'grid 100 56.25\nr 8 8 84 40 |\n  ```chart\n  {"type":"bar","labels":["Q1","Q2"],"values":[10,20]}\n  ```',
      'grid 100 56.25\nr 8 8 84 40 |\n  ```mermaid\n  flowchart LR\n    A --> B\n  ```',
      'grid 100 56.25\nr 8 8 84 40 |\n  $$E = mc^2$$',
    ]);
    const res = await exportAndAnalyze(page, md);
    for (let i = 0; i < 3; i++) {
      // Every block produces exactly one rasterised picture.
      expect(res.slides[i].picCount).toBeGreaterThanOrEqual(1);
      // None of the markdown fence / TeX source survives in the text frames.
      const allText = res.slides[i].texts.join(' ');
      expect(allText).not.toContain('```');
      expect(allText).not.toMatch(/\$\$/);
      expect(allText).not.toContain('flowchart');
      expect(allText).not.toContain('mc^2');
    }
  });

  test('textAngle rotates the text frame', async ({ page }) => {
    test.setTimeout(60000);
    // OOXML rotation is in 60000ths of a degree. 90° = 5400000.
    const md = deck([
      'grid 100 56.25\nr 10 10 30 36 textAngle=90 fill=#fde68a | rotated 90\nr 50 10 30 36 textAngle=-90 fill=#bfdbfe | rotated -90\nr 50 10 30 36 textAngle=45 fill=#fecaca | rotated 45',
    ]);
    const res = await exportAndAnalyze(page, md);
    expect(res.slides[0].rotations).toContain(5400000);
    expect(res.slides[0].rotations).toContain(-5400000);
    expect(res.slides[0].rotations).toContain(2700000);
  });
});
