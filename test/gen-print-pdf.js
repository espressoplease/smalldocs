#!/usr/bin/env node
// Trigger the print-slides flow and capture a real PDF via page.pdf().
const fs = require('fs');
const path = require('path');

(async () => {
  const mdFile = process.argv[2];
  const outPath = process.argv[3];
  if (!mdFile || !outPath) { console.error('usage: gen-print-pdf.js <file.md> <out.pdf>'); process.exit(1); }
  const md = fs.readFileSync(path.resolve(mdFile), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('.md-section-body').forEach((b) => b.classList.add('open'));
  });
  await page.waitForTimeout(500);
  // Build the print stage without actually opening the browser dialog.
  await page.evaluate(() => {
    window.print = () => {};
    window.SDocs.printSlides();
  });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(800);
  await page.pdf({
    path: outPath,
    width: '1280px',
    height: '720px',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: true,
  });
  console.log('Saved', outPath);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
