// Top-level library operations. Brings the modules together:
//   - read a markdown file
//   - extract title, body excerpt, tags, agent metadata
//   - if the file is in an ephemeral location, take a rescue copy
//   - upsert into the index
//
// Also handles the YAML front-matter edit when the CLI passes tags.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const SDocYaml      = require('../shared/sdocs-yaml.js');
const SDocLibTags   = require('../shared/sdocs-library-tags.js');

const store        = require('./library-store');
const scanner      = require('./library-scan');
const ephemeral    = require('./library-ephemeral');
const paths        = require('./library-paths');

const MAX_EXCERPT = 400;

function deriveTitle(meta, body) {
  if (meta && typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim();
  const m = (body || '').match(/^#\s+(.+?)\s*$/m);
  if (m) return m[1];
  return null;
}

function bodyExcerpt(body) {
  if (!body) return '';
  const cleaned = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
    .replace(/^#{1,6} .*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= MAX_EXCERPT) return cleaned;
  return cleaned.slice(0, MAX_EXCERPT) + '...';
}

function readFileSafe(absPath) {
  try { return fs.readFileSync(absPath, 'utf8'); } catch (_) { return null; }
}

function detectGitProject(absPath) {
  let dir = path.dirname(absPath);
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      let branch = null;
      try {
        const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
        const m = head.match(/^ref:\s+refs\/heads\/(.+)$/);
        if (m) branch = m[1];
      } catch (_) {}
      return { project: path.basename(dir), root: dir, branch };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { project: null, root: null, branch: null };
}

function ensureRescueCopy(absPath, content) {
  const dest = path.join(paths.rescuedDir(),
    crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 12) + '-' +
    path.basename(absPath));
  store.ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, content);
  return dest;
}

// Parse, merge tags, and produce a normalised entry from a file's content
// plus metadata. Pure (no fs writes), so tests can drive it directly.
function buildEntry({ absPath, content, addTags, stats, rescuedFrom = null }) {
  const parsed = SDocYaml.parseFrontMatter(content || '');
  const meta = parsed.meta || {};
  const body = parsed.body || '';

  const fmTags = Array.isArray(meta.tags) ? meta.tags : [];
  const tags = SDocLibTags.mergeTags(fmTags, addTags || []);

  const git = detectGitProject(absPath);
  const sdocsMeta = meta['sdocs-library'] && typeof meta['sdocs-library'] === 'object'
    ? meta['sdocs-library'] : {};

  return {
    id:         store.idForPath(absPath),
    path:       absPath,
    rescued:    !!rescuedFrom,
    rescuedFrom,
    title:      deriveTitle(meta, body) || path.basename(absPath, path.extname(absPath)),
    bodyExcerpt: bodyExcerpt(body),
    body:       body,
    tags:       tags,
    mtime:      stats ? new Date(stats.mtimeMs).toISOString() : new Date().toISOString(),
    size:       stats ? stats.size : (content ? Buffer.byteLength(content) : 0),
    gitProject: git.project,
    gitBranch:  git.branch,
    agent:      typeof meta.agent === 'string' ? meta.agent : sdocsMeta['agent'] || null,
    sessionId:  sdocsMeta['session-id'] || null,
    resumeCmd:  sdocsMeta['resume-cmd'] || null,
  };
}

// Add tags to a file's `tags:` front matter, write the file back.
// Returns the new content. If no tags would change the file, returns
// null (caller can skip the write).
function injectTagsIntoFile(absPath, addTags) {
  if (!addTags || !addTags.length) return null;
  const raw = readFileSafe(absPath);
  if (raw == null) return null;
  const parsed = SDocYaml.parseFrontMatter(raw);
  const meta = parsed.meta || {};
  const existing = Array.isArray(meta.tags) ? meta.tags : [];
  const merged = SDocLibTags.mergeTags(existing, addTags);
  const same = existing.length === merged.length && existing.every((t, i) => merged[i] === t);
  if (same) return null;
  meta.tags = merged;
  const out = SDocYaml.serializeFrontMatter(meta) + '\n' + (parsed.body || '');
  fs.writeFileSync(absPath, out);
  return out;
}

// Remove tags from a file's front matter. Returns the new tag list or
// null if the file was missing / had no tags to remove.
function removeTagsFromFile(absPath, removeTags) {
  if (!removeTags || !removeTags.length) return null;
  const raw = readFileSafe(absPath);
  if (raw == null) return null;
  const parsed = SDocYaml.parseFrontMatter(raw);
  const meta = parsed.meta || {};
  const existing = Array.isArray(meta.tags) ? meta.tags : [];
  if (!existing.length) return null;
  const drop = new Set(removeTags.map(t => String(t).toLowerCase()));
  const next = existing.filter(t => !drop.has(String(t).toLowerCase()));
  if (next.length === existing.length) return null;
  if (next.length) meta.tags = next; else delete meta.tags;
  const out = SDocYaml.serializeFrontMatter(meta) + '\n' + (parsed.body || '');
  fs.writeFileSync(absPath, out);
  return next;
}

// Per-file opt-out: front matter `sdocs-library: false` skips indexing.
function isOptedOut(content) {
  if (!content) return false;
  const parsed = SDocYaml.parseFrontMatter(content);
  const meta = parsed.meta || {};
  const v = meta['sdocs-library'];
  return v === false || v === 'false';
}

// Add or update a single file. Returns the upserted entry, or null if
// the file was skipped.
function indexFile(absPath, { addTags } = {}) {
  const resolved = path.resolve(absPath);
  if (!fs.existsSync(resolved)) return null;

  if (addTags && addTags.length) {
    injectTagsIntoFile(resolved, addTags);
  }

  let content = readFileSafe(resolved);
  if (content == null) return null;
  if (isOptedOut(content)) return null;

  let rescuedFrom = null;
  let entryPath = resolved;
  if (ephemeral.isEphemeralPath(resolved)) {
    const rescued = ensureRescueCopy(resolved, content);
    rescuedFrom = resolved;
    entryPath = rescued;
  }

  let stats;
  try { stats = fs.statSync(entryPath); } catch (_) { stats = null; }

  const entry = buildEntry({
    absPath: entryPath, content, addTags, stats, rescuedFrom,
  });
  return store.upsertEntry(entry);
}

// Bulk scan: walk roots, index each .md found. Returns counts.
function scanAndIndex({ roots, excludes, maxFileSize } = {}) {
  const found = scanner.scan({ roots, excludes, maxFileSize });
  let added = 0, updated = 0;
  for (const f of found) {
    const before = store.getEntry(store.idForPath(f.path));
    indexFile(f.path);
    if (before) updated++; else added++;
  }
  const state = store.loadState();
  state.lastScanAt = Date.now();
  store.saveState(state);
  return { scanned: found.length, added, updated };
}

function rebuild() {
  store.clearIndex();
  return scanAndIndex();
}

// Tags used by entries whose path is under a given prefix (the project
// path, typically). For the file-info-card autocomplete and `sdoc
// library ls --tags`. Both the prefix and each entry path are tested
// against their realpaths too so a symlinked /var on macOS doesn't
// hide entries from the tag bag.
function tagsUnderPrefix(prefix) {
  const root = path.resolve(prefix);
  let rootReal = root;
  try { rootReal = fs.realpathSync(root); } catch (_) {}
  // Special case: the filesystem root ('/' on posix, 'C:\' on win) is
  // already its own separator, so `root + path.sep` becomes '//' which
  // matches nothing. Treat it as "everything".
  const rootIsFsRoot = root === path.sep || /^[A-Za-z]:[\\/]$/.test(root);
  const sep = path.sep;
  function under(p) {
    if (rootIsFsRoot) return true;
    if (!p) return false;
    if (p === root || p.startsWith(root + sep)) return true;
    if (rootReal !== root && (p === rootReal || p.startsWith(rootReal + sep))) return true;
    return false;
  }
  const counts = {};
  for (const e of store.loadIndex().entries) {
    const p = e.rescued && e.rescuedFrom ? e.rescuedFrom : e.path;
    let pReal = p;
    try { pReal = fs.realpathSync(p); } catch (_) {}
    if (under(p) || under(pReal)) {
      for (const t of e.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

module.exports = {
  indexFile,
  scanAndIndex,
  rebuild,
  buildEntry,
  injectTagsIntoFile,
  removeTagsFromFile,
  tagsUnderPrefix,
  isOptedOut,
  bodyExcerpt,
  deriveTitle,
};
