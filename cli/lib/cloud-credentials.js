const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const KEYCHAIN_SERVICE = 'org.smalldocs.cloud';
const KEYCHAIN_EXPECT = [
  'log_user 0',
  'set timeout 15',
  'set secret [gets stdin]',
  'spawn security add-generic-password -U -s "' + KEYCHAIN_SERVICE + '" -a "$env(SDOCS_KEYCHAIN_ACCOUNT)" -w',
  'expect -re {password.*item.*:}',
  'send -- "$secret\\r"',
  'expect -re {retype.*item.*:}',
  'send -- "$secret\\r"',
  'expect eof',
  'catch wait result',
  'exit [lindex $result 3]',
].join('\n');

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
    const value = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE,
      '-a', keychainAccount(origin), '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return value ? JSON.parse(value) : null;
  } catch (_) { return null; }
}

function keychainSave(origin, credential, execute) {
  const run = execute || spawnSync;
  const result = run('/usr/bin/expect', ['-c', KEYCHAIN_EXPECT], {
    input: JSON.stringify(credential) + '\n',
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SDOCS_KEYCHAIN_ACCOUNT: keychainAccount(origin) }),
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Could not save the Cloud credential to macOS Keychain.');
  }
}

function keychainDelete(origin) {
  try {
    execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE,
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

module.exports = { cloudDir, credentialFile, atomicWrite, load, save, remove, useKeychain,
  keychainSave };
