'use strict';

const { createAwsKmsClient } = require('../lib/cloud-aws-kms');
const { createManagedKmsKeyProvider } = require('../lib/cloud-kms');
const { checkCloudKmsReadiness } = require('../lib/cloud-deployment-config');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

function clientOptions() {
  return {
    region: required('CLOUD_KMS_REGION'),
    maxAttempts: process.env.CLOUD_KMS_MAX_ATTEMPTS == null
      ? undefined : Number(process.env.CLOUD_KMS_MAX_ATTEMPTS),
    connectionTimeoutMs: process.env.CLOUD_KMS_CONNECTION_TIMEOUT_MS == null
      ? undefined : Number(process.env.CLOUD_KMS_CONNECTION_TIMEOUT_MS),
    requestTimeoutMs: process.env.CLOUD_KMS_REQUEST_TIMEOUT_MS == null
      ? undefined : Number(process.env.CLOUD_KMS_REQUEST_TIMEOUT_MS),
    operationTimeoutMs: process.env.CLOUD_KMS_OPERATION_TIMEOUT_MS == null
      ? undefined : Number(process.env.CLOUD_KMS_OPERATION_TIMEOUT_MS),
  };
}

async function readiness(environment) {
  const client = createAwsKmsClient(clientOptions());
  const provider = createManagedKmsKeyProvider({
    kmsClient: client,
    keyId: required('CLOUD_KMS_KEY_ID'),
    environment,
  });
  try {
    await checkCloudKmsReadiness(provider);
  } finally {
    provider.clearCache();
    client.destroy();
  }
}

async function main() {
  const environment = required('CLOUD_ENVIRONMENT');
  await readiness(environment);

  let denied = false;
  try {
    await readiness(environment + '-denied-smoke');
  } catch (_) {
    denied = true;
  }
  if (!denied) {
    throw new Error('KMS policy accepted the deliberately invalid environment context');
  }

  await readiness(environment);
  process.stdout.write(JSON.stringify({
    ok: true,
    allowed_context_before: 'passed',
    invalid_context: 'denied',
    allowed_context_after: 'passed',
  }) + '\n');
}

main().catch(() => {
  process.stderr.write('KMS failure smoke failed without provider details\n');
  process.exitCode = 1;
});
