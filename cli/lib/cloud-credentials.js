const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const KEYCHAIN_SERVICE = 'org.smalldocs.cloud';
const KEYCHAIN_RECORD_VERSION = 2;
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
const DPAPI_PROTECT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$plain = [Console]::In.ReadToEnd()',
  '$bytes = [Text.Encoding]::UTF8.GetBytes($plain)',
  '$cipher = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($cipher))',
].join('; ');
const DPAPI_UNPROTECT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$encoded = [Console]::In.ReadToEnd()',
  '$cipher = [Convert]::FromBase64String($encoded)',
  '$plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))',
].join('; ');

function cloudDir() {
  return path.join(process.env.SDOCS_HOME || path.join(os.homedir(), '.sdocs'), 'cloud');
}

function credentialFile() { return path.join(cloudDir(), 'credentials.json'); }
function dpapiCredentialFile(origin) {
  if (!origin) return path.join(cloudDir(), 'credentials.dpapi');
  const id = crypto.createHash('sha256').update(origin).digest('hex');
  return path.join(cloudDir(), 'credentials-' + id + '.dpapi');
}
function encryptedCredentialFile(origin, generation) {
  const id = crypto.createHash('sha256').update(origin).digest('hex');
  return path.join(cloudDir(), 'credentials-' + id +
    (generation ? '-' + generation : '') + '.enc');
}

function atomicWriteRaw(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch (_) {}
  const temporary = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  try { fs.chmodSync(temporary, 0o600); } catch (_) {}
  fs.renameSync(temporary, file);
}

function atomicWrite(file, value) {
  atomicWriteRaw(file, JSON.stringify(value, null, 2) + '\n');
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) { return {}; }
}

function readFileStore() { return readJson(credentialFile()); }

function keychainAccount(origin) {
  return Buffer.from(origin).toString('base64url');
}

function keychainReadAccount(account) {
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE,
      '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch (error) {
    if (error && Number(error.status) === 44) return null;
    throw new Error('Could not read the SmallDocs Cloud credential key from macOS Keychain.');
  }
}

function keychainWriteAccount(account, value, execute) {
  const run = execute || spawnSync;
  const result = run('/usr/bin/expect', ['-c', KEYCHAIN_EXPECT], {
    input: value + '\n',
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SDOCS_KEYCHAIN_ACCOUNT: account }),
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Could not save the Cloud credential key to macOS Keychain.');
  }
}

function keychainDeleteAccount(account) {
  try {
    execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE,
      '-a', account], { stdio: 'ignore' });
  } catch (_) {}
}

function keychainOperations(operations) {
  if (operations && typeof operations === 'object') return operations;
  return {
    read: keychainReadAccount,
    write(account, value) { keychainWriteAccount(account, value, operations); },
    remove: keychainDeleteAccount,
  };
}

function parseKeychainRecord(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.v === KEYCHAIN_RECORD_VERSION && typeof value.key === 'string') {
      const key = Buffer.from(value.key, 'base64url');
      const generation = value.file == null ? null : String(value.file);
      if (key.length !== 32 || key.toString('base64url') !== value.key ||
          (generation != null && !/^[a-f0-9]{16}$/.test(generation))) return null;
      return { type: 'key', key, generation };
    }
    return { type: 'legacy', credential: value };
  } catch (_) { return null; }
}

function encryptCredential(credential, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credential), 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  }) + '\n';
}

