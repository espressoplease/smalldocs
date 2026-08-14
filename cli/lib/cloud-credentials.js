const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function cloudDir() {
  return path.join(process.env.SDOCS_HOME || path.join(os.homedir(), '.sdocs'), 'cloud');
}

function credentialFile() { return path.join(cloudDir(), 'credentials.json'); }

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

function readFileStore() {
  try { return JSON.parse(fs.readFileSync(credentialFile(), 'utf8')); } catch (_) { return {}; }
}

function keychainAccount(origin) {
  return Buffer.from(origin).toString('base64url');
}

function keychainLoad(origin) {
  try {
    const value = execFileSync('security', ['find-generic-password', '-s', 'org.smalldocs.cloud',
      '-a', keychainAccount(origin), '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return value ? JSON.parse(value) : null;
  } catch (_) { return null; }
}

function keychainSave(origin, credential) {
  execFileSync('security', ['add-generic-password', '-U', '-s', 'org.smalldocs.cloud',
    '-a', keychainAccount(origin), '-w'], { input: JSON.stringify(credential) + '\n', stdio: ['pipe', 'ignore', 'ignore'] });
}

function keychainDelete(origin) {
  try {
    execFileSync('security', ['delete-generic-password', '-s', 'org.smalldocs.cloud',
      '-a', keychainAccount(origin)], { stdio: 'ignore' });
  } catch (_) {}
}

function useKeychain() {
  return process.platform === 'darwin' && process.env.SDOCS_CLOUD_FILE_CREDENTIALS !== '1';
}

function load(origin) {
  if (useKeychain()) return keychainLoad(origin);
  return readFileStore()[origin] || null;
}

function save(origin, credential) {
  if (useKeychain()) return keychainSave(origin, credential);
  const values = readFileStore();
  values[origin] = credential;
  atomicWrite(credentialFile(), values);
}

function remove(origin) {
  if (useKeychain()) return keychainDelete(origin);
  const values = readFileStore();
  delete values[origin];
  atomicWrite(credentialFile(), values);
}

module.exports = { cloudDir, credentialFile, atomicWrite, load, save, remove, useKeychain };
