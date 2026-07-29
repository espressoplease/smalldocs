// SmallDocs skill install + legacy-block migration.
//
// One canonical SKILL.md lives at ~/.agents/skills/smalldocs/SKILL.md.
// Every other supported agent gets a relative symlink from its own skills
// directory into the canonical dir (single source of truth; one write
// updates every agent). Universal agents already discover ~/.agents/skills,
// so they are skipped. Windows falls back to a junction (absolute target),
// then a copy if symlinks are unavailable.
//
// On setup/refresh we also strip any recognised always-on block from the
// historical agent config files so the reference is not loaded twice.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  SKILL_VERSION,
  SKILL_NAME,
  formatSkill,
  readSkillVersion,
  canonicalSkillDir,
  canonicalSkillFile,
  resolveSkillAgents,
  legacyBlockTargets,
  findBookendedBlock,
  findLegacyBlock,
  removeBlockContent,
} = require('./agent-block');

const { AGENT_CHANGES_URL } = require('./constants');

const IS_WIN = process.platform === 'win32';

// ── generic file helpers ───────────────────────────────────

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

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ── canonical skill ────────────────────────────────────────

function refreshCanonicalSkill(home) {
  home = home || os.homedir();
  const file = canonicalSkillFile(home);
  let existing = null;
  try { existing = fs.readFileSync(file, 'utf-8'); } catch (_) {}
  const currentVersion = existing ? readSkillVersion(existing) : null;
  if (currentVersion === SKILL_VERSION) {
    return { changed: false, reason: 'current', path: file };
  }
  if (currentVersion && currentVersion > SKILL_VERSION) {
    return { changed: false, reason: 'newer', path: file };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, formatSkill(SKILL_VERSION));
  return {
    changed: true, path: file,
    fromVersion: currentVersion || 0, toVersion: SKILL_VERSION,
  };
}

// ── symlink install ────────────────────────────────────────

// Ensure <linkDir> resolves to <canonicalDir>. Idempotent: a link already
// pointing at canonical is a no-op; a wrong/stale link or a real dir is
// replaced. Returns { method } where method is symlink | copy | noop | error.
function ensureSkillLink(canonicalDir, linkDir) {
  try {
    const st = fs.lstatSync(linkDir);
    if (st.isSymbolicLink()) {
      const tgt = fs.readlinkSync(linkDir);
      const resolved = path.resolve(path.dirname(linkDir), tgt);
      if (resolved === canonicalDir) return { method: 'noop' };
    }
    // Exists but is not our link (stale link, real dir, or a stray file).
    fs.rmSync(linkDir, { recursive: true, force: true });
  } catch (_) { /* did not exist - fine */ }

  fs.mkdirSync(path.dirname(linkDir), { recursive: true });

  // Relative symlink on POSIX so it survives a home-dir move; junction on
  // Windows requires an absolute target.
  try {
    if (IS_WIN) {
      fs.symlinkSync(canonicalDir, linkDir, 'junction');
    } else {
      const rel = path.relative(path.dirname(linkDir), canonicalDir);
      fs.symlinkSync(rel, linkDir, 'dir');
    }
    return { method: 'symlink' };
  } catch (_) {
    // Permission / non-admin Windows: fall back to a real copy.
    try {
      copyDirRecursive(canonicalDir, linkDir);
      return { method: 'copy' };
    } catch (e) {
      return { method: 'error', error: e.message };
    }
  }
}

function detectSkillAgents(home, env) {
  home = home || os.homedir();
  return resolveSkillAgents(home, env || process.env)
    .filter(a => a.detect.some(p => { try { return fs.existsSync(p); } catch (_) { return false; } }));
}

// Evidence that the user previously opted into SmallDocs setup: a skill file
// already on disk (prior skill install), or a recognised always-on block in one
// of the historical config files (pre-skill install). maybeAutoRefresh uses
// this so a brand-new user is NOT auto-installed without consent - they get the
// interactive first-run prompt (or run `sdoc setup --yes`) instead.
function hasSetupEvidence(home, env) {
  home = home || os.homedir();
  env = env || process.env;
  if (fs.existsSync(canonicalSkillFile(home))) return true;
  for (const t of legacyBlockTargets(home, env)) {
    let content;
    try { content = fs.readFileSync(t.file, 'utf-8'); } catch (_) { continue; }
    if (findBookendedBlock(content) || findLegacyBlock(content)) return true;
  }
  return false;
}

// ── legacy block stripping ─────────────────────────────────