function decryptCredential(value, key) {
  const envelope = JSON.parse(value);
  if (!envelope || envelope.v !== 1 || typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') return null;
  const iv = Buffer.from(envelope.iv, 'base64url');
  const tag = Buffer.from(envelope.tag, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  const credential = JSON.parse(plain);
  return credential && typeof credential === 'object' && !Array.isArray(credential) ? credential : null;
}

function keychainLoad(origin, operations) {
  const ops = keychainOperations(operations);
  const record = parseKeychainRecord(ops.read(keychainAccount(origin)));
  if (!record) return null;
  if (record.type === 'legacy') return record.credential;
  try {
    return decryptCredential(fs.readFileSync(
      encryptedCredentialFile(origin, record.generation), 'utf8'), record.key);
  } catch (_) { return null; }
}

function keychainSave(origin, credential, operations) {
  const ops = keychainOperations(operations);
  const account = keychainAccount(origin);
  const current = parseKeychainRecord(ops.read(account));
  const key = current && current.type === 'key' ? current.key : crypto.randomBytes(32);
  const generation = current && current.type === 'key'
    ? current.generation : crypto.randomBytes(8).toString('hex');
  const file = encryptedCredentialFile(origin, generation);
  atomicWriteRaw(file, encryptCredential(credential, key));
  if (!current || current.type !== 'key') {
    const record = JSON.stringify({ v: KEYCHAIN_RECORD_VERSION,
      key: key.toString('base64url'), file: generation });
    try { ops.write(account, record); }
    catch (error) {
      try { fs.unlinkSync(file); } catch (_) {}
      throw error;
    }
  }
}

function keychainDelete(origin, operations) {
  const ops = keychainOperations(operations);
  const record = parseKeychainRecord(ops.read(keychainAccount(origin)));
  ops.remove(keychainAccount(origin));
  const file = encryptedCredentialFile(origin,
    record && record.type === 'key' ? record.generation : null);
  try { fs.unlinkSync(file); } catch (_) {}
}

function removeFileCredential(origin) {
  const values = readFileStore();
  delete values[origin];
  if (Object.keys(values).length) atomicWrite(credentialFile(), values);
  else {
    try { fs.unlinkSync(credentialFile()); }
    catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
  }
}

function retryFileCredentialCleanup(origin) {
  try { removeFileCredential(origin); } catch (_) {}
}

function macLoad(origin, operations) {
  const credential = keychainLoad(origin, operations);
  if (credential) {
    if (readFileStore()[origin]) retryFileCredentialCleanup(origin);
    return credential;
  }
  const legacy = readFileStore()[origin] || null;
  if (!legacy) return null;
  keychainSave(origin, legacy, operations);
  retryFileCredentialCleanup(origin);
  return legacy;
}

function macSave(origin, credential, operations) {
  keychainSave(origin, credential, operations);
  retryFileCredentialCleanup(origin);
}

function macRemove(origin, operations) {
  keychainDelete(origin, operations);
  removeFileCredential(origin);
}

function runDpapi(script, input, execute) {
  const run = execute || spawnSync;
  const result = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-Command', script], {
    input,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || typeof result.stdout !== 'string' || !result.stdout.trim()) {
    throw new Error('Windows could not protect the SmallDocs Cloud credential.');
  }
  return result.stdout.trim();
}

function validBase64(value) {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0 && decoded.toString('base64') === value;
  } catch (_) { return false; }
}

function readDpapiCredential(origin, execute) {
  const file = dpapiCredentialFile(origin);
  if (!fs.existsSync(file)) return null;
  try {
    const plain = runDpapi(DPAPI_UNPROTECT, fs.readFileSync(file, 'utf8').trim(), execute);
    const value = JSON.parse(plain);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid store');
    return value;
  } catch (_) {
    throw new Error('Could not read the Windows-protected SmallDocs Cloud credential.');
  }
}

function writeDpapiCredential(origin, credential, execute) {
  const encrypted = runDpapi(DPAPI_PROTECT, JSON.stringify(credential), execute);
  if (!validBase64(encrypted)) {
    throw new Error('Windows returned an invalid protected SmallDocs Cloud credential.');
  }
  atomicWriteRaw(dpapiCredentialFile(origin), encrypted + '\n');
}

function windowsLoad(origin, execute) {
  const protectedCredential = readDpapiCredential(origin, execute);
  if (protectedCredential) {
    if (readFileStore()[origin]) retryFileCredentialCleanup(origin);
    return protectedCredential;
  }
  const legacy = readFileStore()[origin] || null;
  if (!legacy) return null;
  writeDpapiCredential(origin, legacy, execute);
  retryFileCredentialCleanup(origin);
  return legacy;
}

function windowsSave(origin, credential, execute) {
  writeDpapiCredential(origin, credential, execute);
  retryFileCredentialCleanup(origin);
}

function windowsRemove(origin) {
  try { fs.unlinkSync(dpapiCredentialFile(origin)); }
  catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
  removeFileCredential(origin);
}

function forceFileCredentials() {
  return process.env.SDOCS_CLOUD_FILE_CREDENTIALS === '1';
}

function useKeychain() {
  return process.platform === 'darwin' && !forceFileCredentials();
}

function useDpapi() {
  return process.platform === 'win32' && !forceFileCredentials();
}

function load(origin) {
  if (useKeychain()) return macLoad(origin);
  if (useDpapi()) return windowsLoad(origin);
  return readFileStore()[origin] || null;
}

function save(origin, credential) {
  if (useKeychain()) return macSave(origin, credential);
  if (useDpapi()) return windowsSave(origin, credential);
  const values = readFileStore();
  values[origin] = credential;
  atomicWrite(credentialFile(), values);
}

function remove(origin) {
  if (useKeychain()) return macRemove(origin);
  if (useDpapi()) return windowsRemove(origin);
  const values = readFileStore();
  delete values[origin];
  atomicWrite(credentialFile(), values);
}

module.exports = {
  cloudDir,
  credentialFile,
  dpapiCredentialFile,
  encryptedCredentialFile,
  atomicWrite,
  load,
  save,
  remove,
  useKeychain,
  useDpapi,
  keychainLoad,
  keychainSave,
  keychainDelete,
  macLoad,
  macSave,
  macRemove,
  readDpapiCredential,
  writeDpapiCredential,
  windowsLoad,
  windowsSave,
  windowsRemove,
  DPAPI_PROTECT,
  DPAPI_UNPROTECT,
};
