#!/usr/bin/env node
/**
 * gen-doc-pdf.js — Verify the standard PDF export now includes inline slides.
 * Triggers exportPDF (not exportSlidesPdf), captures the Blob.
 *
 * Usage:
 *   PORT=3112 node test/gen-doc-pdf.js <file.md> <out.pdf>
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const mdFile = process.argv[2];
  const outPath = process.argv[3];
  if (!mdFile || !outPath) {
    console.error('Usage: node test/gen-doc-pdf.js <file.md> <out.pdf>');
    process.exit(1);
  }
  const md = fs.readFileSync(path.resolve(mdFile), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (/warn|error|fail/i.test(t)) console.log('[browser]', t);
  });
  const PORT = process.env.PORT || 3000;
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('.md-section-body').forEach((b) => b.classList.add('open'));
  });
  await page.waitForTimeout(500);

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
        el.click = function () { window.__capturedName = el.download; };
      }
      return el;
    };
  });

  // Trigger standard PDF export via the export panel button
  await page.evaluate(() => {
    const btn = document.getElementById('_sd_exp-pdf');
    if (!btn) throw new Error('Export PDF button not found');
    btn.click();
  });
  await page.waitForFunction(() => !!window.__capturedBlob, { timeout: 60000 });

  const bytes = await page.evaluate(async () => {
    const buf = await window.__capturedBlob.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
  fs.writeFileSync(outPath, Buffer.from(bytes));
  console.log('Saved', outPath, '(' + bytes.length + ' bytes)');

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
