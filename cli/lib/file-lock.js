// Cross-process coordination for local CLI state, using Node standard library only.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sleepArray = new Int32Array(new SharedArrayBuffer(4));

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
function sameDirectory(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function tryLock(file) {
  const directory = file + '.sdocs-lock';
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory()) throw new Error('The CLI state lock is not a directory: ' + directory);
      const entries = fs.readdirSync(directory);
      for (const entry of entries) {
        const match = /^owner-(\d+)-[a-f0-9]+$/.exec(entry);
        if (match && !alive(Number(match[1]))) {
          try { fs.unlinkSync(path.join(directory, entry)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
      }
      // An interrupted mkdir may have no owner marker. A new owner checks the
      // directory inode before entering, so removing an old empty lock is safe.
      if (entries.length || Date.now() - stat.mtimeMs > 5000) {
        try { fs.rmdirSync(directory); } catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return null;
  }
  let fd;
  const marker = path.join(directory, 'owner-' + process.pid + '-' + crypto.randomBytes(8).toString('hex'));
  try {
    if (process.platform !== 'win32') fd = fs.openSync(directory, 'r');
    const original = fd == null ? fs.statSync(directory) : fs.fstatSync(fd);
    fs.writeFileSync(marker, '', { flag: 'wx', mode: 0o600 });
    if (!sameDirectory(original, fs.statSync(directory))) {
      fs.unlinkSync(marker);
      return null;
    }
  } catch (error) {
    try { fs.unlinkSync(marker); } catch (_) {}
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { if (fd != null) fs.closeSync(fd); }
  return function release() {
    try { fs.unlinkSync(marker); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { fs.rmdirSync(directory); } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
  };
}
function busyError() {
  return Object.assign(new Error('Another SmallDocs command is updating local state. Retry this command.'), { code: 'temporary_service_failure' });
}
function withLockSync(file, action, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let release;
  while (!(release = tryLock(file))) {
    if (Date.now() >= deadline) throw busyError();
    Atomics.wait(sleepArray, 0, 0, 20);
  }
  try { return action(); } finally { release(); }
}
async function withLock(file, action, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let release;
  while (!(release = tryLock(file))) {
    if (Date.now() >= deadline) throw busyError();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  try { return await action(); } finally { release(); }
}
module.exports = { withLock, withLockSync };
