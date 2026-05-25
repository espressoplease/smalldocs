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
  // Directories whose contents are sensitive even when the user
  // happens to have them outside a hidden-dir ancestor. Belt-and-
  // suspenders for the hidden-dir rule above.
  '.ssh',
  '.aws',
  '.gnupg',
  '.docker',
  '.kube',
  '.gcloud',
  '.azure',
  '.bitwarden',
  '.password-store',
]);

// File basenames that should never make it into the library, regardless
// of which directory they live in or what extension they carry. Most of
// these don't have a markdown extension and so the existing extension
// filter already drops them - but the deny list is the right place for
// the rule, and is in position for when more extensions get indexed.
//
// Crucially, the credentials/secrets patterns require a config-file
// extension (json/yaml/env/...) - they will NOT match `.md` because
// markdown is a notes format and "company-secrets.md" or
// "credentials-handling.md" are legitimate user notes about secrets,
// not the secrets themselves.
const DENY_BASENAME_PATTERNS = [
  // SSH private/public keys
  /^id_rsa(\.pub)?$/i,
  /^id_ed25519(\.pub)?$/i,
  /^id_ecdsa(\.pub)?$/i,
  /^id_dsa(\.pub)?$/i,
  /\.ppk$/i,
  // Environment files (.env, .env.local, .env.production, ...)
  /^\.env(\..+)?$/i,
  // Cryptographic material
  /\.(key|pem|p12|pfx|cer|crt|jks|keystore)$/i,
  // PGP / GPG
  /\.(gpg|pgp|asc)$/i,
  // Password databases / wallets
  /\.(kdbx|kdb|agilekeychain|1pif)$/i,
  /^wallet\.dat$/i,
  // Credential files: literal name (no extension - this is how
  // git/aws/gh store them) or with a config / data extension.
  /(^|[._-])credentials$/i,
  /(^|[._-])credentials\.(json|yaml|yml|toml|ini|env|conf|cfg|key|txt|sh|properties)$/i,
  // Files literally named secret(s).<config-ext>. Does NOT match
  // `secret.md` or other markdown notes ABOUT secrets.
  /^secrets?\.(json|yaml|yml|toml|ini|env|conf|cfg|key|txt|sh|properties)$/i,
  // api_secret.json, api-secret.yaml, apisecret.txt, ...
  /^api[_-]?secret\.(json|yaml|yml|toml|ini|env|conf|cfg|key|txt)$/i,
  // Common single-file secrets in $HOME
  /^\.netrc$/i,
  /^\.pgpass$/i,
  /^\.htpasswd$/i,
];

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

// Exported so the agent's file-read and bridge-spawn endpoints can
// apply the same deny rule on the path they're handed.
function deniedByPattern(absPath) {
  const base = path.basename(absPath);
  if (DENY_BASENAME_PATTERNS.some(re => re.test(base))) return true;
  const segs = absPath.split(path.sep);
  for (const s of segs) {
    if (DIRNAME_BLOCKLIST.has(s)) return true;
  }
  return false;
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

// .sdocsignore: per-directory dotfile that excludes files / directories
// from indexing. Subset of gitignore syntax:
//   - blank lines and lines starting with # are ignored
//   - trailing / means "directory only"
//   - * matches any run of non-/ characters
//   - ** matches across directory boundaries
//   - patterns without a / match against basename only
//   - patterns with a / match against the path relative to the .sdocsignore
// Negation (!) and other gitignore niceties are not supported in v1.
function parseSdocsignore(dir) {
  let raw;
  try { raw = fs.readFileSync(path.join(dir, '.sdocsignore'), 'utf8'); }
  catch (_) { return null; }
  const out = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
    const hasSlash = line.includes('/');
    const re = new RegExp('^' + line
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__GLOBSTAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/__GLOBSTAR__/g, '.*') + '$');
    out.push({ re, dirOnly, anchored: hasSlash, dir });
  }
  return out.length ? out : null;
}

function matchesIgnoreStack(stack, absPath, isDir) {
  for (const layer of stack) {
    const rel = path.relative(layer.dir, absPath);
    if (!rel || rel.startsWith('..')) continue; // outside this .sdocsignore's scope
    const base = path.basename(absPath);
    for (const p of layer.patterns) {
      if (p.dirOnly && !isDir) continue;
      const target = p.anchored ? rel : base;
      if (p.re.test(target)) return true;
    }
  }
  return false;
}

// Walk synchronously and accumulate matches. Cheap enough for personal
// libraries; we'll revisit if a user reports a slow scan.
function scan({ roots, excludes, maxFileSize } = {}) {
  const rootsToWalk = (roots && roots.length ? roots : defaultRoots()).map(p => path.resolve(p));
  const exSet = new Set((excludes || []).map(p => path.resolve(p)));
  for (const sys of systemSkipPaths()) exSet.add(sys);
  const limit = maxFileSize || DEFAULT_MAX_SIZE;

  const found = [];

  function walk(dir, ignoreStack) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    // Pick up .sdocsignore in this directory (cumulative with ancestors).
    const here = parseSdocsignore(dir);
    const stack = here ? ignoreStack.concat([{ dir, patterns: here }]) : ignoreStack;

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (matchesIgnoreStack(stack, full, ent.isDirectory())) continue;
      if (ent.isDirectory()) {
        if (!shouldSkipDir(full, ent.name, exSet, rootsToWalk)) walk(full, stack);
        continue;
      }
      if (!ent.isFile()) continue;
      if (deniedByPattern(full)) continue;
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
    walk(r, []);
  }
  return found;
}

module.exports = {
  scan,
  defaultRoots,
  systemSkipPaths,
  DIRNAME_BLOCKLIST,
  DENY_BASENAME_PATTERNS,
  DEFAULT_MAX_SIZE,
  shouldSkipDir,
  deniedByPattern,
  parseSdocsignore,
  matchesIgnoreStack,
};
