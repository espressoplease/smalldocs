// CLI handlers for the `sdoc library ...` verbs and the on-open
// indexing tap used by the default `sdoc <file>` command.

const fs   = require('fs');
const path = require('path');

const store      = require('./library-store');
const libIndex   = require('./library-index');
const libServer  = require('./library-server');
const autostart  = require('./library-autostart');
const helpText   = require('./help-text');
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

// Walk up from a directory looking for `.git/`. Falls back to the start
// directory if no repo root is found. Matches the rule the agent's
// /api/library/project-tags endpoint uses, so CLI output is consistent
// with what the browser shows.
function resolveProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

// Resolve the scope for `sdoc library ls`. Explicit path arg wins;
// otherwise walk up from cwd to a git root, fall back to cwd. Returns
// the absolute path that will be both the preamble label and the
// prefix filter against indexed entries.
function resolveLsScope(explicitArg) {
  if (explicitArg) {
    const abs = path.resolve(explicitArg);
    if (!fs.existsSync(abs)) {
      console.error(`sdoc library ls: path not found: ${explicitArg}`);
      process.exit(1);
    }
    return abs;
  }
  return resolveProjectRoot(process.cwd());
}

// Return entries whose user-visible path (rescuedFrom when ephemeral,
// otherwise path) is at or under the scope. Compares both the literal
// path and its realpath against both the literal scope and the realpath
// of the scope, so a symlinked /var on macOS doesn't make an entry
// disappear from `sdoc library ls`.
function entriesUnderScope(scope) {
  const root = path.resolve(scope);
  let rootReal = root;
  try { rootReal = fs.realpathSync(root); } catch (_) {}
  const sep = path.sep;
  function under(p) {
    if (!p) return false;
    if (p === root || p.startsWith(root + sep)) return true;
    if (rootReal !== root && (p === rootReal || p.startsWith(rootReal + sep))) return true;
    return false;
  }
  const out = [];
  for (const e of store.loadIndex().entries) {
    const p = e.rescued && e.rescuedFrom ? e.rescuedFrom : e.path;
    let pReal = p;
    try { pReal = fs.realpathSync(p); } catch (_) {}
    if (under(p) || under(pReal)) {
      out.push(Object.assign({}, e, { userPath: p }));
    }
  }
  out.sort((a, b) => a.userPath.localeCompare(b.userPath));
  return out;
}

// `sdoc library ls [path]` and `sdoc library ls [path] --tags`.
// Designed for agents: every output starts with a preamble line that
// states the resolved scope, and ends with a count line. Same shape
// whether the result set is large, small, or empty - so an agent can
// always tell what it queried without guessing.
function libraryLs(opts) {
  const scope = resolveLsScope(opts.extra);

  if (opts.tagsFlag) {
    const tags = libIndex.tagsUnderPrefix(scope);
    if (!tags.length) {
      console.log(`no tagged markdown files indexed under ${scope} yet`);
      console.log(`(tip: run \`sdoc library rebuild\` if you expected results, or open a file with \`sdoc <file> +tag\` to start tagging)`);
      return;
    }
    console.log(`most frequent tags for tagged markdown files under ${scope} (tag - count):`);
    for (const { tag, count } of tags) {
      console.log(`  ${tag} - ${count}`);
    }
    // taggedFiles is the count of entries (under scope) that have at
    // least one tag; tags.length is the count of distinct tags.
    const entries = entriesUnderScope(scope);
    const taggedFiles = entries.filter(e => (e.tags || []).length > 0).length;
    console.log(`(${tags.length} distinct ${tags.length === 1 ? 'tag' : 'tags'} across ${taggedFiles} tagged ${taggedFiles === 1 ? 'file' : 'files'})`);
    return;
  }

  const entries = entriesUnderScope(scope);
  if (!entries.length) {
    console.log(`library has no markdown indexed under ${scope} yet`);
    console.log(`(tip: run \`sdoc library rebuild\` to scan, or open a file with \`sdoc <file>\` to index it)`);
    return;
  }

  console.log(`library files for ${scope}:`);
  // Column width: longest relative path, capped at 60 so very deep paths
  // don't push the tags column off-screen. Aligned padding helps a
  // human skim AND keeps the columns parseable for an agent.
  const rels = entries.map(e => {
    const rel = path.relative(scope, e.userPath);
    return rel === '' ? path.basename(e.userPath) : rel;
  });
  const colWidth = Math.min(60, Math.max(...rels.map(r => r.length)));
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const rel = rels[i];
    const pad = rel.length < colWidth ? ' '.repeat(colWidth - rel.length) : '';
    const tagBox = (e.tags && e.tags.length)
      ? '[' + e.tags.join(', ') + ']'
      : '[no tags]';
    console.log(`  ${rel}${pad}  ${tagBox}`);
  }
  console.log(`(${entries.length} ${entries.length === 1 ? 'file' : 'files'})`);
}

function libraryHelp() {
  console.log(helpText.LIBRARY_HELP);
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
  // `sdoc library --help` and `sdoc library help` both print the
  // library-specific long help (LIBRARY_HELP).
  if (opts.helpFlag) { libraryHelp(); return; }
  const sub = (opts.file || '').toLowerCase();
  switch (sub) {
    case '':         await libraryOpen();    break;
    case 'help':     libraryHelp();          break;
    case 'ls':       libraryLs(opts);        break;
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
      console.error('usage: sdoc library [ls|enable|disable|status|rebuild|autostart|help]');
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
  libraryLs, libraryHelp,
  resolveProjectRoot, resolveLsScope, entriesUnderScope,
  tapOpen,
};