function stripLegacyBlocks(home, env) {
  home = home || os.homedir();
  const out = [];
  for (const t of legacyBlockTargets(home, env || process.env)) {
    if (!fs.existsSync(t.file))                    { out.push({ name: t.name, file: t.file, changed: false, reason: 'absent' });   continue; }
    if (isSymlink(t.file))                          { out.push({ name: t.name, file: t.file, changed: false, reason: 'symlink' }); continue; }

    const release = acquireLock(t.file);
    if (!release)                                   { out.push({ name: t.name, file: t.file, changed: false, reason: 'locked' });  continue; }
    try {
      const content = fs.readFileSync(t.file, 'utf-8');
      const r = removeBlockContent(content);
      if (!r.changed)                              { out.push({ name: t.name, file: t.file, changed: false, reason: r.reason });   continue; }
      backupFile(t.file);
      atomicWrite(t.file, r.content);
      out.push({ name: t.name, file: t.file, changed: true, fromVersion: r.version });
    } catch (e) {
      out.push({ name: t.name, file: t.file, changed: false, error: e.message });
    } finally {
      release();
    }
  }
  return out;
}

// ── orchestration ──────────────────────────────────────────

// One call that does the full sync: refresh canonical skill, symlink every
// detected non-universal agent, strip legacy blocks. Returns a result the
// setup flow reports and derives setup-state from.
function syncAgentSkill(opts = {}) {
  const home = opts.home || os.homedir();
  const env = opts.env || process.env;
  const canonicalDir = canonicalSkillDir(home);

  const result = {
    canonical: refreshCanonicalSkill(home),
    links: [],
    stripped: stripLegacyBlocks(home, env),
    errors: [],
  };

  for (const agent of detectSkillAgents(home, env)) {
    if (agent.universal) continue; // canonical copy already covers them
    const linkDir = path.join(agent.dir, SKILL_NAME);
    const r = ensureSkillLink(canonicalDir, linkDir);
    result.links.push({ name: agent.displayName, path: linkDir, ...r });
    if (r.error) result.errors.push(`${agent.name}: ${r.error}`);
  }
  for (const s of result.stripped) {
    if (s.error) result.errors.push(`${s.file}: ${s.error}`);
  }

  return result;
}

// True if a sync changed anything (skill written/upgraded, a link created,
// or a block stripped). Drives the "nothing to do" message and setup state.
function syncChanged(result) {
  if (result.canonical && result.canonical.changed) return true;
  if (result.links.some(l => l.method === 'symlink' || l.method === 'copy')) return true;
  if (result.stripped.some(s => s.changed)) return true;
  return false;
}

// Flatten a sync result into the {path, changed, error?} shape that
// implicitConsentState expects.
function toImplicitResults(result) {
  const arr = [];
  if (result.canonical) {
    arr.push({ path: result.canonical.path, changed: !!result.canonical.changed });
  }
  for (const l of result.links) {
    arr.push({ path: l.path, changed: l.method === 'symlink' || l.method === 'copy', error: l.error });
  }
  for (const s of result.stripped) {
    arr.push({ path: s.file, changed: s.changed, error: s.error });
  }
  return arr;
}

function printSyncSummary(result) {
  if (result.canonical && result.canonical.changed) {
    console.log(`\u2713 SmallDocs skill updated to v${SKILL_VERSION} at ${result.canonical.path}`);
    console.log(`  Changes: ${AGENT_CHANGES_URL}#v${SKILL_VERSION}`);
  }
  for (const l of result.links) {
    if (l.method === 'symlink' || l.method === 'copy') {
      console.log(`\u2713 ${l.name}: ${l.path} (${l.method})`);
    }
    if (l.error) console.log(`! ${l.name}: ${l.error}`);
  }
  for (const s of result.stripped) {
    if (s.changed)    console.log(`\u2713 removed old SmallDocs block from ${s.file}`);
    if (s.error)      console.log(`! ${s.file}: ${s.error}`);
    if (s.reason === 'hand_edited') console.log(`! ${s.file}: local edits detected, left untouched`);
  }
}

module.exports = {
  IS_WIN,
  isSymlink,
  atomicWrite,
  backupFile,
  acquireLock,
  copyDirRecursive,
  refreshCanonicalSkill,
  ensureSkillLink,
  detectSkillAgents,
  hasSetupEvidence,
  stripLegacyBlocks,
  syncAgentSkill,
  syncChanged,
  toImplicitResults,
  printSyncSummary,
};
