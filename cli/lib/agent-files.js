// Per-file refresh of the SDocs agent block.
//
// Operates on AGENT_TARGETS in $HOME. Atomic writes via tmp + rename,
// short-lived exclusive locks to avoid two `sdoc` runs stomping on each
// other, and a backup file beside each agent file before we modify it.
// Symlinks are skipped unless explicitly followed.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  AGENT_BLOCK_VERSION,
  AGENT_BLOCK_BODY,
  AGENT_BLOCK_LEGACY_OPEN,
  AGENT_TARGETS,
  formatAgentBlock,
  findBookendedBlock,
  refreshContent,
} = require('./agent-block');

const { AGENT_CHANGES_URL } = require('./constants');

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

// Refresh a single agent file.
// Returns { path, name?, changed, fromVersion?, toVersion?, reason?, error? }.
function refreshAgentFile(filePath, opts = {}) {
  if (!fs.existsSync(filePath))                    return { path: filePath, changed: false, reason: 'absent' };
  if (isSymlink(filePath) && !opts.followSymlinks) return { path: filePath, changed: false, reason: 'symlink' };

  const release = acquireLock(filePath);
  if (!release)                                    return { path: filePath, changed: false, reason: 'locked' };

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

module.exports = {
  detectAgents,
  fileHasBlock,
  isSymlink,
  atomicWrite,
  backupFile,
  acquireLock,
  writeBookendedBlock,
  refreshAgentFile,
  refreshAllAgentFiles,
  printRefreshSummary,
};
