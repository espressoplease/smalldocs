#!/usr/bin/env node
'use strict';

// Run store migrations against extracted backup copies without starting workers.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { parseArgs, parseEnv } = require('util');
const Database = require('better-sqlite3');

const DATABASES = ['CLOUD_AUTH_DB', 'CLOUD_OAUTH_DB', 'CLOUD_DB', 'CLOUD_BILLING_DB', 'CLOUD_JOBS_DB'];
const TABLES = {
  CLOUD_AUTH_DB: ['cloud_auth_users', 'cloud_auth_identities', 'cloud_auth_sessions', 'cloud_auth_cli_installations'],
  CLOUD_DB: ['cloud_workspaces', 'cloud_workspace_memberships', 'cloud_projects', 'cloud_documents', 'cloud_document_revisions'],
  CLOUD_BILLING_DB: ['cloud_billing_subscriptions', 'cloud_billing_personal_trials'],
};
function quote(value) { return '"' + value.replace(/"/g, '""') + '"'; }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sourcePath(root, absolute) {
  if (!path.isAbsolute(absolute)) throw new Error('Snapshot database path must be absolute');
  const file = path.resolve(root, '.' + absolute);
  if (!file.startsWith(root + path.sep)) throw new Error('Snapshot path is outside its root');
  return file;
}
function tables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
}
function integrity(db) {
  assert.deepStrictEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
}
function archiveIntegrity(directory) {
  let checked = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { checked += archiveIntegrity(file); continue; }
    if (!entry.isFile() || !/\.(?:db|sqlite|sqlite3)$/.test(entry.name)) continue;
    const handle = fs.openSync(file, 'r'), header = Buffer.alloc(16);
    try { fs.readSync(handle, header, 0, 16, 0); } finally { fs.closeSync(handle); }
    if (header.toString() !== 'SQLite format 3\0') continue;
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { integrity(db); checked++; } finally { db.close(); }
  }
  return checked;
}
function inventory(files, schema) {
  const result = {};
  for (const [key, names] of Object.entries(TABLES)) {
    if (!files[key]) continue;
    const db = new Database(files[key], { readonly: true, fileMustExist: true });
    try {
      integrity(db);
      const present = tables(db);
      for (const table of names) {
        if (schema && !schema[table]) continue;
        if (!present.has(table)) continue;
        const columns = schema?.[table]?.columns || db.prepare('PRAGMA table_info(' + quote(table) + ')').all().map(row => row.name);
        const rows = db.prepare('SELECT ' + columns.map(quote).join(',') + ' FROM ' + quote(table)).all();
        const ordered = rows.map(row => JSON.stringify(row)).sort();
        result[table] = { columns, count: rows.length, sha256: digest(ordered) };
      }
    } finally { db.close(); }
  }
  return result;
}
async function documentDigest(store) {
  const hash = crypto.createHash('sha256');
  let revisions = 0;
  for (const row of store.db.prepare('SELECT * FROM cloud_document_revisions ORDER BY id').iterate()) {
    const value = await store._decryptRevision(row);
    hash.update(JSON.stringify([row.id, value.metadata, value.markdown]));
    revisions++;
  }
  return { revisions, sha256: hash.digest('hex') };
}
function accessDigest(store, auth) {
  const users = auth.db.prepare('SELECT id FROM cloud_auth_users ORDER BY id').all();
  const documents = store.db.prepare('SELECT id FROM cloud_documents ORDER BY id').all();
  const hash = crypto.createHash('sha256');
  let allowed = 0;
  for (const user of users) for (const document of documents) {
    let visible = false;
    try { store._requireDocument(user.id, document.id, 'viewer'); visible = true; } catch (error) {
      if (error.code !== 'resource_unavailable') throw error;
    }
    if (visible) allowed++;
    hash.update(JSON.stringify([user.id, document.id, visible]));
  }
  return { pairs: users.length * documents.length, allowed, sha256: hash.digest('hex') };
}
async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    'snapshot-root': { type: 'string' }, 'previous-release': { type: 'string' },
    'work-dir': { type: 'string' }, 'report': { type: 'string' },
  } });
  const root = fs.realpathSync(values['snapshot-root']);
  const work = path.resolve(values['work-dir']);
  fs.mkdirSync(work, { mode: 0o700 });
  const env = parseEnv(fs.readFileSync(path.join(root, 'etc/smalldocs/smalldocs.env'), 'utf8'));
  const candidates = {}, rollback = {};
  const copied = new Map();
  for (const key of DATABASES) {
    if (!env[key]) continue;
    const source = sourcePath(root, env[key]);
    if (!fs.existsSync(source)) throw new Error('Configured database is missing from backup: ' + key);
    if (!copied.has(source)) {
      const file = path.join(work, key + '.db');
      fs.copyFileSync(source, file, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(file, 0o600);
      copied.set(source, file);
    }
    candidates[key] = copied.get(source);
  }
  const before = inventory(candidates);
  const previous = path.resolve(values['previous-release']);
  const provider = require('./cloud-key-provider').createKeyProvider(env);
  const options = { dbPath: candidates.CLOUD_DB, keyProvider: provider,
    idempotencySecret: env.CLOUD_IDEMPOTENCY_SECRET || env.CLOUD_AUTH_PEPPER };
  let oldStore, store, auth, billing, oauth, jobs;
  const report = { source: 'coordinated production backup', server_started: false, payment_or_email_requests: false };
  try {
    report.archive_databases_verified = archiveIntegrity(path.join(root, 'var/lib'));
    oldStore = require(path.join(previous, 'lib/cloud-store')).createCloudStore(options);
    const contentBefore = await documentDigest(oldStore);
    const oldAuth = { db: new Database(candidates.CLOUD_AUTH_DB, { readonly: true }) };
    let accessBefore;
    try { accessBefore = accessDigest(oldStore, oldAuth); } finally { oldAuth.db.close(); }
    oldStore.close(); oldStore = null;
    auth = require('../lib/cloud-auth').createAuthStore({ dbPath: candidates.CLOUD_AUTH_DB, pepper: env.CLOUD_AUTH_PEPPER });
    oauth = require('../lib/cloud-oauth').createOAuthTransactionStore({ dbPath: candidates.CLOUD_OAUTH_DB, pepper: env.CLOUD_AUTH_PEPPER });
    billing = require('../lib/cloud-billing').createBillingStore({ dbPath: candidates.CLOUD_BILLING_DB, trialIdentitySecret: env.CLOUD_AUTH_PEPPER });
    store = require('../lib/cloud-store').createCloudStore(options);
    jobs = require('../lib/cloud-jobs').createCloudJobs({ dbPath: candidates.CLOUD_JOBS_DB });
    const single = new (require('../lib/cloud-single-plan').SinglePlan)({ billing, store });
    new (require('../lib/cloud-referrals').CloudReferrals)({ billing, auth, store, single,
      secret: env.CLOUD_AUTH_PEPPER, origin: env.CLOUD_AUTH_PUBLIC_ORIGIN });
    new (require('../lib/cloud-publications').CloudPublications)({ store, origin: env.CLOUD_AUTH_PUBLIC_ORIGIN,
      renderPage: () => { throw new Error('Publication work must not run during migration rehearsal'); } });
    const after = inventory(candidates, before);
    assert.deepStrictEqual(after, before, 'Existing records changed during startup migration');
    assert.deepStrictEqual(await documentDigest(store), contentBefore, 'Document content changed during migration');
    assert.deepStrictEqual(accessDigest(store, auth), accessBefore, 'Document access changed during migration');
    report.permission_pairs_checked = accessBefore.pairs;
    report.permissions_preserved = true;
    report.encrypted_data = await require('../lib/cloud-key-recovery').verifyCloudStore(store);
    const owners = store.db.prepare("SELECT DISTINCT user_id FROM cloud_workspace_memberships WHERE role='owner' AND status='active'").all();
    const reviews = owners.map(row => single.migrationReview(row.user_id));
    report.subscription_conflicts = reviews.filter(review => review.subscription_conflicts.length).length;
    assert.strictEqual(report.subscription_conflicts, 0, 'Multiple active subscriptions need operator reconciliation');
    const trials = billing.db.prepare('SELECT user_id,workspace_id,starts_at_ms,ends_at_ms FROM cloud_billing_personal_trials').all();
    for (const review of reviews) {
      const email = auth.getUser(review.user_id).identities.find(identity => identity.verifiedEmail)?.verifiedEmail;
      for (const library of review.libraries) single.initialize(review.user_id, library, email);
    }
    for (const trial of trials) assert.deepStrictEqual(billing.db.prepare('SELECT user_id,workspace_id,starts_at_ms,ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(trial.user_id), trial);
    report.billing_accounts_resolved = reviews.length;
    report.records = Object.fromEntries(Object.entries(before).map(([table, value]) => [table, value.count]));
    report.existing_records_preserved = true;
    report.document_digest_preserved = true;
    report.trial_deadlines_preserved = true;
    for (const resource of [jobs, oauth, auth, billing, store]) resource.close();
    jobs = oauth = auth = billing = store = null;
    provider.clearCache?.();
    // First prove the previous release can reopen the additive migrated schema.
    oldStore = require(path.join(previous, 'lib/cloud-store')).createCloudStore(options);
    assert.deepStrictEqual(await documentDigest(oldStore), contentBefore);
    oldStore.close(); oldStore = null;
    report.previous_reader_after_migration = true;
    // Then restore untouched backup files and validate the previous release again.
    for (const [source, candidate] of copied) {
      const restored = candidate + '.restored';
      fs.copyFileSync(source, restored, fs.constants.COPYFILE_EXCL);
      for (const key of DATABASES) if (candidates[key] === candidate) rollback[key] = restored;
    }
    assert.deepStrictEqual(inventory(rollback), before);
    provider.clearCache?.();
    oldStore = require(path.join(previous, 'lib/cloud-store')).createCloudStore({ ...options, dbPath: rollback.CLOUD_DB });
    assert.deepStrictEqual(await documentDigest(oldStore), contentBefore);
    report.backup_restore_previous_reader = true;
    report.ok = true;
    fs.writeFileSync(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally {
    for (const resource of [jobs, oauth, auth, billing, store, oldStore]) resource?.close();
    provider.clearCache?.(); provider.kmsClient?.destroy?.();
    fs.rmSync(work, { recursive: true, force: true });
  }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: error.code || error.name, message: error.message }) + '\n');
  process.exitCode = 1;
});
module.exports = { inventory, documentDigest, sourcePath };
