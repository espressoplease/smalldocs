#!/usr/bin/env node
/**
 * preview.js — Render a .md file in Playwright with fresh (cache-busted) JS.
 *
 * Usage:
 *   node test/preview.js <file.md> [--screenshot <path.png>] [--wait <ms>]
 *
 * Examples:
 *   node test/preview.js showcase.md
 *   node test/preview.js showcase.md --screenshot /tmp/preview.png
 *   node test/preview.js test-blocks-unified.md --wait 5000
 *
 * Requires: server running on localhost:3000, Playwright installed.
 * Injects fresh JS modules on every run (bypasses browser cache).
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  let mdFile = null;
  let screenshotPath = null;
  let waitMs = 4000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--screenshot' || args[i] === '-s') { screenshotPath = args[++i]; continue; }
    if (args[i] === '--wait' || args[i] === '-w') { waitMs = parseInt(args[++i]) || 4000; continue; }
    if (!mdFile) mdFile = args[i];
  }

  if (!mdFile) {
    console.error('Usage: node test/preview.js <file.md> [--screenshot <path.png>]');
    process.exit(1);
  }

  const mdPath = path.resolve(mdFile);
  if (!fs.existsSync(mdPath)) {
    console.error('File not found: ' + mdPath);
    process.exit(1);
  }

  const mdContent = fs.readFileSync(mdPath, 'utf-8');

  // Launch Playwright
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (e) {
    console.error('Playwright not installed. Run: npx playwright install chromium');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(1500);

  // Inject fresh JS modules (cache-busted)
  const modules = [
    '/public/sdocs-styles.js',
    '/public/sdocs-state.js',
    '/public/sdocs-theme.js',
    '/public/sdocs-controls.js',
    '/public/sdocs-export.js',
    '/public/sdocs-charts.js',
  ];

  await page.evaluate(async (mods) => {
    for (const mod of mods) {
      const src = await fetch(mod + '?v=' + Date.now()).then(r => r.text());
      const s = document.createElement('script');
      s.textContent = src;
      document.head.appendChild(s);
    }
  }, modules);

  // Also inject fresh sdocs-app.js (needs special handling — it re-registers loadText)
  await page.evaluate(async () => {
    const src = await fetch('/public/sdocs-app.js?v=' + Date.now()).then(r => r.text());
    const s = document.createElement('script');
    s.textContent = src;
    document.head.appendChild(s);
  });

  await page.waitForTimeout(500);

  // Load the .md content
  await page.evaluate((content) => {
    window.SDocs.loadText(content, 'preview.md');
  }, mdContent);

  // Wait for charts to render (Chart.js CDN load + render)
  await page.waitForTimeout(waitMs);

  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log('Screenshot saved: ' + screenshotPath);
  } else {
    console.log('Preview loaded. Press Ctrl+C to close.');
    // Keep browser open for manual inspection
    await new Promise(() => {}); // hang forever
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
