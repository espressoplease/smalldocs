const crypto = require('crypto');
const { performance } = require('perf_hooks');

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

function copyKey(value) {
  // Keep retained keys out of Node's shared small-buffer allocation pool.
  const copy = Buffer.alloc(value.length);
  copy.set(value);
  return copy;
}

function wipeKeyEntry(entry) {
  if (entry && Buffer.isBuffer(entry.key)) entry.key.fill(0);
}

function toBuffer(value, name, secret) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return secret ? copyKey(value) : Buffer.from(value);
  }
  throw new KmsKeyProviderError('kms_invalid_response', name + ' must be bytes');
}

function isThenable(value) {
  return value && typeof value.then === 'function';
}

function mapMaybe(value, transform) {
  return isThenable(value) ? Promise.resolve(value).then(transform) : transform(value);
}

function mapMaybeFinally(value, transform, cleanup) {
  if (isThenable(value)) {
    let resolved;
    return Promise.resolve(value).then((item) => {
      resolved = item;
      return transform(item);
    }).finally(() => cleanup(resolved));
  }
  try { return transform(value); } finally { cleanup(value); }
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeKmsError(error) {
  if (error instanceof KmsKeyProviderError) return error;
  if (error && error.code === 'aws_kms_invalid_response') {
    return new KmsKeyProviderError('kms_invalid_response', 'managed key operation returned an invalid result', error);
  }
  return new KmsKeyProviderError('kms_unavailable', 'managed key operation failed', error);
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
  let plaintext;
  let final;
  try {
    const body = ciphertext.subarray(0, ciphertext.length - 16);
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAAD(associatedData);
    decipher.setAuthTag(tag);
    plaintext = decipher.update(body);
    final = decipher.final();
    return Buffer.concat([plaintext, final]);
  } catch (error) {
    throw new KmsKeyProviderError('decryption_failed', 'workspace ciphertext could not be authenticated', error);
  } finally {
    if (plaintext) plaintext.fill(0);
    if (final) final.fill(0);
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
    this.now = options.now || (() => performance.now());
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.cacheTtlMs = options.cacheTtlMs == null ? 5 * 60 * 1000 : Number(options.cacheTtlMs);
    this.cacheMaxEntries = options.cacheMaxEntries == null ? 256 : Number(options.cacheMaxEntries);
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 1 ||
        !Number.isSafeInteger(this.cacheMaxEntries) || this.cacheMaxEntries < 1) {
      throw new KmsKeyProviderError('invalid_key_provider_config', 'cache bounds are invalid');
    }
    this.cache = new Map();
    this.inflight = new Map();
    this.cacheGeneration = 0;
    this.cacheExpiryTimer = null;
    this.cacheExpiryAtMs = null;
    this.cacheExpiryGeneration = 0;
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
      throw normalizeKmsError(error);
    }
    const validate = (value) => {
      if (!value || typeof value !== 'object') {
        throw new KmsKeyProviderError('kms_invalid_response', 'managed key operation returned no result');
      }
      return value;
    };
    if (!isThenable(result)) return validate(result);
    return Promise.resolve(result).catch((error) => {
      throw normalizeKmsError(error);
    }).then(validate);
  }

  _kmsEncrypt(plaintext, context) {
    const kmsPlaintext = copyKey(plaintext);
    let result;
    try {
      result = this._callKms('encrypt', {
        keyId: this.keyId,
        plaintext: kmsPlaintext,
        encryptionContext: context,
      });
    } catch (error) {
      kmsPlaintext.fill(0);
      throw error;
    }
    return mapMaybeFinally(result, (value) => {
      const ciphertext = toBuffer(value.ciphertext || value.CiphertextBlob, 'KMS ciphertext');
      if (!ciphertext.length) throw new KmsKeyProviderError('kms_invalid_response', 'KMS ciphertext is empty');
      const reference = requireText(value.keyId || value.KeyId || value.reference || this.keyId,
        'KMS key reference', 2048);
      return { ciphertext, reference };
    }, () => kmsPlaintext.fill(0));
  }

  _kmsDecrypt(ciphertext, context, reference) {
    const result = this._callKms('decrypt', {
      keyId: this.keyId,
      keyReference: reference,
      ciphertext: Buffer.from(ciphertext),
      encryptionContext: context,
    });
    return mapMaybe(result, (value) => {
      const source = value.plaintext || value.Plaintext;
      const plaintext = toBuffer(source, 'KMS plaintext', true);
      if (Buffer.isBuffer(source) || source instanceof Uint8Array) source.fill(0);
      if (plaintext.length !== 32) {
        plaintext.fill(0);
        throw new KmsKeyProviderError('kms_invalid_response', 'KMS plaintext key must be 32 bytes');
      }
      return plaintext;
    });
  }

  _removeCacheEntry(cacheKey) {
    const entry = this.cache.get(cacheKey);
    if (entry && entry.key) entry.key.fill(0);
    this.cache.delete(cacheKey);
    if (!this.cache.size) this._cancelExpiry();
  }

  _cancelExpiry() {
    this.cacheExpiryGeneration += 1;
    if (this.cacheExpiryTimer !== null) this.clearTimeout(this.cacheExpiryTimer);
    this.cacheExpiryTimer = null;
    this.cacheExpiryAtMs = null;
  }

  _sweepExpired() {
    const now = Number(this.now());
    for (const [cacheKey, entry] of this.cache) {
      if (entry.expiresAtMs <= now) this._removeCacheEntry(cacheKey);
    }
  }

  _scheduleExpiry() {
    if (!this.cache.size) return this._cancelExpiry();
    let nextExpiry = Infinity;
    for (const entry of this.cache.values()) nextExpiry = Math.min(nextExpiry, entry.expiresAtMs);
    if (this.cacheExpiryTimer !== null && this.cacheExpiryAtMs <= nextExpiry) return;
    this._cancelExpiry();
    const generation = this.cacheExpiryGeneration;
    this.cacheExpiryAtMs = nextExpiry;
    // Node treats delays above its signed 32-bit limit as 1ms. Recheck long
    // lifetimes in bounded chunks instead of creating a busy timer loop.
    const delay = Math.min(0x7fffffff, Math.max(1, Math.ceil(nextExpiry - Number(this.now()))));
    this.cacheExpiryTimer = this.setTimeout(() => {
      if (generation !== this.cacheExpiryGeneration) return;
      this.cacheExpiryTimer = null;
      this.cacheExpiryAtMs = null;
      this._sweepExpired();
      this._scheduleExpiry();
    }, delay);
    if (this.cacheExpiryTimer && typeof this.cacheExpiryTimer.unref === 'function') {
      this.cacheExpiryTimer.unref();
    }
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
    this._sweepExpired();
    if (this.cache.has(cacheKey)) this._removeCacheEntry(cacheKey);
    while (this.cache.size >= this.cacheMaxEntries) {
      this._removeCacheEntry(this.cache.keys().next().value);
    }
    this.cache.set(cacheKey, Object.assign({}, entry, {
      key: copyKey(entry.key),
      expiresAtMs: Number(this.now()) + this.cacheTtlMs,
    }));
    this._scheduleExpiry();
    return this.cache.get(cacheKey);
  }

  _subscribe(flight, consume) {
    return new Promise((resolve, reject) => {
      flight.waiters.push({ resolve, reject, consume });
    });
  }

  _singleFlight(operationKey, operation, consume, cleanup) {
    const current = this.inflight.get(operationKey);
    if (current) return this._subscribe(current, consume);
    const generation = this.cacheGeneration;
    const value = operation();
    if (!isThenable(value)) {
      try { return consume ? consume(value) : value; }
      finally { if (cleanup) cleanup(value); }
    }
    const flight = { waiters: [] };
    const pending = this._subscribe(flight, consume);
    this.inflight.set(operationKey, flight);
    const finish = (error, result) => {
      if (this.inflight.get(operationKey) === flight) this.inflight.delete(operationKey);
      if (!error && generation !== this.cacheGeneration) {
        error = new KmsKeyProviderError('kms_cache_cleared', 'managed key cache was cleared during the operation');
      }
      // Copy or consume each working key synchronously, then wipe the shared
      // delivery copy before callers resume. Cache eviction cannot affect it.
      for (const waiter of flight.waiters) {
        if (error) { waiter.reject(error); continue; }
        try { waiter.resolve(waiter.consume ? waiter.consume(result) : result); }
        catch (failure) { waiter.reject(failure); }
      }
      if (cleanup) cleanup(result);
    };
    Promise.resolve(value).then(result => finish(null, result), error => finish(error));
    return pending;
  }

  _requireCacheGeneration(generation) {
    if (generation !== this.cacheGeneration) {
      throw new KmsKeyProviderError('kms_cache_cleared', 'managed key cache was cleared during the operation');
    }
  }

  _withWorkspaceKeyForEncrypt(workspaceId, consume) {
    const cached = this._getCached((entry) => entry.scope === 'workspace' &&
      entry.resourceId === workspaceId && entry.current === true);
    if (cached) return consume(cached);
    return this._singleFlight('workspace:current:' + workspaceId, () => {
      const generation = this.cacheGeneration;
      const plaintextKey = this.randomBytes(32);
      if (!Buffer.isBuffer(plaintextKey) || plaintextKey.length !== 32) {
        throw new KmsKeyProviderError('random_source_failure', 'random source did not return 32 bytes');
      }
      let wrapped;
      try {
        wrapped = this._kmsEncrypt(plaintextKey,
          this._context('workspace-data-key', workspaceId, FORMAT_VERSION));
      } catch (error) {
        plaintextKey.fill(0);
        throw error;
      }
      return mapMaybeFinally(wrapped, (value) => {
        this._requireCacheGeneration(generation);
        const wrappedDigest = digest(value.ciphertext);
        const entry = {
          scope: 'workspace', resourceId: workspaceId, current: true,
          key: plaintextKey, wrappedKey: value.ciphertext,
          wrappedDigest, reference: value.reference,
        };
        this._putCached('workspace:' + workspaceId + ':' + wrappedDigest, entry);
        return { ...entry, key: copyKey(plaintextKey) };
      }, () => plaintextKey.fill(0));
    }, consume, wipeKeyEntry);
  }

  _withWorkspaceKeyForDecrypt(workspaceId, envelope, consume) {
    const wrappedDigest = digest(envelope.wrappedKey);
    const cached = this._getCached((entry) => entry.scope === 'workspace' &&
      entry.resourceId === workspaceId && entry.wrappedDigest === wrappedDigest &&
      entry.reference === envelope.reference);
    if (cached) return consume(cached);
    const operationKey = ['workspace', 'unwrap', workspaceId, envelope.reference, wrappedDigest].join(':');
    return this._singleFlight(operationKey, () => {
      const generation = this.cacheGeneration;
      const key = this._kmsDecrypt(envelope.wrappedKey,
        this._context('workspace-data-key', workspaceId, FORMAT_VERSION), envelope.reference);
      return mapMaybeFinally(key, (value) => {
        this._requireCacheGeneration(generation);
        const entry = {
          scope: 'workspace', resourceId: workspaceId, current: false,
          key: value, wrappedKey: envelope.wrappedKey, wrappedDigest, reference: envelope.reference,
        };
        this._putCached('workspace:' + workspaceId + ':' + wrappedDigest, entry);
        return { ...entry, key: copyKey(value) };
      }, (value) => { if (value) value.fill(0); });
    }, consume, wipeKeyEntry);
  }

  wrapProjectKey(projectId, version, projectKey) {
    projectId = requireText(projectId, 'projectId', 255);
    version = requireVersion(version);
    const key = toBuffer(projectKey, 'project key', true);
    if (key.length !== 32) {
      key.fill(0);
      throw new KmsKeyProviderError('invalid_key_material', 'project key must be 32 bytes');
    }
    const operationKey = ['project', 'wrap', projectId, version, digest(key)].join(':');
    const current = this.inflight.get(operationKey);
    if (current) {
      key.fill(0);
      return this._subscribe(current);
    }
    return this._singleFlight(operationKey, () => {
      const generation = this.cacheGeneration;
      let wrapped;
      try {
        wrapped = this._kmsEncrypt(key, this._context('project-key', projectId, version));
      } catch (error) {
        key.fill(0);
        throw error;
      }
      return mapMaybeFinally(wrapped, (value) => {
        this._requireCacheGeneration(generation);
        const wrappedDigest = digest(value.ciphertext);
        this._putCached('project:' + projectId + ':' + version + ':' + wrappedDigest, {
          scope: 'project', resourceId: projectId, version, wrappedDigest,
          reference: value.reference, key,
        });
        return { ciphertext: value.ciphertext, nonce: Buffer.from(PROJECT_MARKER), reference: value.reference };
      }, () => key.fill(0));
    });
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
    if (cached) return copyKey(cached.key);
    const operationKey = ['project', 'unwrap', projectId, version, reference, wrappedDigest].join(':');
    return this._singleFlight(operationKey, () => {
      const generation = this.cacheGeneration;
      const key = this._kmsDecrypt(ciphertext, this._context('project-key', projectId, version), reference);
      return mapMaybeFinally(key, (value) => {
        this._requireCacheGeneration(generation);
        const entry = {
          scope: 'project', resourceId: projectId, version, wrappedDigest, reference, key: value,
        };
        this._putCached('project:' + projectId + ':' + version + ':' + wrappedDigest, entry);
        return { ...entry, key: copyKey(value) };
      }, (value) => { if (value) value.fill(0); });
    }, entry => copyKey(entry.key), wipeKeyEntry);
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
    return this._withWorkspaceKeyForEncrypt(workspaceId, (valueEntry) => {
      const plaintext = Buffer.from(value, 'utf8');
      try {
        const encrypted = localEncrypt(valueEntry.key, plaintext,
          this._localAad(workspaceId, kind, FORMAT_VERSION, valueEntry.reference,
            valueEntry.wrappedDigest), this.randomBytes);
        return {
          nonce: encrypted.nonce,
          ciphertext: packWorkspaceEnvelope(valueEntry.reference, valueEntry.wrappedKey, encrypted.ciphertext),
        };
      } finally { plaintext.fill(0); }
    });
  }

  decryptWorkspaceValue(workspaceId, kind, encrypted) {
    workspaceId = requireText(workspaceId, 'workspaceId', 255);
    kind = requireText(kind, 'kind', 255);
    if (!encrypted) throw new KmsKeyProviderError('invalid_ciphertext', 'workspace envelope is required');
    const envelope = unpackWorkspaceEnvelope(encrypted.ciphertext);
    return this._withWorkspaceKeyForDecrypt(workspaceId, envelope, (valueEntry) => {
      const plaintext = localDecrypt(valueEntry.key, encrypted.nonce, envelope.ciphertext,
        this._localAad(workspaceId, kind, FORMAT_VERSION, envelope.reference, digest(envelope.wrappedKey)));
      try { return plaintext.toString('utf8'); }
      finally { plaintext.fill(0); }
    });
  }

  clearCache() {
    this._cancelExpiry();
    this.cacheGeneration += 1;
    this.inflight.clear();
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
