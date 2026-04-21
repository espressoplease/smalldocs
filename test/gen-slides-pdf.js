#!/usr/bin/env node
/**
 * gen-slides-pdf.js — Visual-verification helper for the new client-side
 * slide → pdf-lib pipeline.
 *
 * Opens the app in Playwright, renders the given markdown file, calls
 * SDocs.exportSlidesPdf(), captures the generated PDF blob, writes it to
 * disk, and optionally converts each page to a PNG via sips for inspection.
 *
 * Usage:
 *   node test/gen-slides-pdf.js <file.md> <out.pdf>
 *
 * Needs server on :3000.
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const mdFile = process.argv[2];
  const outPath = process.argv[3];
  if (!mdFile || !outPath) {
    console.error('Usage: node test/gen-slides-pdf.js <file.md> <out.pdf>');
    process.exit(1);
  }
  const md = fs.readFileSync(path.resolve(mdFile), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', (msg) => {
    const txt = msg.text();
    if (/slide-pdf|warn|error/i.test(txt)) console.log('[browser]', txt);
  });

  const PORT = process.env.PORT || 3000;
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(1500);
  // Expand sections so all slides are live in the DOM (they need to be
  // parsed as .sdoc-slide[data-dsl] nodes; if a section is collapsed but
  // still in the DOM they should still be present — SDocs only gates
  // visibility, not presence).
  await page.evaluate(() => {
    document.querySelectorAll('.md-section-body').forEach((b) => b.classList.add('open'));
  });
  await page.waitForTimeout(500);

  // Intercept the download triggered by exportSlidesPdf — grab the Blob
  // directly (the href gets revoked right after .click() returns, so
  // intercepting the href alone is racy).
  await page.evaluate(() => {
    window.__capturedBlob = null;
    window.__capturedName = null;
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
        el.click = function () {
          window.__capturedName = el.download;
          // don't actually click — avoid navigation in the test runner.
        };
      }
      return el;
    };
  });

  // Debug: inspect the rendered slide sizes before export
  const debugInfo = await page.evaluate(() => {
    const slides = document.querySelectorAll('.sdoc-slide[data-dsl]');
    const infos = [];
    slides.forEach((slide, idx) => {
      const stage = slide.querySelector('.sd-shape-stage');
      if (!stage) return;
      const rects = stage.querySelectorAll('.shape-rect, .shape-text');
      const info = { slideIdx: idx, stageW: stage.clientWidth, stageH: stage.clientHeight, rects: [] };
      rects.forEach((r) => {
        const cs = getComputedStyle(r);
        info.rects.push({
          fontSize: cs.fontSize,
          text: r.textContent.trim().slice(0, 40),
          left: r.getBoundingClientRect().left - stage.getBoundingClientRect().left,
          width: r.clientWidth,
        });
      });
      infos.push(info);
    });
    return infos;
  });
  console.log('Debug (inline rendered slides):', JSON.stringify(debugInfo, null, 2));

  const t0 = Date.now();
  await page.evaluate(() => { window.__slidePdfDebug = true; window.__slideDebug = []; window.__textDebug = []; window.SDocs.exportSlidesPdf(); });
  await page.waitForFunction(() => !!window.__capturedBlob, { timeout: 60000 });

  const pdfStageInfo = await page.evaluate(() => window.__slideDebug);
  console.log('Debug (PDF export stage):', JSON.stringify(pdfStageInfo, null, 2));
  const textInfo = await page.evaluate(() => window.__textDebug);
  console.log('Debug (drawText calls):', JSON.stringify(textInfo, null, 2));
  const ms = Date.now() - t0;

  const bytes = await page.evaluate(async () => {
    const buf = await window.__capturedBlob.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
  const name = await page.evaluate(() => window.__capturedName);

  fs.writeFileSync(outPath, Buffer.from(bytes));
  console.log('Saved', outPath, '(' + bytes.length + ' bytes, generated in ' + ms + 'ms, suggested name: ' + name + ')');

  // Header check
  const b = Buffer.from(bytes);
  if (b[0] !== 0x25 || b[1] !== 0x50 || b[2] !== 0x44 || b[3] !== 0x46) {
    console.error('Output does not start with %PDF — something went wrong');
    process.exit(2);
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
