'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function backupCloudStore(store, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const handle = fs.openSync(destination, 'wx', 0o600);
  fs.closeSync(handle);
  try {
    // SQLite's backup API includes committed WAL state in a consistent snapshot.
    await store.db.backup(destination);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(destination)) hash.update(chunk);
    return { path: destination, sha256: hash.digest('hex') };
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  }
}

async function verifyCloudStore(store) {
  const integrity = store.db.pragma('integrity_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || store.db.pragma('foreign_key_check').length) {
    throw Object.assign(new Error('backup_integrity_failed'), { code: 'backup_integrity_failed' });
  }
  const result = { workspaces: 0, projects: 0, revisions: 0, source_files: 0, receipts: 0, search_values: 0 };
  for (const row of store.db.prepare('SELECT * FROM cloud_workspaces').iterate()) {
    await store._workspaceName(row); result.workspaces++;
  }
  for (const row of store.db.prepare('SELECT * FROM cloud_projects').iterate()) {
    await store._decryptProjectName(row);
    const key = await store._projectKey(row.id, row.project_key_version);
    try { result.search_values += store.searchIndex.verifyKeyMaterial(row.id, key); }
    finally { key.fill(0); }
    result.projects++;
  }
  for (const row of store.db.prepare('SELECT * FROM cloud_document_revisions').iterate()) {
    await store._decryptRevision(row); result.revisions++;
  }
  for (const row of store.db.prepare('SELECT * FROM cloud_document_source_files').iterate()) {
    await store._readSourceFile({ id: row.document_id }, row); result.source_files++;
  }
  for (const row of store.db.prepare('SELECT * FROM cloud_idempotency_records WHERE response_encrypted=1').iterate()) {
    const envelope = JSON.parse(row.response_json);
    store._validateIdempotencyEnvelope(row, envelope);
    const project = store.db.prepare('SELECT workspace_id FROM cloud_projects WHERE id=?').get(envelope.project_id);
    if (!project) throw Object.assign(new Error('backup_receipt_project_unavailable'), { code: 'backup_receipt_project_unavailable' });
    const key = await store._projectKey(envelope.project_id, envelope.project_key_version);
    try {
      store._openIdempotencyResponse({ projectId: envelope.project_id, workspaceId: project.workspace_id,
        responseKey: key, responseKeyVersion: envelope.project_key_version, userId: row.principal_id,
        endpoint: row.endpoint, resourceId: row.resource_id, idempotencyKey: row.idempotency_key }, envelope, row.request_digest);
      result.receipts++;
    } finally { key.fill(0); }
  }
  return { ok: true, integrity: 'passed', ...result };
}

module.exports = { backupCloudStore, verifyCloudStore };
