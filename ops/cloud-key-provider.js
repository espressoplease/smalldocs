'use strict';
const path = require('path');

function createKeyProvider(env) {
  if (env.CLOUD_KMS_KEY_ID) {
    let kmsClient;
    if (env.CLOUD_KMS_CLIENT_MODULE) {
      const kmsModule = require(path.resolve(env.CLOUD_KMS_CLIENT_MODULE));
      kmsClient = typeof kmsModule.createKmsClient === 'function'
        ? kmsModule.createKmsClient({ environment: env.CLOUD_ENVIRONMENT || 'production' })
        : kmsModule;
    } else {
      kmsClient = require('../lib/cloud-aws-kms').createAwsKmsClient({
        region: env.CLOUD_KMS_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION,
        maxAttempts: env.CLOUD_KMS_MAX_ATTEMPTS == null
          ? undefined : Number(env.CLOUD_KMS_MAX_ATTEMPTS),
        connectionTimeoutMs: env.CLOUD_KMS_CONNECTION_TIMEOUT_MS == null
          ? undefined : Number(env.CLOUD_KMS_CONNECTION_TIMEOUT_MS),
        requestTimeoutMs: env.CLOUD_KMS_REQUEST_TIMEOUT_MS == null
          ? undefined : Number(env.CLOUD_KMS_REQUEST_TIMEOUT_MS),
        operationTimeoutMs: env.CLOUD_KMS_OPERATION_TIMEOUT_MS == null
          ? undefined : Number(env.CLOUD_KMS_OPERATION_TIMEOUT_MS),
      });
    }
    return require('../lib/cloud-kms').createManagedKmsKeyProvider({
      kmsClient,
      keyId: env.CLOUD_KMS_KEY_ID,
      environment: env.CLOUD_ENVIRONMENT || 'production',
    });
  }
  if (env.CLOUD_MASTER_KEY) {
    return require('../lib/cloud-store').createLocalKeyProvider({
      masterKey: env.CLOUD_MASTER_KEY,
      environment: env.CLOUD_ENVIRONMENT || 'development',
      reference: env.CLOUD_KEY_REFERENCE || 'local-development-key',
    });
  }
  throw new Error('Cloud key provider is required');
}

module.exports = { createKeyProvider };
