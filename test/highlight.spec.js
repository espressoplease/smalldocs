// @ts-check
//
// Syntax-highlighting integration tests. highlight.js lazy-loads from a CDN on
// first encounter, so the render tests are network-dependent (like mermaid).
// The XSS and DoS tests assert the security contract from CLAUDE.md
// ("Adding a new markdown feature").
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function loadDoc(page, markdown) {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((md) => window.SDocs.loadText(md), markdown);
}

// ── Render: full pipeline (network-dependent) ───────────

test('colours a ```ruby fence with hljs token spans', async ({ page }) => {
  await loadDoc(page, '```ruby\ndef hi(name)\n  puts "hello #{name}"\nend\n```');
  await page.waitForSelector('#_sd_rendered pre code.hljs .hljs-keyword', { timeout: 10000 });
  expect(await page.locator('#_sd_rendered .hljs-keyword').count()).toBeGreaterThan(0);
  expect(await page.locator('#_sd_rendered .hljs-string').count()).toBeGreaterThan(0);
});

test('emits a comment token so the "comments pop" CSS can target it', async ({ page }) => {
  await loadDoc(page, '```python\n# a standalone comment\nx = 1\n```');
  await page.waitForSelector('#_sd_rendered .hljs-comment', { timeout: 10000 });
  const styled = await page.evaluate(() => {
    const el = document.querySelector('#_sd_rendered .hljs-comment');
    return el ? getComputedStyle(el).fontStyle : null;
  });
  expect(styled).toBe('italic');
});

test('leaves an untagged fence as plain text (no highlighting)', async ({ page }) => {
  await loadDoc(page, '```\njust some text\n```');
  await page.waitForTimeout(1500);
  expect(await page.locator('#_sd_rendered .hljs-keyword').count()).toBe(0);
});

test('does not touch a reserved language (mermaid stays a diagram)', async ({ page }) => {
  await loadDoc(page, '```mermaid\ngraph TD\n  A --> B\n```');
  await page.waitForSelector('.sdoc-mermaid-stage svg', { timeout: 10000 });
  // No highlight spans should have been injected into a mermaid block.
  expect(await page.locator('#_sd_rendered code.language-mermaid .hljs-keyword').count()).toBe(0);
});

// ── Security: nothing executable survives ───────────────

test('does not execute script smuggled through a code block', async ({ page }) => {
  let dialog = false;
  page.on('dialog', (d) => { dialog = true; d.dismiss(); });
  await loadDoc(page, '```html\n<script>window.__pwned = 1<\/script>\n```');
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(dialog).toBe(false);
  // The angle-bracket source is shown as text, not parsed into a live tag.
  expect(await page.locator('#_sd_rendered pre code script').count()).toBe(0);
});

test('strips event-handler attributes from highlighted output', async ({ page }) => {
  await loadDoc(page, '```html\n<div onclick="alert(1)">x</div>\n```');
  await page.waitForTimeout(2000);
  // Only <span class> tokens may exist inside the code block.
  const badAttrs = await page.evaluate(() => {
    const code = document.querySelector('#_sd_rendered pre code');
    if (!code) return -1;
    return code.querySelectorAll('[onclick], [onload], [onerror], [href], [src]').length;
  });
  expect(badAttrs).toBe(0);
});

// ── DoS: a giant block is skipped, not tokenised ────────

test('skips a block over the byte cap (renders as plain text)', async ({ page }) => {
  const huge = 'x = 1\n'.repeat(40000); // ~240KB, over the 200KB cap
  await loadDoc(page, '```ruby\n' + huge + '```');
  await page.waitForTimeout(2500);
  // Over-cap block is marked done but never tokenised.
  expect(await page.locator('#_sd_rendered .hljs-keyword').count()).toBe(0);
});
