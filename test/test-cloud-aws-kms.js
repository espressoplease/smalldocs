function fakeSdk() {
  class EncryptCommand {
    constructor(input) { this.input = input; }
  }
  class DecryptCommand {
    constructor(input) { this.input = input; }
  }
  class NodeHttpHandler {
    constructor(options) {
      NodeHttpHandler.options = options;
    }
  }
  class KMSClient {
    constructor(config) {
      this.config = config;
      this.calls = [];
      this.snapshots = [];
      this.responses = [];
      this.sendOptions = [];
      this.destroyed = false;
      KMSClient.instance = this;
    }
    async send(command, options) {
      this.calls.push(command);
      this.sendOptions.push(options);
      const snapshot = {};
      Object.entries(command.input).forEach(([key, value]) => {
        if (Buffer.isBuffer(value) || value instanceof Uint8Array) snapshot[key] = Buffer.from(value);
        else if (key === 'EncryptionContext') snapshot[key] = Object.assign({}, value);
        else snapshot[key] = value;
      });
      this.snapshots.push(snapshot);
      const response = this.responses.shift();
      if (response instanceof Error) throw response;
      return response;
    }
    destroy() { this.destroyed = true; }
  }
  return { EncryptCommand, DecryptCommand, NodeHttpHandler, KMSClient };
}

