// CLI handlers for the `sdoc library ...` verbs and the on-open
// indexing tap used by the default `sdoc <file>` command.

const path = require('path');

const store      = require('./library-store');
const libIndex   = require('./library-index');
const libServer  = require('./library-server');
const autostart  = require('./library-autostart');
const { openBrowser } = require('./io');
const { DEFAULT_URL } = require('./constants');
const http       = require('http');

function libraryEnable() {
  const s = store.loadState();
  s.enabled = true;
  store.saveState(s);
  console.log('library: enabled');
}

function libraryDisable() {
  const s = store.loadState();
  s.enabled = false;
  store.saveState(s);
  console.log('library: disabled (existing index left in place)');
}

function libraryStatus() {
  const s = store.loadState();
  const idx = store.loadIndex();
  const last = s.lastScanAt ? new Date(s.lastScanAt).toISOString() : 'never';
  console.log(`library: ${s.enabled === false ? 'disabled' : 'enabled'}`);
  console.log(`entries: ${idx.entries.length}`);
  console.log(`last scan: ${last}`);
}

function libraryRebuild() {
  console.log('library: rebuilding...');
  const result = libIndex.rebuild();
  console.log(`library: scanned ${result.scanned}, added ${result.added}, updated ${result.updated}`);
}

// Ping the canonical agent port; resolves true if it answers OK.
function pingAgent(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/library/health', timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Default-on autostart: silently enable the OS auto-launch the first
// time the user runs `sdoc library`, unless they've explicitly disabled
// it before. The user can always turn it off with `sdoc library
// autostart disable`. Stays quiet on platforms that don't support it.
function ensureAutostart() {
  if (!autostart.isSupported()) return;
  const state = store.loadState();
  if (state.autostartUserDisabled) return;
  if (autostart.isEnabled()) return;
  const r = autostart.enable();
  if (r.ok) {
    console.log('library: auto-start on login is on (run `sdoc library autostart disable` to turn off)');
  }
}

async function libraryOpen() {
  const state = store.loadState();
  const siteUrl = process.env.SDOCS_URL || DEFAULT_URL;
  const idx = store.loadIndex();

  // If an agent is already listening on the canonical port (likely
  // because autostart is enabled), don't start another - just open the
  // page and exit. Avoids a port conflict and avoids the user having
  // two agents.
  const existing = await pingAgent(libServer.DEFAULT_PORT);
  if (existing) {
    const pageUrl = `${siteUrl}/library`;
    console.log(`library: ${pageUrl} (using already-running agent)`);
    console.log(`library: ${idx.entries.length} entries indexed`);
    openBrowser(pageUrl);
    return;
  }

  const { agentUrl } = await libServer.createServer();
  const pageUrl = `${siteUrl}/library?agent=${encodeURIComponent(agentUrl)}`;
  console.log(`library: ${pageUrl}`);
  console.log(`library: ${idx.entries.length} entries indexed` + (state.enabled === false ? ' (scanning disabled)' : ''));
  if (!idx.entries.length) console.log('library: click "rescan" in the UI to walk your home for markdown.');
  ensureAutostart();
  console.log(`library: agent at ${agentUrl} (ctrl-c to stop)`);
  openBrowser(pageUrl);
}

function autostartEnable() {
  const r = autostart.enable();
  if (!r.ok) { console.error('library autostart: ' + r.message); process.exit(1); }
  // Clear the "user explicitly disabled" flag so future `sdoc library`
  // invocations don't tip-toe around the preference.
  const s = store.loadState();
  s.autostartUserDisabled = false;
  store.saveState(s);
  console.log('library autostart: enabled (plist at ' + r.path + ')');
}

function autostartDisable() {
  const r = autostart.disable();
  if (!r.ok) { console.error('library autostart: ' + r.message); process.exit(1); }
  // Record the explicit-disable so the default-on logic in libraryOpen
  // doesn't quietly re-enable it next time.
  const s = store.loadState();
  s.autostartUserDisabled = true;
  store.saveState(s);
  console.log(r.alreadyDisabled ? 'library autostart: was not enabled' : 'library autostart: disabled');
}

function autostartStatus() {
  const s = autostart.status();
  if (!s.supported) {
    console.log('library autostart: not supported on ' + process.platform + ' yet (macOS only for now)');
    return;
  }
  console.log('library autostart: ' + (s.enabled ? 'enabled' : 'disabled'));
  console.log('  plist: ' + s.plistPath);
}

// The library verb dispatches on opts.file (which io.parseArgs put the
// sub-sub-verb into - it's the next positional after 'library').
// `sdoc library autostart enable` carries the second sub-arg in opts.extra.
async function libraryCommand(opts) {
  const sub = (opts.file || '').toLowerCase();
  switch (sub) {
    case '':         await libraryOpen();    break;
    case 'enable':   libraryEnable();        break;
    case 'disable':  libraryDisable();       break;
    case 'status':   libraryStatus();        break;
    case 'rebuild':  libraryRebuild();       break;
    case 'autostart': {
      const action = (opts.extra || '').toLowerCase();
      if (action === 'enable')       autostartEnable();
      else if (action === 'disable') autostartDisable();
      else if (action === '' || action === 'status') autostartStatus();
      else {
        console.error(`sdoc library autostart: unknown action "${action}"`);
        console.error('usage: sdoc library autostart [enable|disable|status]');
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`sdoc library: unknown subcommand "${sub}"`);
      console.error('usage: sdoc library [enable|disable|status|rebuild|autostart]');
      process.exit(1);
  }
}

// Hook called from the default open command. Fires after the file has
// been resolved but before (or alongside) the browser open. Best-effort:
// any failure is swallowed so a bad library doesn't break opening a file.
function tapOpen(opts) {
  try {
    const s = store.loadState();
    if (s.enabled === false) return;
    if (!opts.file) return;
    const abs = path.resolve(opts.file);
    libIndex.indexFile(abs, { addTags: opts.addTags || [] });
  } catch (_) {
    // intentional: never break the open flow
  }
}

module.exports = {
  libraryCommand,
  libraryEnable, libraryDisable, libraryStatus, libraryRebuild, libraryOpen,
  tapOpen,
};
