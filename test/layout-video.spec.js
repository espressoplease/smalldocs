// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

// Load markdown through the real app and wait for the first render to settle.
// Layout (marked extension) and video (post-sanitize DOM swap) are both
// synchronous, so the DOM is final by the time loadText returns.
async function load(page, md) {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((m) => window.SDocs.loadText(m), md);
  await page.waitForTimeout(50);
}

const R = '#_sd_rendered';

// ── Layout containers ─────────────────────────────────────

test('grid renders a grid wrapper with cards', async ({ page }) => {
  await load(page, ':::grid cols=3\n:::card\nA\n:::\n:::card\nB\n:::\n:::card\nC\n:::\n:::\n');
  await expect(page.locator(`${R} .sdoc-grid[data-cols="3"]`)).toHaveCount(1);
  await expect(page.locator(`${R} .sdoc-grid .sdoc-card`)).toHaveCount(3);
});

test('a fenced code block inside a card survives as code', async ({ page }) => {
  await load(page, ':::grid\n:::card\n```js\nconst x = 1;\n```\n:::\n:::\n');
  await expect(page.locator(`${R} .sdoc-card pre code`)).toHaveCount(1);
  await expect(page.locator(`${R} .sdoc-card pre code`)).toContainText('const x = 1;');
});

test('::: inside a code fence does not close the container early', async ({ page }) => {
  const md = ':::card\n```text\n:::\n:::grid\n```\nstill inside the card\n:::\n\noutside now\n';
  await load(page, md);
  await expect(page.locator(`${R} .sdoc-card`)).toContainText('still inside the card');
  await expect(page.locator(`${R} .sdoc-card`)).not.toContainText('outside now');
});

test('grid attribute injection cannot smuggle a handler or style', async ({ page }) => {
  await load(page, ':::grid cols=2 onmouseover=alert(1) style=color:red\n:::col\nx\n:::\n:::\n');
  const html = await page.locator(R).innerHTML();
  expect(html).not.toContain('onmouseover');
  expect(html).not.toContain('style=');
  expect(html).toContain('data-cols="2"');
});

test('nested grids both render', async ({ page }) => {
  const md = ':::grid\n:::col\n:::grid cols=2\n:::col\na\n:::\n:::col\nb\n:::\n:::\n:::\n:::\n';
  await load(page, md);
  await expect(page.locator(`${R} .sdoc-grid`)).toHaveCount(2);
});

// ── Video block ───────────────────────────────────────────

test('video block builds a native video with controls', async ({ page }) => {
  await load(page, '```video\nsrc: /demos/clip.mp4\ncaption: hi\n```\n');
  const v = page.locator(`${R} figure.sdoc-video video`);
  await expect(v).toHaveCount(1);
  await expect(v).toHaveJSProperty('controls', true);
  await expect(page.locator(`${R} figure.sdoc-video figcaption`)).toHaveText('hi');
});

test('video with javascript: src renders an error, not a player', async ({ page }) => {
  await load(page, '```video\nsrc: javascript:alert(1)\n```\n');
  await expect(page.locator(`${R} figure.sdoc-video-error`)).toHaveCount(1);
  await expect(page.locator(`${R} figure.sdoc-video video`)).toHaveCount(0);
});

test('video caption is inert text, never parsed as HTML', async ({ page }) => {
  await load(page, '```video\nsrc: /a.mp4\ncaption: <img src=x onerror=alert(1)>\n```\n');
  // The markup is set via textContent, so no img element is created and the
  // literal text is visible.
  await expect(page.locator(`${R} figure.sdoc-video figcaption img`)).toHaveCount(0);
  await expect(page.locator(`${R} figure.sdoc-video figcaption`)).toContainText('onerror=alert(1)');
});

test('a raw <video onerror> typed in markdown is stripped by the sanitizer', async ({ page }) => {
  await load(page, '<video src=x onerror="alert(1)" controls></video>\n');
  const html = await page.locator(R).innerHTML();
  expect(html).not.toContain('onerror');
});

test('autoplay video is muted (so the browser allows it)', async ({ page }) => {
  await load(page, '```video\nsrc: /a.mp4\nautoplay: true\n```\n');
  const v = page.locator(`${R} figure.sdoc-video video`);
  await expect(v).toHaveJSProperty('autoplay', true);
  await expect(v).toHaveJSProperty('muted', true);
});
