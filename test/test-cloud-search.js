const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCloudStore, createLocalKeyProvider } = require('../lib/cloud-store');
const { encodePositions, decodePositions } = require('../lib/cloud-search-index');

module.exports = function(harness) {
  const { assert, testAsync } = harness;
  return async function() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-search-'));
    let now = Date.parse('2026-01-01T00:00:00Z');
    const store = createCloudStore({ dbPath: path.join(directory, 'cloud.db'),
      keyProvider: createLocalKeyProvider({ masterKey: Buffer.alloc(32, 31), environment: 'test' }),
      idempotencySecret: 'search-test-idempotency-secret-123', now: () => now });
    const owner = 'search-owner';
    const member = 'search-member';
    let workspace;
    let second;
    const docs = [];
    const term = (value, field) => ({ field: field || 'text', match: 'term', value });
    const phrase = (value, field) => ({ field: field || 'text', match: 'phrase', value });
    const search = (input) => store.searchPage({ userId: member, workspaceIds: [workspace.workspaceId], ...input });
    async function create(markdown, filename, members) {
      now += 1000;
      const document = await store.createDocument({ userId: owner, projectId: workspace.projectId,
        markdown, filename, idempotencyKey: 'create-' + now });
      if (members !== false) store.setDocumentPermission({ userId: owner, documentId: document.id, mode: 'custom', memberUserIds: [member] });
      docs.push(document);
      return document;
    }
    try {
      workspace = await store.createTeamWorkspace({ userId: owner, name: 'Engineering', projectName: 'Documents' });
      second = await store.createTeamWorkspace({ userId: owner, name: 'Operations', projectName: 'Documents' });
      for (const id of [workspace.workspaceId, second.workspaceId]) {
        store.addWorkspaceMember({ actorUserId: owner, workspaceId: id, userId: member, role: 'member' });
      }
      await create('---\ntags:\n  - engineering\n  - active\n---\n# Incident response\nThe incident-response owner reviews authentication. STRASSE Straße Σ ς.\nThe alpha beta gamma order-id AB-123 code.', 'runbook.md');
      await create('---\ntags:\n  - engineering\n  - draft\n---\n# Authentication plan\nThe incident owner coordinates the response. Alpha gamma beta.\n', 'auth-plan.md');
      await create('---\ntags:\n  - confidential\n  - hidden-marker\n---\n# Secret Incident\nincident response secret-marker', 'private.md', false);

      await testAsync('search positional varints round-trip repeated, sparse and large positions', async () => {
        assert.deepStrictEqual(decodePositions(encodePositions([0, 1, 127, 128, 40000, 10000000])), [0, 1, 127, 128, 40000, 10000000]);
      });
      await testAsync('indexed terms, phrases and prefixes respect whole words and field boundaries', async () => {
        assert.strictEqual((await search({ expression: term('incident') })).total_count, 2);
        assert.strictEqual((await search({ expression: term('incid') })).total_count, 0);
        assert.strictEqual((await search({ expression: { field: 'text', match: 'prefix', value: 'auth' } })).total_count, 2);
        assert.strictEqual((await search({ expression: phrase('incident response') })).total_count, 1);
        assert.strictEqual((await search({ expression: phrase('alpha beta') })).total_count, 1);
        assert.strictEqual((await search({ expression: phrase('beta alpha') })).total_count, 0);
        assert.strictEqual((await search({ expression: term('order-id') })).total_count, 1);
        assert.strictEqual((await search({ expression: term('AB-123') })).total_count, 1);
        assert.strictEqual((await search({ expression: term('STRASSE', 'body') })).total_count, 1);
        assert.strictEqual((await search({ expression: phrase('σ σ', 'body') })).total_count, 1);
        assert.strictEqual((await search({ expression: term('runbook', 'filename') })).total_count, 1);
        assert.strictEqual((await search({ expression: term('runbook'), fields: ['body'] })).total_count, 0);
      });
      await testAsync('Boolean search evaluates nested alternatives and complements within authorized documents', async () => {
        const result = await search({ expression: { op: 'and', clauses: [term('incident'), { op: 'not', clause: phrase('incident response') }] } });
        assert.deepStrictEqual(result.documents.map((document) => document.id), [docs[1].id]);
        assert.strictEqual((await search({ expression: { op: 'or', clauses: [term('runbook'), term('auth')] } })).total_count, 2);
        assert.strictEqual((await search({ expression: { op: 'not', clause: term('secret-marker') } })).total_count, 2);
        assert.strictEqual((await search({ expression: { field: 'author', value: owner } })).total_count, 2);
        assert.strictEqual((await search({ expression: { field: 'author', value: 'me' } })).total_count, 0);
      });
      await testAsync('metadata-only search combines all, any, none and exact tags', async () => {
        assert.strictEqual((await search({ query: '', tags: ['engineering'] })).total_count, 2);
        assert.strictEqual((await search({ tags: ['engineering', 'active'] })).total_count, 1);
        assert.strictEqual((await search({ tagsAny: ['active', 'missing'], tagsNone: ['draft'] })).total_count, 1);
        assert.strictEqual((await search({ expression: { field: 'tag', value: '#ENGINEERING' } })).total_count, 2);
        assert.strictEqual((await search({ expression: { field: 'tag', value: 'engineer' } })).total_count, 0);
        assert.strictEqual((await search({ documentIds: [] })).total_count, 0);
        assert.strictEqual((await search({ workspaceIds: [] })).total_count, 0);
        assert.strictEqual((await search({ documentIds: [docs[0].id, docs[2].id] })).total_count, 1);
        assert.strictEqual((await search({ sharedWithMe: true })).total_count, 2);
      });
      await testAsync('counts facets and snippets exclude private documents and report truncation', async () => {
        const result = await search({ expression: term('incident'), facets: ['tags', 'authors', 'libraries'], facetLimit: 1 });
        assert.strictEqual(result.total_count, 2);
        assert.deepStrictEqual(result.facets.tags, [{ tag: 'engineering', document_count: 2 }]);
        assert.strictEqual(result.facet_totals.tags, 3);
        assert.strictEqual(result.facets_truncated.tags, true);
        assert.deepStrictEqual(result.facets.authors, [{ user_id: owner, document_count: 2 }]);
        assert.deepStrictEqual(result.facets.libraries, [{ id: workspace.workspaceId, document_count: 2 }]);
        assert.strictEqual(JSON.stringify(result).includes('hidden-marker'), false);
        assert.strictEqual(JSON.stringify(result).includes('secret-marker'), false);
        for (const document of result.documents) for (const match of document.matches) {
          assert.ok(match.line == null || match.line > 0);
          for (const offset of match.offsets) assert.ok(match.terms.includes(match.snippet.slice(offset.start, offset.end)));
        }
        const outsider = await search({ userId: 'outsider', facets: ['tags'] });
        assert.strictEqual(outsider.total_count, 0);
        assert.deepStrictEqual(outsider.facets.tags, []);
      });
      await testAsync('legacy literal substring keeps fragments and punctuation exact', async () => {
        assert.strictEqual((await search({ query: 'ncident' })).total_count, 2);
        assert.strictEqual((await search({ query: 'incident-response' })).total_count, 1);
        assert.strictEqual((await search({ query: 'incident response' })).total_count, 1);
        assert.strictEqual((await search({ query: 'a' })).total_count, 2);
        assert.strictEqual((await search({ query: '---' })).total_count, 2);
        assert.strictEqual((await search({ query: 'beta gamma alpha' })).total_count, 0);
      });
      await testAsync('date bounds are inclusive and stable keyset pages contain every authorized result once', async () => {
        const bound = docs[0].updated_at;
        assert.strictEqual((await search({ createdAfter: bound, createdBefore: bound })).total_count, 1);
        assert.strictEqual((await search({ updatedAfter: bound, updatedBefore: bound })).total_count, 1);
        for (const sort of ['relevance', 'updated_desc', 'created_desc']) {
          const first = await search({ expression: term('incident'), sort, limit: 1 });
          assert.strictEqual(first.has_more, true);
          const last = await search({ expression: term('incident'), sort, limit: 1, after: first.nextPosition });
          assert.strictEqual(last.has_more, false);
          assert.strictEqual(new Set(first.documents.concat(last.documents).map((document) => document.id)).size, 2);
          assert.strictEqual(last.total_count, 2);
        }
      });
      await testAsync('author and last-revision-author filters differ after an authorized edit', async () => {
        const changed = await store.saveRevision({ userId: member, documentId: docs[1].id, filename: 'auth-plan.md',
          markdown: '# Authentication plan\nincident owner response updatedword', expectedHeadRevisionId: docs[1].current_revision_id, idempotencyKey: 'member-update' });
        docs[1] = changed;
        assert.strictEqual((await search({ authorUserIds: [owner] })).total_count, 2);
        assert.strictEqual((await search({ updatedByUserIds: [member] })).total_count, 1);
        assert.strictEqual((await search({ updatedByUserIds: [owner] })).total_count, 1);
        assert.strictEqual((await search({ expression: term('updatedword') })).total_count, 1);
        assert.strictEqual((await search({ expression: term('gamma') })).total_count, 1);
      });
      await testAsync('save and revision restore update the index atomically without old-head matches', async () => {
        const original = docs[0];
        const saved = await store.saveRevision({ userId: owner, documentId: original.id, filename: 'runbook.md',
          markdown: '# Replaced\nnewheadtoken', expectedHeadRevisionId: original.current_revision_id, idempotencyKey: 'save-index' });
        assert.strictEqual((await search({ expression: term('newheadtoken') })).total_count, 1);
        assert.strictEqual((await search({ expression: phrase('incident response') })).total_count, 0);
        const restored = await store.restoreRevision({ userId: owner, documentId: original.id, revisionId: original.current_revision_id,
          expectedHeadRevisionId: saved.current_revision_id, idempotencyKey: 'restore-index' });
        docs[0] = restored;
        assert.strictEqual((await search({ expression: term('newheadtoken') })).total_count, 0);
        assert.strictEqual((await search({ expression: phrase('incident response') })).total_count, 1);
        await assert.rejects(store.saveRevision({ userId: owner, documentId: original.id, filename: 'bad.md', markdown: '# rollbacktoken',
          expectedHeadRevisionId: restored.current_revision_id, idempotencyKey: 'rollback-index', beforeCommit() { throw Object.assign(new Error('blocked'), { code: 'test_blocked' }); } }), (error) => error.code === 'test_blocked');
        assert.strictEqual((await search({ expression: term('rollbacktoken') })).total_count, 0);
        assert.strictEqual(store.searchIndexStatus().ready, true);
      });
      await testAsync('deletion restore move and purge preserve search permissions and current project keys', async () => {
        const document = docs[0];
        store.deleteDocument({ userId: owner, documentId: document.id, expectedHeadRevisionId: document.current_revision_id });
        assert.strictEqual((await search({ expression: phrase('incident response') })).total_count, 0);
        await store.restoreDeletedDocument({ userId: owner, documentId: document.id, expectedHeadRevisionId: document.current_revision_id });
        assert.strictEqual((await search({ expression: phrase('incident response') })).total_count, 1);
        await store.moveDocument({ userId: owner, documentId: document.id, projectId: second.projectId, expectedHeadRevisionId: document.current_revision_id });
        assert.strictEqual((await search({ workspaceIds: [workspace.workspaceId, second.workspaceId], expression: phrase('incident response') })).total_count, 0);
        store.setDocumentPermission({ userId: owner, documentId: document.id, mode: 'custom', memberUserIds: [member] });
        assert.strictEqual((await search({ workspaceIds: [second.workspaceId], expression: phrase('incident response') })).total_count, 1);
        store.deleteDocument({ userId: owner, documentId: document.id, expectedHeadRevisionId: document.current_revision_id, restoreWindowMs: 1 });
        now += 2;
        store.purgeDeletedDocuments({ beforeMs: now });
        assert.strictEqual(store.db.prepare('SELECT count(*) AS count FROM cloud_search_documents WHERE document_id=?').get(document.id).count, 0);
      });
      await testAsync('search rechecks permissions and heads after awaited content loads before all aggregates', async () => {
        const original = store._decryptRevision;
        let changed = false;
        store._decryptRevision = async function(row) {
          const result = await original.call(this, row);
          if (!changed && row.document_id === docs[1].id) {
            changed = true;
            this.setDocumentPermission({ userId: owner, documentId: docs[1].id, mode: 'custom', memberUserIds: [] });
          }
          return result;
        };
        try {
          const result = await search({ expression: term('updatedword'), facets: ['tags', 'authors', 'libraries'] });
          assert.strictEqual(result.total_count, 0);
          assert.deepStrictEqual(result.documents, []);
          assert.deepStrictEqual(result.facets.authors, []);
        } finally {
          store._decryptRevision = original;
          store.setDocumentPermission({ userId: owner, documentId: docs[1].id, mode: 'custom', memberUserIds: [member] });
        }
        let calls = 0;
        await assert.rejects(search({ beforeReturn() { if (++calls === 2) throw Object.assign(new Error('revoked'), { code: 'subscription_read_only' }); } }), (error) => error.code === 'subscription_read_only');
      });
      await testAsync('long vocabulary tokens retain exact prefix semantics without quadratic prefix indexing', async () => {
        const prefix = 'a'.repeat(40);
        const document = await create('# Encoded\n' + prefix + 'x' + 'b'.repeat(100000), 'encoded.md');
        await create('# Other\n' + prefix + 'y' + 'c'.repeat(100000), 'other-encoded.md');
        const found = await search({ expression: { field: 'body', match: 'prefix', value: prefix + 'x' } });
        assert.deepStrictEqual(found.documents.map((value) => value.id), [document.id]);
        const inverse = await search({ expression: { op: 'not', clause: { field: 'body', match: 'prefix', value: prefix + 'x' } } });
        assert.ok(!inverse.documents.some((value) => value.id === document.id));
      });
      await testAsync('revocation on another connection removes cursor metadata and fills from authorized results', async () => {
        const selected = [];
        for (let i = 0; i < 3; i++) selected.push(await create('# Cursor safety\ncursorrevocationtoken', 'cursor-safe-' + i + '.md'));
        const other = createCloudStore({ dbPath: path.join(directory, 'cloud.db'),
          keyProvider: createLocalKeyProvider({ masterKey: Buffer.alloc(32, 31), environment: 'test' }),
          idempotencySecret: 'search-test-idempotency-secret-123', now: () => now });
        const original = store._decryptRevision;
        let revoked;
        store._decryptRevision = async function(row) {
          const result = await original.call(this, row);
          if (!revoked) {
            revoked = row.document_id;
            other.setDocumentPermission({ userId: owner, documentId: revoked, mode: 'custom', memberUserIds: [] });
          }
          return result;
        };
        try {
          const first = await search({ expression: term('cursorrevocationtoken'), limit: 1 });
          assert.strictEqual(first.total_count, 2);
          assert.strictEqual(first.documents.length, 1);
          assert.notStrictEqual(first.documents[0].id, revoked);
          assert.strictEqual(first.nextPosition.id, first.documents[0].id);
          assert.ok(!JSON.stringify(first).includes(revoked));
          const last = await search({ expression: term('cursorrevocationtoken'), limit: 1, after: first.nextPosition });
          assert.strictEqual(last.documents.length, 1);
          assert.notStrictEqual(last.documents[0].id, first.documents[0].id);
          assert.strictEqual(last.nextPosition, null);
        } finally { store._decryptRevision = original; other.close(); }
      });
      await testAsync('index rows persist keyed digests encrypted labels and compact positions without plaintext', async () => {
        const hidden = 'persistentsecretvocabulary';
        await create('---\ntags:\n  - persistent-secret-tag\n---\n# ' + hidden + '\n' + hidden, hidden + '.md');
        for (const table of ['cloud_search_documents', 'cloud_search_terms', 'cloud_search_term_features', 'cloud_search_postings', 'cloud_search_tags', 'cloud_search_document_tags']) {
          const rows = store.db.prepare('SELECT * FROM ' + table).all();
          for (const row of rows) for (const value of Object.values(row)) {
            const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
            assert.strictEqual(text.includes(hidden), false);
            assert.strictEqual(text.includes('persistent-secret-tag'), false);
          }
        }
      });
      await testAsync('exact tag labels remain distinct when word case folding would merge them', async () => {
        const document = await create('---\ntags:\n  - straße\n  - strasse\n---\n# Tag variants', 'tag-variants.md');
        const found = await search({ documentIds: [document.id], facets: ['tags'] });
        assert.deepStrictEqual(new Set(found.facets.tags.map((tag) => tag.tag)), new Set(['straße', 'strasse']));
      });
      await testAsync('snippets coalesce overlapping term and phrase highlights into one passage per line', async () => {
        const document = await create('# Operations\nThe incident response team confirms an incident response drill.\n', 'snippet-overlap.md');
        const found = await search({ documentIds: [document.id], expression: { op: 'and', clauses: [term('incident'), phrase('incident response')] }, matchLimit: 5 });
        const matches = found.documents[0].matches;
        assert.strictEqual(matches.length, 1);
        assert.strictEqual(matches[0].line, 2);
        assert.deepStrictEqual(matches[0].terms, ['incident response']);
        assert.strictEqual(matches[0].offsets.length, 2);
        assert.ok(matches[0].offsets[0].end <= matches[0].offsets[1].start);
        for (const offset of matches[0].offsets) assert.strictEqual(matches[0].snippet.slice(offset.start, offset.end), 'incident response');
      });
      await testAsync('snippet budgets cover distinct positive query clauses before repeated occurrences', async () => {
        const document = await create('# Billing evidence\n' + 'payments '.repeat(60) + '\n' + 'Unrelated operational context. '.repeat(20) + '\nRefunds require a case reference.\n', 'snippet-coverage.md');
        const found = await search({ documentIds: [document.id], expression: { op: 'and', clauses: [term('payments'), term('refunds')] }, matchLimit: 2 });
        const matches = found.documents[0].matches;
        assert.strictEqual(matches.length, 2);
        assert.ok(matches.some((match) => match.terms.some((value) => value.toLowerCase() === 'payments')));
        assert.ok(matches.some((match) => match.terms.some((value) => value.toLowerCase() === 'refunds')));
        assert.strictEqual(new Set(matches.map((match) => match.line)).size, 2);
        const repeated = await search({ documentIds: [document.id], expression: term('payments'), matchLimit: 5 });
        assert.strictEqual(repeated.documents[0].matches.length, 1);
      });
      await testAsync('body snippets prefer prose to duplicate front matter and clip YAML out of context', async () => {
        const markdown = '---\ntags:\n  - payments\n  - refunds\n---\n# Operations\nPayments require the current owner.\n' + 'Operational context. '.repeat(20) + '\nRefunds require a case reference.\n';
        const document = await create(markdown, 'snippet-prose.md');
        const found = await search({ documentIds: [document.id], expression: { op: 'and', clauses: [term('payments'), term('refunds')] }, matchLimit: 2 });
        assert.strictEqual(found.documents[0].matches.length, 2);
        for (const match of found.documents[0].matches) {
          assert.strictEqual(match.field, 'body');
          assert.ok(match.line >= 7);
          assert.strictEqual(match.snippet.includes('tags:'), false);
          assert.strictEqual(match.snippet.includes('---'), false);
        }
        const literal = await search({ documentIds: [document.id], query: 'payments', matchLimit: 1 });
        assert.strictEqual(literal.documents[0].matches[0].line, 7);
        assert.strictEqual(literal.documents[0].matches[0].snippet.includes('tags:'), false);
      });
      await testAsync('snippet evidence retains metadata-only matches and explicitly requested fields', async () => {
        const document = await create('---\ntitle: Payments archive\ntags:\n  - finance\n---\n# Operational notes\nRefunds require a case reference.\n', 'snippet-fields.md');
        const metadata = await search({ documentIds: [document.id], expression: term('finance'), matchLimit: 1 });
        assert.strictEqual(metadata.documents[0].matches[0].field, 'tags');
        assert.strictEqual(metadata.documents[0].matches[0].snippet, 'finance');
        const body = await search({ documentIds: [document.id], expression: term('finance', 'body'), matchLimit: 1 });
        assert.strictEqual(body.documents[0].matches[0].field, 'body');
        assert.strictEqual(body.documents[0].matches[0].line, 4);
        const scoped = await search({ documentIds: [document.id], expression: { op: 'and', clauses: [term('payments', 'title'), term('refunds', 'body')] }, matchLimit: 2 });
        assert.deepStrictEqual(new Set(scoped.documents[0].matches.map((match) => match.field)), new Set(['body', 'title']));
      });
      await testAsync('nearby distinct terms share a passage while distant same-line terms keep coverage', async () => {
        const nearby = await create('# Transfers\nPayments queue before refunds are confirmed.\n', 'snippet-nearby.md');
        const expression = { op: 'and', clauses: [term('payments'), term('refunds')] };
        const joined = await search({ documentIds: [nearby.id], expression, matchLimit: 2 });
        assert.strictEqual(joined.documents[0].matches.length, 1);
        assert.deepStrictEqual(new Set(joined.documents[0].matches[0].terms.map((value) => value.toLowerCase())), new Set(['payments', 'refunds']));
        const markdown = '# Long line\nPayments ' + 'context '.repeat(50) + 'refunds require the current reference.';
        const distant = await create(markdown, 'snippet-distant.md');
        const separated = await search({ documentIds: [distant.id], expression, matchLimit: 2 });
        const matches = separated.documents[0].matches;
        assert.strictEqual(matches.length, 2);
        assert.ok(matches.every((match) => match.line === 2));
        const ranges = matches.map((match) => ({ start: markdown.indexOf(match.snippet), end: markdown.indexOf(match.snippet) + match.snippet.length })).sort((a, b) => a.start - b.start);
        assert.ok(ranges[0].end <= ranges[1].start);
      });
      await testAsync('snippet spans remain valid for a phrase crossing the front matter boundary', async () => {
        const document = await create('---\ntags:\n  - finance\n---\n# Operations\nPayments require review.\n', 'snippet-boundary.md');
        const found = await search({ documentIds: [document.id], expression: { op: 'and', clauses: [phrase('finance operations', 'body'), term('operations', 'body')] } });
        assert.strictEqual(found.total_count, 1);
        for (const match of found.documents[0].matches) for (const offset of match.offsets) {
          assert.ok(offset.start >= 0 && offset.end <= match.snippet.length);
          assert.ok(match.terms.includes(match.snippet.slice(offset.start, offset.end)));
        }
      });
      await testAsync('bounded backfill reports unindexed authorized heads and never returns a partial corpus', async () => {
        for (let i = 0; i < 105; i++) await create('# Backfill\nbackfillword', 'backfill-' + i + '.md');
        store.db.prepare('DELETE FROM cloud_search_documents').run();
        assert.strictEqual(store.searchIndexStatus().ready, false);
        await assert.rejects(search({ expression: term('backfillword') }), (error) => error.code === 'search_index_building');
        let result;
        do { result = await store.rebuildSearchIndex({ limit: 7 }); } while (!result.ready);
        assert.strictEqual(store.searchIndexStatus().remaining_count, 0);
        const found = await search({ expression: term('backfillword'), limit: 100 });
        assert.strictEqual(found.total_count, 105);
        assert.strictEqual(found.documents.length, 100);
        assert.strictEqual(found.has_more, true);
      });
      await testAsync('indexed broad counts do not decrypt the full matching corpus', async () => {
        const original = store._decryptRevision;
        let decrypted = 0;
        store._decryptRevision = async function(row) { decrypted++; return original.call(this, row); };
        try {
          const found = await search({ expression: term('backfillword'), limit: 3, facets: ['tags', 'authors', 'libraries'] });
          assert.strictEqual(found.total_count, 105);
          assert.strictEqual(decrypted, 3);
        } finally { store._decryptRevision = original; }
      });
      await testAsync('browsing reads page metadata without opening bodies or keys for unselected projects', async () => {
        const recent = await create('---\ntags:\n  - browse-notes\n---\n# Latest note\n' + 'Long document body. '.repeat(10000), 'latest-note.md');
        const originalBody = store._decryptRevision;
        const originalMetadata = store._decryptRevisionMetadata;
        const originalKey = store._projectKey;
        const metadataRows = [];
        const projects = new Set();
        store._decryptRevision = async function() { throw new Error('Browsing decrypted a document body'); };
        store._decryptRevisionMetadata = async function(row) {
          assert.strictEqual(row.body_ciphertext, undefined);
          metadataRows.push(row.document_id);
          return originalMetadata.call(this, row);
        };
        store._projectKey = async function(projectId, version) {
          projects.add(projectId);
          return originalKey.call(this, projectId, version);
        };
        try {
          for (const extra of [{}, { authorUserIds: [owner] }, { updatedByUserIds: [owner] }, { sharedWithMe: true }]) {
            metadataRows.length = 0; projects.clear();
            const page = await search({ workspaceIds: [workspace.workspaceId, second.workspaceId],
              limit: 1, sort: 'updated_desc', facets: ['authors', 'libraries'], ...extra });
            assert.strictEqual(page.documents[0].id, recent.id);
            assert.strictEqual(page.documents[0].title, recent.title);
            assert.deepStrictEqual(page.documents[0].tags, recent.tags);
            assert.deepStrictEqual(page.documents[0].matches, []);
            assert.deepStrictEqual(metadataRows, [recent.id]);
            assert.deepStrictEqual(projects, new Set([workspace.projectId]));
            assert.ok(page.total_count > 100);
            assert.strictEqual(page.has_more, true);
          }
          const tagged = await search({ tags: ['browse-notes'], limit: 1 });
          assert.strictEqual(tagged.documents.length, 1);
          assert.ok(tagged.documents[0].tags.includes('browse-notes'));
          const silent = await search({ expression: term('backfillword'), limit: 1, matchLimit: 0 });
          assert.strictEqual(silent.total_count, 105);
          assert.deepStrictEqual(silent.documents[0].matches, []);
        } finally {
          store._decryptRevision = originalBody;
          store._decryptRevisionMetadata = originalMetadata;
          store._projectKey = originalKey;
        }
      });
      await testAsync('compatibility forms that expand into words match in both directions with source evidence', async () => {
        for (const [compact, expanded] of [['¼', '1⁄4'], ['ﷺ', 'صلى الله عليه وسلم']]) {
          for (const [source, query] of [[compact, expanded], [expanded, compact]]) {
            const document = await create('# Normalized words\n' + source, 'normalized-words.md');
            for (const expression of [term(query, 'body'), phrase(query, 'body')]) {
              const result = await search({ documentIds: [document.id], expression });
              assert.strictEqual(result.total_count, 1);
              const matches = result.documents[0].matches;
              assert.strictEqual(matches.length, 1);
              assert.strictEqual(matches[0].line, 2);
              assert.ok(matches[0].terms.includes(source));
              for (const offset of matches[0].offsets) {
                assert.ok(offset.start >= 0 && offset.end <= matches[0].snippet.length);
                assert.ok(matches[0].terms.includes(matches[0].snippet.slice(offset.start, offset.end)));
              }
            }
          }
        }
      });
      await testAsync('literal substrings retain decomposed Unicode and partial compatibility sequences', async () => {
        const document = await create('# Literal Unicode\ncafe\u0301 and ¼', 'literal-unicode.md');
        for (const query of ['cafe', 'e\u0301', '¼']) {
          const result = await search({ documentIds: [document.id], query });
          assert.strictEqual(result.total_count, 1);
          assert.ok(result.documents[0].matches.some((match) => match.terms.includes(query)));
        }
        assert.strictEqual((await search({ documentIds: [document.id], query: 'café' })).total_count, 0);
        assert.strictEqual((await search({ documentIds: [document.id], query: '1⁄4' })).total_count, 0);
      });
      await testAsync('high-frequency terms and prefixes decode every position without argument-list overflow', async () => {
        const document = await create('# Frequency fixture\n' + 'repeatword '.repeat(150000), 'frequency.md');
        for (const expression of [term('repeatword', 'body'), { field: 'body', match: 'prefix', value: 'repeat' }]) {
          const result = await search({ documentIds: [document.id], expression, matchLimit: 1 });
          assert.strictEqual(result.total_count, 1);
          assert.strictEqual(result.documents[0].id, document.id);
          assert.strictEqual(result.documents[0].matches[0].line, 2);
        }
      });
    } finally {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
};

if (require.main === module) {
  const harness = require('./runner');
  module.exports(harness)().then(() => harness.report()).catch((error) => { console.error(error); process.exitCode = 1; });
}
