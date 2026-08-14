const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const credentials = require('./cloud-credentials');

function bindingsFile() { return path.join(credentials.cloudDir(), 'bindings.json'); }
function pendingFile() { return path.join(credentials.cloudDir(), 'pending.json'); }
function basesDir() { return path.join(credentials.cloudDir(), 'bases'); }

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; }
}

function canonical(file) {
  const absolute = path.resolve(file);
  try { return fs.realpathSync(absolute); } catch (_) { return absolute; }
}

function key(accountId, file) { return accountId + '\0' + canonical(file); }
function get(accountId, file) { return read(bindingsFile())[key(accountId, file)] || null; }

function set(accountId, file, binding) {
  const values = read(bindingsFile());
  values[key(accountId, file)] = { ...binding, account_id: accountId, path: canonical(file) };
  credentials.atomicWrite(bindingsFile(), values);
  return values[key(accountId, file)];
}

function getPending(accountId, file) { return read(pendingFile())[key(accountId, file)] || null; }
function setPending(accountId, file, value) {
  const values = read(pendingFile());
  values[key(accountId, file)] = value;
  credentials.atomicWrite(pendingFile(), values);
}
function clearPending(accountId, file) {
  const values = read(pendingFile());
  delete values[key(accountId, file)];
  credentials.atomicWrite(pendingFile(), values);
}

function operationKey(accountId, operation, resourceId) {
  return accountId + '\0operation:' + operation + '\0' + resourceId;
}
function getOperationPending(accountId, operation, resourceId) {
  return read(pendingFile())[operationKey(accountId, operation, resourceId)] || null;
}
function setOperationPending(accountId, operation, resourceId, value) {
  const values = read(pendingFile());
  values[operationKey(accountId, operation, resourceId)] = value;
  credentials.atomicWrite(pendingFile(), values);
}
function clearOperationPending(accountId, operation, resourceId) {
  const values = read(pendingFile());
  delete values[operationKey(accountId, operation, resourceId)];
  credentials.atomicWrite(pendingFile(), values);
}

function hash(content) { return crypto.createHash('sha256').update(content).digest('hex'); }

function cacheBase(accountId, documentId, revisionId, content) {
  const dir = path.join(basesDir(), accountId, documentId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, revisionId + '.md');
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

module.exports = { bindingsFile, pendingFile, canonical, get, set, getPending, setPending,
  clearPending, getOperationPending, setOperationPending, clearOperationPending, hash, cacheBase };
