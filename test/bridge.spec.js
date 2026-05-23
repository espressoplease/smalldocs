// @ts-check
//
// Playwright spec for the Bridge editor.
// Spawns a real bridge in-process, navigates the page to the right URL, and
// asserts the file on disk is updated when the user types. Covers the
// autosave round-trip end to end (browser <-> bridge <-> filesystem).
//
// The test relies on the bridge accepting Origin: http://localhost:3000
// (Playwright's baseURL) — loopback origins are allowed by isAllowedOrigin().

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { startBridge } = require('../cli/bin/sdocs-bridge');

const BASE = 'http://localhost:3000';

function tmpFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-bridge-pw-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
}

function bridgeUrl(bridge) {
  return BASE + '/#bridge=127.0.0.1:' + bridge.port + '&token=' + encodeURIComponent(bridge.token);
}

test('open mode: typing into the editor writes the updated body to disk', async ({ page }) => {
  const file = tmpFile('doc.md', '# original heading\n\noriginal body\n');
  const bridge = await startBridge({
    files: [file], mode: 'open',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });

  try {
    await page.goto(bridgeUrl(bridge));
    await page.waitForFunction(() => window.SDocs && window.SDocs.bridge && window.SDocs.bridge._helloed === true);

    // The bridge no longer auto-switches into write mode — the user picks.
    // Drive an edit through the raw textarea, the same path a real edit takes.
    await page.evaluate(() => {
      const r = window.SDocs.rawEl;
      r.value = r.value + '\n\nadded by the test\n';
      r.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect.poll(
      () => fs.readFileSync(file, 'utf-8'),
      { timeout: 5000 }
    ).toContain('added by the test');
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('open mode: external change pushes through and the file-info row shows the cable icon', async ({ page }) => {
  const file = tmpFile('w.md', '# one\n');
  const bridge = await startBridge({
    files: [file], mode: 'open',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });

  try {
    await page.goto(bridgeUrl(bridge));
    await page.waitForFunction(() => window.SDocs && window.SDocs.bridge && window.SDocs.bridge._helloed === true);

    // The Edits row only renders in editing modes — in read mode it stays
    // hidden so the card isn't cluttered for someone just reading. The
    // filename row instead gets a small "local sync" chip so the reader
    // knows the file is connected.
    await expect(page.locator('.fic-row-bridge')).toHaveCount(0);
    await expect(page.locator('.fic-row[data-key="file"] .fic-live-chip')).toContainText('local sync');

    await page.evaluate(() => window.SDocs.setMode('write'));
    await expect(page.locator('.fic-row-bridge .fic-bridge-icon svg')).toBeVisible();
    await expect(page.locator('.fic-row-bridge .fic-local-tag')).toContainText('Local only');
    // Chip steps aside while the Edits row is doing the talking.
    await expect(page.locator('.fic-row[data-key="file"] .fic-live-chip')).toHaveCount(0);

    await expect.poll(
      () => page.evaluate(() => window.SDocs.currentBody),
      { timeout: 5000 }
    ).toContain('one');

    const dir = path.dirname(file);
    const tmp = path.join(dir, '.swap');
    fs.writeFileSync(tmp, '# two\n');
    fs.renameSync(tmp, file);

    await expect.poll(
      () => page.evaluate(() => window.SDocs.currentBody),
      { timeout: 7000 }
    ).toContain('two');
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('open mode: refresh restores the bridge connection from sessionStorage', async ({ page }) => {
  const file = tmpFile('r.md', '# refresh me\n');
  // Generous reconnect grace so the page has time to come back up under
  // the test runner. Production default is 2s, which is plenty for a real
  // browser refresh but borderline under Playwright load.
  const bridge = await startBridge({
    files: [file], mode: 'open',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 10000, idleTimeoutMs: 0,
  });

  try {
    await page.goto(bridgeUrl(bridge));
    await page.waitForFunction(() => window.SDocs && window.SDocs.bridge && window.SDocs.bridge._helloed === true);

    // After hello the URL bar should have been scrubbed of the token.
    await expect.poll(() => page.url()).not.toContain('token=');

    // Refresh. The hash no longer carries the bridge params, so the only
    // way back is via sessionStorage. The bridge process is still alive.
    await page.reload();
    await page.waitForFunction(() => window.SDocs && window.SDocs.bridge && window.SDocs.bridge._helloed === true);

    // Editor body should reflect the file content, same as before refresh.
    const body = await page.evaluate(() => window.SDocs.currentBody);
    expect(body).toContain('refresh me');
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('feedback mode: message banner shows + Done writes the file and submits', async ({ page }) => {
  const file = tmpFile('c.md', '# draft\n\nbody\n');
  const bridge = await startBridge({
    files: [file], mode: 'feedback',
    message: 'Satisfied with my change to Q3?',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });

  let term;
  const terminalPromise = bridge.awaitTerminal().then(t => { term = t; });

  try {
    await page.goto(bridgeUrl(bridge));
    await page.waitForFunction(() => window.SDocs && window.SDocs.bridge && window.SDocs.bridge._helloed === true);

    // The agent's prompt renders as a request row inside the file-info
    // card — no separate banner surface.
    await expect(page.locator('.fic-row-request .fic-request-text')).toContainText('Satisfied with my change to Q3?');

    // Done sends submit and terminates the bridge cleanly.
    await page.locator('.fic-row-request .fic-request-done').click();
    await terminalPromise;

    expect(term.kind).toBe('submit');
    expect(term.code).toBe(0);
    // Row disappears once the submission is acknowledged.
    await expect(page.locator('.fic-row-request')).toHaveCount(0);
  } finally {
    bridge.close();
  }
});
