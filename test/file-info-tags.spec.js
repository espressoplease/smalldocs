// File info card Tags row: read-only on hash URLs, interactive when the
// file is local AND the library agent is reachable.

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const zlib = require('zlib');

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

let SANDBOX, agentServer, agentUrl;

test.beforeAll(async () => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-tagrow-'));
  process.env.SDOCS_HOME = SANDBOX;
  process.env.SDOCS_LAUNCHAGENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-la-'));
  process.env.SDOCS_AUTOSTART_DRY_RUN = '1';
  for (const k of Object.keys(require.cache)) {
    if (k.includes('library-') || k.includes('sdocs-library-')) delete require.cache[k];
  }
  // The agent runs on port 0 here for isolation, but the editor page
  // pings the canonical port (47843). For the editable tests we run the
  // agent on 47843; the read-only test uses a URL the page hits but no
  // running agent, which falls back to read-only.
  const libServer = require('../cli/lib/library-server');
  const r = await libServer.createServer({ port: 47843 });
  agentServer = r.server;
  agentUrl = r.agentUrl;
});

test.afterAll(async () => {
  if (agentServer) agentServer.close();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
});

test('file info: read-only tag chips render from front-matter when file is not local', async ({ page }) => {
  const md = '---\ntitle: Read only\ntags:\n  - alpha\n  - beta\n---\n\n# Read only\n\nbody.';
  await page.goto(buildHashUrl(md));
  // The card lazy-renders; wait for the Tags row to appear.
  await page.waitForSelector('.fic-row-tags');
  const chips = await page.$$eval('.fic-tag-chip', els => els.map(e => e.textContent.trim()));
  expect(chips.some(c => c.includes('alpha'))).toBeTruthy();
  expect(chips.some(c => c.includes('beta'))).toBeTruthy();
  // No local + no agent => no edit controls, regardless of agent state.
  await expect(page.locator('.fic-tag-x')).toHaveCount(0);
  await expect(page.locator('.fic-tag-add')).toHaveCount(0);
});

test('file info: body hashtags surface alongside front-matter tags', async ({ page }) => {
  const md = '---\ntitle: With body tag\ntags:\n  - fromfront\n---\n\n# t\n\nfor #frombody only.';
  await page.goto(buildHashUrl(md));
  await page.waitForSelector('.fic-row-tags');
  const chips = await page.$$eval('.fic-tag-chip', els => els.map(e => e.textContent.trim()));
  expect(chips.some(c => c.includes('fromfront'))).toBeTruthy();
  expect(chips.some(c => c.includes('frombody'))).toBeTruthy();
});

test('file info: when local + agent reachable, can add a tag from the card', async ({ page }) => {
  const realFile = path.join(SANDBOX, 'editme.md');
  fs.writeFileSync(realFile, '---\ntitle: Editable\n---\n\n# Editable\n\nbody.');
  const md = '---\ntitle: Editable\n---\n\n# Editable\n\nbody.';
  await page.goto(buildHashUrl(md, { fullPath: realFile }));
  // Wait for the agent-ping result to flip the row to editable.
  await page.waitForSelector('.fic-row-tags .fic-tag-add', { timeout: 5000 });
  await page.click('.fic-tag-add');
  await page.fill('.fic-tag-input', 'newtag');
  await page.press('.fic-tag-input', 'Enter');
  // The chip should appear, and the on-disk file should have the tag.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.fic-tag-chip')]
      .some(el => el.textContent.includes('newtag'))
  );
  const raw = fs.readFileSync(realFile, 'utf8');
  expect(raw).toMatch(/tags:[\s\S]*newtag/);
});

test('file info: × on a chip removes the tag and rewrites the file', async ({ page }) => {
  const realFile = path.join(SANDBOX, 'removeme.md');
  fs.writeFileSync(realFile, '---\ntitle: Removable\ntags:\n  - dropme\n  - keepme\n---\n\n# Removable\n\nbody.');
  const md = '---\ntitle: Removable\ntags:\n  - dropme\n  - keepme\n---\n\n# Removable\n\nbody.';
  await page.goto(buildHashUrl(md, { fullPath: realFile }));
  await page.waitForSelector('.fic-row-tags .fic-tag-add');
  // Click the × button for the "dropme" chip.
  await page.click('.fic-tag-x[data-tag="dropme"]');
  await page.waitForFunction(() => {
    const ts = [...document.querySelectorAll('.fic-tag-chip')].map(e => e.textContent);
    return !ts.some(t => t.includes('dropme'));
  });
  const raw = fs.readFileSync(realFile, 'utf8');
  expect(raw).not.toMatch(/dropme/);
  expect(raw).toMatch(/keepme/);
});
