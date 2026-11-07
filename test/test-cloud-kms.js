const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function contextBytes(context) {
  return Buffer.from(JSON.stringify(context), 'utf8');
}

function createFakeKms(rootKey) {
  return {
    encryptCalls: [],
    decryptCalls: [],
    encrypt(input) {
      this.encryptCalls.push(input);
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', rootKey, nonce);
      cipher.setAAD(contextBytes(input.encryptionContext));
      const body = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
      return {
        ciphertext: Buffer.concat([nonce, body, cipher.getAuthTag()]),
        keyId: 'kms://projects/sdocs/keys/cloud-root/versions/7',
      };
    },
    decrypt(input) {
      this.decryptCalls.push(input);
      const value = input.ciphertext;
      const nonce = value.subarray(0, 12);
      const body = value.subarray(12, value.length - 16);
      const tag = value.subarray(value.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', rootKey, nonce);
      decipher.setAAD(contextBytes(input.encryptionContext));
      decipher.setAuthTag(tag);
      return { plaintext: Buffer.concat([decipher.update(body), decipher.final()]) };
    },
  };
}

function createAsyncFakeKms(rootKey) {
  const sync = createFakeKms(rootKey);
  return {
    encryptCalls: sync.encryptCalls,
    decryptCalls: sync.decryptCalls,
    async encrypt(input) { return sync.encrypt(input); },
    async decrypt(input) { return sync.decrypt(input); },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeTimers() {
  let now = 0;
  const pending = new Set();
  return {
    now: () => now,
    pending,
    setTimeout(callback, delay) {
      const timer = { callback, delay, at: now + delay, unreferenced: false,
        unref() { this.unreferenced = true; } };
      pending.add(timer);
      return timer;
    },
    clearTimeout(timer) { pending.delete(timer); },
    advance(milliseconds) {
      now += milliseconds;
      for (;;) {
        const due = Array.from(pending).find(timer => timer.at <= now);
        if (!due) break;
        pending.delete(due);
        due.callback();
      }
    },
  };
}

module.exports = function(harness) {
  const { assert, test, testAsync } = harness;

  return async function() {
    console.log('\n-- Cloud Managed KMS Tests ----------------------------\n');

    const { KmsKeyProviderError, createManagedKmsKeyProvider } = require('../lib/cloud-kms');
    const { createCloudStore } = require('../lib/cloud-store');
    const rootKey = crypto.randomBytes(32);
    const kmsClient = createFakeKms(rootKey);
    let clock = 1700000000000;
    const provider = createManagedKmsKeyProvider({
      kmsClient,
      keyId: 'kms://projects/sdocs/keys/cloud-root',
      environment: 'test',
      now: () => clock,
      cacheTtlMs: 100,
      cacheMaxEntries: 4,
    });

    test('wraps project keys with KMS context and returns CloudStore fields', () => {
      const projectKey = crypto.randomBytes(32);
      const wrapped = provider.wrapProjectKey('project-1', 3, projectKey);
      assert.ok(Buffer.isBuffer(wrapped.ciphertext));
      assert.ok(Buffer.isBuffer(wrapped.nonce));
      assert.strictEqual(wrapped.nonce.length, 12);
      assert.strictEqual(wrapped.reference, 'kms://projects/sdocs/keys/cloud-root/versions/7');
      assert.strictEqual(wrapped.ciphertext.includes(projectKey), false);
      assert.deepStrictEqual(kmsClient.encryptCalls.at(-1).encryptionContext, {
        application: 'sdocs-cloud', environment: 'test', purpose: 'project-key',
        resource_id: 'project-1', version: '3',
      });
      assert.deepStrictEqual(provider.unwrapProjectKey('project-1', 3, wrapped), projectKey);
    });

    test('encrypts workspace names and values under a KMS-wrapped local data key', () => {
      const before = kmsClient.encryptCalls.length;
      const name = provider.encryptWorkspaceName('workspace-1', 'Acme Engineering');
      const invitation = provider.encryptWorkspaceValue('workspace-1', 'invitation-email', 'person@example.com');
      assert.strictEqual(kmsClient.encryptCalls.length, before + 1);
      assert.strictEqual(name.ciphertext.includes(Buffer.from('Acme Engineering')), false);
      assert.strictEqual(invitation.ciphertext.includes(Buffer.from('person@example.com')), false);
      assert.strictEqual(provider.decryptWorkspaceName('workspace-1', name), 'Acme Engineering');
      assert.strictEqual(provider.decryptWorkspaceValue('workspace-1', 'invitation-email', invitation),
        'person@example.com');
      assert.deepStrictEqual(kmsClient.encryptCalls.at(-1).encryptionContext, {
        application: 'sdocs-cloud', environment: 'test', purpose: 'workspace-data-key',
        resource_id: 'workspace-1', version: '1',
      });
    });

    test('uses cached plaintext keys only within the bounded TTL', () => {
      const encrypted = provider.encryptWorkspaceName('workspace-cache', 'Cached workspace');
      const decryptBefore = kmsClient.decryptCalls.length;
      assert.strictEqual(provider.decryptWorkspaceName('workspace-cache', encrypted), 'Cached workspace');
      assert.strictEqual(kmsClient.decryptCalls.length, decryptBefore);
      clock += 101;
      assert.strictEqual(provider.decryptWorkspaceName('workspace-cache', encrypted), 'Cached workspace');
      assert.strictEqual(kmsClient.decryptCalls.length, decryptBefore + 1);
    });

    test('evicts least recently used keys when the cache reaches its bound', () => {
      const smallKms = createFakeKms(rootKey);
      const small = createManagedKmsKeyProvider({
        kmsClient: smallKms, keyId: 'kms://root', environment: 'test',
        now: () => clock, cacheTtlMs: 1000, cacheMaxEntries: 2,
      });
      const first = small.encryptWorkspaceName('workspace-a', 'A');
      small.encryptWorkspaceName('workspace-b', 'B');
      small.encryptWorkspaceName('workspace-c', 'C');
      assert.strictEqual(small.cache.size, 2);
      assert.strictEqual(small.decryptWorkspaceName('workspace-a', first), 'A');
      assert.strictEqual(smallKms.decryptCalls.length, 1);
      assert.strictEqual(small.cache.size, 2);
      small.clearCache();
      assert.strictEqual(small.cache.size, 0);
    });

    await testAsync('wipes idle expired keys with a background timer and leaves caller copies intact', async () => {
      const idleKms = createAsyncFakeKms(rootKey);
      const idle = createManagedKmsKeyProvider({
        kmsClient: idleKms, keyId: 'kms://root', environment: 'test', cacheTtlMs: 10,
      });
      const original = crypto.randomBytes(32);
      let callerKey;
      try {
        const wrapped = await idle.wrapProjectKey('idle-project', 1, original);
        callerKey = await idle.unwrapProjectKey('idle-project', 1, wrapped);
        const cachedKey = Array.from(idle.cache.values())[0].key;
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.strictEqual(idle.cache.size, 0);
        assert.ok(cachedKey.equals(Buffer.alloc(32)));
        assert.deepStrictEqual(callerKey, original);
        assert.strictEqual(idleKms.decryptCalls.length, 0);
        const next = await idle.unwrapProjectKey('idle-project', 1, wrapped);
        assert.deepStrictEqual(next, original);
        assert.strictEqual(idleKms.decryptCalls.length, 1);
        next.fill(0);
      } finally {
        idle.clearCache();
        original.fill(0);
        if (callerKey) callerKey.fill(0);
      }
    });

    test('uses one unreferenced expiry timer without extending TTL on cache hits', () => {
      const timers = fakeTimers();
      const timedKms = createFakeKms(rootKey);
      const timed = createManagedKmsKeyProvider({ kmsClient: timedKms,
        keyId: 'kms://root', environment: 'test', cacheTtlMs: 100, ...timers });
      try {
        const first = timed.encryptWorkspaceName('timed-a', 'First');
        const firstKey = Array.from(timed.cache.values())[0].key;
        const firstTimer = Array.from(timers.pending)[0];
        assert.strictEqual(timers.pending.size, 1);
        assert.strictEqual(firstTimer.unreferenced, true);
        timers.advance(30);
        timed.encryptWorkspaceName('timed-b', 'Second');
        const secondKey = Array.from(timed.cache.values()).find(entry => entry.resourceId === 'timed-b').key;
        for (let i = 0; i < 20; i++) {
          assert.strictEqual(timed.decryptWorkspaceName('timed-a', first), 'First');
        }
        assert.strictEqual(Array.from(timers.pending)[0], firstTimer);
        assert.strictEqual(timedKms.decryptCalls.length, 0);
        timers.advance(69);
        assert.strictEqual(timed.cache.size, 2);
        timers.advance(1);
        assert.ok(firstKey.equals(Buffer.alloc(32)));
        assert.ok(!secondKey.equals(Buffer.alloc(32)));
        assert.strictEqual(timed.cache.size, 1);
        assert.strictEqual(timers.pending.size, 1);
        timers.advance(30);
        assert.ok(secondKey.equals(Buffer.alloc(32)));
        assert.strictEqual(timed.cache.size, 0);
        assert.strictEqual(timers.pending.size, 0);
        assert.strictEqual(timedKms.encryptCalls.length, 2);
        assert.strictEqual(timedKms.decryptCalls.length, 0);
      } finally { timed.clearCache(); }
    });

    test('cancels expiry on cache clear and ignores stale timer callbacks after reuse', () => {
      const timers = fakeTimers();
      const timed = createManagedKmsKeyProvider({ kmsClient: createFakeKms(rootKey),
        keyId: 'kms://root', environment: 'test', cacheTtlMs: 100, ...timers });
      try {
        timed.encryptWorkspaceName('timed-clear', 'First');
        const oldKey = Array.from(timed.cache.values())[0].key;
        const oldTimer = Array.from(timers.pending)[0];
        timed.clearCache();
        assert.ok(oldKey.equals(Buffer.alloc(32)));
        assert.strictEqual(timers.pending.size, 0);
        timed.encryptWorkspaceName('timed-clear', 'Second');
        const newKey = Array.from(timed.cache.values())[0].key;
        const newTimer = Array.from(timers.pending)[0];
        oldTimer.callback();
        assert.strictEqual(timers.pending.size, 1);
        assert.strictEqual(Array.from(timers.pending)[0], newTimer);
        assert.ok(!newKey.equals(Buffer.alloc(32)));
        timers.advance(100);
        assert.ok(newKey.equals(Buffer.alloc(32)));
        assert.strictEqual(timed.cache.size, 0);
      } finally { timed.clearCache(); }
    });

    test('splits long cache TTLs into supported timer delays without early expiry', () => {
      const timers = fakeTimers();
      const timed = createManagedKmsKeyProvider({ kmsClient: createFakeKms(rootKey),
        keyId: 'kms://root', environment: 'test', cacheTtlMs: 0x7fffffff + 20, ...timers });
      try {
        timed.encryptWorkspaceName('long-ttl', 'Name');
        const key = Array.from(timed.cache.values())[0].key;
        assert.strictEqual(Array.from(timers.pending)[0].delay, 0x7fffffff);
        timers.advance(0x7fffffff);
        assert.strictEqual(timed.cache.size, 1);
        assert.strictEqual(Array.from(timers.pending)[0].delay, 20);
        timers.advance(20);
        assert.ok(key.equals(Buffer.alloc(32)));
        assert.strictEqual(timed.cache.size, 0);
      } finally { timed.clearCache(); }
    });

    test('binds workspace ciphertext to environment, workspace, kind, and wrapped key', () => {
      const encrypted = provider.encryptWorkspaceValue('workspace-bound', 'invitation-email', 'bound@example.com');
      assert.throws(() => provider.decryptWorkspaceValue('workspace-other', 'invitation-email', encrypted),
        (error) => error instanceof KmsKeyProviderError);
      assert.throws(() => provider.decryptWorkspaceValue('workspace-bound', 'workspace-name', encrypted),
        (error) => error instanceof KmsKeyProviderError && error.code === 'decryption_failed');
      const tampered = { nonce: encrypted.nonce, ciphertext: Buffer.from(encrypted.ciphertext) };
      tampered.ciphertext[tampered.ciphertext.length - 1] ^= 1;
      assert.throws(() => provider.decryptWorkspaceValue('workspace-bound', 'invitation-email', tampered),
        (error) => error instanceof KmsKeyProviderError && error.code === 'decryption_failed');
      const otherEnvironment = createManagedKmsKeyProvider({
        kmsClient, keyId: 'kms://projects/sdocs/keys/cloud-root', environment: 'production',
      });
      assert.throws(() => otherEnvironment.decryptWorkspaceValue(
        'workspace-bound', 'invitation-email', encrypted),
        (error) => error instanceof KmsKeyProviderError && error.code === 'kms_unavailable');
    });

    test('fails closed for malformed envelopes', () => {
      assert.throws(() => provider.unwrapProjectKey('project-1', 1, {
        ciphertext: Buffer.from('invalid'), nonce: Buffer.alloc(12), reference: 'kms://root',
      }), (error) => error.code === 'invalid_ciphertext');
      assert.throws(() => provider.decryptWorkspaceName('workspace-1', {
        ciphertext: Buffer.from('invalid'), nonce: Buffer.alloc(12),
      }), (error) => error.code === 'invalid_ciphertext');
    });

    await testAsync('supports asynchronous managed KMS clients without changing envelope fields', async () => {
      const asyncKms = createAsyncFakeKms(rootKey);
      const asyncProvider = createManagedKmsKeyProvider({
        kmsClient: asyncKms, keyId: 'kms://root', environment: 'test',
      });
      const projectKey = crypto.randomBytes(32);
      const wrapped = await asyncProvider.wrapProjectKey('async-project', 2, projectKey);
      assert.ok(Buffer.isBuffer(wrapped.ciphertext));
      assert.ok(wrapped.nonce.equals(Buffer.from('sdocskmsv001')));
      assert.strictEqual(wrapped.reference, 'kms://projects/sdocs/keys/cloud-root/versions/7');
      asyncProvider.clearCache();
      assert.deepStrictEqual(await asyncProvider.unwrapProjectKey('async-project', 2, wrapped), projectKey);
      const encrypted = await asyncProvider.encryptWorkspaceName('async-workspace', 'Async workspace');
      asyncProvider.clearCache();
      assert.strictEqual(await asyncProvider.decryptWorkspaceName('async-workspace', encrypted),
        'Async workspace');
      assert.deepStrictEqual(asyncKms.encryptCalls[0].encryptionContext, {
        application: 'sdocs-cloud', environment: 'test', purpose: 'project-key',
        resource_id: 'async-project', version: '2',
      });
      asyncProvider.clearCache();
    });

    await testAsync('shares concurrent workspace KMS calls and wipes the request key copy', async () => {
      const gate = deferred();
      const syncKms = createFakeKms(rootKey);
      let encryptCalls = 0;
      let retainedPlaintext;
      const singleFlightProvider = createManagedKmsKeyProvider({
        kmsClient: {
          encrypt(input) {
            encryptCalls += 1;
            retainedPlaintext = input.plaintext;
            return gate.promise.then(() => syncKms.encrypt(input));
          },
          decrypt: async (input) => syncKms.decrypt(input),
        },
        keyId: 'kms://root', environment: 'test',
      });
      const first = singleFlightProvider.encryptWorkspaceName('shared-workspace', 'First');
      const second = singleFlightProvider.encryptWorkspaceName('shared-workspace', 'Second');
      assert.strictEqual(encryptCalls, 1);
      gate.resolve();
      const [firstEncrypted, secondEncrypted] = await Promise.all([first, second]);
      assert.strictEqual(encryptCalls, 1);
      assert.strictEqual(retainedPlaintext.every((value) => value === 0), true);
      assert.strictEqual(singleFlightProvider.cache.size, 1);
      assert.strictEqual(await singleFlightProvider.decryptWorkspaceName('shared-workspace', firstEncrypted),
        'First');
      assert.strictEqual(await singleFlightProvider.decryptWorkspaceName('shared-workspace', secondEncrypted),
        'Second');
      singleFlightProvider.clearCache();
    });

    await testAsync('concurrent project unwraps share one KMS request with independent caller keys', async () => {
      const asyncKms = createAsyncFakeKms(rootKey);
      const concurrent = createManagedKmsKeyProvider({
        kmsClient: asyncKms, keyId: 'kms://root', environment: 'test',
      });
      const original = crypto.randomBytes(32);
      const callers = [];
      try {
        const wrapped = await concurrent.wrapProjectKey('shared-project', 1, original);
        concurrent.clearCache();
        callers.push(...await Promise.all(Array.from({ length: 20 }, () =>
          concurrent.unwrapProjectKey('shared-project', 1, wrapped))));
        assert.strictEqual(asyncKms.decryptCalls.length, 1);
        callers[0].fill(0);
        for (const key of callers.slice(1)) assert.deepStrictEqual(key, original);
        const cachedCopy = await concurrent.unwrapProjectKey('shared-project', 1, wrapped);
        callers.push(cachedCopy);
        assert.deepStrictEqual(cachedCopy, original);
        assert.strictEqual(asyncKms.decryptCalls.length, 1);
        concurrent.clearCache();
        for (const key of callers.slice(1)) assert.deepStrictEqual(key, original);
      } finally {
        concurrent.clearCache(); original.fill(0);
        for (const key of callers) key.fill(0);
      }
    });

    await testAsync('cache eviction during concurrent workspace operations cannot wipe their working keys', async () => {
      const asyncKms = createAsyncFakeKms(rootKey);
      const concurrent = createManagedKmsKeyProvider({
        kmsClient: asyncKms, keyId: 'kms://root', environment: 'test', cacheMaxEntries: 1,
      });
      try {
        const encrypted = await Promise.all(['a', 'b', 'c'].map(id =>
          concurrent.encryptWorkspaceName(id, 'Workspace ' + id)));
        for (let i = 0; i < encrypted.length; i++) {
          concurrent.clearCache();
          assert.strictEqual(await concurrent.decryptWorkspaceName(['a', 'b', 'c'][i], encrypted[i]),
            'Workspace ' + ['a', 'b', 'c'][i]);
        }
        concurrent.clearCache();
        const values = await Promise.all(encrypted.map((value, i) =>
          concurrent.decryptWorkspaceName(['a', 'b', 'c'][i], value)));
        assert.deepStrictEqual(values, ['Workspace a', 'Workspace b', 'Workspace c']);
      } finally { concurrent.clearCache(); }
    });

    await testAsync('concurrent unwraps for different projects survive eviction before delivery', async () => {
      const concurrent = createManagedKmsKeyProvider({ kmsClient: createAsyncFakeKms(rootKey),
        keyId: 'kms://root', environment: 'test', cacheMaxEntries: 1 });
      const originals = [crypto.randomBytes(32), crypto.randomBytes(32), crypto.randomBytes(32)];
      const keys = [];
      try {
        const wrapped = await Promise.all(originals.map((key, i) => concurrent.wrapProjectKey('burst-' + i, 1, key)));
        concurrent.clearCache();
        keys.push(...await Promise.all(wrapped.map((value, i) => concurrent.unwrapProjectKey('burst-' + i, 1, value))));
        keys.forEach((key, i) => assert.deepStrictEqual(key, originals[i]));
        assert.strictEqual(concurrent.cache.size, 1);
      } finally {
        concurrent.clearCache();
        for (const key of originals.concat(keys)) key.fill(0);
      }
    });

    await testAsync('cache clear rejects old unwraps without deleting a replacement flight or retaining its key', async () => {
      const syncKms = createFakeKms(rootKey);
      const gates = [deferred(), deferred()];
      const retained = [];
      let calls = 0;
      const managed = createManagedKmsKeyProvider({ keyId: 'kms://root', environment: 'test', kmsClient: {
        encrypt: input => syncKms.encrypt(input),
        decrypt(input) {
          const gate = gates[calls++];
          return gate.promise.then(() => {
            const result = syncKms.decrypt(input);
            retained.push(result.plaintext);
            return result;
          });
        },
      } });
      const original = crypto.randomBytes(32);
      let current;
      try {
        const wrapped = managed.wrapProjectKey('cleared-project', 1, original);
        managed.clearCache();
        const old = managed.unwrapProjectKey('cleared-project', 1, wrapped);
        const oldResult = assert.rejects(old, error => error.code === 'kms_cache_cleared');
        managed.clearCache();
        const replacement = managed.unwrapProjectKey('cleared-project', 1, wrapped);
        gates[0].resolve();
        await oldResult;
        assert.strictEqual(managed.cache.size, 0);
        assert.strictEqual(managed.inflight.size, 1);
        gates[1].resolve();
        current = await replacement;
        assert.deepStrictEqual(current, original);
        assert.strictEqual(managed.inflight.size, 0);
        assert.ok(retained.every(key => key.equals(Buffer.alloc(32))));
      } finally {
        managed.clearCache(); original.fill(0);
        if (current) current.fill(0);
      }
    });

    await testAsync('a failed workspace decrypt does not affect concurrent callers of the same key', async () => {
      const asyncKms = createAsyncFakeKms(rootKey);
      const concurrent = createManagedKmsKeyProvider({ kmsClient: asyncKms,
        keyId: 'kms://root', environment: 'test' });
      try {
        const encrypted = await concurrent.encryptWorkspaceName('shared-decrypt', 'Name');
        const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
        tampered.ciphertext[tampered.ciphertext.length - 1] ^= 1;
        concurrent.clearCache();
        const results = await Promise.allSettled([
          concurrent.decryptWorkspaceName('shared-decrypt', tampered),
          concurrent.decryptWorkspaceName('shared-decrypt', encrypted),
        ]);
        assert.strictEqual(results[0].status, 'rejected');
        assert.strictEqual(results[0].reason.code, 'decryption_failed');
        assert.deepStrictEqual(results[1], { status: 'fulfilled', value: 'Name' });
        assert.strictEqual(asyncKms.decryptCalls.length, 1);
      } finally { concurrent.clearCache(); }
    });

    await testAsync('cache clear prevents late KMS work from restoring plaintext cache entries', async () => {
      const gate = deferred();
      const syncKms = createFakeKms(rootKey);
      let retainedPlaintext;
      const clearingProvider = createManagedKmsKeyProvider({
        kmsClient: {
          encrypt(input) {
            retainedPlaintext = input.plaintext;
            return gate.promise.then(() => syncKms.encrypt(input));
          },
          decrypt: async (input) => syncKms.decrypt(input),
        },
        keyId: 'kms://root', environment: 'test',
      });
      const pending = clearingProvider.encryptWorkspaceName('cleared-workspace', 'Name');
      clearingProvider.clearCache();
      gate.resolve();
      await assert.rejects(pending, (error) => error.code === 'kms_cache_cleared');
      assert.strictEqual(clearingProvider.cache.size, 0);
      assert.strictEqual(clearingProvider.inflight.size, 0);
      assert.strictEqual(retainedPlaintext.every((value) => value === 0), true);
    });

    await testAsync('maps asynchronous KMS rejection and malformed responses to provider errors', async () => {
      let rejectedPlaintext;
      const unavailable = createManagedKmsKeyProvider({
        kmsClient: {
          encrypt: async (input) => {
            rejectedPlaintext = input.plaintext;
            throw new Error('network detail');
          },
          decrypt: async () => { throw new Error('network detail'); },
        },
        keyId: 'kms://root', environment: 'test',
      });
      await assert.rejects(unavailable.encryptWorkspaceName('workspace-1', 'Name'),
        (error) => error instanceof KmsKeyProviderError && error.code === 'kms_unavailable');
      assert.strictEqual(rejectedPlaintext.every((value) => value === 0), true);
      const malformed = createManagedKmsKeyProvider({
        kmsClient: { encrypt: async () => ({}), decrypt: async () => ({}) },
        keyId: 'kms://root', environment: 'test',
      });
      await assert.rejects(malformed.encryptWorkspaceName('workspace-1', 'Name'),
        (error) => error instanceof KmsKeyProviderError && error.code === 'kms_invalid_response');
      const adapterMalformed = createManagedKmsKeyProvider({
        kmsClient: {
          encrypt: async () => { throw Object.assign(new Error('invalid response'), {
            code: 'aws_kms_invalid_response',
          }); },
          decrypt: async () => ({}),
        },
        keyId: 'kms://root', environment: 'test',
      });
      await assert.rejects(adapterMalformed.encryptWorkspaceName('workspace-1', 'Name'),
        (error) => error instanceof KmsKeyProviderError && error.code === 'kms_invalid_response');
    });

    await testAsync('works through the existing CloudStore keyProvider interface', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-kms-'));
      const storeProvider = createManagedKmsKeyProvider({
        kmsClient: createFakeKms(rootKey), keyId: 'kms://root', environment: 'test',
      });
      const store = createCloudStore({
        dbPath: path.join(directory, 'cloud.db'), keyProvider: storeProvider,
        idempotencySecret: 'test-idempotency-secret',
      });
      try {
        const workspace = await store.ensurePersonalWorkspace('user-1', 'Personal');
        const document = await store.createDocument({
          userId: 'user-1', projectId: workspace.projectId,
          filename: 'kms.md', markdown: '# Managed KMS\n\nEncrypted content.',
          idempotencyKey: 'create-kms-doc',
        });
        assert.strictEqual((await store.getDocument({ userId: 'user-1', documentId: document.id })).markdown,
          '# Managed KMS\n\nEncrypted content.');
        const raw = store.db.prepare('SELECT body_ciphertext FROM cloud_document_revisions WHERE document_id = ?')
          .get(document.id).body_ciphertext;
        assert.strictEqual(raw.includes(Buffer.from('Encrypted content')), false);
      } finally {
        store.close();
        storeProvider.clearCache();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    await testAsync('concurrent cold-cache document reads and saves preserve encrypted bodies and retry receipts', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-kms-concurrent-'));
      const managed = createManagedKmsKeyProvider({ kmsClient: createAsyncFakeKms(rootKey),
        keyId: 'kms://root', environment: 'test' });
      const store = createCloudStore({ dbPath: path.join(directory, 'cloud.db'),
        keyProvider: managed, idempotencySecret: 'concurrent-kms-idempotency-secret' });
      try {
        const workspace = await store.ensurePersonalWorkspace('owner', 'Personal');
        const input = { userId: 'owner', projectId: workspace.projectId,
          filename: 'original.md', markdown: '# Original', idempotencyKey: 'original' };
        const original = await store.createDocument(input);
        const read = () => store.getDocument({ userId: 'owner', documentId: original.id });
        managed.clearCache();
        const reads = await Promise.all([read(), read(), read()]);
        for (const value of reads) assert.strictEqual(value.markdown, '# Original');
        managed.clearCache();
        const create = { ...input, filename: 'second.md', markdown: '# Second', idempotencyKey: 'second' };
        const [, second] = await Promise.all([read(), store.createDocument(create)]);
        managed.clearCache();
        assert.strictEqual((await store.getDocument({ userId: 'owner', documentId: second.id })).markdown, '# Second');
        managed.clearCache();
        assert.strictEqual((await store.createDocument(create)).id, second.id);
      } finally {
        store.close(); managed.clearCache(); fs.rmSync(directory, { recursive: true, force: true });
      }
    });
    provider.clearCache();
  };
};
