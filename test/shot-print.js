#!/usr/bin/env node
// Render a deck, trigger the slide-print class, emulate print media,
// screenshot what the PDF renderer would see page by page.
const fs = require('fs');
const path = require('path');

(async () => {
  const mdFile = process.argv[2];
  const outBase = process.argv[3];
  if (!mdFile || !outBase) { console.error('usage: shot-print.js <file.md> <out-prefix>'); process.exit(1); }
  const md = fs.readFileSync(path.resolve(mdFile), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(1500);
  // Expand sections so slides below H2s render.
  await page.evaluate(() => {
    document.querySelectorAll('.md-section-body').forEach((b) => b.classList.add('open'));
  });
  await page.waitForTimeout(600);
  // Intercept window.print so it doesn't block; call printSlides to build
  // the #_sd_print-stage, then emulate print media to let CSS kick in.
  await page.evaluate(() => {
    window.print = () => { /* no-op for screenshot */ };
    window.SDocs.printSlides();
  });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(800);

  // Screenshot each printed slide page.
  const slides = await page.$$('.sdoc-print-page');
  for (let i = 0; i < slides.length; i++) {
    const out = `${outBase}-p${i + 1}.png`;
    await slides[i].screenshot({ path: out });
    console.log('Saved', out);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
