#!/usr/bin/env node
// Visual-verification helper for the new client-side slide → pptx pipeline.
// Mirrors test/gen-slides-pdf.js: opens the app in Playwright, renders the
// given markdown, calls SDocs.exportSlidesPptx, captures the .pptx blob,
// writes it to disk. Optionally unzips the XML for structural inspection.
//
// Usage: node test/gen-slides-pptx.js <file.md> <out.pptx>

const fs = require('fs');
const path = require('path');

async function main() {
  const mdFile = process.argv[2];
  const outPath = process.argv[3];
  if (!mdFile || !outPath) {
    console.error('Usage: node test/gen-slides-pptx.js <file.md> <out.pptx>');
    process.exit(1);
  }
  const md = fs.readFileSync(path.resolve(mdFile), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    const txt = msg.text();
    if (/slide-pptx|warn|error/i.test(txt)) console.log('[browser]', txt);
  });

  const PORT = process.env.PORT || 3000;
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  // Slightly longer wait than the PDF harness uses: pptx export triggers
  // fresh mermaid / katex / lucide loads against the off-stage stage, and
  // those queue behind the on-screen first-render. Two seconds is enough
  // in practice; the real-user flow (clicking the export button) waits at
  // least this long naturally.
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('.md-section-body').forEach((b) => b.classList.add('open'));
  });
  await page.waitForTimeout(500);

  // Intercept the blob. PptxGenJS 3.12 emits the file as
  // application/zip (a .pptx IS a zip); accept any blob ≥ 1 KB so we
  // don't false-match against other small blob URLs the app creates.
  await page.evaluate(() => {
    window.__pptxBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {
      if (obj instanceof Blob && obj.size > 1024) {
        window.__pptxBlob = obj;
      }
      return orig(obj);
    };
    const origCreateEl = document.createElement.bind(document);
    document.createElement = function (tag) {
      const el = origCreateEl(tag);
      if (tag === 'a') {
        el.click = function () { window.__pptxName = el.download; };
      }
      return el;
    };
  });

  const t0 = Date.now();
  await page.evaluate(() => { return window.SDocs.exportSlidesPptx(); });
  await page.waitForFunction(() => !!window.__pptxBlob, { timeout: 90000 });
  const ms = Date.now() - t0;

  const bytes = await page.evaluate(async () => {
    const buf = await window.__pptxBlob.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
  fs.writeFileSync(outPath, Buffer.from(bytes));
  console.log('Saved', outPath, '(' + bytes.length + ' bytes, generated in ' + ms + 'ms)');

  // .pptx is a zip. Check the magic bytes.
  const b = Buffer.from(bytes);
  if (b[0] !== 0x50 || b[1] !== 0x4b) {
    console.error('Output does not start with PK — not a zip / pptx');
    process.exit(2);
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
