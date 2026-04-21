#!/usr/bin/env node
// Compare inline vs fullscreen font-sizes for the same slide DSL.
const fs = require('fs');
const path = require('path');

(async () => {
  const mdFile = process.argv[2];
  if (!mdFile) { console.error('usage: debug-parity.js <file.md>'); process.exit(1); }
  const md = fs.readFileSync(path.resolve(mdFile), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(1500);
  // Expand collapsed sections so inline autofit can measure.
  await page.evaluate(() => {
    document.querySelectorAll('.md-section-body').forEach(b => b.classList.add('open'));
    document.querySelectorAll('.section-toggle').forEach(t => t.classList.add('open'));
  });
  await page.waitForTimeout(800);
  const inline = await page.evaluate(() => {
    const rects = document.querySelectorAll('.sdoc-slide .shape-rect');
    return Array.from(rects).map(r => ({
      inlineFS: r.style.fontSize,
      computedFS: getComputedStyle(r).fontSize,
      stageH: r.closest('.sd-shape-stage').clientHeight,
    }));
  });
  console.log('INLINE (after expanding sections):');
  inline.forEach((r, i) => console.log(`  slide ${i+1}: style=${r.inlineFS}  computed=${r.computedFS}  stageH=${r.stageH}`));

  await page.evaluate(() => { window.SDocPresent && window.SDocPresent.open(0); });
  await page.waitForTimeout(1500);
  const present = await page.evaluate(() => {
    const rects = document.querySelectorAll('.sdoc-present-stage .shape-rect');
    return Array.from(rects).map(r => ({
      inlineFS: r.style.fontSize,
      computedFS: getComputedStyle(r).fontSize,
      stageH: r.closest('.sd-shape-stage').clientHeight,
    }));
  });
  console.log('\nPRESENT (slide 1):');
  present.forEach((r, i) => console.log(`  rect ${i+1}: style=${r.inlineFS}  computed=${r.computedFS}  stageH=${r.stageH}`));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
