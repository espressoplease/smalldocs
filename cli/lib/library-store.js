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

module.exports = {
  ensureDir,
  atomicWriteJson,
  readJson,
  loadState, saveState,
  loadIndex, saveIndex,
  upsertEntry, removeEntry, getEntry, setStar,
  clearIndex,
  idForPath,
};
