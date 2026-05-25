// Filesystem walker for the library. Walks one or more roots, returning
// the absolute paths of .md files that pass the size cap and ignore
// rules. Pure: takes config and returns files; doesn't touch the index.
//
// For v1 we walk everything. Mtime-based shortcuts can come once it
// proves slow in practice.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ephemeral = require('./library-ephemeral');
const paths     = require('./library-paths');

const DEFAULT_MAX_SIZE = 1 * 1024 * 1024;

const DIRNAME_BLOCKLIST = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'vendor',
  '.venv',
  '.next',
  '.cache',
  '__pycache__',
  'target',
  '.gradle',
  '.idea',
  '.vscode',
  '.DS_Store',
  '.Trash',
]);

function systemSkipPaths() {
  const home = os.homedir();
  const out = new Set();
  if (process.platform === 'darwin') {
    out.add('/Applications');
    out.add('/System');
    out.add('/Library');
    out.add('/usr');
    out.add('/private');
    out.add(path.join(home, 'Library'));
  } else if (process.platform === 'linux') {
    out.add('/usr');
    out.add('/var');
    out.add('/etc');
    out.add('/proc');
    out.add('/sys');
    out.add('/boot');
    out.add(path.join(home, '.local'));
    out.add(path.join(home, '.config'));
  } else if (process.platform === 'win32') {
    out.add('C:\\Program Files');
    out.add('C:\\Program Files (x86)');
    out.add('C:\\Windows');
    out.add(path.join(home, 'AppData'));
  }
  return out;
}

function shouldSkipDir(absDir, base, skipSet, exemptRoots) {
  if (base.startsWith('.') && base !== '.' && base !== '..') return true;
  if (DIRNAME_BLOCKLIST.has(base)) return true;
  if (skipSet.has(absDir)) return true;
  // Skip ephemeral paths during descent unless we're inside a root that
  // the caller explicitly named (in which case they want it scanned).
  if (ephemeral.isEphemeralPath(absDir) && !insideAnyRoot(absDir, exemptRoots)) return true;
  if (absDir === paths.root() || absDir.startsWith(paths.root() + path.sep)) return true;
  return false;
}

function insideAnyRoot(absDir, roots) {
  if (!roots || !roots.length) return false;
  for (const r of roots) {
    if (absDir === r || absDir.startsWith(r + path.sep)) return true;
  }
  return false;
}

function defaultRoots() {
  return [os.homedir()];
}

// Walk synchronously and accumulate matches. Cheap enough for personal
// libraries; we'll revisit if a user reports a slow scan.
function scan({ roots, excludes, maxFileSize } = {}) {
  const rootsToWalk = (roots && roots.length ? roots : defaultRoots()).map(p => path.resolve(p));
  const exSet = new Set((excludes || []).map(p => path.resolve(p)));
  for (const sys of systemSkipPaths()) exSet.add(sys);
  const limit = maxFileSize || DEFAULT_MAX_SIZE;

  const found = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (!shouldSkipDir(full, ent.name, exSet, rootsToWalk)) walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!/\.(md|mdx|markdown)$/i.test(ent.name)) continue;
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (st.size > limit) continue;
      found.push({ path: full, mtime: st.mtimeMs, size: st.size });
    }
  }

  for (const r of rootsToWalk) {
    let st;
    try { st = fs.statSync(r); } catch (_) { continue; }
    if (!st.isDirectory()) continue;
    walk(r);
  }
  return found;
}

module.exports = {
  scan,
  defaultRoots,
  systemSkipPaths,
  DIRNAME_BLOCKLIST,
  DEFAULT_MAX_SIZE,
  shouldSkipDir,
};
