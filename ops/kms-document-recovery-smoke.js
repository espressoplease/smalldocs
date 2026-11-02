'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAwsKmsClient } = require('../lib/cloud-aws-kms');
const { createManagedKmsKeyProvider } = require('../lib/cloud-kms');
const { createCloudStore } = require('../lib/cloud-store');
const { rotateProjectKey } = require('../lib/cloud-key-rotation');
const { backupCloudStore, verifyCloudStore } = require('../lib/cloud-key-recovery');

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
  const beforePath = path.join(tempDir, 'before.db');
  const owner = 'synthetic-recovery-user';
  const firstMarkdown = '# Recovery fixture\n\nFirst revision.\n';
  const secondMarkdown = '# Recovery fixture\n\nSecond revision.\n';
  const thirdMarkdown = '# Recovery fixture\n\nAfter project-key rotation.\n';
  const idempotencySecret = crypto.randomBytes(32).toString('base64url');
  let firstResources;
  let restoredResources;
  let sourceStore;
  let restoredStore;

  try {
    firstResources = createProvider();
    sourceStore = createCloudStore({
      dbPath: sourcePath,
      keyProvider: firstResources.provider,
      idempotencySecret,
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
    await backupCloudStore(sourceStore, beforePath);
    const rotation = await rotateProjectKey(sourceStore, { projectId: account.projectId });
    const afterRotation = await sourceStore.saveRevision({
      userId: owner, documentId: created.id, expectedHeadRevisionId: updated.current_revision_id,
      filename: 'recovery-fixture.md', markdown: thirdMarkdown,
      idempotencyKey: 'update-after-key-rotation',
    });
    sourceStore.close();
    sourceStore = null;
    closeResources(firstResources);
    firstResources = null;

    const snapshots = [];
    for (const snapshot of [
      { file: beforePath, revision: updated.current_revision_id, markdown: secondMarkdown, count: 2, version: 1 },
      { file: sourcePath, revision: afterRotation.current_revision_id, markdown: thirdMarkdown, count: 3, version: 2 },
    ]) {
      fs.copyFileSync(snapshot.file, restoredPath);
      restoredResources = createProvider();
      restoredStore = createCloudStore({ dbPath: restoredPath,
        keyProvider: restoredResources.provider, idempotencySecret });
      const current = await restoredStore.getDocument({ userId: owner, documentId: created.id });
      const historical = await restoredStore.getDocument({ userId: owner,
        documentId: created.id, revisionId: created.current_revision_id });
      const revisions = restoredStore.listRevisions({ userId: owner, documentId: created.id });
      if (current.current_revision_id !== snapshot.revision || current.markdown !== snapshot.markdown ||
          historical.markdown !== firstMarkdown || revisions.length !== snapshot.count ||
          restoredStore._projectKeyVersion(account.projectId) !== snapshot.version) {
        throw new Error('synthetic document recovery did not match the source database');
      }
      await verifyCloudStore(restoredStore);
      snapshots.push({ key_version: snapshot.version, current_revision: 'passed', historical_revision: 'passed',
        encrypted_receipts: 'passed', revision_count: revisions.length });
      restoredStore.close(); restoredStore = null;
      closeResources(restoredResources); restoredResources = null;
    }
    // Optional durable fixtures for an off-site recovery drill. These files
    // contain only the synthetic document and its generated test configuration.
    const output = process.env.CLOUD_RECOVERY_DRILL_OUTPUT;
    if (output) {
      fs.mkdirSync(output, { recursive: true, mode: 0o700 });
      const artifacts = [];
      for (const [name, source] of [['before.db', beforePath], ['after.db', sourcePath]]) {
        const destination = path.join(output, name);
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(destination, 0o600);
        artifacts.push({ file: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex') });
      }
      fs.writeFileSync(path.join(output, 'fixture.json'), JSON.stringify({ synthetic_only: true,
        environment: required('CLOUD_ENVIRONMENT'), region: required('CLOUD_KMS_REGION'),
        kms_key_id: required('CLOUD_KMS_KEY_ID'), idempotency_secret: idempotencySecret, artifacts }, null, 2),
      { mode: 0o600, flag: 'wx' });
    }
    process.stdout.write(JSON.stringify({
      ok: true,
      synthetic_only: true,
      fresh_kms_cache: 'passed',
      project_key_rotation: rotation.active_version === 2 ? 'passed' : 'failed',
      snapshots,
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
