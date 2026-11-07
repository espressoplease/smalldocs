'use strict';

const { CloudError, aad, encryptAead, decryptAead } = require('./cloud-store');
const { databaseBatches } = require('./cloud-db-batches');
const zlib = require('zlib');

function projectKeyStatus(store, projectId) {
  const project = store.db.prepare('SELECT * FROM cloud_projects WHERE id = ?').get(projectId);
  if (!project) throw new CloudError('resource_unavailable');
  const count = table => store.db.prepare('SELECT count(*) AS n FROM ' + table + ' WHERE project_id = ?').get(projectId).n;
  return { project_id: projectId, active_version: project.project_key_version || 1,
    retained_versions: store.db.prepare('SELECT version, created_at_ms, retired_at_ms FROM cloud_project_keys WHERE project_id = ? ORDER BY version').all(projectId),
    documents: count('cloud_documents'), revisions: count('cloud_document_revisions'),
    source_files: count('cloud_document_source_files') };
}

// This is an operator maintenance operation, not a user-access API. One write
// transaction switches every protected value and its search index together.
// Batch ciphertext rows so memory is bounded independently of library size.
async function rotateProjectKey(store, input) {
  const projectId = input.projectId;
  const project = store.db.prepare('SELECT * FROM cloud_projects WHERE id = ?').get(projectId);
  if (!project) throw new CloudError('resource_unavailable');
  const expectedVersion = input.expectedVersion == null ? project.project_key_version : input.expectedVersion;
  store._assertProjectKeyVersion(projectId, expectedVersion);
  const nextVersion = store.db.prepare('SELECT max(version) + 1 AS version FROM cloud_project_keys WHERE project_id = ?').get(projectId).version;
  if (!Number.isSafeInteger(nextVersion) || nextVersion < 2) throw new CloudError('temporary_service_failure');
  const oldKeys = new Map();
  const newKey = store.randomBytes(32);
  const result = { project_id: projectId, previous_version: expectedVersion, active_version: nextVersion,
    revisions: 0, source_files: 0, receipts: 0, indexed_documents: 0 };
  try {
    for (const row of store.db.prepare('SELECT version FROM cloud_project_keys WHERE project_id = ?').all(projectId)) {
      oldKeys.set(row.version, await store._projectKey(projectId, row.version));
    }
    const wrapped = await store._keyOperation(() => store.keyProvider.wrapProjectKey(projectId, nextVersion, newKey));
    const reencrypt = (version, nonce, ciphertext, context) => {
      const oldKey = oldKeys.get(version);
      if (!oldKey) throw new CloudError('temporary_service_failure', 'historical project key is unavailable');
      const plaintext = decryptAead(oldKey, nonce, ciphertext, context);
      try { return encryptAead(newKey, plaintext, context, store.randomBytes); }
      finally { plaintext.fill(0); }
    };
    return store.db.transaction(() => {
      store._assertProjectKeyVersion(projectId, expectedVersion);
      const now = store.now();
      store.db.prepare(`INSERT INTO cloud_project_keys
        (project_id,version,wrapped_key_ciphertext,wrapped_key_nonce,key_reference,created_at_ms)
        VALUES (?,?,?,?,?,?)`).run(projectId, nextVersion, wrapped.ciphertext, wrapped.nonce, wrapped.reference, now);
      const currentProject = store.db.prepare('SELECT * FROM cloud_projects WHERE id = ?').get(projectId);
      const name = reencrypt(currentProject.project_key_version, currentProject.name_nonce, currentProject.name_ciphertext,
        aad({ environment: store.environment, workspaceId: project.workspace_id, projectId, kind: 'project-name' }));
      const updateRevision = store.db.prepare(`UPDATE cloud_document_revisions SET body_ciphertext=?, body_nonce=?,
        metadata_ciphertext=?, metadata_nonce=?, project_key_version=? WHERE id=?`);
      for (const row of databaseBatches(store.db, `SELECT rowid AS batch_rowid,* FROM cloud_document_revisions
        WHERE project_id=@projectId AND rowid>@after ORDER BY rowid LIMIT @limit`, { projectId })) {
        const context = { environment: store.environment, workspaceId: row.workspace_id,
          projectId, documentId: row.document_id, revisionId: row.id };
        const body = reencrypt(row.project_key_version, row.body_nonce, row.body_ciphertext,
          aad({ ...context, kind: 'body', compression: row.compression_format }));
        const metadata = reencrypt(row.project_key_version, row.metadata_nonce, row.metadata_ciphertext,
          aad({ ...context, kind: 'metadata', compression: 'none' }));
        updateRevision.run(body.ciphertext, body.nonce, metadata.ciphertext, metadata.nonce, nextVersion, row.id);
        result.revisions++;
      }
      const updateSource = store.db.prepare(`UPDATE cloud_document_source_files
        SET source_ciphertext=?,source_nonce=?,project_key_version=? WHERE document_id=?`);
      for (const row of databaseBatches(store.db, `SELECT rowid AS batch_rowid,* FROM cloud_document_source_files
        WHERE project_id=@projectId AND rowid>@after ORDER BY rowid LIMIT @limit`, { projectId })) {
        const source = reencrypt(row.project_key_version, row.source_nonce, row.source_ciphertext,
          aad({ environment: store.environment, workspaceId: row.workspace_id, projectId,
            documentId: row.document_id, kind: 'creator-source-file' }));
        updateSource.run(source.ciphertext, source.nonce, nextVersion, row.document_id);
        result.source_files++;
      }
      const updateReceipt = store.db.prepare(`UPDATE cloud_idempotency_records SET response_json=?,response_encrypted=1
        WHERE principal_id=? AND endpoint=? AND resource_id=? AND idempotency_key=?`);
      const receipts = `SELECT r.rowid AS batch_rowid,r.* FROM cloud_idempotency_records r
        WHERE ((json_valid(r.response_json) AND json_extract(r.response_json,'$.project_id') = @projectId)
          OR (r.response_encrypted = 0 AND ((r.endpoint = 'documents.create' AND r.resource_id = @projectId)
            OR EXISTS (SELECT 1 FROM cloud_documents d WHERE d.id = r.resource_id AND d.project_id = @projectId))))
          AND r.rowid>@after ORDER BY r.rowid LIMIT @limit`;
      for (const row of databaseBatches(store.db, receipts, { projectId })) {
        const envelope = JSON.parse(row.response_json);
        store._validateIdempotencyEnvelope(row, envelope);
        const context = { userId: row.principal_id, endpoint: row.endpoint,
          resourceId: row.resource_id, idempotencyKey: row.idempotency_key,
          projectId, workspaceId: project.workspace_id };
        const response = store._openIdempotencyResponse({ ...context,
          responseKey: oldKeys.get(envelope.project_key_version), responseKeyVersion: envelope.project_key_version },
        envelope, row.request_digest);
        updateReceipt.run(store._sealIdempotencyResponse({ ...context, responseKey: newKey,
          responseKeyVersion: nextVersion }, response, row.request_digest),
        row.principal_id, row.endpoint, row.resource_id, row.idempotency_key);
        result.receipts++;
      }
      // Delete the old keyed dictionary too, including unused terms and tags.
      store.db.prepare('DELETE FROM cloud_search_terms WHERE project_id=?').run(projectId);
      store.db.prepare('DELETE FROM cloud_search_tags WHERE project_id=?').run(projectId);
      store.db.prepare('DELETE FROM cloud_search_documents WHERE project_id=?').run(projectId);
      const heads = `SELECT r.rowid AS batch_rowid,r.* FROM cloud_documents d JOIN cloud_document_revisions r
        ON r.id=d.current_revision_id WHERE d.project_id=@projectId AND d.deleted_at_ms IS NULL
          AND r.rowid>@after ORDER BY r.rowid LIMIT @limit`;
      for (const row of databaseBatches(store.db, heads, { projectId })) {
        const context = { environment: store.environment, workspaceId: row.workspace_id,
          projectId, documentId: row.document_id, revisionId: row.id };
        const compressed = decryptAead(newKey, row.body_nonce, row.body_ciphertext,
          aad({ ...context, kind: 'body', compression: row.compression_format }));
        let body, metadata;
        try {
          body = zlib.brotliDecompressSync(compressed, { maxOutputLength: row.uncompressed_size });
          if (body.length !== row.uncompressed_size) throw new CloudError('temporary_service_failure');
          metadata = decryptAead(newKey, row.metadata_nonce, row.metadata_ciphertext,
            aad({ ...context, kind: 'metadata', compression: 'none' }));
          const prepared = store.searchIndex.prepare({ key: newKey, projectId,
            markdown: body.toString('utf8'), metadata: JSON.parse(metadata.toString('utf8')) });
          store.searchIndex.commit({ documentId: row.document_id, projectId, revisionId: row.id, prepared });
          result.indexed_documents++;
        } finally { compressed.fill(0); if (body) body.fill(0); if (metadata) metadata.fill(0); }
      }
      store.db.prepare('UPDATE cloud_projects SET name_ciphertext=?,name_nonce=?,project_key_version=? WHERE id=?')
        .run(name.ciphertext, name.nonce, nextVersion, projectId);
      store.db.prepare('UPDATE cloud_project_keys SET retired_at_ms=coalesce(retired_at_ms,?) WHERE project_id=? AND version<>?')
        .run(now, projectId, nextVersion);
      store._audit({ workspaceId: project.workspace_id, projectId, userId: 'operator:key-rotation',
        action: 'project.key.rotate', resourceId: projectId });
      return result;
    }).immediate();
  } finally {
    newKey.fill(0);
    for (const key of oldKeys.values()) key.fill(0);
  }
}

module.exports = { projectKeyStatus, rotateProjectKey };
