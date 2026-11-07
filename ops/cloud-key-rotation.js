#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseArgs } = require('util');
const { createCloudStore } = require('../lib/cloud-store');
const { createKeyProvider } = require('./cloud-key-provider');
const { rotateProjectKey, projectKeyStatus } = require('../lib/cloud-key-rotation');
const { backupCloudStore, verifyCloudStore } = require('../lib/cloud-key-recovery');

const HELP = `Cloud encryption key maintenance

Use the matching deployment environment and credentials. This command is for
operators. It does not expose key material or create a public API.

  node ops/cloud-key-rotation.js status --project PROJECT_ID
  node ops/cloud-key-rotation.js rotate --project PROJECT_ID --backup FILE.db
  node ops/cloud-key-rotation.js verify-backup --backup FILE.db --sha256 HASH

Rotation creates a consistent encrypted SQLite backup, then changes the project
key, retained revisions, paths, retry receipts and search index in one transaction.
Use a maintenance window for a large project: writes wait for that transaction.
Old wrapped keys are retained for recovery. No key is disabled or deleted.

Verification restores a backup to a temporary directory and decrypts protected
values using fresh key caches. It never replaces the live database.

Required for rotate and verify-backup: CLOUD_KMS_KEY_ID and region (or a
development CLOUD_MASTER_KEY), CLOUD_IDEMPOTENCY_SECRET (or CLOUD_AUTH_PEPPER).
All commands require CLOUD_ENVIRONMENT. Status and rotate also require CLOUD_DB.
`;

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function failure(code) { return Object.assign(new Error(code), { code }); }

async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true,
    options: { help: { type: 'boolean' }, project: { type: 'string' },
      backup: { type: 'string' }, sha256: { type: 'string' } } });
  if (values.help || !positionals.length) { process.stdout.write(HELP); return; }
  const action = positionals[0];
  if (positionals.length !== 1 || !['status', 'rotate', 'verify-backup'].includes(action)) throw failure('invalid_command');
  if (!process.env.CLOUD_ENVIRONMENT) throw failure('cloud_environment_required');
  if (action !== 'verify-backup' && (!values.project || !process.env.CLOUD_DB)) throw failure('project_and_cloud_db_required');
  if (action === 'status') {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.CLOUD_DB, { readonly: true, fileMustExist: true });
    try { process.stdout.write(JSON.stringify({ ok: true, ...projectKeyStatus({ db }, values.project) }) + '\n'); }
    finally { db.close(); }
    return;
  }
  const secret = process.env.CLOUD_IDEMPOTENCY_SECRET || process.env.CLOUD_AUTH_PEPPER;
  if (!secret || Buffer.byteLength(secret) < 16) throw failure('cloud_idempotency_secret_required');
  if (!values.backup) throw failure('backup_path_required');
  let tempDir, store, provider;
  try {
    let dbPath = process.env.CLOUD_DB;
    if (action === 'rotate' && !fs.statSync(dbPath).isFile()) throw failure('cloud_database_file_required');
    if (action === 'verify-backup') {
      if (!values.sha256 || !/^[a-f0-9]{64}$/i.test(values.sha256) || await sha256(values.backup) !== values.sha256.toLowerCase()) {
        throw failure('backup_checksum_mismatch');
      }
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-key-restore-'));
      dbPath = path.join(tempDir, 'restored.db');
      fs.copyFileSync(values.backup, dbPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(dbPath, 0o600);
    }
    provider = createKeyProvider(process.env);
    store = createCloudStore({ dbPath, keyProvider: provider, idempotencySecret: secret });
    let result;
    if (action === 'rotate') {
      const before = projectKeyStatus(store, values.project);
      const backup = await backupCloudStore(store, path.resolve(values.backup));
      // Print the recoverable snapshot receipt before any write is attempted.
      process.stdout.write(JSON.stringify({ ok: true, action: 'backup', backup }) + '\n');
      result = { ok: true, action, ...await rotateProjectKey(store,
        { projectId: values.project, expectedVersion: before.active_version }), backup };
    } else result = { action, ...await verifyCloudStore(store) };
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    if (store) store.close();
    if (provider && provider.clearCache) provider.clearCache();
    if (provider && provider.kmsClient && provider.kmsClient.destroy) provider.kmsClient.destroy();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // Provider errors can contain credential paths or cloud request details.
  process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'key_maintenance_failed' }) + '\n');
  process.exitCode = 1;
});

module.exports = { main };
