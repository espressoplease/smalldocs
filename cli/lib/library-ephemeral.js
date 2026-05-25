// Hardcoded list of OS paths that auto-delete files. Files in these
// locations get a rescue copy taken into ~/.sdocs/library/rescued/ at
// index time, because the original is going to vanish on the OS's
// schedule.
//
// Strongest signal is os.tmpdir(). Beyond that we hardcode the well-
// known set per platform.

const os   = require('os');
const path = require('path');

function homedir() { return os.homedir(); }

function ephemeralRoots() {
  const roots = new Set();
  try { roots.add(path.resolve(os.tmpdir())); } catch (_) {}

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

function isEphemeralPath(absPath) {
  if (!absPath) return false;
  const resolved = path.resolve(absPath);
  for (const root of ephemeralRoots()) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

module.exports = { ephemeralRoots, isEphemeralPath };
