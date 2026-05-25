// Library autostart unit tests. Uses SDOCS_LAUNCHAGENTS_DIR + a dry-run
// env var so launchctl is never actually invoked.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const SANDBOX_LA  = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-la-'));
const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-home-'));
process.env.SDOCS_LAUNCHAGENTS_DIR = SANDBOX_LA;
process.env.SDOCS_HOME = SANDBOX_HOME;
process.env.SDOCS_AUTOSTART_DRY_RUN = '1';

for (const k of Object.keys(require.cache)) {
  if (k.includes('library-')) delete require.cache[k];
}
const autostart = require('../cli/lib/library-autostart');

module.exports = function (h) {
  const { test, assert } = h;

  test('autostart: buildPlist contains label, node path, script path, log path', () => {
    const xml = autostart.buildPlist({
      nodePath:   '/usr/local/bin/node',
      scriptPath: '/path/to/sdocs-dev.js',
      logPath:    '/tmp/sdocs.log',
    });
    assert.ok(xml.includes('<string>dev.sdocs.library</string>'));
    assert.ok(xml.includes('<string>/usr/local/bin/node</string>'));
    assert.ok(xml.includes('<string>/path/to/sdocs-dev.js</string>'));
    assert.ok(xml.includes('<string>library</string>'));
    assert.ok(xml.includes('<string>/tmp/sdocs.log</string>'));
    assert.ok(xml.includes('<key>RunAtLoad</key>'));
    assert.ok(xml.includes('<key>KeepAlive</key>'));
  });

  test('autostart: buildPlist escapes XML metacharacters in paths', () => {
    const xml = autostart.buildPlist({
      nodePath:   '/usr/local/bin/node',
      scriptPath: '/path/with <angles> and & ampersand.js',
      logPath:    '/tmp/sdocs.log',
    });
    assert.ok(xml.includes('&lt;angles&gt;'));
    assert.ok(xml.includes('&amp; ampersand'));
  });

  test('autostart: isEnabled is false by default', () => {
    try { fs.unlinkSync(autostart.plistPath()); } catch (_) {}
    assert.strictEqual(autostart.isEnabled(), false);
  });

  if (process.platform === 'darwin') {
    test('autostart: enable writes plist and reports ok', () => {
      const r = autostart.enable();
      assert.strictEqual(r.ok, true);
      assert.ok(fs.existsSync(r.path));
      assert.strictEqual(autostart.isEnabled(), true);
    });

    test('autostart: status reflects enabled state', () => {
      const s = autostart.status();
      assert.strictEqual(s.supported, true);
      assert.strictEqual(s.enabled, true);
    });

    test('autostart: disable removes the plist', () => {
      const r = autostart.disable();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(autostart.isEnabled(), false);
    });

    test('autostart: disable when not enabled is a no-op success', () => {
      const r = autostart.disable();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.alreadyDisabled, true);
    });
  } else {
    test('autostart: refuses to enable on unsupported platforms', () => {
      const r = autostart.enable();
      assert.strictEqual(r.ok, false);
      assert.ok(/macOS/.test(r.message));
    });
  }

  if (process.platform === 'darwin') {
    test('library-commands.autostartDisable records explicit-disable in state', () => {
      // Fresh state.
      const store = require('../cli/lib/library-store');
      store.saveState({ enabled: true, lastScanAt: 0, autostartUserDisabled: false });
      // Make sure plist exists so disable() has something to remove.
      autostart.enable();
      const lc = require('../cli/lib/library-commands');
      const origExit = process.exit;
      const origLog = console.log;
      process.exit = (() => {}); console.log = (() => {});
      try {
        lc.libraryCommand({ file: 'autostart', extra: 'disable' });
      } finally {
        process.exit = origExit; console.log = origLog;
      }
      const s = store.loadState();
      assert.strictEqual(s.autostartUserDisabled, true,
        'disable must record the user-disabled flag');
    });

    test('library-commands.autostartEnable clears the explicit-disable flag', () => {
      const store = require('../cli/lib/library-store');
      store.saveState({ enabled: true, lastScanAt: 0, autostartUserDisabled: true });
      const lc = require('../cli/lib/library-commands');
      const origExit = process.exit;
      const origLog = console.log;
      process.exit = (() => {}); console.log = (() => {});
      try {
        lc.libraryCommand({ file: 'autostart', extra: 'enable' });
      } finally {
        process.exit = origExit; console.log = origLog;
      }
      const s = store.loadState();
      assert.strictEqual(s.autostartUserDisabled, false,
        'enable must clear the user-disabled flag');
    });
  }

  test('cleanup', () => {
    try { fs.rmSync(SANDBOX_LA, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch (_) {}
    delete process.env.SDOCS_LAUNCHAGENTS_DIR;
    delete process.env.SDOCS_AUTOSTART_DRY_RUN;
    assert.ok(true);
  });
};
