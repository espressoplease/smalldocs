#!/usr/bin/env node
/**
 * shot.js — Quick Playwright screenshot helper for verifying UI changes.
 *
 * Usage:
 *   node test/shot.js <file.md> <out.png> [--viewport 1440x900] [--present 0] [--wait 800]
 *
 * --present N  clicks the Nth .sdoc-slide thumbnail and screenshots present mode
 * --wait MS    extra wait after render (default 700)
 * --viewport WxH  default 1440x900
 *
 * Needs server on :3000.
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  let mdFile = null, outPath = null;
  let viewport = { width: 1440, height: 900 };
  let presentIdx = null;
  let waitMs = 700;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--viewport') {
      const [w, h] = args[++i].split('x').map(Number);
      viewport = { width: w, height: h };
    } else if (a === '--present') {
      presentIdx = parseInt(args[++i], 10);
    } else if (a === '--wait') {
      waitMs = parseInt(args[++i], 10);
    } else if (!mdFile) {
      mdFile = a;
    } else if (!outPath) {
      outPath = a;
    }
  }
  if (!mdFile || !outPath) {
    console.error('Usage: node test/shot.js <file.md> <out.png> [--viewport WxH] [--present N] [--wait MS]');
    process.exit(1);
  }
  const md = fs.readFileSync(path.resolve(mdFile), 'utf8');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((body) => { window.SDocs.currentBody = body; window.SDocs.render(); }, md);
  await page.waitForTimeout(waitMs);
  // Expand any collapsed SDocs sections so slides below the first heading
  // are visible in the screenshot.
  await page.evaluate(() => {
    document.querySelectorAll('#_sd_rendered .collapsed > summary, #_sd_rendered h1, #_sd_rendered h2, #_sd_rendered h3').forEach((el) => {
      const details = el.closest('details');
      if (details && !details.open) details.open = true;
    });
  });
  await page.waitForTimeout(200);
  if (presentIdx != null) {
    await page.locator('.sdoc-slide').nth(presentIdx).click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: outPath, fullPage: false });
  console.log('Saved', outPath);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
