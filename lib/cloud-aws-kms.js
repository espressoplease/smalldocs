'use strict';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_CONNECTION_TIMEOUT_MS = 3000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_OPERATION_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 60000;

class AwsKmsAdapterError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AwsKmsAdapterError';
    this.code = code;
  }
}

function requireText(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > (maxLength || 2048)) {
    throw new AwsKmsAdapterError('invalid_aws_kms_input', name + ' is required');
  }
  return value.trim();
}

function requireInteger(value, name, defaultValue, minimum, maximum) {
  const result = value == null ? defaultValue : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new AwsKmsAdapterError('invalid_aws_kms_config', name + ' is out of range');
  }
  return result;
}

function requireBytes(value, name, allowEmpty) {
  let bytes;
  if (Buffer.isBuffer(value)) bytes = Buffer.from(value);
  else if (value instanceof Uint8Array) bytes = Buffer.from(value);
  else throw new AwsKmsAdapterError('invalid_aws_kms_input', name + ' must be bytes');
  if (!allowEmpty && bytes.length === 0) {
    throw new AwsKmsAdapterError('invalid_aws_kms_input', name + ' must not be empty');
  }
  return bytes;
}

function requireContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AwsKmsAdapterError('invalid_aws_kms_input', 'encryptionContext is required');
  }
  const context = {};
  for (const [key, item] of Object.entries(value)) {
    const contextKey = requireText(key, 'encryptionContext key', 256);
    context[contextKey] = requireText(item, 'encryptionContext value', 256);
  }
  if (Object.keys(context).length === 0) {
    throw new AwsKmsAdapterError('invalid_aws_kms_input', 'encryptionContext must not be empty');
  }
  return context;
}

function loadSdk(options) {
  if (options.KMSClient && options.EncryptCommand && options.DecryptCommand && options.NodeHttpHandler) {
    return options;
  }
  let kms;
  let smithy;
  try {
    kms = require('@aws-sdk/client-kms');
    smithy = require('@smithy/node-http-handler');
  } catch (error) {
    throw new AwsKmsAdapterError('aws_kms_sdk_unavailable',
      'AWS SDK v3 KMS and Node HTTP handler packages are required');
  }
  return {
    KMSClient: options.KMSClient || kms.KMSClient,
    EncryptCommand: options.EncryptCommand || kms.EncryptCommand,
    DecryptCommand: options.DecryptCommand || kms.DecryptCommand,
    NodeHttpHandler: options.NodeHttpHandler || smithy.NodeHttpHandler,
  };
}

class AwsKmsClientAdapter {
  constructor(options) {
    options = options || {};
    this.region = requireText(options.region, 'region', 64);
    this.maxAttempts = requireInteger(options.maxAttempts, 'maxAttempts', DEFAULT_MAX_ATTEMPTS, 1, 5);
    this.connectionTimeoutMs = requireInteger(options.connectionTimeoutMs, 'connectionTimeoutMs',
      DEFAULT_CONNECTION_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
    this.requestTimeoutMs = requireInteger(options.requestTimeoutMs, 'requestTimeoutMs',
      DEFAULT_REQUEST_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
    this.operationTimeoutMs = requireInteger(options.operationTimeoutMs, 'operationTimeoutMs',
      DEFAULT_OPERATION_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);

    const sdk = loadSdk(options);
    this.EncryptCommand = sdk.EncryptCommand;
    this.DecryptCommand = sdk.DecryptCommand;
    const requestHandler = new sdk.NodeHttpHandler({
      connectionTimeout: this.connectionTimeoutMs,
      requestTimeout: this.requestTimeoutMs,
    });
    this.client = new sdk.KMSClient({
      region: this.region,
      maxAttempts: this.maxAttempts,
      requestHandler,
    });
    if (!this.client || typeof this.client.send !== 'function' || typeof this.client.destroy !== 'function') {
      throw new AwsKmsAdapterError('invalid_aws_kms_config', 'KMSClient must provide send and destroy methods');
    }
  }

  async _send(command) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.operationTimeoutMs);
    try {
      return await this.client.send(command, { abortSignal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async encrypt(input) {
    input = input || {};
    const keyId = requireText(input.keyId, 'keyId', 2048);
    const plaintext = requireBytes(input.plaintext, 'plaintext');
    const encryptionContext = requireContext(input.encryptionContext);
    let result;
    try {
      result = await this._send(new this.EncryptCommand({
        KeyId: keyId,
        Plaintext: plaintext,
        EncryptionContext: encryptionContext,
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
      }));
    } finally {
      plaintext.fill(0);
    }
    if (!result || typeof result !== 'object') {
      throw new AwsKmsAdapterError('aws_kms_invalid_response', 'AWS KMS encrypt returned no result');
    }
    const ciphertext = requireResponseBytes(result.CiphertextBlob, 'CiphertextBlob');
    const returnedKeyId = requireResponseText(result.KeyId, 'KeyId');
    return { ciphertext, keyId: returnedKeyId };
  }

  async decrypt(input) {
    input = input || {};
    const keyId = requireText(input.keyReference || input.keyId, 'keyReference or keyId', 2048);
    const ciphertext = requireBytes(input.ciphertext, 'ciphertext');
    const encryptionContext = requireContext(input.encryptionContext);
    const result = await this._send(new this.DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: ciphertext,
      EncryptionContext: encryptionContext,
      EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
    }));
    if (!result || typeof result !== 'object') {
      throw new AwsKmsAdapterError('aws_kms_invalid_response', 'AWS KMS decrypt returned no result');
    }
    const plaintext = requireResponseBytes(result.Plaintext, 'Plaintext');
    if (Buffer.isBuffer(result.Plaintext) || result.Plaintext instanceof Uint8Array) {
      result.Plaintext.fill(0);
    }
    const returnedKeyId = result.KeyId == null ? keyId : requireResponseText(result.KeyId, 'KeyId');
    return { plaintext, keyId: returnedKeyId };
  }

  destroy() {
    this.client.destroy();
  }
}

function requireResponseBytes(value, name) {
  try {
    return requireBytes(value, name);
  } catch (_) {
    throw new AwsKmsAdapterError('aws_kms_invalid_response', 'AWS KMS ' + name + ' must be non-empty bytes');
  }
}

function requireResponseText(value, name) {
  try {
    return requireText(value, name, 2048);
  } catch (_) {
    throw new AwsKmsAdapterError('aws_kms_invalid_response', 'AWS KMS ' + name + ' is missing');
  }
}

function createAwsKmsClient(options) {
  return new AwsKmsClientAdapter(options);
}

module.exports = {
  AwsKmsAdapterError,
  AwsKmsClientAdapter,
  createAwsKmsClient,
};
