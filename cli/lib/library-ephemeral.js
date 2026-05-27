// Hardcoded list of OS paths that auto-delete files. Two categories:
//
//   ephemeralRoots() - paths a user might legitimately put work in
//   (`/tmp`, `~/.Trash`). Files here get a *rescue copy* taken into
//   ~/.sdocs/library/rescued/ at index time, because the original is
//   going to vanish on the OS's schedule.
//
//   throwawayRoots() - OS-managed scratch directories like
//   `os.tmpdir()` on macOS (which resolves to a per-user folder under
//   /var/folders/...). Nothing meaningful lives here long enough to
//   index; it is where Playwright sandboxes, build tools, and other
//   transient processes write their working files. Anything under
//   these roots is skipped entirely at index time - no rescue, no
//   library entry. This is what stops test-run pollution from
//   accumulating in the user's library.
//
// Both checks realpath() the input so macOS's /private/var/folders/...
// alias does not slip through.

const os   = require('os');
const fs   = require('fs');
const path = require('path');

function homedir() { return os.homedir(); }

// Resolve all known forms of a path so the `/private/...` macOS alias
// is matched the same as the bare form.
function expandAliases(p) {
  if (!p) return [];
  const out = new Set();
  const resolved = path.resolve(p);
  out.add(resolved);
  try {
    const real = fs.realpathSync(resolved);
    if (real) out.add(real);
  } catch (_) { /* path may not exist; resolved form is enough */ }
  return [...out];
}

function ephemeralRoots() {
  const roots = new Set();
  for (const r of expandAliases(os.tmpdir())) roots.add(r);

  if (process.platform === 'darwin') {
    roots.add('/tmp');
    roots.add('/private/tmp');
    roots.add('/var/tmp');
    roots.add('/private/var/tmp');
    roots.add(path.join(homedir(), '.Trash'));
  } else if (process.platform === 'linux') {
    roots.add('/tmp');
    roots.add('/var/tmp');
    roots.add('/run');
    roots.add('/dev/shm');
    roots.add(path.join(homedir(), '.cache'));
  } else if (process.platform === 'win32') {
    if (process.env.TEMP) roots.add(path.resolve(process.env.TEMP));
    if (process.env.TMP)  roots.add(path.resolve(process.env.TMP));
    roots.add('C:\\Windows\\Temp');
  }

  return [...roots].filter(Boolean);
}

// OS scratch directories - never index files from here, even with
// rescue. These are where test runners, build tools, and short-lived
// processes write their working files; the user does not put meaningful
// long-lived documents under them.
function throwawayRoots() {
  const roots = new Set();
  for (const r of expandAliases(os.tmpdir())) roots.add(r);
  if (process.platform === 'darwin') {
    // /var/folders/<u>/<gid>/T is per-user macOS tmp; the /private alias
    // is the realpath, the un-prefixed form is the symlink. Cover both.
    roots.add('/var/folders');
    roots.add('/private/var/folders');
  } else if (process.platform === 'linux') {
    roots.add('/run');
    roots.add('/dev/shm');
  } else if (process.platform === 'win32') {
    if (process.env.TEMP) roots.add(path.resolve(process.env.TEMP));
    if (process.env.TMP)  roots.add(path.resolve(process.env.TMP));
    roots.add('C:\\Windows\\Temp');
  }
  return [...roots].filter(Boolean);
}

function pathUnder(absPath, roots) {
  if (!absPath) return false;
  for (const candidate of expandAliases(absPath)) {
    for (const root of roots) {
      if (candidate === root || candidate.startsWith(root + path.sep)) return true;
    }
  }
  return false;
}

function isEphemeralPath(absPath) {
  return pathUnder(absPath, ephemeralRoots());
}

function isThrowawayPath(absPath) {
  return pathUnder(absPath, throwawayRoots());
}

module.exports = {
  ephemeralRoots,
  throwawayRoots,
  isEphemeralPath,
  isThrowawayPath,
};
