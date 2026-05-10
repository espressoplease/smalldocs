#!/usr/bin/env node
/**
 * sdoc CLI
 * Usage:
 *   sdoc report.md              # open file in browser
 *   sdoc share report.md        # copy shareable link to clipboard
 *   sdoc new                    # blank document in write mode
 *   cat file.md | sdoc          # pipe markdown to browser
 *   sdoc                        # open studio with empty editor
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync, execFileSync } = require('child_process');
const SDocYaml = require('../public/sdocs-yaml.js');
const SDocStyles = require('../public/sdocs-styles.js');

const https    = require('https');
const http     = require('http');
const crypto   = require('crypto');
const os       = require('os');
const readline = require('readline');

const DEFAULT_URL = 'https://sdocs.dev';
const VERSION = require('../package.json').version;

// ── Update check ─────────────────────────────────────────
// Daily background refresh of the latest version from npm (silent).
// On next invocation, if the cached `latest` is newer, prompt the user
// to install. Y/y runs `npm i -g sdocs-dev` and re-execs their command.

const UPDATE_CACHE = path.join(os.homedir(), '.sdocs', 'update-check.json');
const SETUP_CACHE  = path.join(os.homedir(), '.sdocs', 'setup.json');
const ONE_DAY = 86400000;

// ── Agent integration block ──────────────────────────────
// IMPORTANT: keep this in sync with the per-agent setup snippets in
// public/sdoc.md (the "Set up your agent" section). If you reword one,
// reword the other.
//
// Release checklist when AGENT_BLOCK_BODY changes:
//   1. Bump AGENT_BLOCK_VERSION below.
//   2. Set AGENT_BLOCK_REASON to a one-line summary of what changed.
//   3. Prepend a new section to public/agent-changes.md.
//   4. Reword public/sdoc.md per-agent snippets to match.

const AGENT_BLOCK_VERSION = 4;
const AGENT_BLOCK_REASON  = 'Add `sdoc diagrams` reference for the new Mermaid render path; tell agents to read it before writing ```mermaid blocks; mention `.mmd` / `.mermaid` standalone files.';

const AGENT_BLOCK_BODY = `## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash - nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a \`.md\` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The \`sdoc\` CLI is installed globally:
- \`sdoc file.md\` - open styled in browser (great for easy reading).
- \`sdoc share file.md\` - copy shareable URL to clipboard.
- \`sdoc schema\` - how to adjust all stylable properties (fonts, colors, spacing).
- \`sdoc charts\` - read this before writing a \`\`\`chart block. The JSON shape is specific and easy to get wrong from memory.
- \`sdoc diagrams\` - read this before writing a \`\`\`mermaid block. Covers supported diagram types and the security model. Standalone \`.mmd\` / \`.mermaid\` files also work: \`sdoc graph.mmd\`.
- \`sdoc --help\` - full usage.

When helping the user themselves, prefer \`sdoc file.md\` over \`sdoc share file.md\`. Share is for sending a link to someone else.

Source: https://github.com/espressoplease/SDocs
`;

const AGENT_BLOCK_START_PREFIX = '<!-- sdocs-agent-block:start v=';
const AGENT_BLOCK_START_RE     = /<!-- sdocs-agent-block:start v=(\d+) -->/;
const AGENT_BLOCK_END_MARKER   = '<!-- sdocs-agent-block:end -->';
const AGENT_BLOCK_LEGACY_OPEN  = '<!-- sdocs-agent-block -->';

const AGENT_CHANGES_URL = 'https://sdocs.dev/agent-changes';
const GITHUB_REPO_URL   = 'https://github.com/espressoplease/SDocs';

function formatAgentBlock(version, body) {
  return `${AGENT_BLOCK_START_PREFIX}${version} -->\n${body}${AGENT_BLOCK_END_MARKER}\n`;
}

const AGENT_TARGETS = [
  { name: 'Claude Code', dir: '.claude',                file: 'CLAUDE.md'  },
  { name: 'Codex',       dir: '.codex',                 file: 'AGENTS.md'  },
  { name: 'Gemini CLI',  dir: '.gemini',                file: 'GEMINI.md'  },
  { name: 'opencode',    dir: path.join('.config', 'opencode'), file: 'AGENTS.md' },
];

// Find a current bookended block. Returns { start, end, version, body } | null.
// Bails on ambiguity (multiple start markers).
function findBookendedBlock(content) {
  const startMatch = AGENT_BLOCK_START_RE.exec(content);
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  const startLineEnd = content.indexOf('\n', startIdx);
  if (startLineEnd < 0) return null;
  const endIdx = content.indexOf(AGENT_BLOCK_END_MARKER, startLineEnd);
  if (endIdx < 0) return null;
  const endMarkerEnd = endIdx + AGENT_BLOCK_END_MARKER.length;
  const trailingNewline = content[endMarkerEnd] === '\n' ? 1 : 0;
  const second = content.indexOf(AGENT_BLOCK_START_PREFIX, endMarkerEnd);
  if (second >= 0) return null;
  return {
    start: startIdx,
    end: endMarkerEnd + trailingNewline,
    version: parseInt(startMatch[1], 10),
    body: content.slice(startLineEnd + 1, endIdx),
  };
}

// Find a legacy open-only block (1.4.x format). Returns { start, end, version } | null.
// Only matches bodies whose terminator is the JoshInLisbon URL line, which is the
// known shape of v1 (1.4.0/1.4.1) and v2 (1.4.2). Hand-edited bodies return null.
function findLegacyBlock(content) {
  const idx = content.indexOf(AGENT_BLOCK_LEGACY_OPEN);
  if (idx < 0) return null;
  const second = content.indexOf(AGENT_BLOCK_LEGACY_OPEN, idx + AGENT_BLOCK_LEGACY_OPEN.length);
  if (second >= 0) return null;
  const terminator = 'Source: https://github.com/JoshInLisbon/SDocs\n';
  const termIdx = content.indexOf(terminator, idx);
  if (termIdx < 0) return null;
  const blockEnd = termIdx + terminator.length;
  const region = content.slice(idx, blockEnd);
  // Heuristic to recover from-version: v2 added the copy-code line, v1 didn't.
  const version = region.includes('Also handy for copying specific code') ? 2 : 1;
  return { start: idx, end: blockEnd, version };
}

// Pure: takes content, returns refresh result.
//   { changed: false, reason: 'absent'|'current'|'newer'|'hand_edited' }
//   { changed: true, content, fromVersion, toVersion }
function refreshContent(content) {
  const bookended = findBookendedBlock(content);
  if (bookended) {
    if (bookended.version === AGENT_BLOCK_VERSION) {
      return { changed: false, reason: 'current' };
    }
    if (bookended.version > AGENT_BLOCK_VERSION) {
      return { changed: false, reason: 'newer' };
    }
    return {
      changed: true,
      content: content.slice(0, bookended.start)
             + formatAgentBlock(AGENT_BLOCK_VERSION, AGENT_BLOCK_BODY)
             + content.slice(bookended.end),
      fromVersion: bookended.version,
      toVersion: AGENT_BLOCK_VERSION,
    };
  }
  const legacy = findLegacyBlock(content);
  if (!legacy) {
    // No block, or unrecognised legacy body. Either is "leave it alone."
    return { changed: false, reason: content.includes(AGENT_BLOCK_LEGACY_OPEN) ? 'hand_edited' : 'absent' };
  }
  return {
    changed: true,
    content: content.slice(0, legacy.start)
           + formatAgentBlock(AGENT_BLOCK_VERSION, AGENT_BLOCK_BODY)
           + content.slice(legacy.end),
    fromVersion: legacy.version,
    toVersion: AGENT_BLOCK_VERSION,
  };
}

function isNewer(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function readCachedLatest() {
  try { return JSON.parse(fs.readFileSync(UPDATE_CACHE, 'utf-8')).latest; }
  catch (_) { return null; }
}

// Self-upgrade: runs npm i -g, then re-execs the same command into the new binary.
// On any failure, falls through (so the user's actual command still runs).
function autoInstallAndReexec(latest) {
  console.log(`\nUpdating sdoc ${VERSION} \u2192 ${latest}...`);
  try {
    execSync('npm i -g sdocs-dev@latest', { stdio: 'pipe' });
  } catch (e) {
    console.error(`! sdoc auto-update to ${latest} failed: ${(e.stderr || e.message || '').toString().trim().split('\n')[0]}`);
    console.error(`  Run \`npm i -g sdocs-dev@latest\` manually to upgrade.`);
    return false;
  }
  console.log(`\u2713 sdoc updated ${VERSION} \u2192 ${latest}`);
  console.log(`  Diff: ${GITHUB_REPO_URL}/compare/v${VERSION}...v${latest}`);
  // Re-exec into the new binary so the user's command runs with the new code.
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.argv0, process.argv.slice(1), { stdio: 'inherit' });
  process.exit(r.status == null ? 0 : r.status);
}

// Single entry point for "there's a newer version on npm" handling.
// Behaviour depends on context:
//   - autoInstallUpdates=true: silent self-upgrade + re-exec.
//   - interactive TTY: Y/n prompt as today.
//   - non-TTY (agent shell): one-line hint to stdout.
async function maybeUpdateBinary() {
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;
  const latest = readCachedLatest();
  if (!latest || !isNewer(latest, VERSION)) return;

  const state = readSetupState();
  const autoInstall = state && state.autoInstallUpdates === true;

  if (autoInstall) {
    autoInstallAndReexec(latest);
    return;
  }

  const isInteractive = process.stdout.isTTY && process.stdin.isTTY;
  if (!isInteractive) {
    console.log(`Update available: ${VERSION} \u2192 ${latest}. Run \`npm i -g sdocs-dev@latest\` to upgrade.`);
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question(`\nUpdate available: ${VERSION} \u2192 ${latest}. Install now? [Y/n] `, a => {
      rl.close(); resolve(a.trim().toLowerCase());
    });
  });
  if (answer && answer !== 'y' && answer !== 'yes') return;

  console.log('Installing sdocs-dev@latest...');
  try {
    execSync('npm i -g sdocs-dev@latest', { stdio: 'inherit' });
    console.log(`\u2713 Updated to v${latest}`);
  } catch (_) {
    console.error('Update failed. You may need: sudo npm i -g sdocs-dev');
  }
}

// Daily refresh of the cached `latest` version from npm. Not gated on TTY:
// agents populate the cache too, so the update hint reaches them on next run.
function refreshUpdateCache() {
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;
  try {
    if (Date.now() - fs.statSync(UPDATE_CACHE).mtimeMs < ONE_DAY) return;
  } catch (_) {}

  https.get('https://registry.npmjs.org/-/package/sdocs-dev/dist-tags', { timeout: 3000 }, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const latest = JSON.parse(data).latest;
        fs.mkdirSync(path.dirname(UPDATE_CACHE), { recursive: true });
        fs.writeFileSync(UPDATE_CACHE, JSON.stringify({ latest }));
      } catch (_) {}
    });
  }).on('error', () => {}).on('timeout', function () { this.destroy(); });
}

// ── Agent setup ──────────────────────────────────────────
// On first interactive run, detect which coding-agent config dirs exist
// and offer to write the SDocs section into each. Tracked in
// ~/.sdocs/setup.json so we never prompt twice. Manually re-runnable
// via `sdoc setup`. Auto-refresh on later upgrades is gated on the
// user's consent during setup.

const SETUP_SCHEMA_VERSION = 1;

// Pre-1.5.0 setup.json had no `schemaVersion`. Existing users wrote the block
// (so they want it kept current) but were never asked about auto-install.
function migrateSetupState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion === SETUP_SCHEMA_VERSION) return raw;
  if (raw.schemaVersion && raw.schemaVersion > SETUP_SCHEMA_VERSION) {
    // From a future sdoc; treat as unknown and let the user re-consent.
    return null;
  }
  if (!raw.setupCompleted) return null;
  return {
    schemaVersion: SETUP_SCHEMA_VERSION,
    setupCompleted: raw.setupCompleted,
    writtenTo: raw.writtenTo || [],
    declined: !!raw.declined,
    autoRefreshAgentFiles: !raw.declined,
    autoInstallUpdates: false,
    lastRunVersion: null,
  };
}

function readSetupState() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(SETUP_CACHE, 'utf-8')); }
  catch (_) { return null; }
  if (raw && raw.schemaVersion === SETUP_SCHEMA_VERSION) return raw;
  const migrated = migrateSetupState(raw);
  if (migrated) {
    writeSetupState(migrated);
    return migrated;
  }
  return null;
}

function writeSetupState(state) {
  try {
    fs.mkdirSync(path.dirname(SETUP_CACHE), { recursive: true });
    const payload = { schemaVersion: SETUP_SCHEMA_VERSION, ...state };
    payload.schemaVersion = SETUP_SCHEMA_VERSION;
    fs.writeFileSync(SETUP_CACHE, JSON.stringify(payload, null, 2));
  } catch (_) {}
}

function compareVersions(a, b) {
  const A = String(a || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  const B = String(b || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((A[i] || 0) > (B[i] || 0)) return 1;
    if ((A[i] || 0) < (B[i] || 0)) return -1;
  }
  return 0;
}

function detectAgents() {
  const home = os.homedir();
  return AGENT_TARGETS
    .map(t => ({ ...t, dirPath: path.join(home, t.dir), filePath: path.join(home, t.dir, t.file) }))
    .filter(t => fs.existsSync(t.dirPath));
}

function fileHasBlock(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return findBookendedBlock(content) !== null
        || content.includes(AGENT_BLOCK_LEGACY_OPEN);
  } catch (_) { return false; }
}

function isSymlink(filePath) {
  try { return fs.lstatSync(filePath).isSymbolicLink(); }
  catch (_) { return false; }
}

// Atomic write: tmp file in the SAME directory (so rename can't hit EXDEV),
// then rename. Cleans up the tmp on any error.
function atomicWrite(filePath, content) {
  const dir  = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp  = path.join(dir, `.${base}.sdocs.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, content);
  try { fs.renameSync(tmp, filePath); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

function backupFile(filePath) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(filePath, `${filePath}.sdocs.bak.${stamp}`);
  } catch (_) {}
}

// Best-effort exclusive lock. Returns a release function or null on contention.
// Stale locks (>60s) are reaped.
function acquireLock(filePath) {
  const lockPath = `${filePath}.sdocs.lock`;
  try {
    const fd = fs.openSync(lockPath, 'wx');
    try { fs.writeSync(fd, String(process.pid)); } catch (_) {}
    fs.closeSync(fd);
    return () => { try { fs.unlinkSync(lockPath); } catch (_) {} };
  } catch (e) {
    if (e.code !== 'EEXIST') return null;
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > 60000) {
        fs.unlinkSync(lockPath);
        return acquireLock(filePath);
      }
    } catch (_) {}
    return null;
  }
}

function writeBookendedBlock(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const block = formatAgentBlock(AGENT_BLOCK_VERSION, AGENT_BLOCK_BODY);
  if (!fs.existsSync(filePath)) {
    atomicWrite(filePath, block);
    return;
  }
  const existing = fs.readFileSync(filePath, 'utf-8');
  const prefix = existing.endsWith('\n') ? '\n' : '\n\n';
  atomicWrite(filePath, existing + prefix + block);
}

// Refresh a single agent file. Returns { path, name?, changed, fromVersion?, toVersion?, reason?, error? }.
function refreshAgentFile(filePath, opts = {}) {
  if (!fs.existsSync(filePath))                       return { path: filePath, changed: false, reason: 'absent' };
  if (isSymlink(filePath) && !opts.followSymlinks)    return { path: filePath, changed: false, reason: 'symlink' };

  const release = acquireLock(filePath);
  if (!release)                                       return { path: filePath, changed: false, reason: 'locked' };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const result  = refreshContent(content);
    if (!result.changed) return { path: filePath, changed: false, reason: result.reason };
    backupFile(filePath);
    atomicWrite(filePath, result.content);
    return {
      path: filePath, changed: true,
      fromVersion: result.fromVersion, toVersion: result.toVersion,
    };
  } catch (e) {
    return { path: filePath, changed: false, error: e.message };
  } finally {
    release();
  }
}

function refreshAllAgentFiles(opts = {}) {
  const home = os.homedir();
  return AGENT_TARGETS.map(t => {
    const filePath = path.join(home, t.dir, t.file);
    return { name: t.name, ...refreshAgentFile(filePath, opts) };
  });
}

function printRefreshSummary(results) {
  const changed = results.filter(r => r.changed);
  if (changed.length > 0) {
    const n = changed.length;
    console.log(`✓ SDocs agent block updated to v${AGENT_BLOCK_VERSION} in ${n} ${n === 1 ? 'file' : 'files'}`);
    console.log(`  Changes: ${AGENT_CHANGES_URL}#v${AGENT_BLOCK_VERSION}`);
  }
  for (const r of results.filter(r => r.error)) {
    console.log(`! ${r.path}: ${r.error}`);
  }
  for (const r of results.filter(r => r.reason === 'symlink')) {
    console.log(`! ${r.path}: symlink, skipped (run \`sdoc setup --follow-symlinks\` to follow)`);
  }
  for (const r of results.filter(r => r.reason === 'hand_edited')) {
    console.log(`! ${r.path}: local edits detected, run \`sdoc setup\` to refresh manually`);
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, a => { rl.close(); resolve(a.trim().toLowerCase()); });
  });
}

async function askAutoInstallConsent() {
  console.log('\nAuto-install sdoc updates when available?');
  console.log('');
  console.log('This runs `npm i -g sdocs-dev@latest` on your behalf when a new');
  console.log('version ships. The output includes a source-diff link so you');
  console.log('(or your agent) can verify what was installed.');
  console.log('');
  console.log('Recommended if you mostly use sdoc through coding agents.');
  console.log('');
  console.log('Change any time with `sdoc auto-update on` / `sdoc auto-update off`.\n');
  const a = await ask('Enable? [Y/n] ');
  return !a || a === 'y' || a === 'yes';
}

async function askAutoRefreshConsent() {
  console.log('\nKeep this block updated on future sdoc upgrades?');
  console.log('');
  console.log('When sdoc adds a feature we sometimes update this section so');
  console.log('your agent learns about it. Each time the block changes we');
  console.log(`print a notice with a link to ${AGENT_CHANGES_URL}`);
  console.log('showing the exact delta - the new wording, and why it changed.');
  console.log('');
  console.log('Re-run `sdoc setup` any time to change this.\n');
  const a = await ask('Enable? [Y/n] ');
  return !a || a === 'y' || a === 'yes';
}

async function runSetup({ force = false } = {}) {
  if (!force) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) return;
    if (process.env.CI || process.env.SDOCS_NO_SETUP) return;
    if (readSetupState()) return;
  }

  const detected = detectAgents().filter(t => !fileHasBlock(t.filePath));

  if (detected.length === 0) {
    // Fallback: ask about opencode if nothing detected and not already set up
    const opencodeAlreadyDone = fileHasBlock(path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md'));
    if (opencodeAlreadyDone) {
      writeSetupState({
        setupCompleted: new Date().toISOString(),
        writtenTo: [], declined: false,
        autoRefreshAgentFiles: true, autoInstallUpdates: false,
        lastRunVersion: VERSION,
      });
      console.log('\nSDocs is already set up in all detected agent configs. Nothing to do.');
      return;
    }
    console.log('\n\u2728\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SDocs setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2728');
    console.log('First run only - wire SDocs into your CLI coding agents.\n');
    console.log('No coding-agent configs detected.');
    const a = await ask('Do you use opencode? [y/N] ');
    const writtenTo = [];
    let autoRefresh = false;
    let autoInstall = false;
    if (a === 'y' || a === 'yes') {
      const target = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
      try { writeBookendedBlock(target); writtenTo.push(target); console.log(`\u2713 Wrote SDocs section to ${target}`); }
      catch (e) { console.error(`Failed to write ${target}: ${e.message}`); }
      autoRefresh = await askAutoRefreshConsent();
      autoInstall = await askAutoInstallConsent();
      console.log('Done. Run `sdoc setup` any time to revisit.');
    } else {
      console.log('Skipped. Run `sdoc setup` any time to revisit.');
    }
    writeSetupState({
      setupCompleted: new Date().toISOString(),
      writtenTo, declined: writtenTo.length === 0,
      autoRefreshAgentFiles: autoRefresh,
      autoInstallUpdates: autoInstall,
      lastRunVersion: VERSION,
    });
    return;
  }

  console.log('\n\u2728\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SDocs setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2728');
  console.log('First run only - wire SDocs into your CLI coding agents.\n');
  console.log('Detected: ' + detected.map(t => t.name).join(', '));
  console.log('\nWill append a short SDocs section to:');
  for (const t of detected) console.log('  ' + t.filePath);
  console.log('\nThese files are loaded into every conversation across all your');
  console.log('projects, so SDocs becomes available no matter where you\'re working.');
  console.log('');
  console.log('You can ask your agent things like:');
  console.log('  "write up the plan and sdoc it to me"');
  console.log('  "explain async/await to me in a sdoc"');
  console.log('  "draft the release notes as a sdoc I can share"');
  console.log('');
  console.log('This is the best way to work with SDocs');
  const RULE = '\u2550'.repeat(36);
  console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 Block to add \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  console.log(AGENT_BLOCK_BODY.trim());
  console.log(RULE);

  const a = await ask('\nAdd to all? [Y/n/skip] ');
  const skipped = a === 'skip' || (a && a !== 'y' && a !== 'yes');
  if (skipped) {
    writeSetupState({
      setupCompleted: new Date().toISOString(),
      writtenTo: [], declined: true,
      autoRefreshAgentFiles: false, autoInstallUpdates: false,
      lastRunVersion: VERSION,
    });
    console.log('Skipped. Run `sdoc setup` any time to revisit.');
    return;
  }

  const writtenTo = [];
  for (const t of detected) {
    try { writeBookendedBlock(t.filePath); writtenTo.push(t.filePath); console.log(`\u2713 ${t.name}: ${t.filePath}`); }
    catch (e) { console.error(`\u2717 ${t.name}: ${e.message}`); }
  }

  const autoRefresh = writtenTo.length > 0 ? await askAutoRefreshConsent() : false;
  const autoInstall = writtenTo.length > 0 ? await askAutoInstallConsent() : false;

  writeSetupState({
    setupCompleted: new Date().toISOString(),
    writtenTo, declined: false,
    autoRefreshAgentFiles: autoRefresh,
    autoInstallUpdates: autoInstall,
    lastRunVersion: VERSION,
  });
  console.log('\nDone. Run `sdoc setup` any time to revisit.');
}

// Auto-refresh existing agent files when the binary version is newer than the
// version that last ran. No prompt: the user already consented during setup.
// Bails on downgrades (block version > shipped version), errors, or partial
// failures (lastRunVersion only advances when every changed file succeeded).
async function maybeAutoRefresh() {
  if (process.env.SDOCS_NO_REFRESH) return;
  const state = readSetupState();
  if (!state) return;
  if (!state.autoRefreshAgentFiles) return;
  if (compareVersions(VERSION, state.lastRunVersion) <= 0) return;

  const results = refreshAllAgentFiles();
  const anyChanged = results.some(r => r.changed);
  if (anyChanged) printRefreshSummary(results);

  const anyError = results.some(r => r.error);
  if (!anyError) {
    writeSetupState({ ...state, lastRunVersion: VERSION });
  }
}

// `sdoc auto-update on|off|status` — flips state.autoInstallUpdates.
function runAutoUpdateSubcommand(arg) {
  let state = readSetupState();
  if (!state) {
    console.log('Run `sdoc setup` first to configure auto-update.');
    return;
  }
  if (arg === 'on') {
    writeSetupState({ ...state, autoInstallUpdates: true });
    console.log('✓ Auto-install of sdoc updates: on');
    return;
  }
  if (arg === 'off') {
    writeSetupState({ ...state, autoInstallUpdates: false });
    console.log('✓ Auto-install of sdoc updates: off');
    return;
  }
  console.log(`Auto-install of sdoc updates: ${state.autoInstallUpdates ? 'on' : 'off'}`);
  console.log('Use `sdoc auto-update on` or `sdoc auto-update off` to change.');
}

// ── Help ───────────────────────────────────────────────────
const HELP = `
SDocs CLI
=========
Open, share, and style markdown files from the terminal.

USAGE
  sdoc <file>                      Open file in browser (read mode)
  sdoc <file> --write              Open in write mode
  sdoc <file> --style              Open with style panel
  sdoc <file> --raw                Open raw markdown source
  sdoc <file> --comment            Open in comment mode (review/annotate)
  sdoc new                         New blank document (write mode)
  sdoc share <file>                Copy shareable link to clipboard
  sdoc share <file> --section "X"  Link with section anchor
  sdoc share <file> --short        Encrypted /s/<id> short link (see SHORT LINKS)
  sdoc schema                      Print the full styles schema
  sdoc charts                      Chart types, options, and styling guide
  sdoc diagrams                    Mermaid diagrams reference (\`\`\`mermaid blocks)
  sdoc comments                    Comment-format reference (for agents)
  sdoc defaults                    Show ~/.sdocs/styles.yaml
  sdoc defaults --reset            Remove default styles
  sdoc setup                       Wire SDocs into your coding agents
  sdoc auto-update [on|off]        Toggle auto-install of sdoc updates
  sdoc safe                        Verify the SDocs server is running the published code
  sdoc safe --json                 Same, machine-readable (for agents)
  sdoc safe --audit                Same, plus GitHub links to server-side source files
  sdoc help                        Show this help
  cat file.md | sdoc               Pipe markdown from stdin
  cat file.md | sdoc share         Pipe to clipboard link

MODE FLAGS
  --read     Clean reading view (default when file given)
  --write    Opens the contentEditable writer
  --style    Styled preview with style panel visible
  --raw      Shows raw markdown source
  --comment  Comment mode: gutter buttons appear on each block; cards
             render under blocks that already have comments. Useful both
             for human review and for opening files an agent has annotated.

OPTIONS
  --section <heading>   Scroll to heading section on load
  --light               Open in light theme
  --dark                Open in dark theme
  --url <base>          Custom base URL (default: https://sdocs.dev)
  --mode <m>            Alias for --read / --write / --style / --raw / --comment
  --short               Use the encrypted /s/<id> short-URL form (share
                        subcommand only). See SHORT LINKS below.
  --json                Machine-readable output (safe subcommand only).
  --audit               Also print GitHub links to server-side source
                        files (safe subcommand only).

ENVIRONMENT
  SDOCS_URL   Fallback base URL if --url is not passed.

FILE INFO CARD
  When you \`sdoc <file>\`, the browser shows a small info card
  above the document with:
    file       The filename — included in the share URL.
    path       Relative path from the cwd — local only.
    fullPath   Absolute path on your machine — local only.

  Local fields (path, fullPath) are passed to the browser via a
  separate URL parameter that JS reads into memory and then strips
  from the address bar on load. They never appear in any URL the
  user can copy, and \`sdoc share <file>\` never includes them in
  the generated link. If someone opens your shared URL, only
  \`file\` is visible.

SHORT LINKS (sdoc share --short)
  By default, \`sdoc share <file>\` encodes the document into the URL hash:
  \`https://sdocs.dev/#md=<base64url>\`. The whole document lives in the
  hash, which the browser does not send to any server.

  \`--short\` produces a shorter, encrypted form: \`https://sdocs.dev/s/<id>#k=<key>\`.

  How it works:
    1. The CLI brotli-compresses the content, generates a 256-bit AES-GCM
       key + 96-bit nonce locally, and encrypts the compressed bytes.
    2. The CLI POSTs the ciphertext (nonce + ct + auth tag, base64url) to
       /api/short. The server stores it under a random short id and
       returns the id. The key NEVER leaves the CLI.
    3. The CLI assembles \`https://sdocs.dev/s/<id>#k=<key>\` and copies
       it to the clipboard. The key lives in the URL fragment, which the
       browser does not send to the server on page load.
    4. Whoever opens the link: the browser fetches the ciphertext from
       /api/short/<id>, reads \`#k=\` from window.location.hash, decrypts
       in JavaScript, and renders.

  What the server can see:
    - That a ciphertext blob was uploaded under id <id>.
    - When it was fetched and from which IP (standard server logs).
  What the server cannot see:
    - The plaintext document. It does not have the key.
    - The key. The key never leaves the URL fragment.

  Trade-offs vs the default \`#md=\` hash form:
    - + Shorter URL.
    - + Survives URL-length limits (some chat apps truncate at ~2k chars).
    - - Requires the server to remain reachable (the default form does not).
    - - Stored ciphertext can be deleted by the operator at any time.
    - - Server logs reveal access patterns even though contents are encrypted.

  If you don't trust an SDocs operator with even those metadata, use the
  default \`sdoc share <file>\` (no --short) which never contacts the
  server at all.

VERIFYING THE SERVER (sdoc safe)
  \`sdoc safe\` asks https://sdocs.dev what commit it is running, pulls the
  authoritative fingerprint list for that commit from GitHub (published by the
  publish-manifest workflow on every push to main), downloads every frontend
  file from the host, hashes each one with SHA-256, and compares. Bytes come
  from the host; fingerprints come from GitHub. The host cannot produce a
  match it did not already publish to GitHub.

  It does not prove anything about server-side code (that runs on a machine
  we control). \`sdoc safe --audit\` prints GitHub links to the server files
  an agent or human would need to read to audit the rest.

  \`sdoc safe --json\` returns structured output for scripting.

MATH
  Inline $...$ and display $$...$$ are rendered as LaTeX via KaTeX.
    Inline:   The energy is $E = mc^2$.
    Display:  $$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$
  Supported commands: https://katex.org/docs/supported.html

STYLED MARKDOWN FORMAT
  SDocs extends standard .md files with an optional YAML
  front matter block (the same standard used by Jekyll, Hugo, Obsidian).
  The \`styles\` key controls every visual aspect of the rendered document.

  ---
  title: "My Document"
  styles:
    fontFamily: Inter
    baseFontSize: 16
    color: "#1c1917"
    h1: { fontSize: 2.2, color: "#1a3a5c", fontWeight: 700 }
    p:  { lineHeight: 1.85, marginBottom: 1.1 }
  ---
  # My Document
  Content here...

  Colors work in both themes automatically — dark mode versions
  are generated by inverting lightness. Use \`dark:\` to override.

COMMENTS
  SDocs files can carry reviewer comments in their YAML front matter
  under a \`comments:\` key. Comments do not modify the body — they're
  resolved at render time by index lookup with a text-based fallback.
  A typical use:
    1. an agent generates a draft .md file
    2. a human reads it via \`sdoc <file> --comment\`, leaves comments
    3. the user copies the .md back to the agent (with comments)
    4. the agent processes the comments and regenerates

  Or the inverse: an agent writes comments into the front matter to
  flag uncertainty, and runs \`sdoc <file> --comment\` to surface them
  for the human.

Run \`sdoc comments\` for the full format reference and authoring guide.
Run \`sdoc schema\` for the complete list of style properties.
Run \`sdoc charts\` for chart types, options, and styling.
`;

const COMMENTS_HELP = `
SDocs — Comments
================
Reviewer comments are stored in YAML front matter under \`comments:\`.
The body is never modified — anchoring happens at render time.
This makes the format safe for round-tripping through agents and
markdown tooling that doesn't understand SDocs-specific markers.

WHEN TO USE THIS
  Two flows benefit from comments:

  1. Human reviewing agent output. The agent generates a .md file,
     the human runs \`sdoc <file> --comment\`, leaves notes, and pastes
     the file (with its YAML) back to the agent. The agent reads
     \`comments:\` and acts on each entry.

  2. Agent flagging uncertainty for a human. The agent writes one or
     more comments into the front matter, then opens the file with
     \`sdoc <file> --comment\` so the user sees the annotations rendered
     beside the relevant blocks.

OPENING IN COMMENT MODE
  sdoc <file> --comment       Open in comment mode (or --mode comment)

  Comment mode shows a gutter "+" button beside every top-level block
  for adding new comments, and renders existing comments as yellow
  sidecar cards beneath their anchored blocks.

TWO INPUT FORMATS
  SDocs accepts comments in two interchangeable formats. Both render
  identically in comment mode. Pick whichever is more natural for the
  context:

  1. Markdown footnote format (RECOMMENDED FOR AGENTS).
     Standard markdown footnote syntax. The agent edits the body,
     adding [^cN] markers where the comment anchors. No counting of
     element indices required — anchoring is positional, computed
     from the marker's position in the body.

  2. YAML front-matter format.
     The canonical on-disk store. Used by the SDocs UI and round-trip
     export. Comments live as a structured list under \`comments:\`.

  At load time, SDocs parses both: footnote markers are lifted out of
  the body and merged with the YAML list. On save (round-trip export),
  comments are normalised to YAML.

AUTHORING VIA MARKDOWN FOOTNOTES
  Recommended path for agents that produce text. No tag:n counting,
  no block_text, just standard markdown. Two patterns:

  Inline (anchor a specific phrase):
    Wrap the phrase in [phrase][^cN] and add the definition at the
    end of the document.

      The migration was [implemented in three weeks][^c1] this quarter.

      [^c1]: agent - actually slipped to five weeks

  Block (anchor an entire paragraph or heading):
    Place a lone [^cN] at the end of the block (after the closing
    period) and add the definition at the end.

      The reliability picture was equally encouraging.[^c2]

      [^c2]: agent - need to specify what "incident-free" means

  Definitions support optional author and a [resolved] marker:
    [^c3]: priya [resolved] - already addressed
    [^c4]: agent - check Q2 numbers (block p:5)

  Only footnote ids matching the cN pattern (c1, c2, ...) are treated
  as comments. Other footnote ids (e.g. [^citation1]) keep standard
  footnote semantics.

  This format renders sensibly in any markdown viewer — refs as
  superscripts, definitions at the bottom — so the file is useful
  outside SDocs too.

COMMENT KINDS
  block   Anchored to an entire block element (paragraph, heading,
          list, code block, table, blockquote).
  inline  Anchored to a specific text span within a block.

THE BLOCK ID SCHEME
  Both kinds carry a \`block\` field of the form "tag:n":
    - tag is the lowercased HTML element name (p, h1, h2, h3, h4,
      ul, ol, pre, blockquote, table, plus "chart" for chart blocks).
    - n is the 0-indexed position of that element among siblings of
      the same tag, in render order across the entire document.

  Examples:
    "h2:0"    First <h2> in the document.
    "p:3"     Fourth <p> in render order (ignores headings/lists).
    "ul:0"    First unordered list.
    "pre:1"   Second code block.

  Per-tag-type indexing is more resilient to reordering than a single
  global ordinal, but indices still drift if blocks of the same type
  are inserted upstream. See "Survival hints" below.

SCHEMA — A FULLY-POPULATED EXAMPLE
  ---
  title: "Q2 Roadmap (Draft)"
  # Comments: block "tag:n" = nth (0-indexed) <tag> in render order.
  # block kind may carry block_text (first ~60 chars) as a survival hint when the index drifts.
  # inline kind anchors via quote (+ optional prefix/suffix). resolved: true marks addressed.
  comments:
    - id: c1
      kind: block
      block: "h2:0"
      block_text: "Context"
      author: priya
      color: "#ffbb00"
      at: "2026-04-22T09:14:00Z"
      text: "rename this to 'Where Q1 left us' — sharper"
    - id: c2
      kind: inline
      quote: "shipped on time"
      prefix: "every committed feature "
      suffix: " and within budget"
      block: "p:0"
      author: priya
      color: "#ffbb00"
      at: "2026-04-22T09:15:00Z"
      text: "auth migration slipped 2 weeks — please correct"
    - id: c3
      kind: block
      block: "p:5"
      block_text: "Cost discipline becomes more visible in Q2"
      author: priya
      color: "#ffbb00"
      at: "2026-04-22T09:24:00Z"
      text: "align the $180k figure with finance before publishing"
      resolved: true
  ---

  # Q2 Roadmap (Draft)
  ## Context
  Q1 closed strong: every committed feature shipped on time and within budget...

FIELDS
  Required for both kinds:
    id        Stable identifier. Convention: c1, c2, c3...
    kind      "block" or "inline"
    text      The reviewer's note (the comment body).

  Required for inline:
    quote     The exact text span in the rendered body to highlight.

  Optional but recommended:
    block         The "tag:n" anchor. Used as a fast lookup. Optional
                  for inline (the quote alone is enough), required for
                  block (it's the only anchor).
    block_text    For block kind only. The first ~60 characters of
                  the block's plain text at the time of writing.
                  Survival hint: when "tag:n" no longer matches (the
                  document was edited and indices drifted), readers
                  fall back to scanning for a block whose start
                  matches block_text.
    prefix        For inline kind. Up to 60 chars of the rendered
                  text immediately before the quote, used to
                  disambiguate when the quote appears multiple times.
    suffix        Same as prefix but for the text immediately after.
    resolved      true if the comment has been addressed. Preserved
                  for audit; readers should skip resolved comments
                  when generating action lists.
    author        Display name on the rendered card. Default: "user".
    color         Card tint, hex (#rrggbb). Default: "#ffbb00" (yellow).
    at            ISO 8601 timestamp. Default: now (browser side).

ID GENERATION
  Use c1, c2, c3... in chronological order. To pick the next id, take
  the highest cN currently in the file and add 1. Don't reuse ids of
  deleted comments — gaps are fine. Non-cN ids are tolerated but lose
  the auto-increment guarantee.

ANCHOR RESOLUTION (HOW READERS RECOVER FROM DRIFT)
  When a tool (the SDocs renderer or another agent) loads the file,
  each comment is resolved in this order:

  Block kind:
    1. Try \`block: "tag:n"\` exactly.
    2. If found, optionally verify the resolved block's leading text
       matches \`block_text\`. If not, fall through.
    3. Search the document for any block whose first ~60 chars start
       with \`block_text\`.
    4. Give up — comment is orphaned.

  Inline kind:
    1. Find the block via \`block: "tag:n"\`.
    2. Inside that block, find \`prefix + quote + suffix\`.
    3. Fall back to \`prefix + quote + suffix\` anywhere in the body.
    4. Fall back to \`quote\` alone, anywhere in the body.
    5. Give up — comment is orphaned.

AUTHORING TIPS FOR AGENTS
  - Prefer the markdown-footnote authoring path (above). It avoids
    the index-counting work the YAML path requires and is the most
    reliable way for an LLM to write a comment that anchors correctly.
  - If you do author in YAML directly:
      - Compute "tag:n" by counting same-tag elements in render order.
        Headings, paragraphs, lists each have their own counters.
      - Counting errors are common. The fallback tiers (block_text
        for block kind, prefix/suffix or quote-only search for inline)
        will rescue an off-by-one index — but only if you populate them.
      - For block comments, ALWAYS populate block_text (first ~60 chars
        of the block's plain text).
      - For inline comments, ensure the comment is uniquely resolvable:
        either pick a long unique quote, or populate prefix/suffix.
  - To mark a comment addressed without losing audit trail, set
    \`resolved: true\` (YAML) or add \`[resolved]\` after the author
    name in the footnote definition.
  - When acting on comments, skip those marked resolved — they
    describe past work, not pending requests.
`;

const SCHEMA = `
SDocs — Styles Schema
=====================
All style values live under the \`styles:\` key in YAML front matter.
Every property is optional — omit anything you want left at its default.

GENERAL
  fontFamily    string   Any of the supported fonts (see FONTS below)
                         Default: "Inter"
  baseFontSize  number   Base font size in px. All rem/em values scale from this.
                         Default: 16
  background    string   Page background color (hex).
                         Default: "#ffffff" (light) / "#2c2a26" (dark)
  color         string   Master body text color (hex). Cascades to headings,
                         paragraphs, and lists unless those are overridden.
                         Default: "#1c1917"
  lineHeight    number   Global line-height multiplier.
                         Default: 1.75

HEADINGS  (general heading controls)
  headers:
    scale         number  Relative size multiplier applied across all heading levels.
                          Default: 1.0
    marginBottom  number  Space below headings (em). Default: 0.4
    color         string  Heading color — cascades to h1/h2/h3/h4 unless overridden.
                          Default: inherits \`color\`

PER-HEADING  (each independently overrides the heading defaults above)
  h1: { fontSize: number, color: string, fontWeight: number }
  h2: { fontSize: number, color: string, fontWeight: number }
  h3: { fontSize: number, color: string, fontWeight: number }
  h4: { fontSize: number, color: string, fontWeight: number }

  fontSize is in rem (relative to baseFontSize).
  Sensible defaults: h1 2.2, h2 1.55, h3 1.2, h4 1.0
  fontWeight: 400 (regular) · 600 (semibold) · 700 (bold)

PARAGRAPH
  p:
    lineHeight    number  Line height for body paragraphs. Default: 1.75
    marginBottom  number  Space between paragraphs (em). Default: 1.1
    color         string  Paragraph text color. Default: inherits \`color\`

LISTS
  list:
    color         string  Color for list items and bullet/number markers.
                          Default: inherits paragraph color

LINKS
  link:
    color       string   Link color. Default: "#2563eb"
    decoration  string   "underline" | "none". Default: "underline"

CODE
  code:
    fontFamily  string   Monospace font. Default: "ui-monospace, monospace"
    background  string   Inline/block code background color. Default: "#F1EDE8"
    padding     number   Inline code padding (em). Default: 0.2

BLOCKQUOTE
  blockquote:
    borderColor  string  Left border accent color. Default: "#2563eb"
    borderWidth  number  Left border thickness (px). Default: 3
    background   string  Quote background color. Default: "#f7f5f2"
    color        string  Quote text color. Default: "#6b6560"

BLOCKS (shared styling for code, blockquote, and chart blocks)
  blocks:
    background  string  Background for all block types. Cascades to code,
                        blockquote, and chart backgrounds unless overridden.
    color       string  Text color for all block types. Cascades to code,
                        blockquote, and chart text unless overridden.

CHARTS
  chart:
    accent      string  Palette base color (hex). Default: "#3b82f6"
    palette     string  Palette mode. Default: "monochrome"
                        Options: monochrome, complementary, analogous, triadic,
                        pastel, warm, cool, earth
    background  string  Chart background. Default: inherits blocks.background
    textColor   string  Chart labels/axes. Default: inherits blocks.color

  Run \`sdoc charts\` for the full chart reference — chart types, JSON
  format, axis/legend/annotation options, and per-chart styling overrides.

COLOR CASCADE
  Colors cascade from general → specific:
    color  →  headers.color  →  h1.color, h2.color, h3.color, h4.color
    color  →  p.color        →  list.color
    blocks.background  →  code.background, blockquote.background, chart.background
    blocks.color       →  code.color, blockquote.color, chart.textColor
  Set a child color only when you want it to differ from its parent.

THEME COLORS
  Top-level colors are light-mode colors. Dark mode is auto-generated
  by inverting lightness (same hue, flipped brightness). Light backgrounds
  become dark, dark text becomes light. Colors already very dark (like a
  dark code block background) are kept as-is.

  This means you only need to specify colors ONCE:

  ---
  styles:
    color: "#2d1810"
    background: "#fdf6f0"
    headers: { color: "#8b2500" }
    blocks:
      background: "#f5e6d8"
      color: "#5a3e2e"
  ---

  Dark mode will automatically get inverted versions of all colors above.

  To override specific dark-mode colors, add a \`dark:\` block:

  ---
  styles:
    color: "#2d1810"
    background: "#fdf6f0"
    blocks:
      background: "#f5e6d8"
    dark:
      background: "#1a1210"
      blocks:
        background: "#2a1a1a"
  ---

  Non-color properties (fonts, sizes, spacing, weights) remain at the
  top level and are shared across both themes.

FONTS (24 supported, loaded lazily from Google Fonts)
  Inter · Roboto · Open Sans · Lato · Montserrat · Source Sans 3
  Oswald · Raleway · Poppins · Merriweather · Ubuntu · Nunito
  Playfair Display · Roboto Slab · PT Sans · Lora · Mulish · Noto Sans
  Rubik · Dosis · Josefin Sans · PT Serif · Libre Franklin · Crimson Text

EXAMPLE — editorial article with colored heading tiers
  ---
  styles:
    fontFamily: Lora
    baseFontSize: 17
    background: "#fffaf5"
    color: "#1a1a2e"
    h1: { fontSize: 2.3, fontWeight: 700, color: "#c0392b" }
    h2: { fontSize: 1.55, fontWeight: 600, color: "#8e44ad" }
    h3: { fontSize: 1.2, fontWeight: 600, color: "#16a085" }
    p: { lineHeight: 1.9, marginBottom: 1.2 }
    link: { color: "#e67e22" }
    blocks:
      background: "#faf0eb"
    blockquote: { borderColor: "#c0392b", color: "#7f8c8d" }
    dark:
      background: "#1a1520"
      h1: { color: "#ef6f5e" }
      h2: { color: "#c490e4" }
      blockquote: { borderColor: "#ef6f5e" }
  ---
`;

const CHARTS_HELP = `
SDocs — Charts
==============
Render beautiful charts in markdown using \`\`\`chart code blocks.
Charts are powered by Chart.js, loaded lazily from CDN only when needed.

BASIC SYNTAX
  Wrap a JSON object in a \`\`\`chart fenced code block:

  \`\`\`chart
  {
    "type": "bar",
    "title": "Monthly Revenue",
    "labels": ["Jan", "Feb", "Mar"],
    "values": [100, 150, 130]
  }
  \`\`\`

CHART TYPES
  pie              Circular segments (use "color" for monochrome shading)
  doughnut         Hollow-center pie (alias: donut)
  bar              Vertical bars
  horizontal_bar   Horizontal bars (alias: hbar)
  stacked_bar      Stacked vertical bars
  line             Line graph with data points
  area             Line with filled area beneath
  stacked_area     Multiple filled areas stacked (alias: stacked_line)
  radar            Spider/web chart for multi-axis comparison
  polarArea        Like pie but equal angles, varying radius
  scatter          X/Y point plots
  bubble           Like scatter with size dimension
  mixed            Combo chart — bar + line on same plot (alias: combo)

DATA FORMATS
  Simple (single dataset):
    "labels": ["A", "B", "C"],
    "values": [10, 20, 15]

  Multi-dataset:
    "labels": ["Q1", "Q2"],
    "datasets": [
      { "label": "2024", "values": [10, 20] },
      { "label": "2025", "values": [12, 25] }
    ]

  Scatter/Bubble:
    "datasets": [
      { "label": "Group", "data": [{"x": 1, "y": 2}, {"x": 3, "y": 5}] }
    ]

CHART OPTIONS
  title           string     Chart heading
  subtitle        string     Smaller text below title
  labels          string[]   Category labels
  values          number[]   Data for a single dataset
  datasets        array      Multiple datasets (see above)
  color           string     Single accent color (hex)
  colors          string[]   Per-segment/bar custom colors

AXIS OPTIONS
  xAxis / xLabel  string     X-axis label
  yAxis / yLabel  string     Y-axis label
  y2Axis          string     Right y-axis label (enables dual axis)
  min             number     Minimum value on value axis
  max             number     Maximum value on value axis
  stepSize        number     Tick interval
  beginAtZero     boolean    Default true. Set false for auto-range.

NUMBER FORMATTING
  format          string     "currency" ($), "euro" (€), "pound" (£),
                             "percent" (%), "comma" (1,000)
  prefix          string     Custom value prefix (e.g. "£")
  suffix          string     Custom value suffix (e.g. " kg", "°C")
  y2Format        string     Format for right y-axis
  y2Prefix        string     Prefix for right y-axis
  y2Suffix        string     Suffix for right y-axis

DISPLAY OPTIONS
  legend          boolean    Show/hide legend (auto by default)
  legendPosition  string     "top", "bottom" (default), "left", "right"
  dataLabels      boolean    Show values on chart (default true). Set false for clean look.
  aspectRatio     number     Width/height ratio (e.g. 2 for wide, 0.8 for tall)
  stacked         boolean    Force stacking on bar/line charts

DATASET OPTIONS (inside each dataset object)
  label           string     Name shown in legend
  values          number[]   Data points
  data            object[]   For scatter: [{x, y}], for bubble: [{x, y, r}]
  color           string     Dataset color (hex)
  colors          string[]   Per-bar colors within dataset
  type            string     Override type in mixed charts ("bar" or "line")
  yAxisID         string     "y" (left) or "y2" (right) for dual-axis charts
  fill            boolean    Fill area under line
  tension         number     Line smoothing (0 = straight, 0.4 = smooth)
  order           number     Draw order (lower = rendered on top)

ANNOTATIONS (reference lines)
  "annotations": [
    { "y": 60, "label": "Target", "color": "#ef4444" },
    { "x": "Mar", "label": "Launch", "dashed": true }
  ]

  y / x           number/string   Position of the reference line
  label           string          Text label on the line
  color           string          Line color
  width           number          Line thickness (default 2)
  dashed          boolean         Dashed style (default true)
  position        string          Label position: "start", "center", "end"

CHART STYLING (via front matter or style panel)
  Charts inherit background and text colors from the block cascade:

  ---
  styles:
    blocks:
      background: "#1a1a2e"     # all blocks: code, blockquote, charts
      color: "#c8c3bc"          # text in all blocks
    chart:
      accent: "#6366f1"         # palette base color
      palette: monochrome       # palette generation mode
      background: "#0e4a1a"     # override blocks.background for charts only
      textColor: "#c8f0d8"      # override blocks.color for charts only
  ---

  COLOR CASCADE FOR BLOCKS
    blocks.background  →  code.background, blockquote.background, chart.background
    blocks.color       →  code.color, blockquote.color, chart.textColor
    Set a child value only when you want it to differ from the parent.

  DARK MODE
    All colors auto-generate dark-mode counterparts (lightness inverted).
    Add a \`dark:\` block to override specific values:
      dark:
        blocks:
          background: "#2a1a1a"

  PALETTE MODES
    monochrome      Same hue, varying lightness (default)
    complementary   Hues spread evenly around the color wheel
    analogous       Neighboring hues for a harmonious feel
    triadic         Three base hues 120° apart
    pastel          Soft, light colors
    warm            Reds, oranges, yellows
    cool            Blues, teals, purples
    earth           Browns, olives, muted greens

  Per-chart override: set "accent" and/or "palette" directly in the chart JSON.
  Per-chart colors: set "colors": ["#hex", ...] to override the palette entirely.
  Single-color pie: set "color": "#hex" on a pie/doughnut for monochrome shading.

MIXED CHART EXAMPLE (dual y-axis)
  \`\`\`chart
  {
    "type": "mixed",
    "title": "Revenue vs Growth",
    "labels": ["Q1", "Q2", "Q3", "Q4"],
    "datasets": [
      { "label": "Revenue", "type": "bar", "values": [50, 65, 80, 95], "yAxisID": "y" },
      { "label": "Growth", "type": "line", "values": [12, 30, 23, 19], "yAxisID": "y2" }
    ],
    "yAxis": "Revenue ($M)",
    "y2Axis": "Growth %",
    "format": "currency",
    "y2Format": "percent"
  }
  \`\`\`
`;

const DIAGRAMS_HELP = `
SDocs — Diagrams
================
Render Mermaid diagrams in markdown using \`\`\`mermaid code blocks.
Mermaid is loaded lazily from CDN only when a diagram is present.

BASIC SYNTAX
  \`\`\`mermaid
  graph TD
    A[Start] --> B{Decision}
    B -- yes --> C[Do this]
    B -- no  --> D[Do that]
  \`\`\`

STANDALONE .mmd FILES
  \`sdoc graph.mmd\` works like \`sdoc file.md\` - the CLI wraps the
  contents in a \`\`\`mermaid fence before opening. Same for share:
  \`sdoc share graph.mmd\`. \`.mermaid\` files work the same way.

SUPPORTED DIAGRAM TYPES
  flowchart / graph         flowchart TD, LR, etc.
  sequenceDiagram           interaction sequences
  classDiagram              UML-style class relationships
  stateDiagram-v2           state machines
  erDiagram                 entity-relationship
  gantt                     timelines
  pie                       proportional breakdown
  journey                   user-journey diagrams
  gitGraph                  git history visualisation
  mindmap                   mind maps
  timeline                  chronological events
  quadrantChart             2x2 matrix
  sankey-beta               flow diagrams
  See https://mermaid.js.org for the full syntax reference.

THEMING
  Diagrams inherit colors from the SDocs blocks cascade:

    \`\`\`yaml
    styles:
      blocks:
        background: "#f4f1ed"   # diagram wrapper bg
        color: "#6b6560"        # node text / lines
    \`\`\`

  In dark mode the inverted block colors apply automatically.
  For finer-grained control, set Mermaid theme variables in the
  diagram source itself, but note that \`%%{init:...}%%\` directives
  are stripped by SDocs as a security measure (they can otherwise
  override sanitisation settings at parse time).

LIMITS
  - Per-diagram source cap: 64 KB.
  - Per-document diagram cap: 50 (excess rendered as plain code).
  - Per-render timeout: 5 seconds (large or pathological graphs error out).

SECURITY
  Mermaid runs with \`securityLevel: 'strict'\` and \`htmlLabels: true\`.
  htmlLabels lets long node labels wrap inside a \`<foreignObject>\`,
  which is otherwise a script-injection vector; SDocs makes that safe
  by post-sanitising the SVG before render. \`<script>\`, \`<iframe>\`,
  \`<form>\`, \`<input>\`, \`<use>\`, animation tags, \`on*\` event handlers
  and \`javascript:\` URLs are stripped (inside foreignObject and out).
  Source caps and a render timeout cover the DoS surface. Treat diagram
  source as untrusted - it travels in the URL hash with the rest of
  the document.

EXAMPLE
  \`\`\`mermaid
  sequenceDiagram
    participant U as User
    participant S as SDocs
    participant C as CDN
    U->>S: open page with diagram
    S->>C: load mermaid.min.js (lazy, first time only)
    C-->>S: script
    S->>S: render() → SVG
    S->>U: paint diagram
  \`\`\`
`;

// ── Compression (brotli + base64url) ─────────────────

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - b64.length % 4) % 4;
  b64 += '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}

function compressToBase64Url(text) {
  const compressed = zlib.brotliCompressSync(Buffer.from(text, 'utf-8'), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
  return toBase64Url(compressed);
}

function decompressFromBase64Url(b64url) {
  const buf = fromBase64Url(b64url);
  // Try brotli first, fall back to deflate for old URLs.
  // Treat empty output from non-trivial input as failure (matches browser).
  try {
    const out = zlib.brotliDecompressSync(buf);
    if (out.length > 0 || buf.length <= 2) return out.toString('utf-8');
  } catch (_) {}
  return zlib.inflateRawSync(buf).toString('utf-8');
}

// ── Short-link encrypt + upload (AES-GCM, client-held key) ─

// Compress with brotli, then encrypt with AES-256-GCM. Returns
// { keyBytes, cipherB64url } where keyBytes never leaves this process.
// The blob format (nonce(12) + ciphertext + tag(16)) matches the browser.
function compressAndEncrypt(content) {
  const compressed = zlib.brotliCompressSync(Buffer.from(content, 'utf-8'), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
  const keyBytes = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, nonce);
  const ct = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([nonce, ct, tag]);
  return { keyBytes, cipherB64url: toBase64Url(blob) };
}

function uploadShortLink(ciphertextB64, baseUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL('/api/short', baseUrl);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = JSON.stringify({ ciphertext: ciphertextB64 });
    const req = mod.request({
      method: 'POST',
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(body); } catch (_) { json = null; }
        if (res.statusCode >= 200 && res.statusCode < 300 && json && json.id) {
          resolve(json.id);
        } else {
          const err = (json && json.error) || ('http_' + res.statusCode);
          reject(new Error(err));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function buildShortUrl(content, opts) {
  if (!content) throw new Error('short link requires file content');

  // Mirror the hash-build's default-stripping so the encrypted payload is
  // identical to what the browser would encode.
  const parsed = SDocYaml.parseFrontMatter(content);
  if (parsed.meta && parsed.meta.styles) {
    const stripped = SDocStyles.stripStyleDefaults(parsed.meta.styles);
    if (Object.keys(stripped).length > 0) parsed.meta.styles = stripped;
    else delete parsed.meta.styles;
    content = SDocYaml.serializeFrontMatter(parsed.meta) + '\n' + parsed.body;
  }

  const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
  const { keyBytes, cipherB64url } = compressAndEncrypt(content);
  const id = await uploadShortLink(cipherB64url, baseUrl);
  const keyB64 = toBase64Url(keyBytes);

  const params = new URLSearchParams();
  params.set('k', keyB64);
  const mode = opts.mode;
  if (mode && mode !== 'read') params.set('mode', mode);
  if (opts.theme) params.set('theme', opts.theme);
  if (opts.section) params.set('sec', slugify(opts.section));

  return `${baseUrl}/s/${id}#${params.toString()}`;
}

// ── Slugify (shared module) ───────────────────────────────

var slugify = require('../public/sdocs-slugify').slugify;

// ── sdoc safe: verify frontend hashes + point agents at the server source ──
//
// 1. Asks the SDocs host what commit it is running (/trust/manifest, .commit).
// 2. Fetches the authoritative fingerprint list for that commit from GitHub
//    (raw.githubusercontent.com/.../trust-manifests/<sha>.json), published on
//    every push to main by .github/workflows/publish-manifest.yml.
// 3. Downloads each file from the host, hashes it with SHA-256, compares to
//    GitHub's list.
// Bytes come from the host. Fingerprints come from GitHub. The host cannot
// produce a match it did not already publish to GitHub.
//
// Server-side code (request handling, storage) still cannot be verified by
// hashing. With --audit, the command prints direct GitHub links to the files
// an agent should read to review that part.

// Server-side files that a curious human or agent needs to read to audit
// what `sdoc safe` cannot prove by hashing. Kept small on purpose: these
// are the only files that touch server-side request handling.
const AUDIT_SOURCE_FILES = [
  'server.js',
  'short-links/db.js',
  'short-links/rate-limit.js',
  'analytics/db.js',
  'analytics/query.js',
];

const TRUST_RAW_BASE = 'https://raw.githubusercontent.com/espressoplease/SDocs/trust-manifests';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    mod.get(u, { timeout: 8000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        res.resume();
        return;
      }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('invalid JSON from ' + url)); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    mod.get(u, { timeout: 15000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => { chunks.push(c); });
      res.on('end', () => { resolve(Buffer.concat(chunks)); });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

async function runSafe(opts) {
  const base = (opts.url || process.env.SDOCS_URL || DEFAULT_URL).replace(/\/$/, '');
  const jsonOut = !!opts.jsonFlag;
  const audit = !!opts.auditFlag;
  const rawBase = (opts.rawBase || process.env.SDOCS_TRUST_RAW || TRUST_RAW_BASE).replace(/\/$/, '');

  // Step 1: learn the commit the host reports.
  let serverReport;
  try {
    serverReport = await fetchJson(base + '/trust/manifest');
  } catch (e) {
    if (jsonOut) { console.log(JSON.stringify({ ok: false, error: 'server_fetch_failed', message: e.message })); }
    else { console.error('sdoc safe: could not fetch ' + base + '/trust/manifest - ' + e.message); }
    process.exit(2);
  }
  const commit = serverReport.commit;
  if (!commit || commit === 'unknown') {
    if (jsonOut) { console.log(JSON.stringify({ ok: false, error: 'no_commit_reported' })); }
    else { console.error('sdoc safe: host did not report a commit.'); }
    process.exit(2);
  }

  // Step 2: pull the authoritative fingerprint list from GitHub for that commit.
  const manifestUrl = rawBase + '/' + commit + '.json';
  let manifest;
  try {
    manifest = await fetchJson(manifestUrl);
  } catch (e) {
    const pending = /HTTP 404/.test(e.message);
    if (jsonOut) {
      console.log(JSON.stringify({
        ok: false,
        error: pending ? 'manifest_not_yet_published' : 'manifest_fetch_failed',
        host: base, commit, manifestUrl, message: e.message,
      }));
    } else if (pending) {
      console.error('sdoc safe: no fingerprint list published on GitHub for commit ' + commit.slice(0, 7) + ' yet.');
      console.error('           (publish-manifest.yml runs on push to main; give it a minute.)');
      console.error('           looked for: ' + manifestUrl);
    } else {
      console.error('sdoc safe: could not fetch ' + manifestUrl + ' - ' + e.message);
    }
    process.exit(pending ? 2 : 3);
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    if (jsonOut) { console.log(JSON.stringify({ ok: false, error: 'manifest_has_no_files', manifestUrl })); }
    else { console.error('sdoc safe: GitHub manifest at ' + manifestUrl + ' has no files array.'); }
    process.exit(3);
  }

  // Step 3: hash files from the host, compare to GitHub's list.
  const results = [];
  let ok = 0, fail = 0;
  for (const file of manifest.files) {
    const fileUrl = base + '/public' + file.path;
    try {
      const buf = await fetchBuffer(fileUrl);
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      const match = got === file.sha256;
      results.push({ path: file.path, bytes: file.bytes, expected: file.sha256, got, match });
      if (match) ok++; else fail++;
    } catch (e) {
      results.push({ path: file.path, bytes: file.bytes, expected: file.sha256, error: e.message, match: false });
      fail++;
    }
  }

  const repo = manifest.repo || 'https://github.com/espressoplease/SDocs';
  const auditLinks = audit ? AUDIT_SOURCE_FILES.map(f => ({
    file: f,
    url: repo + '/blob/' + commit + '/' + f,
  })) : null;

  if (jsonOut) {
    console.log(JSON.stringify({
      ok: fail === 0,
      host: base,
      commit,
      builtAt: manifest.builtAt,
      manifestUrl,
      totals: { ok, fail, total: results.length },
      files: results,
      audit: auditLinks,
      unverified: {
        note: 'Server-side code (request handling, storage) cannot be verified by hashing. Read the source files listed under audit to review what a malicious operator could theoretically modify.',
        files: AUDIT_SOURCE_FILES,
      },
    }, null, 2));
  } else {
    console.log('');
    console.log('  sdoc safe - verifying ' + base);
    console.log('  commit    ' + commit);
    console.log('  built at  ' + (manifest.builtAt || '?'));
    console.log('  tree      ' + repo + '/tree/' + commit);
    console.log('  list      ' + manifestUrl);
    console.log('');
    for (const r of results) {
      const glyph = r.match ? '\u2713' : '\u2717';
      const line = '  ' + glyph + ' ' + r.path.padEnd(32) + ' ' + (r.match ? 'match' : (r.error || 'MISMATCH'));
      console.log(line);
    }
    console.log('');
    if (fail === 0) {
      console.log('  \u2713 ' + ok + ' / ' + results.length + ' files match the list GitHub published for this commit.');
      console.log('    Bytes came from this host; fingerprints came from GitHub.');
    } else {
      console.log('  \u2717 ' + fail + ' / ' + results.length + ' files FAILED to match GitHub\'s list for this commit.');
      console.log('    The host is serving different bytes than GitHub published for ' + commit.slice(0, 7) + '.');
    }
    console.log('');
    console.log('  What this does not prove:');
    console.log('    Server-side request handling cannot be verified by hashing alone.');
    console.log('    The only way to audit it is to read the source. Start here:');
    console.log('');
    for (const f of AUDIT_SOURCE_FILES) {
      console.log('    ' + repo + '/blob/' + commit + '/' + f);
    }
    console.log('');
    if (!audit) {
      console.log('  Re-run with --audit for machine-readable audit pointers, or --json for full output.');
      console.log('');
    }
  }

  process.exit(fail === 0 ? 0 : 1);
}

// ── Parse args ────────────────────────────────────────────

const SUBCOMMANDS = new Set(['new', 'share', 'schema', 'defaults', 'help', 'charts', 'diagrams', 'comments', 'setup', 'safe', 'auto-update']);

function parseArgs(argv) {
  const args = argv || process.argv.slice(2);
  let file = null;
  let mode = null;
  let url = null;
  let subcommand = null;
  let section = null;
  let theme = null;
  let resetFlag = false;
  let shortFlag = false;
  let jsonFlag = false;
  let auditFlag = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Legacy / shortcut flags that map to subcommands
    if (arg === '--help' || arg === '-h') { subcommand = 'help'; continue; }
    if (arg === '--schema')               { subcommand = 'schema'; continue; }

    // Mode shorthand flags
    if (arg === '--write')   { mode = 'write'; continue; }
    if (arg === '--style')   { mode = 'style'; continue; }
    if (arg === '--raw')     { mode = 'raw';   continue; }
    if (arg === '--read')    { mode = 'read';  continue; }
    if (arg === '--comment') { mode = 'comment'; continue; }
    if (arg === '--light')   { theme = 'light'; continue; }
    if (arg === '--dark')    { theme = 'dark';  continue; }

    // Long-form --mode
    if (arg === '--mode' || arg === '-m') {
      mode = args[++i];
      if (!['read', 'write', 'style', 'raw', 'comment'].includes(mode)) {
        console.error(`sdoc: unknown mode "${mode}" — use read, write, style, raw, or comment`);
        process.exit(1);
      }
      continue;
    }

    // --url flag
    if (arg === '--url') { url = args[++i]; continue; }

    // --section flag
    if (arg === '--section' || arg === '-s') { section = args[++i]; continue; }

    // --reset flag (for defaults subcommand)
    if (arg === '--reset') { resetFlag = true; continue; }

    // --short flag (share subcommand only): encrypt + upload, return /s/... URL
    if (arg === '--short') { shortFlag = true; continue; }

    // --json flag (safe subcommand): machine-readable output
    if (arg === '--json') { jsonFlag = true; continue; }

    // --audit flag (safe subcommand): also print server-side source audit links
    if (arg === '--audit') { auditFlag = true; continue; }

    // Positional: check for subcommand first, then file
    if (!subcommand && SUBCOMMANDS.has(arg)) {
      subcommand = arg;
      continue;
    }

    if (!file) { file = arg; continue; }
  }

  return { file, mode, url, subcommand, section, theme, resetFlag, shortFlag, jsonFlag, auditFlag };
}

// ── Build URL ─────────────────────────────────────────────

function buildUrl(content, opts) {
  const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
  const params = new URLSearchParams();

  // Runtime-only metadata (paths). Stripped from the URL by the browser on load,
  // so anything the user copies from the address bar won't contain them.
  if (opts.local && Object.keys(opts.local).length > 0) {
    const json = JSON.stringify(opts.local);
    const b64 = Buffer.from(json, 'utf-8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    params.set('local', b64);
  }

  if (content) {
    // Strip default style values to produce shorter URLs
    const parsed = SDocYaml.parseFrontMatter(content);
    if (parsed.meta && parsed.meta.styles) {
      const stripped = SDocStyles.stripStyleDefaults(parsed.meta.styles);
      if (Object.keys(stripped).length > 0) {
        parsed.meta.styles = stripped;
      } else {
        delete parsed.meta.styles;
      }
      content = SDocYaml.serializeFrontMatter(parsed.meta) + '\n' + parsed.body;
    }
    params.set('md', compressToBase64Url(content));
  } else if (opts.defaultStyles) {
    const stylesJson = JSON.stringify(opts.defaultStyles);
    params.set('styles', encodeURIComponent(Buffer.from(stylesJson, 'utf-8').toString('base64')));
  }

  const mode = opts.mode || (content ? 'read' : 'style');
  if (mode && mode !== 'read') params.set('mode', mode);

  if (opts.theme) params.set('theme', opts.theme);

  if (opts.section) {
    params.set('sec', slugify(opts.section));
  }

  const qs = params.toString();
  return qs ? `${baseUrl}/#${qs}` : baseUrl;
}

// ── YAML parsing (shared module) ──
const { parseSimpleYaml, parseFrontMatter, serializeFrontMatter } = SDocYaml;

// ── ~/.sdocs/styles.yaml default styles ────────────────────

function getDefaultsPath() {
  return path.join(require('os').homedir(), '.sdocs', 'styles.yaml');
}

function loadDefaultStyles() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    const yaml = fs.readFileSync(configPath, 'utf-8');
    return parseSimpleYaml(yaml);
  } catch {
    return null;
  }
}

function showDefaults() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) {
    console.log('No default styles set (~/.sdocs/styles.yaml not found).');
    console.log('\nTo set defaults, style a document in SDocs and use');
    console.log('the "Save as Default" panel to generate the command.');
    return;
  }
  console.log(fs.readFileSync(configPath, 'utf-8'));
}

function resetDefaults() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) {
    console.log('No default styles to remove.');
    return;
  }
  fs.unlinkSync(configPath);
  console.log('Removed ' + configPath);
}

// Deep merge: defaults under file styles (file wins on conflict)
// Recursive for light:/dark: sub-objects that contain nested objects
function mergeStyles(defaults, fileStyles) {
  if (!defaults) return fileStyles || {};
  if (!fileStyles) return { ...defaults };
  const merged = { ...defaults };
  for (const [k, v] of Object.entries(fileStyles)) {
    if (typeof v === 'object' && v !== null && typeof merged[k] === 'object' && merged[k] !== null) {
      // Recurse one level deeper for light/dark blocks that contain nested objects (e.g. h1: { color: ... })
      const inner = { ...merged[k] };
      for (const [ik, iv] of Object.entries(v)) {
        if (typeof iv === 'object' && iv !== null && typeof inner[ik] === 'object' && inner[ik] !== null) {
          inner[ik] = { ...inner[ik], ...iv };
        } else {
          inner[ik] = iv;
        }
      }
      merged[k] = inner;
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

// Apply default styles to content, returning modified content
function applyDefaultStyles(content) {
  const defaults = loadDefaultStyles();
  if (!defaults) return content;

  const { meta, body } = parseFrontMatter(content);
  const mergedStyles = mergeStyles(defaults, meta.styles);
  const newMeta = { ...meta, styles: mergedStyles };
  return serializeFrontMatter(newMeta) + '\n' + body;
}

// ── Read content ───────────────────────────────────────────

async function readContent(file) {
  if (file) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`sdoc: file not found: ${file}`);
      process.exit(1);
    }
    var raw = fs.readFileSync(resolved, 'utf-8');
    // .mmd / .mermaid files (standalone Mermaid sources) are wrapped in a
    // fenced block so the renderer picks them up. No special CLI path needed.
    if (/\.(mmd|mermaid)$/i.test(file)) {
      raw = '```mermaid\n' + raw.replace(/\s+$/, '') + '\n```\n';
    }
    return raw;
  }

  // Check if stdin has data (piped input)
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }

  return null; // no content — just open studio
}

// ── Open browser ───────────────────────────────────────────

function openBrowser(url) {
  try {
    if (process.platform === 'darwin')      execFileSync('open', [url]);
    else if (process.platform === 'win32')  execFileSync('cmd', ['/c', 'start', '', url]);
    else                                    execFileSync('xdg-open', [url]);
  } catch {
    console.log(`Open in browser: ${url}`);
  }
}

// ── Main ───────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const opts = parseArgs();

    // Subcommand dispatch
    if (opts.subcommand === 'help')   { console.log(HELP);   process.exit(0); }
    if (opts.subcommand === 'schema') { console.log(SCHEMA); process.exit(0); }
    if (opts.subcommand === 'charts') { console.log(CHARTS_HELP); process.exit(0); }
    if (opts.subcommand === 'diagrams') { console.log(DIAGRAMS_HELP); process.exit(0); }
    if (opts.subcommand === 'comments') { console.log(COMMENTS_HELP); process.exit(0); }
    if (opts.subcommand === 'setup')  { await runSetup({ force: true }); process.exit(0); }
    if (opts.subcommand === 'auto-update') {
      // Sub-arg lives in opts.file (positional). Accept on/off/empty.
      runAutoUpdateSubcommand((opts.file || '').toLowerCase());
      process.exit(0);
    }
    if (opts.subcommand === 'safe')   { await runSafe(opts); return; }
    if (opts.subcommand === 'defaults') {
      if (opts.resetFlag) resetDefaults();
      else showDefaults();
      process.exit(0);
    }
    if (opts.subcommand === 'new') {
      const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
      const url = baseUrl + '/new';
      openBrowser(url);
      console.log(`SDocs → ${url}`);
      process.exit(0);
    }

    // File / stdin handling
    let content = await readContent(opts.file);

    // Apply ~/.sdocs/styles.yaml defaults
    const defaults = loadDefaultStyles();
    if (content && defaults) {
      content = applyDefaultStyles(content);
    }

    // Inject `file:` into front matter (basename only — safe to share).
    // Respects user-set file: if already present.
    if (content && opts.file) {
      const parsed = parseFrontMatter(content);
      if (!parsed.meta.file) {
        parsed.meta.file = path.basename(opts.file);
        content = serializeFrontMatter(parsed.meta) + '\n' + parsed.body;
      }
    }

    // Runtime-only local metadata for the opener's view.
    // `share` omits it so shared URLs never carry paths.
    let local = null;
    if (opts.file && opts.subcommand !== 'share') {
      const abs = path.resolve(opts.file);
      const rel = path.relative(process.cwd(), abs);
      local = { fullPath: abs };
      // Only include a relative path if the file is inside cwd, otherwise
      // `path` would just duplicate `fullPath`.
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        local.path = './' + rel;
      }
    }

    let url;
    if (opts.shortFlag) {
      if (opts.subcommand !== 'share') {
        console.error('sdoc: --short is only valid with the `share` subcommand');
        process.exit(1);
      }
      if (!content) {
        console.error('sdoc: --short needs content (a file path or piped stdin)');
        process.exit(1);
      }
      try {
        url = await buildShortUrl(content, {
          url: opts.url,
          mode: opts.mode,
          theme: opts.theme,
          section: opts.section,
        });
      } catch (e) {
        console.error('sdoc: could not create short link -', e.message);
        process.exit(1);
      }
    } else {
      url = buildUrl(content, {
        url: opts.url,
        mode: opts.mode,
        theme: opts.theme,
        defaultStyles: !content ? defaults : null,
        section: opts.section,
        local: local,
      });
    }

    // Share: copy to clipboard
    if (opts.subcommand === 'share') {
      try {
        const clip = process.platform === 'darwin' ? 'pbcopy'
          : execSync('which xclip 2>/dev/null', { encoding: 'utf-8' }).trim() ? 'xclip -selection clipboard'
          : 'xsel --clipboard --input';
        execSync(clip, { input: url, stdio: ['pipe', 'ignore', 'ignore'] });
        const name = opts.file ? path.basename(opts.file) : 'stdin';
        const label = opts.shortFlag ? 'Short link' : 'Link';
        console.log(`\u2713 ${label} for ${name} copied to clipboard`);
        if (opts.shortFlag) console.log(`  ${url}`);
      } catch (_) {
        process.stdout.write(url + '\n');
      }
      refreshUpdateCache();
      await maybeUpdateBinary();
      await runSetup();
      await maybeAutoRefresh();
      return;
    }

    // Default: open browser
    openBrowser(url);
    console.log(`SDocs → ${url.length > 80 ? url.slice(0, 77) + '...' : url}`);
    refreshUpdateCache();
    await maybeUpdateBinary();
    await runSetup();
    await maybeAutoRefresh();
  })().catch(e => {
    console.error('sdoc:', e.message);
    process.exit(1);
  });
}

// ── Exports (for tests) ───────────────────────────────────

module.exports = {
  mergeStyles,
  applyDefaultStyles,
  parseFrontMatter,
  serializeFrontMatter,
  parseSimpleYaml,
  parseArgs,
  buildUrl,
  slugify,
  compressToBase64Url,
  decompressFromBase64Url,
  compressAndEncrypt,
  uploadShortLink,
  buildShortUrl,
  // Agent block (pure functions for tests)
  AGENT_BLOCK_VERSION,
  AGENT_BLOCK_BODY,
  formatAgentBlock,
  findBookendedBlock,
  findLegacyBlock,
  refreshContent,
  compareVersions,
  migrateSetupState,
};
