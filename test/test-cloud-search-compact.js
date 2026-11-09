'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { createCloudStore, createLocalKeyProvider } = require('../lib/cloud-store');

module.exports = function ({ assert, testAsync }) {
  return async function () {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-search-compact-'));
    const options = { dbPath: path.join(directory, 'cloud.db'),
      keyProvider: createLocalKeyProvider({ masterKey: Buffer.alloc(32, 71), environment: 'test' }),
      idempotencySecret: 'compact-search-fixture-secret' };
    let store = createCloudStore(options);
    const owner = 'owner', reader = 'reader';
    const team = await store.createTeamWorkspace({ userId: owner, name: 'Engineering', projectName: 'Documents' });
    store.addWorkspaceMember({ actorUserId: owner, workspaceId: team.workspaceId, userId: reader, role: 'member' });
    let serial = 0;
    const create = (markdown, extra = {}) => store.createDocument({ userId: owner, projectId: team.projectId,
      filename: 'fixture-' + (++serial) + '.md', markdown, idempotencyKey: 'create-' + serial, ...extra });
    const search = input => store.searchPage({ userId: reader, workspaceIds: [team.workspaceId], ...input });
    const compact = async document => {
      const row = store.db.prepare('SELECT * FROM cloud_document_revisions WHERE id=?').get(document.current_revision_id);
      const content = await store._decryptRevision(row), key = await store._projectKey(team.projectId, row.project_key_version);
      try {
        const prepared = store.searchIndex.prepare({ key, projectId: team.projectId, ...content });
        store.db.transaction(() => store.searchIndex.commit({ documentId: document.id, projectId: team.projectId,
          revisionId: row.id, prepared: { ...prepared, terms: [], scanRequired: true } }))();
      } finally { key.fill(0); }
    };
    const term = (value, field = 'text') => ({ field, value, match: 'term' });
    try {
      const first = await create('---\ntags:\n  - engineering\n  - active\n---\n# Incident response\nAlpha beta alpha beta. Straße STRASSE Σ ς ¼. incident-response AB-123.');
      const second = await create('---\ntags:\n  - engineering\n  - draft\n---\n# Authentication plan\nAlpha gamma beta. incident response.');
      for (const document of [first, second]) store.setDocumentPermission({ userId: owner, documentId: document.id,
        mode: 'custom', memberUserIds: [reader] });
      const hidden = await create('# Private hidden-marker\nincident response');
      const queries = [
        { expression: term('incident') }, { expression: term('incident-response') },
        { expression: { field: 'body', value: 'alpha beta', match: 'phrase' } },
        { expression: { field: 'text', value: 'auth', match: 'prefix' } },
        { expression: term('STRASSE') }, { expression: { field: 'body', value: 'σ σ', match: 'phrase' } },
        { expression: { field: 'body', value: '1 4', match: 'phrase' } },
        { expression: term('incident'), fields: ['body', 'body'] },
        { expression: { op: 'and', clauses: [term('incident'), { op: 'not', clause: term('gamma') }] } },
        { expression: { op: 'or', clauses: [term('gamma'), { field: 'tag', value: 'active' }] } },
        { expression: { op: 'and', clauses: [{ field: 'author', value: owner }, term('incident')] } },
        ...['ncident', 'incident-response', 'incident response', '---', 'cafe\u0301', '¼', 'AB-123'].map(query => ({ query })),
        { expression: term('incident'), query: 'response', tagsNone: ['draft'] },
      ].map(query => ({ ...query, facets: ['tags', 'authors', 'libraries'], limit: 1, matchLimit: 5 }));
      const baseline = [], continuation = [];
      for (const query of queries) {
        const result = await search(query);
        baseline.push(result);
        continuation.push(result.nextPosition ? await search({ ...query, after: result.nextPosition }) : null);
      }
      await testAsync('compact and mixed indexes preserve scores, Boolean matches, literals, facets, snippets and cursors', async () => {
        for (const document of [first, second]) {
          await compact(document);
          for (let i = 0; i < queries.length; i++) {
            const result = await search(queries[i]);
            assert.deepStrictEqual(result, baseline[i], JSON.stringify(queries[i]));
            if (result.nextPosition) assert.deepStrictEqual(await search({ ...queries[i], after: result.nextPosition }), continuation[i]);
          }
        }
        assert.ok(!JSON.stringify(baseline).includes(hidden.id));
      });
      await testAsync('compact matching rechecks document revocation across cooperative scan awaits', async () => {
        const other = createCloudStore(options), original = store._decryptRevision;
        let changed = false;
        store._decryptRevision = async function (row) {
          const result = await original.call(this, row);
          if (row.document_id === first.id && !changed) {
            changed = true;
            setImmediate(() => other.setDocumentPermission({ userId: owner, documentId: first.id,
              mode: 'custom', memberUserIds: [] }));
          }
          assert.notStrictEqual(row.document_id, hidden.id);
          return result;
        };
        try {
          const result = await search({ documentIds: [first.id], expression: term('incident'), facets: ['tags', 'authors', 'libraries'] });
          assert.strictEqual(result.total_count, 0);
          assert.deepStrictEqual(result.documents, []);
          assert.deepStrictEqual(result.facets.tags, []);
          assert.ok(!JSON.stringify(result).includes(first.id));
        } finally { store._decryptRevision = original; other.close(); }
      });
      await testAsync('ordinary prose and code retain inverted indexes while high-entropy edits stay compact', async () => {
        for (const filename of ['alphafold3-benchmark-audit.md', 'idempotent-order-api.md', 'retry-amplification-study.md']) {
          const document = await create(fs.readFileSync(path.join(__dirname, '../public/homepage/examples', filename), 'utf8'));
          assert.strictEqual(store.db.prepare('SELECT scan_required FROM cloud_search_documents WHERE document_id=?').get(document.id).scan_required, 0, filename);
        }
        const before = store.db.prepare('SELECT count(*) AS n FROM cloud_search_term_features').get().n;
        let document;
        for (let i = 0; i < 4; i++) {
          const markdown = '---\ntags:\n  - compact\n---\n# Encoded data\n' + crypto.randomBytes(96 * 1024).toString('base64');
          document = document ? await store.saveRevision({ userId: owner, documentId: document.id,
            expectedHeadRevisionId: document.current_revision_id, filename: 'encoded.md', markdown, idempotencyKey: 'encoded-' + i })
            : await create(markdown, { filename: 'encoded.md' });
          assert.strictEqual(store.db.prepare('SELECT scan_required FROM cloud_search_documents WHERE document_id=?').get(document.id).scan_required, 1);
          assert.strictEqual(store.db.prepare('SELECT count(*) AS n FROM cloud_search_term_features').get().n, before);
        }
        assert.strictEqual((await store.searchPage({ userId: owner, documentIds: [document.id], tags: ['compact'] })).total_count, 1);
        const prior = document.current_revision_id;
        await assert.rejects(store.saveRevision({ userId: owner, documentId: document.id,
          expectedHeadRevisionId: prior, filename: 'encoded.md', markdown: '# Rollback', idempotencyKey: 'compact-rollback',
          beforeCommit() { throw new Error('fixture rollback'); } }));
        assert.strictEqual(store.db.prepare('SELECT head_revision_id FROM cloud_search_documents WHERE document_id=?').get(document.id).head_revision_id, prior);
      });
      await testAsync('orphan collection cannot invalidate another prepared document sharing the same word', async () => {
        const plan = store.db.prepare('EXPLAIN QUERY PLAN SELECT feature_hash FROM cloud_search_term_features WHERE term_id=?').all(-1);
        assert.ok(plan.some(row => row.detail.includes('cloud_search_term_features_term_idx')));
        const a = await create('# UniqueSharedWord');
        const other = createCloudStore(options), original = store._prepareSourceFile;
        let switched = false;
        store._prepareSourceFile = async function (...args) {
          if (!switched) {
            switched = true;
            await other.saveRevision({ userId: owner, documentId: a.id, expectedHeadRevisionId: a.current_revision_id,
              filename: 'replacement.md', markdown: '# ReplacementOnlyWord', idempotencyKey: 'replace-shared-word' });
          }
          return original.apply(this, args);
        };
        try {
          const b = await create('# UniqueSharedWord', { sourceFile: { absolute_path: '/notes/shared.md' } });
          assert.strictEqual((await store.searchPage({ userId: owner, expression: term('UniqueSharedWord') })).documents[0].id, b.id);
          assert.deepStrictEqual(store.db.pragma('foreign_key_check'), []);
        } finally { store._prepareSourceFile = original; other.close(); }
      });
      await testAsync('existing index schema migrates without changing indexed heads or term hashes', async () => {
        const legacyOptions = { ...options, dbPath: path.join(directory, 'legacy.db') };
        let legacy = createCloudStore(legacyOptions);
        try {
          const workspace = await legacy.createTeamWorkspace({ userId: owner, name: 'Existing library' });
          await legacy.createDocument({ userId: owner, projectId: workspace.projectId, filename: 'existing.md',
            markdown: '# Existing indexed words', idempotencyKey: 'legacy-document' });
          const hashes = legacy.db.prepare('SELECT term_hash FROM cloud_search_terms ORDER BY id').all();
          const heads = legacy.db.prepare('SELECT document_id,head_revision_id FROM cloud_search_documents ORDER BY id').all();
          legacy.db.exec('ALTER TABLE cloud_search_documents DROP COLUMN scan_required');
          legacy.close(); legacy = createCloudStore(legacyOptions);
          assert.deepStrictEqual(legacy.db.prepare('SELECT term_hash FROM cloud_search_terms ORDER BY id').all(), hashes);
          assert.deepStrictEqual(legacy.db.prepare('SELECT document_id,head_revision_id FROM cloud_search_documents ORDER BY id').all(), heads);
          assert.strictEqual((await legacy.searchPage({ userId: owner, expression: term('indexed') })).total_count, 1);
        } finally { legacy.close(); }
      });
      await testAsync('old readers detect compact records as stale and old rewrites cannot leave a misleading scan flag', async () => {
        const document = await create('# Rollback compatibility\nrollbackword');
        await compact(document);
        const stored = store.db.prepare('SELECT format_version,scan_required FROM cloud_search_documents WHERE document_id=?').get(document.id);
        assert.deepStrictEqual(stored, { format_version: 4, scan_required: 1 });
        // This is the previous reader's stale-record predicate. Its ordinary
        // rebuild/pending response handles version 4 rather than missing words.
        assert.ok(store.db.prepare('SELECT 1 FROM cloud_search_documents WHERE document_id=? AND format_version<>3').get(document.id));
        const row = store.db.prepare('SELECT * FROM cloud_document_revisions WHERE id=?').get(document.current_revision_id);
        const content = await store._decryptRevision(row), key = await store._projectKey(team.projectId, row.project_key_version);
        try {
          const prepared = store.searchIndex.prepare({ key, projectId: team.projectId, ...content });
          store.db.transaction(() => store.searchIndex.commit({ documentId: document.id, projectId: team.projectId,
            revisionId: row.id, prepared }))();
        } finally { key.fill(0); }
        // The old INSERT does not know this additive column and retains it on
        // conflict. A rebuilt version-3 posting list remains authoritative.
        store.db.prepare('UPDATE cloud_search_documents SET scan_required=1 WHERE document_id=?').run(document.id);
        const original = store._decryptRevision;
        store._decryptRevision = async () => { throw new Error('An indexed match must not scan its body'); };
        try {
          const result = await store.searchPage({ userId: owner, documentIds: [document.id],
            expression: term('rollbackword'), matchLimit: 0 });
          assert.strictEqual(result.total_count, 1);
        } finally { store._decryptRevision = original; }
      });
    } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }

    await testAsync('permitted high-entropy saves and exact fallback queries keep HTTP health requests responsive', async () => {
      const f = await require('./cloud-onboarding-fixture').startFixture();
      const watchdog = setTimeout(() => process.kill(f.serverPid, 'SIGKILL'), 20000);
      try {
        const project = (await f.store.listProjects(f.users.returning.id, f.personal.workspaceId))[0];
        const markdown = '# Responsiveness\n' + crypto.randomBytes(3 * 1024 * 1024).toString('base64') + '\nresponsivenessneedle';
        const measurements = [];
        async function responsive(operation) {
          const operationStarted = performance.now();
          let done = false;
          const pending = operation.finally(() => { done = true; });
          pending.catch(() => {});
          const latencies = [];
          while (!done) {
            const start = performance.now();
            const health = await fetch(f.origin + '/version-check', { signal: AbortSignal.timeout(2000) });
            await health.text();
            assert.strictEqual(health.status, 200);
            latencies.push(performance.now() - start);
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          const result = await pending;
          assert.ok(latencies.length > 0);
          assert.ok(Math.max(...latencies) < 1000, 'health latency ' + Math.max(...latencies));
          measurements.push({ duration_ms: Math.round(performance.now() - operationStarted),
            max_health_ms: Math.round(Math.max(...latencies)), health_requests: latencies.length });
          return result;
        }
        const saved = await responsive(f.api('returning', '/api/cloud/v1/documents', 'POST', {
          project_id: project.id, filename: 'encoded.md', markdown, idempotency_key: 'responsive-save',
        }));
        assert.strictEqual(saved.status, 201, JSON.stringify(saved.data));
        const document = saved.data.document;
        assert.strictEqual(f.store.db.prepare('SELECT scan_required FROM cloud_search_documents WHERE document_id=?').get(document.id).scan_required, 1);
        assert.strictEqual(f.store.db.prepare('SELECT count(*) AS n FROM cloud_search_term_features').get().n, 0);
        const found = await responsive(f.api('returning', '/api/cloud/v1/search', 'POST', {
          workspace_id: f.personal.workspaceId, document_ids: [document.id], mode: 'query', query: 'responsivenessneedle', match_limit: 1,
        }));
        assert.strictEqual(found.status, 200, JSON.stringify(found.data));
        assert.strictEqual(found.data.total_count, 1);
        console.log('Compact search fixture: ' + JSON.stringify({ source_bytes: Buffer.byteLength(markdown),
          operations: measurements, features: f.store.db.prepare('SELECT count(*) AS n FROM cloud_search_term_features').get().n,
          database_bytes: fs.statSync(path.join(f.dir, 'store.db')).size,
          wal_bytes: fs.statSync(path.join(f.dir, 'store.db-wal')).size }));
      } finally { clearTimeout(watchdog); await f.close(); }
    });
  };
};
