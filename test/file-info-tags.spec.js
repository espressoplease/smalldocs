// File info card Tags row: read-only display for any document, with
// editing gated to "the Bridge is connected and can save". The Bridge
// is now the single write channel for the file - the agent never
// rewrites user content.

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const zlib = require('zlib');

const { startBridge } = require('../cli/bin/sdocs-bridge');

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function compressToBase64Url(text) {
  return toBase64Url(zlib.brotliCompressSync(Buffer.from(text, 'utf-8'), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }));
}
function buildHashUrl(content, local) {
  const params = new URLSearchParams();
  if (content) params.set('md', compressToBase64Url(content));
  if (local)   params.set('local', toBase64Url(Buffer.from(JSON.stringify(local), 'utf-8')));
  return 'http://localhost:3000/#' + params.toString();
}
function buildBridgeUrl(port, token, file) {
  const params = new URLSearchParams();
  params.set('bridge', '127.0.0.1:' + port);
  params.set('token', token);
  params.set('file',  file);
  return 'http://localhost:3000/#' + params.toString();
}

let SANDBOX;
const liveBridges = [];

test.beforeAll(async () => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-tagrow-'));
  process.env.SDOCS_HOME = SANDBOX;
  process.env.SDOCS_LAUNCHAGENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-la-'));
  process.env.SDOCS_AUTOSTART_DRY_RUN = '1';
});
test.afterAll(async () => {
  for (const b of liveBridges) {
    try { b.close(); } catch (_) {}
  }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
});

async function startBridgeFor(filePath) {
  const b = await startBridge({
    files: [filePath], mode: 'open',
    noConnectTimeoutMs: 10000, idleTimeoutMs: 0, reconnectGraceMs: 0,
  });
  liveBridges.push(b);
  return b;
}

// ── Read-only display flows ──

test('file info: read-only tag chips render from front-matter when file is not local', async ({ page }) => {
  const md = '---\ntitle: Read only\ntags:\n  - alpha\n  - beta\n---\n\n# Read only\n\nbody.';
  await page.goto(buildHashUrl(md));
  await page.waitForSelector('.fic-row-tags');
  const chips = await page.$$eval('.fic-tag-chip', els => els.map(e => e.textContent.trim()));
  expect(chips.some(c => c.includes('alpha'))).toBeTruthy();
  expect(chips.some(c => c.includes('beta'))).toBeTruthy();
  // No Bridge => no edit controls.
  await expect(page.locator('.fic-tag-x')).toHaveCount(0);
  await expect(page.locator('.fic-tag-add')).toHaveCount(0);
});

test('file info: local file with tags but no Bridge shows chips read-only, no hint', async ({ page }) => {
  const realFile = path.join(SANDBOX, 'hint.md');
  fs.writeFileSync(realFile, '---\ntags:\n  - one\n---\n# t');
  const md = fs.readFileSync(realFile, 'utf-8');
  await page.goto(buildHashUrl(md, { fullPath: realFile }));
  await page.waitForSelector('.fic-row-tags');
  // Tags still display read-only...
  await expect(page.locator('.fic-tag-chip')).toHaveCount(1);
  // ...but no nag hint and no editing affordances without a live Bridge.
  await expect(page.locator('.fic-tag-hint')).toHaveCount(0);
  await expect(page.locator('.fic-tag-add')).toHaveCount(0);
});

test('file info: local file with no tags and no Bridge hides the tags row entirely', async ({ page }) => {
  const realFile = path.join(SANDBOX, 'no-tags.md');
  fs.writeFileSync(realFile, '# just a heading\n\nno front matter here.');
  const md = fs.readFileSync(realFile, 'utf-8');
  await page.goto(buildHashUrl(md, { fullPath: realFile }));
  // The file-info card renders (path row), but with nothing to show or do the
  // tags row stays hidden rather than nagging the user to start a bridge.
  await page.waitForSelector('.fic-row');
  await expect(page.locator('.fic-row-tags')).toHaveCount(0);
});

// ── Bridge-gated editing flows ──

test('file info: with a Bridge, the composer is present and × shows on chips', async ({ page }) => {
  const realFile = path.join(SANDBOX, 'composer-present.md');
  fs.writeFileSync(realFile, '---\ntags:\n  - first\n---\n# t\n');
  const b = await startBridgeFor(realFile);
  await page.goto(buildBridgeUrl(b.port, b.token, 'composer-present.md'));
  // Wait for the Bridge to connect, then the file info card to settle.
  await page.waitForSelector('.fic-row-tags .fic-tag-add', { timeout: 8000 });
  await expect(page.locator('.fic-tag-x[data-tag="first"]')).toHaveCount(1);
});

test('file info: with a Bridge, add tag via composer writes the file', async ({ page }) => {
  const realFile = path.join(SANDBOX, 'add-via-bridge.md');
  fs.writeFileSync(realFile, '---\ntitle: t\n---\n# t\nbody');
  const b = await startBridgeFor(realFile);
  await page.goto(buildBridgeUrl(b.port, b.token, 'add-via-bridge.md'));
  await page.waitForSelector('.fic-row-tags .fic-tag-add', { timeout: 8000 });
  await page.click('.fic-tag-add');
  await page.fill('.fic-tag-input', 'fromcomposer');
  await page.click('.fic-tag-save');
  // Wait until the Bridge save has flushed to disk (debounced 500ms +
  // round-trip). Poll the file content.
  await expect.poll(() => fs.readFileSync(realFile, 'utf8'),
    { timeout: 5000 }).toMatch(/fromcomposer/);
});

test('file info: with a Bridge, × on chip rewrites the file without that tag', async ({ page }) => {
  const realFile = path.join(SANDBOX, 'remove-via-bridge.md');
  fs.writeFileSync(realFile, '---\ntags:\n  - keep\n  - dropme\n---\n# t\n');
  const b = await startBridgeFor(realFile);
  await page.goto(buildBridgeUrl(b.port, b.token, 'remove-via-bridge.md'));
  await page.waitForSelector('.fic-tag-x[data-tag="dropme"]', { timeout: 8000 });
  await page.click('.fic-tag-x[data-tag="dropme"]');
  await expect.poll(() => fs.readFileSync(realFile, 'utf8'),
    { timeout: 5000 }).not.toMatch(/dropme/);
  expect(fs.readFileSync(realFile, 'utf8')).toMatch(/keep/);
});

test('file info: cancel closes the composer without writing', async ({ page }) => {
  const realFile = path.join(SANDBOX, 'cancel.md');
  fs.writeFileSync(realFile, '---\ntitle: t\n---\n# t\n');
  const b = await startBridgeFor(realFile);
  await page.goto(buildBridgeUrl(b.port, b.token, 'cancel.md'));
  await page.waitForSelector('.fic-tag-add', { timeout: 8000 });
  await page.click('.fic-tag-add');
  await page.waitForSelector('.fic-tag-composer');
  await page.fill('.fic-tag-input', 'shouldnotappear');
  await page.click('.fic-tag-cancel');
  await expect(page.locator('.fic-tag-composer')).toHaveCount(0);
  // Give any spurious save a moment to (not) happen.
  await page.waitForTimeout(800);
  expect(fs.readFileSync(realFile, 'utf8')).not.toMatch(/shouldnotappear/);
});
