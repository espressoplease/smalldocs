const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 1;
const WORKSPACE_MAGIC = Buffer.from('SDOCKMS1');
const PROJECT_MARKER = Buffer.from('sdocskmsv001');
const MAX_HEADER_BYTES = 64 * 1024;

class KmsKeyProviderError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'KmsKeyProviderError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function requireText(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > (maxLength || 1024)) {
    throw new KmsKeyProviderError('invalid_key_provider_config', name + ' is required');
  }
  return value.trim();
}

function requireVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new KmsKeyProviderError('invalid_key_material', 'key version is invalid');
  }
  return version;
}

function toBuffer(value, name) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new KmsKeyProviderError('kms_invalid_response', name + ' must be bytes');
}

function isThenable(value) {
  return value && typeof value.then === 'function';
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function localEncrypt(key, plaintext, associatedData, randomBytes) {
  const nonce = randomBytes(12);
  if (!Buffer.isBuffer(nonce) || nonce.length !== 12) {
    throw new KmsKeyProviderError('random_source_failure', 'random source did not return 12 bytes');
  }
  try {
    const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return { nonce, ciphertext };
  } catch (error) {
    throw new KmsKeyProviderError('encryption_failed', 'workspace value could not be encrypted', error);
  }
}

function localDecrypt(key, nonce, ciphertext, associatedData) {
  if (!Buffer.isBuffer(nonce) || nonce.length !== 12 ||
      !Buffer.isBuffer(ciphertext) || ciphertext.length < 16) {
    throw new KmsKeyProviderError('invalid_ciphertext', 'workspace ciphertext is invalid');
  }
  try {
    const body = ciphertext.subarray(0, ciphertext.length - 16);
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAAD(associatedData);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch (error) {
    throw new KmsKeyProviderError('decryption_failed', 'workspace ciphertext could not be authenticated', error);
  }
}

function packWorkspaceEnvelope(reference, wrappedKey, ciphertext) {
  const header = Buffer.from(JSON.stringify({
    version: FORMAT_VERSION,
    reference,
    wrapped_key: wrappedKey.toString('base64'),
  }), 'utf8');
  if (header.length > MAX_HEADER_BYTES) {
    throw new KmsKeyProviderError('kms_invalid_response', 'wrapped key metadata is too large');
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([WORKSPACE_MAGIC, length, header, ciphertext]);
}

function unpackWorkspaceEnvelope(value) {
  if (!Buffer.isBuffer(value) || value.length < WORKSPACE_MAGIC.length + 4 + 16 ||
      !value.subarray(0, WORKSPACE_MAGIC.length).equals(WORKSPACE_MAGIC)) {
    throw new KmsKeyProviderError('invalid_ciphertext', 'workspace envelope is invalid');
  }
  const headerLength = value.readUInt32BE(WORKSPACE_MAGIC.length);
  const headerStart = WORKSPACE_MAGIC.length + 4;
  const bodyStart = headerStart + headerLength;
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES || bodyStart + 16 > value.length) {
    throw new KmsKeyProviderError('invalid_ciphertext', 'workspace envelope is invalid');
  }
  let header;
  try { header = JSON.parse(value.subarray(headerStart, bodyStart).toString('utf8')); } catch (_) {
    throw new KmsKeyProviderError('invalid_ciphertext', 'workspace envelope metadata is invalid');
  }
  if (!header || header.version !== FORMAT_VERSION || typeof header.reference !== 'string' ||
      !header.reference || typeof header.wrapped_key !== 'string') {
    throw new KmsKeyProviderError('invalid_ciphertext', 'workspace envelope metadata is invalid');
  }
  let wrappedKey;
  try { wrappedKey = Buffer.from(header.wrapped_key, 'base64'); } catch (_) {
    throw new KmsKeyProviderError('invalid_ciphertext', 'wrapped workspace key is invalid');
  }
  if (!wrappedKey.length || wrappedKey.toString('base64') !== header.wrapped_key) {
    throw new KmsKeyProviderError('invalid_ciphertext', 'wrapped workspace key is invalid');
  }
  return { reference: header.reference, wrappedKey, ciphertext: value.subarray(bodyStart) };
}

class ManagedKmsKeyProvider {
  constructor(options) {
    options = options || {};
    if (!options.kmsClient || typeof options.kmsClient.encrypt !== 'function' ||
        typeof options.kmsClient.decrypt !== 'function') {
      throw new KmsKeyProviderError('invalid_key_provider_config', 'kmsClient encrypt and decrypt methods are required');
    }
    this.kmsClient = options.kmsClient;
    this.keyId = requireText(options.keyId, 'keyId', 2048);
    this.environment = requireText(options.environment, 'environment', 64);
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.now = options.now || Date.now;
    this.cacheTtlMs = options.cacheTtlMs == null ? 5 * 60 * 1000 : Number(options.cacheTtlMs);
    this.cacheMaxEntries = options.cacheMaxEntries == null ? 256 : Number(options.cacheMaxEntries);
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 1 ||
        !Number.isSafeInteger(this.cacheMaxEntries) || this.cacheMaxEntries < 1) {
      throw new KmsKeyProviderError('invalid_key_provider_config', 'cache bounds are invalid');
    }
    this.cache = new Map();
  }

  _context(purpose, id, version) {
    return {
      application: 'sdocs-cloud',
      environment: this.environment,
      purpose,
      resource_id: String(id),
      version: String(version),
    };
  }

  _localAad(workspaceId, kind, version, reference, wrappedDigest) {
    return Buffer.from([
      'sdocs-cloud-kms', this.environment, 'workspace-value', workspaceId, kind,
      String(version), reference, wrappedDigest,
    ].join('\0'), 'utf8');
  }

  _callKms(method, input) {
    let result;
    try { result = this.kmsClient[method](input); } catch (error) {
      throw new KmsKeyProviderError('kms_unavailable', 'managed key operation failed', error);
    }
    if (isThenable(result)) {
      throw new KmsKeyProviderError('async_kms_client_unsupported',
        'kmsClient must provide synchronous encrypt and decrypt methods');
    }
    if (!result || typeof result !== 'object') {
      throw new KmsKeyProviderError('kms_invalid_response', 'managed key operation returned no result');
    }
    return result;
  }

  _kmsEncrypt(plaintext, context) {
    const result = this._callKms('encrypt', {
      keyId: this.keyId,
      plaintext: Buffer.from(plaintext),
      encryptionContext: context,
    });
    const ciphertext = toBuffer(result.ciphertext || result.CiphertextBlob, 'KMS ciphertext');
    if (!ciphertext.length) throw new KmsKeyProviderError('kms_invalid_response', 'KMS ciphertext is empty');
    const reference = requireText(result.keyId || result.KeyId || result.reference || this.keyId,
      'KMS key reference', 2048);
    return { ciphertext, reference };
  }

  _kmsDecrypt(ciphertext, context, reference) {
    const result = this._callKms('decrypt', {
      keyId: this.keyId,
      keyReference: reference,
      ciphertext: Buffer.from(ciphertext),
      encryptionContext: context,
    });
    const plaintext = toBuffer(result.plaintext || result.Plaintext, 'KMS plaintext');
    if (plaintext.length !== 32) {
      plaintext.fill(0);
      throw new KmsKeyProviderError('kms_invalid_response', 'KMS plaintext key must be 32 bytes');
    }
    return plaintext;
  }

  _removeCacheEntry(cacheKey) {
    const entry = this.cache.get(cacheKey);
    if (entry && entry.key) entry.key.fill(0);
    this.cache.delete(cacheKey);
  }

  _getCached(predicate) {
    const now = Number(this.now());
    for (const [cacheKey, entry] of this.cache) {
      if (entry.expiresAtMs <= now) {
        this._removeCacheEntry(cacheKey);
        continue;
      }
      if (!predicate(entry)) continue;
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, entry);
      return entry;
    }
    return null;
  }

  _putCached(cacheKey, entry) {
    if (this.cache.has(cacheKey)) this._removeCacheEntry(cacheKey);
    while (this.cache.size >= this.cacheMaxEntries) {
      this._removeCacheEntry(this.cache.keys().next().value);
    }
    this.cache.set(cacheKey, Object.assign({}, entry, {
      key: Buffer.from(entry.key),
      expiresAtMs: Number(this.now()) + this.cacheTtlMs,
    }));
    return this.cache.get(cacheKey);
  }

  _workspaceKeyForEncrypt(workspaceId) {
    const cached = this._getCached((entry) => entry.scope === 'workspace' &&
      entry.resourceId === workspaceId && entry.current === true);
    if (cached) return cached;
    const plaintextKey = this.randomBytes(32);
    if (!Buffer.isBuffer(plaintextKey) || plaintextKey.length !== 32) {
      throw new KmsKeyProviderError('random_source_failure', 'random source did not return 32 bytes');
    }
    try {
      const wrapped = this._kmsEncrypt(plaintextKey, this._context('workspace-data-key', workspaceId, FORMAT_VERSION));
      const wrappedDigest = digest(wrapped.ciphertext);
      return this._putCached('workspace:' + workspaceId + ':' + wrappedDigest, {
        scope: 'workspace', resourceId: workspaceId, current: true,
        key: plaintextKey, wrappedKey: wrapped.ciphertext,
        wrappedDigest, reference: wrapped.reference,
      });
    } finally {
      plaintextKey.fill(0);
    }
  }

  _workspaceKeyForDecrypt(workspaceId, envelope) {
    const wrappedDigest = digest(envelope.wrappedKey);
    const cached = this._getCached((entry) => entry.scope === 'workspace' &&
      entry.resourceId === workspaceId && entry.wrappedDigest === wrappedDigest &&
      entry.reference === envelope.reference);
    if (cached) return cached;
    const key = this._kmsDecrypt(envelope.wrappedKey,
      this._context('workspace-data-key', workspaceId, FORMAT_VERSION), envelope.reference);
    try {
      return this._putCached('workspace:' + workspaceId + ':' + wrappedDigest, {
        scope: 'workspace', resourceId: workspaceId, current: false,
        key, wrappedKey: envelope.wrappedKey, wrappedDigest, reference: envelope.reference,
      });
    } finally {
      key.fill(0);
    }
  }

  wrapProjectKey(projectId, version, projectKey) {
    projectId = requireText(projectId, 'projectId', 255);
    version = requireVersion(version);
    const key = toBuffer(projectKey, 'project key');
    if (key.length !== 32) throw new KmsKeyProviderError('invalid_key_material', 'project key must be 32 bytes');
    const wrapped = this._kmsEncrypt(key, this._context('project-key', projectId, version));
    const wrappedDigest = digest(wrapped.ciphertext);
    this._putCached('project:' + projectId + ':' + version + ':' + wrappedDigest, {
      scope: 'project', resourceId: projectId, version, wrappedDigest,
      reference: wrapped.reference, key,
    });
    key.fill(0);
    return { ciphertext: wrapped.ciphertext, nonce: Buffer.from(PROJECT_MARKER), reference: wrapped.reference };
  }

  unwrapProjectKey(projectId, version, wrapped) {
    projectId = requireText(projectId, 'projectId', 255);
    version = requireVersion(version);
    if (!wrapped || !Buffer.isBuffer(wrapped.nonce) || !wrapped.nonce.equals(PROJECT_MARKER)) {
      throw new KmsKeyProviderError('invalid_ciphertext', 'project key envelope is invalid');
    }
    const ciphertext = toBuffer(wrapped.ciphertext, 'wrapped project key');
    const reference = requireText(wrapped.reference, 'project key reference', 2048);
    const wrappedDigest = digest(ciphertext);
    const cached = this._getCached((entry) => entry.scope === 'project' &&
      entry.resourceId === projectId && entry.version === version &&
      entry.wrappedDigest === wrappedDigest && entry.reference === reference);
    if (cached) return Buffer.from(cached.key);
    const key = this._kmsDecrypt(ciphertext, this._context('project-key', projectId, version), reference);
    this._putCached('project:' + projectId + ':' + version + ':' + wrappedDigest, {
      scope: 'project', resourceId: projectId, version, wrappedDigest, reference, key,
    });
    const output = Buffer.from(key);
    key.fill(0);
    return output;
  }

  encryptWorkspaceName(workspaceId, name) {
    return this.encryptWorkspaceValue(workspaceId, 'workspace-name', name);
  }

  decryptWorkspaceName(workspaceId, encrypted) {
    return this.decryptWorkspaceValue(workspaceId, 'workspace-name', encrypted);
  }

  encryptWorkspaceValue(workspaceId, kind, value) {
    workspaceId = requireText(workspaceId, 'workspaceId', 255);
    kind = requireText(kind, 'kind', 255);
    if (typeof value !== 'string') throw new KmsKeyProviderError('invalid_key_material', 'workspace value must be a string');
    const entry = this._workspaceKeyForEncrypt(workspaceId);
    const encrypted = localEncrypt(entry.key, Buffer.from(value, 'utf8'),
      this._localAad(workspaceId, kind, FORMAT_VERSION, entry.reference, entry.wrappedDigest), this.randomBytes);
    return {
      nonce: encrypted.nonce,
      ciphertext: packWorkspaceEnvelope(entry.reference, entry.wrappedKey, encrypted.ciphertext),
    };
  }

  decryptWorkspaceValue(workspaceId, kind, encrypted) {
    workspaceId = requireText(workspaceId, 'workspaceId', 255);
    kind = requireText(kind, 'kind', 255);
    if (!encrypted) throw new KmsKeyProviderError('invalid_ciphertext', 'workspace envelope is required');
    const envelope = unpackWorkspaceEnvelope(encrypted.ciphertext);
    const entry = this._workspaceKeyForDecrypt(workspaceId, envelope);
    return localDecrypt(entry.key, encrypted.nonce, envelope.ciphertext,
      this._localAad(workspaceId, kind, FORMAT_VERSION, envelope.reference,
        digest(envelope.wrappedKey))).toString('utf8');
  }

  clearCache() {
    Array.from(this.cache.keys()).forEach((cacheKey) => this._removeCacheEntry(cacheKey));
  }
}

function createManagedKmsKeyProvider(options) {
  return new ManagedKmsKeyProvider(options);
}

module.exports = {
  FORMAT_VERSION,
  KmsKeyProviderError,
  ManagedKmsKeyProvider,
  createManagedKmsKeyProvider,
};
