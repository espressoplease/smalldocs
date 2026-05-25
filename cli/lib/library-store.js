// JSON-backed library index. Crash-safe via temp-file + rename.
//
// Two files on disk:
//   ~/.sdocs/library-index.json  - entries
//   ~/.sdocs/library-state.json  - { enabled, lastScanAt }
//
// The index is a rebuildable cache; the markdown files on disk are the
// source of truth. Hence we don't bother with WAL or row-level locking
// for v1 - a corrupted index gets dropped and rebuilt by `sdoc library
// rebuild`.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const paths = require('./library-paths');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function loadState() {
  const defaults = { enabled: true, lastScanAt: 0, autostartUserDisabled: false };
  const s = readJson(paths.stateFile(), null);
  if (s && typeof s === 'object') return Object.assign(defaults, s);
  return defaults;
}

function saveState(state) {
  atomicWriteJson(paths.stateFile(), state);
}

function loadIndex() {
  const data = readJson(paths.indexFile(), null);
  if (!data || !Array.isArray(data.entries)) return { entries: [], generatedAt: 0 };
  return data;
}

function saveIndex(index) {
  atomicWriteJson(paths.indexFile(), {
    entries: index.entries,
    generatedAt: Date.now(),
  });
}

function idForPath(absPath) {
  return crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 10);
}

function upsertEntry(entry) {
  const idx = loadIndex();
  const i = idx.entries.findIndex(e => e.id === entry.id);
  if (i >= 0) {
    idx.entries[i] = Object.assign({}, idx.entries[i], entry);
  } else {
    idx.entries.push(Object.assign({ firstSeen: new Date().toISOString() }, entry));
  }
  saveIndex(idx);
  return idx.entries.find(e => e.id === entry.id);
}

function removeEntry(id) {
  const idx = loadIndex();
  const before = idx.entries.length;
  idx.entries = idx.entries.filter(e => e.id !== id);
  if (idx.entries.length !== before) saveIndex(idx);
  return before - idx.entries.length;
}

function getEntry(id) {
  return loadIndex().entries.find(e => e.id === id) || null;
}

function setStar(id, starred) {
  const idx = loadIndex();
  const e = idx.entries.find(e => e.id === id);
  if (!e) return false;
  e.starred = !!starred;
  saveIndex(idx);
  return true;
}

function clearIndex() {
  saveIndex({ entries: [] });
}

// "Is this absolute path currently in the index?" Compares the
// requested path (and, where it exists, its realpath) against each
// entry's stored path AND - for rescued entries - the path the rescue
// copy came from. The realpath check is what guards against symlink
// shenanigans (Item C): a symlink that points outside the library can
// be requested by its source path, but realpath resolves outside any
// indexed location and the lookup fails.
function isIndexed(absPath) {
  if (!absPath) return false;
  const fs = require('fs');
  const path = require('path');
  let real = absPath;
  try { real = fs.realpathSync(absPath); } catch (_) { /* not a real path - take as-is */ }
  const idx = loadIndex();
  for (const e of idx.entries) {
    if (e.path === absPath || e.path === real) return true;
    if (e.rescued && e.rescuedFrom && (e.rescuedFrom === absPath || e.rescuedFrom === real)) return true;
    // Also realpath each entry's path for the symmetric case where the
    // index stored a symlinked path. Cheap: at most a few hundred
    // entries on a typical library.
    try {
      const er = fs.realpathSync(e.path);
      if (er === absPath || er === real) return true;
    } catch (_) { /* entry path may have vanished - skip */ }
  }
  return false;
}

module.exports = {
  ensureDir,
  atomicWriteJson,
  readJson,
  loadState, saveState,
  loadIndex, saveIndex,
  upsertEntry, removeEntry, getEntry, setStar,
  clearIndex,
  idForPath,
  isIndexed,
};
