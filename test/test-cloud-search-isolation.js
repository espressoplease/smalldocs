const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCloudStore, createLocalKeyProvider } = require('../lib/cloud-store');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-search-isolation-'));
    const dbPath = path.join(directory, 'store.db');
    const configuration = () => ({ dbPath,
      keyProvider: createLocalKeyProvider({ masterKey: Buffer.alloc(32, 62), environment: 'test' }),
      idempotencySecret: 'search-isolation-test-idempotency-secret' });
    const store = createCloudStore(configuration());
    const secondConnection = createCloudStore(configuration());
    const owners = ['company-a-owner', 'company-b-owner'];
    const reader = 'company-a-reader';
    let sequence = 0;
    const term = value => ({ field: 'text', match: 'term', value });
    const identifiers = page => new Set(page.documents.map(document => document.id));
    const allFacets = ['tags', 'authors', 'libraries'];
    let first, foreign;
    const search = extra => store.searchPage({ userId: reader,
      workspaceIds: [first.workspaceId, foreign.workspaceId], facets: allFacets, ...extra });
    async function create(library, userId, markdown, filename, share) {
      const document = await store.createDocument({ userId, projectId: library.projectId,
        markdown, filename, idempotencyKey: 'isolation-create-' + ++sequence });
      if (share) store.setDocumentPermission({ userId, documentId: document.id,
        mode: 'custom', memberUserIds: [reader] });
      return document;
    }
    const tagged = (tag, body) => '---\ntags:\n  - ' + tag + '\n---\n' + body;
    function noDisclosure(page, values) {
      const serialized = JSON.stringify(page);
      for (const value of values) assert.strictEqual(serialized.includes(value), false, 'disclosed ' + value);
    }
    try {
      first = await store.createTeamWorkspace({ userId: owners[0], name: 'Company A', projectName: 'Documents A' });
      foreign = await store.createTeamWorkspace({ userId: owners[1], name: 'Company B', projectName: 'Documents B' });
      store.addWorkspaceMember({ actorUserId: owners[0], workspaceId: first.workspaceId, userId: reader, role: 'member' });
      store.grantProject({ actorUserId: owners[0], workspaceId: first.workspaceId,
        projectId: first.projectId, userId: reader, role: 'editor' });
      const samePlaintext = tagged('shared-label', '# Shared text\nidentical-needle :: 42% / exact\n');
      const visible = await create(first, owners[0], samePlaintext, 'identical.md', true);
      const privateSameCompany = await create(first, owners[0],
        tagged('private-a-label', '# Private A title\nidentical-needle :: 42% / exact\nPrivateAOnlyCanary\n'), 'private-a-canary.md');
      const privateOtherCompany = await create(foreign, owners[1], samePlaintext, 'identical.md');
      const privateReader = await create(first, reader,
        tagged('reader-private-label', '# Reader private\nReaderOnlyCanary\n'), 'reader-private-canary.md');

      await testAsync('literal and word searches isolate private documents, tag labels, counts and all facets', async () => {
        for (const input of [{ query: 'needle :: 42%' }, { expression: term('identical') },
          { expression: { op: 'not', clause: term('doesnotexist') }, documentIds: [visible.id, privateSameCompany.id, privateOtherCompany.id] }]) {
          const result = await search(input);
          assert.deepStrictEqual(identifiers(result), new Set([visible.id]));
          assert.strictEqual(result.total_count, 1);
          assert.deepStrictEqual(result.facets.tags, [{ tag: 'shared-label', document_count: 1 }]);
          assert.deepStrictEqual(result.facets.libraries, [{ id: first.workspaceId, document_count: 1 }]);
          assert.deepStrictEqual(result.facets.authors, [{ user_id: owners[0], document_count: 1 }]);
          noDisclosure(result, [privateSameCompany.id, privateOtherCompany.id, 'private-a-label', 'PrivateAOnlyCanary', 'private-a-canary.md', foreign.workspaceId, owners[1]]);
        }
        for (const input of [{ query: 'PrivateAOnlyCanary' }, { query: 'private-a-label' }, { tags: ['private-a-label'] },
          { expression: { field: 'tag', value: 'private-a-label' } }, { documentIds: [privateSameCompany.id, privateOtherCompany.id] }]) {
          const result = await search(input);
          assert.strictEqual(result.total_count, 0);
          assert.deepStrictEqual(result.documents, []);
          for (const facet of allFacets) assert.deepStrictEqual(result.facets[facet], []);
        }
      });
      await testAsync('workspace owners and admins cannot search another creator private document', async () => {
        const page = await search({ userId: owners[0], query: 'ReaderOnlyCanary', documentIds: [privateReader.id] });
        assert.strictEqual(page.total_count, 0);
        noDisclosure(page, [privateReader.id, 'reader-private-label', 'ReaderOnlyCanary']);
        store.addWorkspaceMember({ actorUserId: owners[0], workspaceId: first.workspaceId, userId: 'company-a-admin', role: 'admin' });
        const admin = await search({ userId: 'company-a-admin', query: 'ReaderOnlyCanary', documentIds: [privateReader.id] });
        assert.strictEqual(admin.total_count, 0);
        assert.deepStrictEqual(admin.facets.tags, []);
      });
      await testAsync('identical plaintext receives independent project digests and access stays document scoped', async () => {
        const firstHashes = new Set(store.db.prepare('SELECT term_hash FROM cloud_search_terms WHERE project_id=?').all(first.projectId).map(row => row.term_hash.toString('hex')));
        const foreignHashes = store.db.prepare('SELECT term_hash FROM cloud_search_terms WHERE project_id=?').all(foreign.projectId).map(row => row.term_hash.toString('hex'));
        assert.ok(firstHashes.size && foreignHashes.length);
        assert.ok(foreignHashes.every(hash => !firstHashes.has(hash)));
        const firstTags = new Set(store.db.prepare('SELECT tag_hash FROM cloud_search_tags WHERE project_id=?').all(first.projectId).map(row => row.tag_hash.toString('hex')));
        assert.ok(store.db.prepare('SELECT tag_hash FROM cloud_search_tags WHERE project_id=?').all(foreign.projectId).every(row => !firstTags.has(row.tag_hash.toString('hex'))));
        const firstFeatures = new Set(store.db.prepare(`SELECT DISTINCT f.feature_hash FROM cloud_search_term_features f
          JOIN cloud_search_terms t ON t.id=f.term_id WHERE t.project_id=?`).all(first.projectId).map(row => row.feature_hash.toString('hex')));
        assert.ok(store.db.prepare(`SELECT DISTINCT f.feature_hash FROM cloud_search_term_features f
          JOIN cloud_search_terms t ON t.id=f.term_id WHERE t.project_id=?`).all(foreign.projectId).every(row => !firstFeatures.has(row.feature_hash.toString('hex'))));
        const other = await search({ userId: owners[1], query: 'needle :: 42%' });
        assert.deepStrictEqual(identifiers(other), new Set([privateOtherCompany.id]));
        assert.deepStrictEqual(other.facets.tags, [{ tag: 'shared-label', document_count: 1 }]);
        noDisclosure(other, [visible.id, privateSameCompany.id, privateReader.id, first.workspaceId, owners[0]]);
      });
      await testAsync('cross-library authorized tag labels merge counts without adding inaccessible documents', async () => {
        store.addWorkspaceMember({ actorUserId: owners[1], workspaceId: foreign.workspaceId, userId: reader, role: 'member' });
        store.setDocumentPermission({ userId: owners[1], documentId: privateOtherCompany.id, mode: 'custom', memberUserIds: [reader] });
        const result = await search({ query: 'needle :: 42%' });
        assert.deepStrictEqual(identifiers(result), new Set([visible.id, privateOtherCompany.id]));
        assert.deepStrictEqual(result.facets.tags, [{ tag: 'shared-label', document_count: 2 }]);
        assert.strictEqual(result.total_count, 2);
        noDisclosure(result, [privateSameCompany.id, 'private-a-label', 'PrivateAOnlyCanary']);
        store.setDocumentPermission({ userId: owners[1], documentId: privateOtherCompany.id, mode: 'custom', memberUserIds: [] });
      });
      for (const method of ['_projectKey', '_decryptRevision', '_decryptProjectName']) {
        await testAsync('revocation during awaited ' + method + ' removes plaintext, labels, counts and cursor positions', async () => {
          const marker = 'awaitneedle' + sequence;
          const control = await create(first, owners[0], tagged('control-label-' + sequence, '# Control\n' + marker + '\n'), 'control-' + sequence + '.md', true);
          const secretTag = 'revoked-label-' + sequence;
          const target = await create(first, owners[0], tagged(secretTag, '# RevokedCanary' + sequence + '\n' + marker + '\n'), 'revoked-canary-' + sequence + '.md', true);
          const original = store[method];
          let revoked = false;
          store[method] = async function (...args) {
            const value = await original.apply(this, args);
            if (!revoked && (method !== '_decryptRevision' || args[0].document_id === target.id)) {
              revoked = true;
              secondConnection.setDocumentPermission({ userId: owners[0], documentId: target.id, mode: 'custom', memberUserIds: [] });
            }
            return value;
          };
          try {
            const result = await search({ query: marker, documentIds: [target.id, control.id], limit: 2 });
            assert.strictEqual(revoked, true);
            assert.deepStrictEqual(identifiers(result), new Set([control.id]));
            assert.strictEqual(result.total_count, 1);
            assert.strictEqual(result.nextPosition, null);
            assert.strictEqual(result.has_more, false);
            noDisclosure(result, [target.id, secretTag, target.title, target.filename]);
            assert.deepStrictEqual(result.facets.tags, [{ tag: control.tags[0], document_count: 1 }]);
          } finally { store[method] = original; }
        });
      }
      for (const [method, action] of [['_decryptRevision', 'revoke'], ['_decryptProjectName', 'revoke'], ['_decryptRevision', 'unstar']]) {
        await testAsync(action + ' of different selected and unsnippeted documents during ' + method + ' cannot survive final aggregation', async () => {
          const marker = 'crossrow' + sequence + ' :: await';
          const sensitiveTag = 'cross-sensitive-' + sequence;
          const safeTag = 'cross-safe-' + sequence;
          const selected = await create(first, owners[0], tagged(sensitiveTag,
            '# AlreadySelectedCanary' + sequence + '\n' + marker + '\n'), 'selected-canary-' + sequence + '.md', true);
          const loading = await create(foreign, owners[1], tagged(safeTag,
            '# Loading safe\n' + marker + '\n'), 'loading-safe-' + sequence + '.md', true);
          const unsnippeted = await create(first, owners[0], tagged(sensitiveTag,
            '# UnsnippetedCanary' + sequence + '\n' + marker + '\n'), 'unsnippeted-canary-' + sequence + '.md', true);
          const continuation = await create(foreign, owners[1], tagged(safeTag,
            '# Continuation safe\n' + marker + '\n'), 'continuation-safe-' + sequence + '.md', true);
          const documents = [selected, loading, unsnippeted, continuation];
          const timestamp = Date.now();
          for (const [index, document] of documents.entries()) {
            store.db.prepare('UPDATE cloud_documents SET updated_at_ms=? WHERE id=?').run(timestamp - index * 1000, document.id);
            if (action === 'unstar') store.setDocumentStar({ userId: reader, documentId: document.id, starred: true });
          }
          const original = store[method];
          const bodyCalls = new Map();
          let changed = false;
          store[method] = async function (...args) {
            const value = await original.apply(this, args);
            if (method === '_decryptRevision') bodyCalls.set(args[0].document_id, (bodyCalls.get(args[0].document_id) || 0) + 1);
            // Multi-run literals decrypt once for matching, then again for the
            // selected page. Revoke A and C during B's page load, after A has
            // entered the result array and before C ever receives a snippet.
            const atLoadingPage = method === '_decryptRevision'
              ? args[0].document_id === loading.id && bodyCalls.get(loading.id) === 2
              : args[0].id === foreign.projectId;
            if (!changed && atLoadingPage) {
              changed = true;
              for (const document of [selected, unsnippeted]) {
                if (action === 'unstar') secondConnection.setDocumentStar({ userId: reader, documentId: document.id, starred: false });
                else secondConnection.setDocumentPermission({ userId: owners[0], documentId: document.id, mode: 'custom', memberUserIds: [] });
              }
            }
            return value;
          };
          try {
            const input = { query: marker, documentIds: documents.map(document => document.id),
              sort: 'updated_desc', limit: 2, starredOnly: action === 'unstar' };
            const result = await search(input);
            assert.strictEqual(changed, true);
            assert.deepStrictEqual(identifiers(result), new Set([loading.id]));
            assert.strictEqual(result.total_count, 2);
            assert.deepStrictEqual(result.facets.tags, [{ tag: safeTag, document_count: 2 }]);
            assert.deepStrictEqual(result.facets.authors, [{ user_id: owners[1], document_count: 2 }]);
            assert.deepStrictEqual(result.facets.libraries, [{ id: foreign.workspaceId, document_count: 2 }]);
            assert.strictEqual(result.has_more, true);
            assert.strictEqual(result.nextPosition.id, loading.id);
            noDisclosure(result, [selected.id, unsnippeted.id, selected.title, unsnippeted.title,
              selected.filename, unsnippeted.filename, sensitiveTag, first.workspaceId, owners[0]]);
            const next = await search({ ...input, after: result.nextPosition });
            assert.deepStrictEqual(identifiers(next), new Set([continuation.id]));
            assert.strictEqual(next.total_count, 2);
            assert.strictEqual(next.nextPosition, null);
          } finally {
            store[method] = original;
            if (action === 'unstar') for (const document of documents) {
              store.setDocumentStar({ userId: reader, documentId: document.id, starred: false });
            }
          }
        });
      }
      await testAsync('workspace revocation during a key await removes the whole company from results and facets', async () => {
        const original = store._projectKey;
        let revoked = false;
        store._projectKey = async function (...args) {
          const value = await original.apply(this, args);
          if (!revoked && args[0] === first.projectId) {
            revoked = true;
            secondConnection.removeWorkspaceMember({ actorUserId: owners[0], workspaceId: first.workspaceId, userId: reader });
          }
          return value;
        };
        try {
          const result = await search({ query: 'needle :: 42%' });
          assert.strictEqual(revoked, true);
          assert.strictEqual(result.total_count, 0);
          assert.deepStrictEqual(result.documents, []);
          for (const facet of allFacets) assert.deepStrictEqual(result.facets[facet], []);
          noDisclosure(result, [visible.id, first.workspaceId, 'shared-label']);
        } finally {
          store._projectKey = original;
          store.addWorkspaceMember({ actorUserId: owners[0], workspaceId: first.workspaceId, userId: reader, role: 'member' });
        }
      });
      await testAsync('indexed literal candidates preserve arbitrary JavaScript lowercase substring semantics', async () => {
        const body = '# Literal corpus\nC++ a.b/path?flag=1 :: #tag 100% [x] {y} $z \\root\n' +
          'cafe\u0301 / café / İx / I\u0307y / Straße / STRASSE / ΟΣ / ΣΟΣ\n' +
          '👩🏽‍💻🇬🇧 😀 🧑‍🚀 中文かな한글 العربية עברית\n' +
          '\u0000binary\tgap\nAcross\nlines\r\nend\n';
        const document = await create(first, owners[0], body, 'unicode-corpus.md', true);
        const queries = new Set(['C++', '++', 'a.b/', '?flag=', ':: #', '100%', '[x]', '{y}', '$z', '\\root',
          'cafe', 'e\u0301', '\u0301', 'café', 'İ', 'i\u0307', '\u0307', 'İx', 'x', 'straße', 'STRASSE', 'ΟΣ', 'Σ',
          '👩🏽‍💻', '🏽', '\u200d', '\ud83d', '\udc69', '🇬', '😀', 'かな', 'الع', 'עבר', '\u0000b', 'gap\nAcross', 'Across\nlines', 'lines\r\nend',
          'not-in-corpus', 'cafe\u0300', 'a/b/path', '👩‍💻', '1⁄4']);
        // Sample UTF-16 substrings, including half-surrogate and combining-mark boundaries.
        let state = 17021;
        for (let i = 0; i < 80; i++) {
          state = (state * 1664525 + 1013904223) >>> 0;
          const start = state % body.length;
          state = (state * 1664525 + 1013904223) >>> 0;
          const value = body.slice(start, start + 1 + state % 11).trim();
          if (value) queries.add(value);
        }
        const failures = [];
        for (const query of queries) {
          const expected = body.toLowerCase().includes(query.trim().toLowerCase());
          const result = await search({ documentIds: [document.id], fields: ['body'], query, matchLimit: 0 });
          if (result.total_count !== (expected ? 1 : 0) ||
              (expected && !identifiers(result).has(document.id))) failures.push({ query, expected, actual: result.total_count });
        }
        assert.deepStrictEqual(failures, []);
      });
      await testAsync('literal candidates preserve tag spaces and synthetic selected-field newline boundaries', async () => {
        const document = await create(first, owners[0], '---\ntitle: "!!"\ntags:\n  - a?\n  - "!b"\n---\n## Body\n', '!!', true);
        for (const [query, fields] of [['? !', ['tags']], ['!\na?', ['filename', 'tags']],
          ['!!\na?', ['filename', 'tags']], ['!!\n!!', ['title', 'filename']],
          ['!b\n##', ['tags', 'body']], ['?\n!', ['tags']]]) {
          const values = { title: document.title, filename: document.filename,
            tags: document.tags.join(' '), body: '---\ntitle: "!!"\ntags:\n  - a?\n  - "!b"\n---\n## Body\n' };
          const expected = fields.map(field => values[field]).join('\n').toLowerCase().includes(query.trim().toLowerCase());
          const result = await search({ documentIds: [document.id], query, fields, matchLimit: 0 });
          assert.strictEqual(result.total_count, expected ? 1 : 0, JSON.stringify({ query, fields }));
        }
      });
      await testAsync('literal evidence maps lowercase expansions back to original Unicode source offsets', async () => {
        const document = await create(first, owners[0], '# Unicode\nİx\n', 'unicode-offsets.md', true);
        const result = await search({ documentIds: [document.id], fields: ['body'], query: 'x', matchLimit: 1 });
        assert.strictEqual(result.total_count, 1);
        assert.strictEqual(result.documents[0].matches.length, 1);
        const match = result.documents[0].matches[0];
        assert.deepStrictEqual(match.terms, ['x']);
        assert.strictEqual(match.snippet.slice(match.offsets[0].start, match.offsets[0].end), 'x');
      });
      await testAsync('all-tag filters deduplicate after tag spelling normalization', async () => {
        const document = await create(first, owners[0], '---\ntags:\n  - alpha\n  - beta\n---\n# Tag normalization\n', 'tag-normalization.md', true);
        for (const tags of [['alpha', 'ALPHA'], ['alpha', '#alpha'], ['alpha', ' alpha '],
          ['alpha', 'ALPHA', '#ALPHA', ' beta ', 'BETA']]) {
          const result = await search({ documentIds: [document.id], tags });
          assert.deepStrictEqual(identifiers(result), new Set([document.id]), JSON.stringify(tags));
        }
        assert.strictEqual((await search({ documentIds: [document.id], tags: ['alpha', 'missing'] })).total_count, 0);
      });
      await testAsync('selective literal queries decrypt candidates and page content while misses and tag inventory decrypt no documents', async () => {
        const documentIds = [];
        for (let index = 0; index < 32; index++) {
          const document = await create(first, owners[0], tagged('inventory-visible', '# Indexed document ' + index + '\n' +
            (index === 7 ? 'Selective::Needle%987' : 'Background corpus ' + index) + '\n'), 'indexed-' + index + '.md', true);
          documentIds.push(document.id);
        }
        const original = store._decryptRevision;
        let decryptions = [];
        store._decryptRevision = async function (row) {
          decryptions.push(row.document_id);
          return original.call(this, row);
        };
        try {
          const found = await search({ documentIds, query: 'Selective::Needle%987', limit: 1 });
          assert.strictEqual(found.total_count, 1);
          assert.ok(decryptions.length <= 2, 'decrypted ' + decryptions.length + ' documents for one candidate');
          assert.ok(decryptions.every(id => id === found.documents[0].id));
          decryptions = [];
          const singleRun = await search({ documentIds, query: 'elective', limit: 1 });
          assert.strictEqual(singleRun.total_count, 1);
          assert.deepStrictEqual(decryptions, [singleRun.documents[0].id]);
          decryptions = [];
          assert.strictEqual((await search({ documentIds, query: 'Absent::Literal%831' })).total_count, 0);
          assert.deepStrictEqual(decryptions, []);
          const tags = await store.listTags({ userId: reader, workspaceId: first.workspaceId, documentIds });
          assert.deepStrictEqual(tags, [{ tag: 'inventory-visible', count: 32 }]);
          assert.deepStrictEqual(decryptions, []);
        } finally { store._decryptRevision = original; }
      });
      await testAsync('persistent stars remain per principal and never expand document access', async () => {
        assert.strictEqual(store.isDocumentStarred(reader, visible.id), false);
        assert.deepStrictEqual(store.setDocumentStar({ userId: reader, documentId: visible.id, starred: true }), { document_id: visible.id, starred: true });
        assert.strictEqual(secondConnection.isDocumentStarred(reader, visible.id), true);
        assert.strictEqual(store.isDocumentStarred(owners[0], visible.id), false);
        store.setDocumentStar({ userId: reader, documentId: visible.id, starred: true });
        assert.strictEqual(store.db.prepare('SELECT count(*) AS n FROM cloud_document_stars WHERE user_id=? AND document_id=?').get(reader, visible.id).n, 1);
        for (const id of [privateSameCompany.id, privateOtherCompany.id, 'unknown-document']) {
          for (const starred of [true, false]) assert.throws(() => store.setDocumentStar({ userId: reader, documentId: id, starred }), error => error.code === 'resource_unavailable');
        }
        const reopen = createCloudStore(configuration());
        try { assert.strictEqual(reopen.isDocumentStarred(reader, visible.id), true); }
        finally { reopen.close(); }
        const mine = await search({ starredOnly: true });
        assert.deepStrictEqual(identifiers(mine), new Set([visible.id]));
        assert.strictEqual(mine.documents[0].starred, true);
        assert.strictEqual((await search({ userId: owners[0], starredOnly: true })).total_count, 0);
        secondConnection.setDocumentPermission({ userId: owners[0], documentId: visible.id, mode: 'custom', memberUserIds: [] });
        const revoked = await search({ starredOnly: true });
        assert.strictEqual(revoked.total_count, 0);
        for (const facet of allFacets) assert.deepStrictEqual(revoked.facets[facet], []);
        noDisclosure(revoked, [visible.id, 'shared-label']);
        assert.throws(() => store.setDocumentStar({ userId: reader, documentId: visible.id, starred: false }), error => error.code === 'resource_unavailable');
      });
      await testAsync('unstarring during a document await keeps starred-only results and facets consistent', async () => {
        const document = await create(first, owners[0], tagged('racing-star-label', '# Star race\n'), 'star-race.md', true);
        store.setDocumentStar({ userId: reader, documentId: document.id, starred: true });
        const original = store._decryptRevision;
        let removed = false;
        store._decryptRevision = async function (row) {
          const content = await original.call(this, row);
          if (!removed && row.document_id === document.id) {
            removed = true;
            secondConnection.setDocumentStar({ userId: reader, documentId: document.id, starred: false });
          }
          return content;
        };
        try {
          const result = await search({ documentIds: [document.id], starredOnly: true });
          assert.strictEqual(removed, true);
          assert.strictEqual(result.total_count, 0);
          assert.deepStrictEqual(result.documents, []);
          for (const facet of allFacets) assert.deepStrictEqual(result.facets[facet], []);
          assert.strictEqual(result.nextPosition, null);
          noDisclosure(result, [document.id, 'racing-star-label']);
        } finally { store._decryptRevision = original; }
      });
    } finally { secondConnection.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }

    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
    const post = (actor, body) => f.api(actor, '/api/cloud/v1/search', 'POST', body);
    const request = extra => ({ mode: 'literal', query: 'cursor::needle', workspace_id: f.team.workspaceId,
      facets: allFacets, limit: 1, ...extra });
    const httpDocs = [];
    try {
      for (let i = 0; i < 3; i++) {
        const document = await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
          markdown: tagged('http-visible', '# HTTP visible ' + i + '\ncursor::needle\n'), filename: 'visible-' + i + '.md', idempotencyKey: 'isolation-http-' + i });
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: document.id, mode: 'everyone' });
        httpDocs.push(document);
      }
      const privateDoc = await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
        markdown: tagged('http-private-secret', '# HTTP private canary\ncursor::needle\n'), filename: 'private-http.md', idempotencyKey: 'isolation-http-private' });
      const foreignDoc = await f.store.createDocument({ userId: f.users.outsider.id, projectId: f.otherTeam.projectId,
        markdown: tagged('foreign-private-secret', '# Foreign private canary\ncursor::needle\n'), filename: 'foreign-private.md', idempotencyKey: 'isolation-http-foreign' });
      await testAsync('simultaneous HTTP searches and tag inventories keep companies and private documents separate', async () => {
        const requests = Array.from({ length: 12 }, (_, i) => {
          const actor = i % 2 ? 'member' : 'outsider';
          const foreign = actor === 'outsider';
          const workspace = foreign ? f.otherTeam.workspaceId : f.team.workspaceId;
          const query = i % 3 === 0 ? { mode: 'query', query: 'needle' } : i % 3 === 1
            ? { mode: 'literal', query: 'needle' } : { mode: 'literal', query: 'cursor::needle' };
          return post(actor, { ...query, workspace_id: workspace, facets: allFacets, limit: 10 }).then(result => {
            assert.strictEqual(result.status, 200, JSON.stringify(result.data));
            assert.strictEqual(result.data.total_count, foreign ? 1 : 3);
            assert.deepStrictEqual(new Set(result.data.documents.map(doc => doc.id)),
              new Set(foreign ? [foreignDoc.id] : httpDocs.map(doc => doc.id)));
            noDisclosure(result.data, foreign ? [...httpDocs.map(doc => doc.id), privateDoc.id, 'http-visible', 'http-private-secret', f.team.workspaceId]
              : [foreignDoc.id, privateDoc.id, 'foreign-private-secret', 'http-private-secret', f.otherTeam.workspaceId]);
          });
        });
        for (const [actor, workspace, tag, count] of [['member', f.team.workspaceId, 'http-visible', 3],
          ['outsider', f.otherTeam.workspaceId, 'foreign-private-secret', 1]]) requests.push(
          f.api(actor, '/api/cloud/v1/account/tags?account_id=' + workspace).then(result => {
            assert.strictEqual(result.status, 200, JSON.stringify(result.data));
            assert.deepStrictEqual(result.data.tags, [{ tag, count }]);
          }));
        await Promise.all(requests);
      });
      await testAsync('literal HTTP cursors bind caller, query, library, fields, facets, filters and sorting', async () => {
        const firstPage = await post('member', request());
        assert.strictEqual(firstPage.status, 200, JSON.stringify(firstPage.data));
        assert.strictEqual(firstPage.data.total_count, 3);
        assert.ok(firstPage.data.next_cursor);
        const cursor = firstPage.data.next_cursor;
        for (const [actor, patch] of [['bob', {}], ['member', { query: 'needle' }], ['member', { fields: ['filename'] }],
          ['member', { facets: ['tags'] }], ['member', { tags: ['http-visible'] }], ['member', { sort: 'created_desc' }],
          ['member', { document_ids: httpDocs.map(document => document.id) }], ['member', { starred_only: true }],
          ['member', { workspace_id: f.otherTeam.workspaceId }]]) {
          const result = await post(actor, request({ cursor, ...patch }));
          assert.ok([400, 404].includes(result.status), JSON.stringify(result.data));
          assert.strictEqual(result.data.documents, undefined);
          assert.strictEqual(result.data.facets, undefined);
        }
        const tampered = cursor.slice(0, -1) + (cursor.endsWith('a') ? 'b' : 'a');
        assert.strictEqual((await post('member', request({ cursor: tampered }))).status, 400);
        const next = await post('member', request({ cursor, limit: 2 }));
        assert.strictEqual(next.status, 200, JSON.stringify(next.data));
        assert.strictEqual(next.data.documents.length, 2);
        noDisclosure(firstPage.data, [privateDoc.id, foreignDoc.id, 'http-private-secret', 'foreign-private-secret', f.otherTeam.workspaceId]);
      });
      await testAsync('revoking a document between literal pages removes its label and ID from results and readable cursor payloads', async () => {
        const firstPage = await post('member', request());
        const toHide = httpDocs.find(document => document.id !== firstPage.data.documents[0].id);
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: toHide.id, mode: 'custom', memberUserIds: [] });
        const next = await post('member', request({ cursor: firstPage.data.next_cursor }));
        assert.strictEqual(next.status, 200, JSON.stringify(next.data));
        assert.strictEqual(next.data.total_count, 2);
        noDisclosure(next.data, [toHide.id, privateDoc.id, foreignDoc.id, 'http-private-secret', 'foreign-private-secret']);
        if (next.data.next_cursor) {
          const payload = Buffer.from(next.data.next_cursor.split('.')[0], 'base64url').toString();
          assert.strictEqual(payload.includes(toHide.id), false);
        }
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: toHide.id, mode: 'everyone' });
      });
      await testAsync('star PUT binds authenticated principal and path document, ignoring forged user and company identities', async () => {
        const star = (actor, document, body) => f.api(actor, '/api/cloud/v1/documents/' + document.id + '/star', 'PUT', body);
        const visible = httpDocs[0];
        assert.strictEqual((await star('bob', visible, { starred: true })).status, 200);
        const member = await star('member', visible, { starred: true, user_id: f.users.bob.id,
          document_id: privateDoc.id, workspace_id: f.otherTeam.workspaceId, account_id: f.otherTeam.workspaceId });
        assert.strictEqual(member.status, 200, JSON.stringify(member.data));
        assert.strictEqual(member.data.document_id, visible.id);
        assert.strictEqual(f.store.isDocumentStarred(f.users.member.id, visible.id), true);
        assert.strictEqual(f.store.isDocumentStarred(f.users.member.id, privateDoc.id), false);
        assert.strictEqual((await star('member', visible, { starred: false, user_id: f.users.bob.id })).status, 200);
        assert.strictEqual(f.store.isDocumentStarred(f.users.bob.id, visible.id), true);
        assert.strictEqual(f.store.isDocumentStarred(f.users.member.id, visible.id), false);
        for (const [actor, document] of [['outsider', visible], ['member', privateDoc], ['bob', foreignDoc]]) {
          for (const starred of [true, false]) {
            const denied = await star(actor, document, { starred, user_id: f.users.bob.id,
              document_id: visible.id, workspace_id: f.team.workspaceId, account_id: f.team.workspaceId });
            assert.strictEqual(denied.status, 404, JSON.stringify(denied.data));
            assert.deepStrictEqual(denied.data, { ok: false, error: 'resource_unavailable' });
          }
        }
        for (const invalid of [null, 1, 'true', [], {}]) {
          assert.strictEqual((await star('bob', visible, { starred: invalid })).status, 400);
        }
        assert.strictEqual(f.store.isDocumentStarred(f.users.bob.id, visible.id), true);
        const crossOrigin = await fetch(f.origin + '/api/cloud/v1/documents/' + visible.id + '/star', {
          method: 'PUT', headers: { Cookie: f.users.bob.cookie, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
          body: JSON.stringify({ starred: false }) });
        assert.strictEqual(crossOrigin.status, 403);
        assert.strictEqual(f.store.isDocumentStarred(f.users.bob.id, visible.id), true);
      });
      await testAsync('starred HTTP results and tag inventory remain permission scoped after revocation', async () => {
        const visible = httpDocs[0];
        const starEndpoint = '/api/cloud/v1/documents/' + visible.id + '/star';
        assert.strictEqual((await f.api('member', starEndpoint, 'PUT', { starred: true })).status, 200);
        const before = await post('member', request({ starred_only: true }));
        assert.deepStrictEqual(new Set(before.data.documents.map(document => document.id)), new Set([visible.id]));
        assert.strictEqual(before.data.documents[0].starred, true);
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: visible.id, mode: 'custom', memberUserIds: [] });
        for (const starred of [true, false]) assert.strictEqual((await f.api('member', starEndpoint, 'PUT', { starred })).status, 404);
        const hidden = await post('member', request({ starred_only: true }));
        assert.strictEqual(hidden.status, 200);
        assert.strictEqual(hidden.data.total_count, 0);
        assert.deepStrictEqual(hidden.data.documents, []);
        for (const facet of allFacets) assert.deepStrictEqual(hidden.data.facets[facet], []);
        noDisclosure(hidden.data, [visible.id, privateDoc.id, foreignDoc.id, 'http-private-secret', 'foreign-private-secret']);
        const tags = await f.api('member', '/api/cloud/v1/account/tags?account_id=' + f.team.workspaceId);
        assert.strictEqual(tags.status, 200, JSON.stringify(tags.data));
        assert.deepStrictEqual(tags.data.tags, [{ tag: 'http-visible', count: 2 }]);
      });
    } finally { await f.close(); }
  };
};

if (require.main === module) {
  const harness = require('./runner');
  module.exports(harness)().then(() => harness.report()).catch(error => { console.error(error); process.exitCode = 1; });
}
