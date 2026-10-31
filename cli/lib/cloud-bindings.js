const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const credentials = require('./cloud-credentials');
const { withLockSync } = require('./file-lock');

function bindingsFile() { return path.join(credentials.cloudDir(), 'bindings.json'); }
function pendingFile() { return path.join(credentials.cloudDir(), 'pending.json'); }
function basesDir() { return path.join(credentials.cloudDir(), 'bases'); }

function read(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CLI state');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw Object.assign(new Error('Could not read SmallDocs Cloud state. The existing file was preserved: ' + file), { code: 'temporary_service_failure' });
  }
}

function canonical(file) {
  const absolute = path.resolve(file);
  try { return fs.realpathSync(absolute); } catch (_) {
    const parent = path.dirname(absolute);
    return parent === absolute ? absolute : path.join(canonical(parent), path.basename(absolute));
  }
}

function key(accountId, file) { return accountId + '\0' + canonical(file); }
function get(accountId, file) { return read(bindingsFile())[key(accountId, file)] || null; }

function update(file, change) {
  return withLockSync(file, () => {
    const values = read(file);
    const result = change(values);
    credentials.atomicWrite(file, values);
    return result;
  });
}
function set(accountId, file, binding) {
  return update(bindingsFile(), values => {
    const record = { ...binding, account_id: accountId, path: canonical(file) };
    values[key(accountId, file)] = record;
    return record;
  });
}
function getPending(accountId, file) { return read(pendingFile())[key(accountId, file)] || null; }
function setPending(accountId, file, value) {
  return update(pendingFile(), values => { values[key(accountId, file)] = value; });
}
function clearPending(accountId, file) {
  return update(pendingFile(), values => { delete values[key(accountId, file)]; });
}
function operationKey(accountId, operation, resourceId) {
  return accountId + '\0operation:' + operation + '\0' + resourceId;
}
function getOperationPending(accountId, operation, resourceId) {
  return read(pendingFile())[operationKey(accountId, operation, resourceId)] || null;
}
function setOperationPending(accountId, operation, resourceId, value) {
  return update(pendingFile(), values => { values[operationKey(accountId, operation, resourceId)] = value; });
}
function clearOperationPending(accountId, operation, resourceId) {
  return update(pendingFile(), values => { delete values[operationKey(accountId, operation, resourceId)]; });
}

function hash(content) { return crypto.createHash('sha256').update(content).digest('hex'); }

function baseFile(accountId, documentId, revisionId) {
  const root = path.resolve(basesDir());
  const file = path.resolve(root, String(accountId), String(documentId), String(revisionId) + '.md');
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}

function cacheBase(accountId, documentId, revisionId, content) {
  const file = baseFile(accountId, documentId, revisionId);
  if (!file) throw new Error('Cloud base path is invalid');
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function readBase(accountId, documentId, revisionId) {
  const file = baseFile(accountId, documentId, revisionId);
  if (!file) return null;
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
}

module.exports = { bindingsFile, pendingFile, canonical, get, set, getPending, setPending,
  clearPending, getOperationPending, setOperationPending, clearOperationPending, hash, cacheBase,
  readBase };
