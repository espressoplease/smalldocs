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

    // The file-info card carries an Edits row with the screen-share icon
    // on the RHS plus a "Local only" pill.
    await expect(page.locator('.fic-row-bridge .fic-bridge-icon svg')).toBeVisible();
    await expect(page.locator('.fic-row-bridge .fic-local-tag')).toContainText('Local only');

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

    // The agent's prompt renders as a banner above the document.
    await expect(page.locator('#_sd_bridge-banner')).toContainText('Satisfied with my change to Q3?');

    // Done sends submit and terminates the bridge cleanly.
    await page.locator('#_sd_bridge-submit').click();
    await terminalPromise;

    expect(term.kind).toBe('submit');
    expect(term.code).toBe(0);
    // Banner is removed once the submission is acknowledged.
    await expect(page.locator('#_sd_bridge-banner')).toHaveCount(0);
  } finally {
    bridge.close();
  }
});