module.exports = function(harness) {
  const { assert, testAsync } = harness;

  return async function() {
    console.log('\n-- Cloud AWS KMS Adapter Tests ------------------------\n');

    const { AwsKmsAdapterError, createAwsKmsClient } = require('../lib/cloud-aws-kms');

    await testAsync('configures the AWS SDK client with explicit bounded networking', async () => {
      const sdk = fakeSdk();
      const adapter = createAwsKmsClient(Object.assign({
        region: 'eu-central-1', maxAttempts: 2,
        connectionTimeoutMs: 1500, requestTimeoutMs: 7000, operationTimeoutMs: 9000,
      }, sdk));
      assert.strictEqual(sdk.KMSClient.instance.config.region, 'eu-central-1');
      assert.strictEqual(sdk.KMSClient.instance.config.maxAttempts, 2);
      assert.strictEqual(sdk.KMSClient.instance.config.requestHandler instanceof sdk.NodeHttpHandler, true);
      assert.deepStrictEqual(sdk.NodeHttpHandler.options, {
        connectionTimeout: 1500, requestTimeout: 7000,
      });
      assert.strictEqual(adapter.operationTimeoutMs, 9000);
      adapter.destroy();
      assert.strictEqual(sdk.KMSClient.instance.destroyed, true);
    });

    await testAsync('maps neutral encrypt input to an AWS KMS EncryptCommand', async () => {
      const sdk = fakeSdk();
      const adapter = createAwsKmsClient(Object.assign({ region: 'eu-central-1' }, sdk));
      sdk.KMSClient.instance.responses.push({
        CiphertextBlob: new Uint8Array([9, 8, 7]),
        KeyId: 'arn:aws:kms:eu-central-1:123:key/key-id',
      });
      const result = await adapter.encrypt({
        keyId: 'alias/sdocs-production',
        plaintext: Buffer.from('data key'),
        encryptionContext: { application: 'sdocs-cloud', environment: 'production' },
      });
      const command = sdk.KMSClient.instance.calls[0];
      assert.strictEqual(command instanceof sdk.EncryptCommand, true);
      assert.deepStrictEqual(sdk.KMSClient.instance.snapshots[0], {
        KeyId: 'alias/sdocs-production',
        Plaintext: Buffer.from('data key'),
        EncryptionContext: { application: 'sdocs-cloud', environment: 'production' },
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
      });
      assert.deepStrictEqual(result, {
        ciphertext: Buffer.from([9, 8, 7]),
        keyId: 'arn:aws:kms:eu-central-1:123:key/key-id',
      });
      assert.deepStrictEqual(command.input.Plaintext, Buffer.alloc(Buffer.byteLength('data key')));
      assert.strictEqual(sdk.KMSClient.instance.sendOptions[0].abortSignal instanceof AbortSignal, true);
      adapter.destroy();
    });

    await testAsync('maps neutral decrypt input and uses the recorded key reference', async () => {
      const sdk = fakeSdk();
      const adapter = createAwsKmsClient(Object.assign({ region: 'eu-central-1' }, sdk));
      sdk.KMSClient.instance.responses.push({
        Plaintext: new Uint8Array(32).fill(4),
        KeyId: 'arn:aws:kms:eu-central-1:123:key/key-id',
      });
      const result = await adapter.decrypt({
        keyId: 'alias/sdocs-production',
        keyReference: 'arn:aws:kms:eu-central-1:123:key/key-id',
        ciphertext: Buffer.from([1, 2, 3]),
        encryptionContext: { purpose: 'project-key' },
      });
      const command = sdk.KMSClient.instance.calls[0];
      assert.strictEqual(command instanceof sdk.DecryptCommand, true);
      assert.deepStrictEqual(sdk.KMSClient.instance.snapshots[0], {
        KeyId: 'arn:aws:kms:eu-central-1:123:key/key-id',
        CiphertextBlob: Buffer.from([1, 2, 3]),
        EncryptionContext: { purpose: 'project-key' },
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
      });
      assert.deepStrictEqual(result, {
        plaintext: Buffer.alloc(32, 4),
        keyId: 'arn:aws:kms:eu-central-1:123:key/key-id',
      });
      adapter.destroy();
    });

    await testAsync('rejects invalid configuration, inputs, and AWS responses', async () => {
      const sdk = fakeSdk();
      assert.throws(() => createAwsKmsClient(Object.assign({ region: '', maxAttempts: 9 }, sdk)),
        (error) => error instanceof AwsKmsAdapterError);
      assert.throws(() => createAwsKmsClient(Object.assign({ region: 'eu-central-1', requestTimeoutMs: 60001 }, sdk)),
        (error) => error.code === 'invalid_aws_kms_config');

      const adapter = createAwsKmsClient(Object.assign({ region: 'eu-central-1' }, sdk));
      await assert.rejects(adapter.encrypt({ keyId: 'alias/key', plaintext: Buffer.alloc(0), encryptionContext: {} }),
        (error) => error.code === 'invalid_aws_kms_input');
      sdk.KMSClient.instance.responses.push({ CiphertextBlob: new Uint8Array(0), KeyId: 'arn:key' });
      await assert.rejects(adapter.encrypt({
        keyId: 'alias/key', plaintext: Buffer.from([1]), encryptionContext: { purpose: 'test' },
      }), (error) => error.code === 'aws_kms_invalid_response');
      sdk.KMSClient.instance.responses.push({ Plaintext: null });
      await assert.rejects(adapter.decrypt({
        keyId: 'alias/key', ciphertext: Buffer.from([1]), encryptionContext: { purpose: 'test' },
      }), (error) => error.code === 'aws_kms_invalid_response');
      adapter.destroy();
    });

    await testAsync('passes AWS SDK failures through without logging sensitive inputs', async () => {
      const sdk = fakeSdk();
      const adapter = createAwsKmsClient(Object.assign({ region: 'eu-central-1' }, sdk));
      const sdkError = new Error('KMS unavailable');
      sdk.KMSClient.instance.responses.push(sdkError);
      const originalLog = console.log;
      const originalError = console.error;
      const logs = [];
      console.log = (...items) => logs.push(items);
      console.error = (...items) => logs.push(items);
      try {
        await assert.rejects(adapter.encrypt({
          keyId: 'alias/key', plaintext: Buffer.from('secret material'),
          encryptionContext: { purpose: 'test' },
        }), (error) => error === sdkError);
      } finally {
        console.log = originalLog;
        console.error = originalError;
        adapter.destroy();
      }
      assert.deepStrictEqual(logs, []);
    });

    await testAsync('aborts a KMS operation at the configured total deadline', async () => {
      const sdk = fakeSdk();
      sdk.KMSClient.prototype.send = function(command, options) {
        this.calls.push(command);
        return new Promise((resolve, reject) => {
          options.abortSignal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
      };
      const adapter = createAwsKmsClient(Object.assign({
        region: 'eu-central-1', operationTimeoutMs: 5,
      }, sdk));
      await assert.rejects(adapter.encrypt({
        keyId: 'alias/key', plaintext: Buffer.from([1]), encryptionContext: { purpose: 'test' },
      }), (error) => error.name === 'AbortError');
      adapter.destroy();
    });
  };
};
