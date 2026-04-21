#!/usr/bin/env node
// Open a deck in present mode and screenshot the rail thumbnails.
const fs = require('fs');
const path = require('path');

(async () => {
  const mdFile = process.argv[2];
  const outPath = process.argv[3];
  if (!mdFile || !outPath) {
    console.error('Usage: node shot-present.js <file.md> <out.png>');
    process.exit(1);
  }
  const md = fs.readFileSync(path.resolve(mdFile), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.SDocPresent && window.SDocPresent.open(4); });  // open slide 5 (CTA)
  await page.waitForTimeout(1200);
  if (process.argv.includes('--full')) {
    await page.screenshot({ path: outPath, fullPage: false });
  } else {
    await page.screenshot({ path: outPath, clip: { x: 0, y: 40, width: 180, height: 860 }, fullPage: false });
  }
  console.log('Saved', outPath);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
