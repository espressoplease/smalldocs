'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAwsKmsClient } = require('../lib/cloud-aws-kms');
const { createManagedKmsKeyProvider } = require('../lib/cloud-kms');
const { createCloudStore } = require('../lib/cloud-store');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

function optionalNumber(name) {
  return process.env[name] == null ? undefined : Number(process.env[name]);
}

function createProvider() {
  const kmsClient = createAwsKmsClient({
    region: required('CLOUD_KMS_REGION'),
    maxAttempts: optionalNumber('CLOUD_KMS_MAX_ATTEMPTS'),
    connectionTimeoutMs: optionalNumber('CLOUD_KMS_CONNECTION_TIMEOUT_MS'),
    requestTimeoutMs: optionalNumber('CLOUD_KMS_REQUEST_TIMEOUT_MS'),
    operationTimeoutMs: optionalNumber('CLOUD_KMS_OPERATION_TIMEOUT_MS'),
  });
  const provider = createManagedKmsKeyProvider({
    kmsClient,
    keyId: required('CLOUD_KMS_KEY_ID'),
    environment: required('CLOUD_ENVIRONMENT'),
  });
  return { kmsClient, provider };
}

function closeResources(resources) {
  if (!resources) return;
  if (resources.provider) resources.provider.clearCache();
  if (resources.kmsClient) resources.kmsClient.destroy();
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-kms-recovery-'));
  const sourcePath = path.join(tempDir, 'source.db');
  const restoredPath = path.join(tempDir, 'restored.db');
  const owner = 'synthetic-recovery-user';
  const firstMarkdown = '# Recovery fixture\n\nFirst revision.\n';
  const secondMarkdown = '# Recovery fixture\n\nSecond revision.\n';
  let firstResources;
  let restoredResources;
  let sourceStore;
  let restoredStore;

  try {
    firstResources = createProvider();
    sourceStore = createCloudStore({
      dbPath: sourcePath,
      keyProvider: firstResources.provider,
      idempotencySecret: crypto.randomBytes(32).toString('base64url'),
    });
    const account = await sourceStore.ensurePersonalWorkspace(owner, 'Recovery fixture');
    const created = await sourceStore.createDocument({
      userId: owner,
      projectId: account.projectId,
      filename: 'recovery-fixture.md',
      markdown: firstMarkdown,
      idempotencyKey: 'create-recovery-fixture',
    });
    const updated = await sourceStore.saveRevision({
      userId: owner,
      documentId: created.id,
      expectedHeadRevisionId: created.current_revision_id,
      filename: 'recovery-fixture.md',
      markdown: secondMarkdown,
      idempotencyKey: 'update-recovery-fixture',
    });
    sourceStore.close();
    sourceStore = null;
    closeResources(firstResources);
    firstResources = null;

    fs.copyFileSync(sourcePath, restoredPath);
    restoredResources = createProvider();
    restoredStore = createCloudStore({
      dbPath: restoredPath,
      keyProvider: restoredResources.provider,
      idempotencySecret: crypto.randomBytes(32).toString('base64url'),
    });
    const current = await restoredStore.getDocument({ userId: owner, documentId: created.id });
    const historical = await restoredStore.getDocument({
      userId: owner,
      documentId: created.id,
      revisionId: created.current_revision_id,
    });
    const revisions = restoredStore.listRevisions({ userId: owner, documentId: created.id });
    if (current.current_revision_id !== updated.current_revision_id ||
        current.markdown !== secondMarkdown || historical.markdown !== firstMarkdown ||
        revisions.length !== 2) {
      throw new Error('synthetic document recovery did not match the source database');
    }
    process.stdout.write(JSON.stringify({
      ok: true,
      fresh_kms_cache: 'passed',
      current_revision: 'passed',
      historical_revision: 'passed',
      revision_count: 2,
    }) + '\n');
  } finally {
    if (sourceStore) sourceStore.close();
    if (restoredStore) restoredStore.close();
    closeResources(firstResources);
    closeResources(restoredResources);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(() => {
  process.stderr.write('KMS document recovery smoke failed\n');
  process.exitCode = 1;
});
