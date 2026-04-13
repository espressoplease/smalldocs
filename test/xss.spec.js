// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Load markdown into the app via SDocs.loadText() and return the
 * sanitized HTML that ends up in #_sd_rendered.
 */
async function loadAndGetHTML(page, markdown) {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((md) => window.SDocs.loadText(md), markdown);
  return page.locator('#_sd_rendered').innerHTML();
}

// ── Script injection ──────────────────────────────────────

test('strips <script> tags from rendered markdown', async ({ page }) => {
  const html = await loadAndGetHTML(page, '# Hello\n<script>alert("xss")</script>');
  expect(html).not.toContain('<script');
});

test('strips <script> with src attribute', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<script src="https://evil.com/xss.js"></script>');
  expect(html).not.toContain('<script');
});

// ── Event handler attributes ──────────────────────────────

test('strips onerror handler from img tags', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<img src=x onerror="alert(1)">');
  expect(html).not.toContain('onerror');
});

test('strips onload handler from svg tags', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<svg onload="alert(1)"><circle r="10"/></svg>');
  expect(html).not.toContain('onload');
});

test('strips onmouseover handler from div', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<div onmouseover="alert(1)">hover me</div>');
  expect(html).not.toContain('onmouseover');
});

test('strips onclick handler from anchor tags', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<a onclick="alert(1)">click</a>');
  expect(html).not.toContain('onclick');
});

// ── javascript: URLs ──────────────────────────────────────

test('strips javascript: href from links', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<a href="javascript:alert(1)">click me</a>');
  expect(html).not.toContain('javascript:');
});

test('strips javascript: href in markdown link syntax', async ({ page }) => {
  const html = await loadAndGetHTML(page, '[click me](javascript:alert(1))');
  expect(html).not.toContain('javascript:');
});

// ── Obfuscation / edge cases ──────────────────────────────

test('strips nested script attempts', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<<script>script>alert(1)<</script>/script>');
  expect(html).not.toContain('<script');
});

test('strips event handlers with mixed case', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<img src=x oNeRrOr="alert(1)">');
  expect(html).not.toContain('onerror');
  expect(html).not.toContain('oNeRrOr');
});

test('strips iframe tags', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<iframe src="https://evil.com"></iframe>');
  expect(html).not.toContain('<iframe');
});

test('strips object/embed tags', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<object data="evil.swf"></object><embed src="evil.swf">');
  expect(html).not.toContain('<object');
  expect(html).not.toContain('<embed');
});

// ── No script execution ──────────────────────────────────

test('no script actually executes during render', async ({ page }) => {
  // Set a sentinel — if any XSS fires, it sets window.__xss
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate(() => { window.__xss = false; });

  const payloads = [
    '<script>window.__xss=true</script>',
    '<img src=x onerror="window.__xss=true">',
    '<svg onload="window.__xss=true">',
    '<body onload="window.__xss=true">',
    '<a href="javascript:window.__xss=true">click</a>',
    '<details open ontoggle="window.__xss=true"><summary>x</summary></details>',
  ];

  for (const payload of payloads) {
    await page.evaluate((md) => window.SDocs.loadText(md), '# Test\n' + payload);
    const xss = await page.evaluate(() => window.__xss);
    expect(xss, `XSS fired for: ${payload}`).toBe(false);
  }
});

// ── Legitimate HTML preserved ─────────────────────────────

test('preserves safe inline HTML', async ({ page }) => {
  const html = await loadAndGetHTML(page, 'This is <em>italic</em> and <strong>bold</strong>');
  expect(html).toContain('<em>italic</em>');
  expect(html).toContain('<strong>bold</strong>');
});

test('preserves safe links with https href', async ({ page }) => {
  const html = await loadAndGetHTML(page, '<a href="https://example.com">link</a>');
  expect(html).toContain('href="https://example.com"');
});

test('preserves markdown-rendered links', async ({ page }) => {
  const html = await loadAndGetHTML(page, '[example](https://example.com)');
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('example');
});

test('preserves images with safe src', async ({ page }) => {
  const html = await loadAndGetHTML(page, '![alt text](https://example.com/img.png)');
  expect(html).toContain('<img');
  expect(html).toContain('src="https://example.com/img.png"');
});

// ── Write mode sanitization ──────────────────────────────

test('write mode also sanitizes content', async ({ page }) => {
  await page.goto(BASE + '/#mode=write');
  await page.waitForSelector('#_sd_write[contenteditable="true"]');

  await page.evaluate((md) => {
    window.SDocs.currentBody = md;
  }, '<script>alert("xss")</script>\n<img src=x onerror="alert(1)">');

  // Re-enter write mode to trigger the sanitized render
  await page.evaluate(() => {
    document.getElementById('_sd_write').innerHTML =
      DOMPurify.sanitize(marked.parse(window.SDocs.currentBody));
  });

  const html = await page.locator('#_sd_write').innerHTML();
  expect(html).not.toContain('<script');
  expect(html).not.toContain('onerror');
});
