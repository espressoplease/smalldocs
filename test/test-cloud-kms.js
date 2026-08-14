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

module.exports = function(harness) {
  const { assert, test } = harness;

  return function() {
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

    test('fails closed for malformed envelopes and asynchronous KMS clients', () => {
      assert.throws(() => provider.unwrapProjectKey('project-1', 1, {
        ciphertext: Buffer.from('invalid'), nonce: Buffer.alloc(12), reference: 'kms://root',
      }), (error) => error.code === 'invalid_ciphertext');
      assert.throws(() => provider.decryptWorkspaceName('workspace-1', {
        ciphertext: Buffer.from('invalid'), nonce: Buffer.alloc(12),
      }), (error) => error.code === 'invalid_ciphertext');
      const asyncProvider = createManagedKmsKeyProvider({
        kmsClient: { encrypt: async () => ({}), decrypt: async () => ({}) },
        keyId: 'kms://root', environment: 'test',
      });
      assert.throws(() => asyncProvider.encryptWorkspaceName('workspace-1', 'Name'),
        (error) => error.code === 'async_kms_client_unsupported');
    });

    test('works through the existing CloudStore keyProvider interface', () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-kms-'));
      const storeProvider = createManagedKmsKeyProvider({
        kmsClient: createFakeKms(rootKey), keyId: 'kms://root', environment: 'test',
      });
      const store = createCloudStore({
        dbPath: path.join(directory, 'cloud.db'), keyProvider: storeProvider,
        idempotencySecret: 'test-idempotency-secret',
      });
      try {
        const workspace = store.ensurePersonalWorkspace('user-1', 'Personal');
        const document = store.createDocument({
          userId: 'user-1', projectId: workspace.projectId,
          filename: 'kms.md', markdown: '# Managed KMS\n\nEncrypted content.',
          idempotencyKey: 'create-kms-doc',
        });
        assert.strictEqual(store.getDocument({ userId: 'user-1', documentId: document.id }).markdown,
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
  };
};
