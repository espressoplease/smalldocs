'use strict';
const { startFixture } = require('./cloud-onboarding-fixture');
const crypto = require('crypto'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { execFileSync } = require('child_process');
const count = Number(process.env.HISTORY_BENCH_REVISIONS || 10000);
function rss(pid) { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) * 1024; }
(async () => {
  const f = await startFixture({ singlePlan: true });
  try {
    const samples = [];
    for (const file of ['test/fixtures/rich-edit-mode.md', 'public/sdoc.md']) {
      const body = fs.readFileSync(path.join(__dirname, '..', file));
      const compressed = zlib.brotliCompressSync(body);
      samples.push({ file, body_bytes: body.length, compressed_body_bytes: compressed.length,
        projected_body_bytes_for_1000_versions: compressed.length * 1000 });
    }
    const results = [];
    for (const kind of ['agent', 'browser', 'agent-with-reasons', 'agent-with-long-reasons']) {
      const doc = await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
        markdown: '# Launch notes\n\nOriginal paragraph.\n', filename: 'launch-notes.md', idempotencyKey: 'bench-' + kind });
      const isAgent = kind !== 'browser';
      const insert = f.store.db.prepare(`INSERT INTO cloud_document_revisions
        (id,workspace_id,project_id,document_id,parent_revision_id,revision_number,body_ciphertext,metadata_ciphertext,
         body_nonce,metadata_nonce,algorithm,compression_format,crypto_format_version,project_key_version,compressed_size,
         uncompressed_size,created_by_user_id,created_by_credential_id,created_at_ms,edit_session_id)
        SELECT ?,workspace_id,project_id,document_id,?,?,body_ciphertext,metadata_ciphertext,body_nonce,metadata_nonce,
          algorithm,compression_format,crypto_format_version,project_key_version,compressed_size,uncompressed_size,
          created_by_user_id,?,?,? FROM cloud_document_revisions WHERE id=?`);
      // Inert copied ciphertext deliberately cannot be opened under the new IDs.
      // A successful listing proves that this workload does not decrypt bodies.
      let head = doc.current_revision_id; const session = crypto.randomUUID(), now = Date.now();
      f.store.db.transaction(() => {
        for (let n = 0; n < count; n++) { const id = crypto.randomUUID(); insert.run(id, head, n + 2,
          isAgent ? 'assistant' : null, now + n, kind === 'browser' ? session : null, doc.current_revision_id); head = id; }
        f.store.db.prepare('UPDATE cloud_documents SET current_revision_id=?,agent_edit_seen=1 WHERE id=?').run(head, doc.id);
      })();
      if (kind.startsWith('agent-with-')) {
        const { encryptAead, aad } = require('../lib/cloud-store');
        const key = await f.store._projectKey(f.team.projectId);
        try {
          const recent = f.store.db.prepare('SELECT * FROM cloud_document_revisions WHERE document_id=? ORDER BY revision_number DESC LIMIT 20').all(doc.id);
          for (const row of recent) {
            const encrypted = encryptAead(key, Buffer.from(JSON.stringify({ title: 'Launch notes', filename: 'launch-notes.md', tags: [], edit_reason: kind === 'agent-with-long-reasons' ? 'Delivery review context. '.repeat(20000) : 'Use the launch date agreed in the delivery review.' })),
              aad({ environment: f.store.environment, workspaceId: row.workspace_id, projectId: row.project_id, documentId: row.document_id, revisionId: row.id, kind: 'metadata', compression: 'none' }), crypto.randomBytes);
            f.store.db.prepare('UPDATE cloud_document_revisions SET metadata_ciphertext=?,metadata_nonce=?,has_edit_reason=1 WHERE id=?').run(encrypted.ciphertext, encrypted.nonce, row.id);
          }
        } finally { key.fill(0); }
      }
      const memoryBefore = rss(f.serverPid), started = performance.now();
      const durations = await Promise.all(Array.from({ length: 20 }, async () => {
        const begin = performance.now(), response = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/history?limit=20');
        if (response.status !== 200 || response.data.entries.length !== (isAgent ? 20 : 2)) throw new Error('History benchmark failed');
        return performance.now() - begin;
      }));
      durations.sort((a, b) => a - b);
      results.push({ kind, revisions: count + 1, concurrent_requests: 20, elapsed_ms: performance.now() - started,
        median_ms: durations[10], max_ms: durations.at(-1), server_rss_growth_bytes: rss(f.serverPid) - memoryBefore });
    }
    console.log(JSON.stringify({ ok: true, samples, results }, null, 2));
  } finally { await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
