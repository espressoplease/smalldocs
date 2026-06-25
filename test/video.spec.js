// @ts-check
//
// Video embed integration tests. No network needed: the renderer builds a
// fixed-shape <iframe> from a validated id and never loads the embed itself
// during the test (the browser would, but we only assert on the DOM we emit).
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';
const ID = 'dQw4w9WgXcQ';

async function loadDoc(page, markdown) {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((md) => window.SDocs.loadText(md), markdown);
}

// ── Render ──────────────────────────────────────────────

test('renders a ```video fence as a nocookie iframe', async ({ page }) => {
  await loadDoc(page, '```video\nhttps://www.youtube.com/watch?v=' + ID + '\n```');
  await page.waitForSelector('.sdoc-video iframe');
  const src = await page.locator('.sdoc-video iframe').getAttribute('src');
  expect(src).toBe('https://www.youtube-nocookie.com/embed/' + ID + '?rel=0');
});

test('replaces the original <pre> (no raw source visible)', async ({ page }) => {
  await loadDoc(page, '```video\n' + ID + '\n```');
  await page.waitForSelector('.sdoc-video iframe');
  expect(await page.locator('#_sd_rendered code.language-video').count()).toBe(0);
});

test('start time becomes a start= param', async ({ page }) => {
  await loadDoc(page, '```video\nhttps://youtu.be/' + ID + '\nstart: 1:30\n```');
  await page.waitForSelector('.sdoc-video iframe');
  const src = await page.locator('.sdoc-video iframe').getAttribute('src');
  expect(src).toBe('https://www.youtube-nocookie.com/embed/' + ID + '?rel=0&start=90');
});

test('title renders a caption link to the watch URL', async ({ page }) => {
  await loadDoc(page, '```video\n' + ID + '\ntitle: My clip\n```');
  await page.waitForSelector('.sdoc-video-caption a');
  const a = page.locator('.sdoc-video-caption a');
  expect(await a.textContent()).toBe('My clip');
  expect(await a.getAttribute('href')).toContain('youtube.com/watch?v=' + ID);
});

test('renders multiple videos in one document', async ({ page }) => {
  await loadDoc(page, [
    '```video', ID, '```', '', '```video', 'https://youtu.be/' + ID, '```',
  ].join('\n'));
  await page.waitForSelector('.sdoc-video iframe');
  expect(await page.locator('.sdoc-video iframe').count()).toBe(2);
});

// ── Security: the trust boundary ────────────────────────

test('a non-YouTube URL renders an error, never an iframe', async ({ page }) => {
  await loadDoc(page, '```video\nhttps://evil.com/watch?v=' + ID + '\n```');
  await page.waitForSelector('.sdoc-video-error');
  expect(await page.locator('.sdoc-video iframe').count()).toBe(0);
});

test('a script-injection payload never becomes an iframe', async ({ page }) => {
  await loadDoc(page, '```video\n"><iframe src=javascript:alert(1)></iframe>\n```');
  await page.waitForSelector('.sdoc-video-error');
  // No iframe anywhere in the rendered output, and no script executed.
  expect(await page.locator('#_sd_rendered iframe').count()).toBe(0);
});

test('every emitted iframe points only at the nocookie host', async ({ page }) => {
  await loadDoc(page, [
    '```video', 'https://www.youtube.com/watch?v=' + ID, '```', '',
    '```video', 'https://youtu.be/' + ID, '```', '',
    '```video', ID, '```',
  ].join('\n'));
  await page.waitForSelector('.sdoc-video iframe');
  const srcs = await page.locator('#_sd_rendered iframe').evaluateAll(
    (els) => els.map((e) => e.getAttribute('src')));
  expect(srcs.length).toBe(3);
  for (const s of srcs) {
    expect(s).toContain('https://www.youtube-nocookie.com/embed/');
    expect(/\/\/(?:www\.)?youtube\.com\//.test(String(s))).toBe(false);
  }
});
