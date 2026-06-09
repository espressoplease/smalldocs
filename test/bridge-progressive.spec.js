// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { stripAndCompress } = require('../cli/lib/url');
const { startBridge } = require('../cli/bin/sdocs-bridge');

const BASE = 'http://localhost:3000';

/**
 * Progressive-enhancement bridge.
 *
 * A `sdoc <file>` open now embeds the document as `md=<brotli+base64url>` in the
 * same hash that carries `bridge=`/`token=`. The page paints that snapshot
 * read-only at first load and "upgrades" to the live, editable session when the
 * bridge's `hello` arrives. If the socket never connects, the snapshot stays on
 * screen read-only instead of the page going blank.
 *
 * These tests pin the three behaviours that matter:
 *   1. dead bridge  -> read-only document, editing blocked (not a blank page)
 *   2. live bridge  -> hello content wins, editing enabled, md stripped from URL
 *   3. the handoff cannot silently discard an edit (read-only is enforced, not
 *      narrated)
 */

const SNAP = '---\ntitle: PE test\n---\n# SNAPSHOT_HEADING\n\nThis is the embedded snapshot body.\n';

test.describe('progressive-enhancement bridge', () => {
  let bridge = null;
  let tmpFile = null;

  test.afterEach(async () => {
    if (bridge) { try { bridge.close(); } catch (_) {} bridge = null; }
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (_) {} tmpFile = null; }
  });

  test('dead bridge falls back to a read-only render, not a blank page', async ({ page }) => {
    const md = stripAndCompress(SNAP);
    // 59997 has nothing listening -> the ws connect is refused fast -> _fail.
    const url = `${BASE}/#bridge=127.0.0.1:59997&token=tok&file=test.md&md=${md}`;
    await page.goto(url);

    // The document is on screen (decoded from md=), not a blank page.
    await expect(page.locator('#_sd_rendered')).toContainText('SNAPSHOT_HEADING', { timeout: 10000 });

    // Read-only gate is engaged...
    expect(await page.evaluate(() => window.SDocs.bridge && window.SDocs.bridge._staticReadOnly)).toBe(true);

    // ...and trying to enter an editing mode is blocked (coerced back to read).
    await page.evaluate(() => window.SDocs.setMode('write'));
    await expect(page.locator('body')).not.toHaveClass(/write-mode/);

    // The degraded state is VISIBLE, not silent: a read-only chip appears next
    // to the filename so it doesn't look like an ordinary read-only document.
    await expect(page.locator('.fic-readonly-chip')).toBeVisible({ timeout: 8000 });
  });

  test('live bridge upgrades: hello content wins, editing enabled, md stripped from URL', async ({ page }) => {
    tmpFile = path.join(os.tmpdir(), 'sdoc-pe-live-' + process.pid + '.md');
    fs.writeFileSync(tmpFile, '# LIVE_CONTENT_HEADING\n\nThis came from disk over the bridge.\n');

    bridge = await startBridge({ files: [tmpFile], mode: 'open' });
    const md = stripAndCompress(SNAP); // deliberately DIFFERENT from disk content
    const url = `${BASE}/#bridge=127.0.0.1:${bridge.port}&token=${encodeURIComponent(bridge.token)}`
      + `&file=${encodeURIComponent(path.basename(tmpFile))}&md=${md}`;
    await page.goto(url);

    // hello delivers the disk content, which replaces the snapshot.
    await expect(page.locator('#_sd_rendered')).toContainText('LIVE_CONTENT_HEADING', { timeout: 10000 });
    // The stale snapshot heading is gone.
    await expect(page.locator('#_sd_rendered')).not.toContainText('SNAPSHOT_HEADING');

    // Read-only gate released; editing now works.
    expect(await page.evaluate(() => window.SDocs.bridge._staticReadOnly)).toBe(false);
    await page.evaluate(() => window.SDocs.setMode('write'));
    await expect(page.locator('body')).toHaveClass(/write-mode/);

    // Token AND the document are stripped from the address bar once live.
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).not.toContain('token=');
    expect(hash).not.toContain('md=');
    expect(hash).not.toContain('bridge=');
  });

  test('handoff cannot discard a pre-connect edit (read-only enforced before hello)', async ({ page }) => {
    // Point at a dead bridge so we stay in the read-only static state, then prove
    // the editor genuinely refuses edit modes while the snapshot is showing.
    const md = stripAndCompress(SNAP);
    const url = `${BASE}/#bridge=127.0.0.1:59998&token=tok&file=test.md&md=${md}`;
    await page.goto(url);
    await expect(page.locator('#_sd_rendered')).toContainText('SNAPSHOT_HEADING', { timeout: 10000 });

    // Every mutating mode is coerced to read while read-only.
    for (const mode of ['write', 'raw', 'comment']) {
      await page.evaluate((m) => window.SDocs.setMode(m), mode);
      await expect(page.locator('body')).not.toHaveClass(/write-mode/);
      await expect(page.locator('body')).not.toHaveClass(/comment-mode/);
    }

    // capabilities reflect read-only (canSave off) so the tags row / autosave
    // can't write into a dead socket either.
    expect(await page.evaluate(() => window.SDocs.bridge.capabilities.canSave)).toBe(false);
  });
});
