module.exports = function (h) {
  const { assert, testAsync } = h;
  const { parseQuery } = require('../cli/shared/sdocs-search-query');
  return async function () {
    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
    const { api, store, users } = f;
    let published, second, hidden;
    const search = (actor, body) => api(actor, '/api/cloud/v1/search', 'POST', body);
    const rich = (query, extra = {}) => ({ expression: parseQuery(query), workspace_id: f.team.workspaceId, facets: ['tags', 'authors', 'libraries'], ...extra });
    async function save(actor, name, markdown, everyone = false) {
      const result = await api(actor, '/api/cloud/v1/account/documents', 'POST', { account_id: f.team.workspaceId, filename: name + '.md', markdown, idempotency_key: 'rich-search-' + name });
      assert.strictEqual(result.status, 201, JSON.stringify(result.data));
      const document = result.data.document;
      if (everyone) store.setDocumentPermission({ userId: users[actor].id, documentId: document.id, mode: 'everyone' });
      return document;
    }
    try {
      await testAsync('search HTTP returns creator, library, exact counts, snippets and usable scoped pages', async () => {
        published = await save('bob', 'incident-response', '---\ntags:\n  - engineering\n  - operations\n---\n# Incident response\n\nWe chose cobalt recovery for durable queues.\n\nThe rollback was validated.', true);
        second = await save('bob', 'cobalt-rollout', '---\ntags:\n  - engineering\n  - rollout\n---\n# Cobalt rollout\n\nOur cobalt recovery checklist uses durable queues.', true);
        hidden = await save('bob', 'private-cobalt-secret', '---\ntags:\n  - private-sentinel\n---\n# Private cobalt 9137\n\nCobalt recovery never discloses the private sentinel.');
        const response = await search('member', rich('"cobalt recovery"', { limit: 1 }));
        assert.strictEqual(response.status, 200, JSON.stringify(response.data));
        const body = response.data;
        assert.strictEqual(body.total_count, 2); assert.strictEqual(body.documents.length, 1);
        assert.ok(body.next_cursor); assert.strictEqual(body.has_more, true);
        assert.strictEqual(body.documents[0].author.name, 'Bob Example');
        assert.strictEqual(body.documents[0].library.name, "Joe's engineering");
        assert.ok(body.documents[0].url.includes('/docs?cloud-document='));
        assert.ok(body.documents[0].matches.some(match => match.field === 'body' && match.line && match.snippet.includes('cobalt recovery')));
        assert.ok(!JSON.stringify(body).includes('private-sentinel'));
        const page2 = await search('member', rich('"cobalt recovery"', { limit: 1, cursor: body.next_cursor }));
        assert.strictEqual(page2.status, 200, JSON.stringify(page2.data));
        assert.strictEqual(page2.data.has_more, false);
        assert.deepStrictEqual(new Set([body.documents[0].id, page2.data.documents[0].id]), new Set([published.id, second.id]));
      });
      await testAsync('search never discloses unshared words, tags, authors, or another library via facets', async () => {
        const privateQuery = await search('member', rich('9137'));
        assert.strictEqual(privateQuery.status, 200, JSON.stringify(privateQuery.data));
        assert.strictEqual(privateQuery.data.total_count, 0);
        assert.deepStrictEqual(privateQuery.data.documents, []);
        assert.deepStrictEqual(privateQuery.data.facets.tags, []);
        assert.deepStrictEqual(privateQuery.data.facets.authors, []);
        const foreign = await search('outsider', rich('cobalt'));
        assert.strictEqual(foreign.status, 404);
        assert.deepStrictEqual(foreign.data, { ok: false, error: 'resource_unavailable' });
        const narrowed = await search('member', rich('NOT nonexistent', { document_ids: [hidden.id, published.id, 'unknown'] }));
        assert.strictEqual(narrowed.status, 200);
        assert.deepStrictEqual(narrowed.data.documents.map(d => d.id), [published.id]);
        const empty = await search('member', rich('cobalt', { document_ids: [] }));
        assert.strictEqual(empty.data.total_count, 0);
      });
      await testAsync('search cursors cannot be replayed across caller, expression, filter, sort or scope', async () => {
        const first = await search('member', rich('cobalt', { limit: 1 }));
        assert.ok(first.data.next_cursor);
        const cursor = first.data.next_cursor;
        for (const [actor, body] of [['bob', rich('cobalt', { limit: 1, cursor })], ['member', rich('recovery', { limit: 1, cursor })],
          ['member', rich('cobalt', { tags: ['engineering'], limit: 1, cursor })], ['member', rich('cobalt', { sort: 'created_desc', limit: 1, cursor })],
          ['member', rich('cobalt', { limit: 1, cursor: cursor.slice(0, -1) + (cursor.endsWith('a') ? 'b' : 'a') })]]) {
          const result = await search(actor, body); assert.strictEqual(result.status, 400, JSON.stringify(result));
          assert.strictEqual(result.data.error, 'invalid_request');
        }
      });
      await testAsync('membership changes immediately affect old cursors and document group grants', async () => {
        const first = await search('member', rich('cobalt', { limit: 1 }));
        const toHide = first.data.documents[0].id === published.id ? second.id : published.id;
        store.setDocumentPermission({ userId: users.bob.id, documentId: toHide, mode: 'custom', memberUserIds: [users.bob.id] });
        const next = await search('member', rich('cobalt', { limit: 1, cursor: first.data.next_cursor }));
        assert.strictEqual(next.status, 200, JSON.stringify(next.data));
        assert.strictEqual(next.data.total_count, 1);
        assert.ok(!next.data.documents.some(document => document.id === toHide));
        store.setDocumentPermission({ userId: users.bob.id, documentId: hidden.id, mode: 'custom', memberUserIds: [users.bob.id, users.member.id] });
        const added = await search('member', rich('9137'));
        assert.strictEqual(added.data.total_count, 1);
        store.setDocumentPermission({ userId: users.bob.id, documentId: hidden.id, mode: 'custom', memberUserIds: [users.bob.id] });
        assert.strictEqual((await search('member', rich('9137'))).data.total_count, 0);
        store.setDocumentPermission({ userId: users.bob.id, documentId: toHide, mode: 'everyone' });
      });
      await testAsync('metadata-only creator, tag, date and document filters intersect on the server', async () => {
        const response = await search('member', { workspace_id: f.team.workspaceId, tags: ['engineering'], tags_any: ['operations', 'rollout'], tags_none: ['private-sentinel'], author_user_ids: [users.bob.id], fields: ['body'], document_ids: [published.id], updated_before: '2099-12-31' });
        assert.strictEqual(response.status, 200, JSON.stringify(response.data));
        assert.deepStrictEqual(response.data.documents.map(document => document.id), [published.id], JSON.stringify({ response: response.data, published, accessible: store.getDocumentPermission({ userId: users.bob.id, documentId: published.id }) }));
        assert.strictEqual((await search('member', rich('author:me'))).data.total_count, 0);
        assert.strictEqual((await search('bob', rich('author:me AND 9137'))).data.total_count, 1);
      });
      await testAsync('project search accepts document-level grants without granting project or foreign library access', async () => {
        const projectId = store.getDocumentContext({ userId: users.member.id, documentId: published.id }).projectId;
        assert.throws(() => store.getProjectContext({ userId: users.member.id, projectId }), error => error.code === 'resource_unavailable');
        const scoped = await search('member', rich('cobalt', { project_id: projectId }));
        assert.strictEqual(scoped.status, 200, JSON.stringify(scoped.data));
        assert.strictEqual(scoped.data.total_count, 2);
        const conflict = await search('member', { mode: 'query', query: 'cobalt', project_id: projectId, workspace_id: f.otherTeam.workspaceId });
        assert.strictEqual(conflict.status, 404);
        assert.strictEqual((await search('outsider', { project_id: projectId })).status, 404);
      });
      await testAsync('a 100000-document subset crosses the auth JSON default without widening permissions', async () => {
        const ids = Array.from({ length: 99998 }, (_, index) => '00000000-0000-0000-0000-' + String(index).padStart(12, '0'));
        ids.push(published.id, hidden.id);
        const result = await search('member', rich('cobalt', { document_ids: ids }));
        assert.strictEqual(result.status, 200, JSON.stringify(result.data));
        assert.deepStrictEqual(result.data.documents.map(document => document.id), [published.id]);
        assert.ok(!JSON.stringify(result.data).includes('private-sentinel'));
      });
      await testAsync('word forms are explicit and preserve phrase and exclusion semantics', async () => {
        const document = await save('bob', 'payment-retries', '# Operations\n\nPayments use retries to recover.', true);
        assert.strictEqual((await search('member', rich('payment retry'))).data.total_count, 0);
        const expanded = await search('member', { workspace_id: f.team.workspaceId, mode: 'query', query: 'payment retry', word_forms: true });
        assert.strictEqual(expanded.status, 200, JSON.stringify(expanded.data));
        assert.deepStrictEqual(expanded.data.documents.map(value => value.id), [document.id]);
        assert.strictEqual((await search('member', { workspace_id: f.team.workspaceId, mode: 'query', query: '"payment retry"', word_forms: true })).data.total_count, 0);
        assert.strictEqual((await search('member', { workspace_id: f.team.workspaceId, mode: 'query', query: 'NOT payment', document_ids: [document.id], word_forms: true })).data.total_count, 0);
      });
      await testAsync('malformed search expressions return repair guidance without exposing index internals', async () => {
        const response = await search('member', { mode: 'query', query: 'cobalt AND', workspace_id: f.team.workspaceId });
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.data.error, 'invalid_request');
        assert.ok(response.data.message.includes('Search syntax'));
        assert.ok(response.data.details.suggestion.includes('--literal'));
      });
    } finally { await f.close(); }
    await testAsync('all-library search fails visibly instead of silently omitting an unavailable library', async () => {
      const legacy = await require('./cloud-onboarding-fixture').startFixture();
      try {
        legacy.store.addWorkspaceMember({ actorUserId: legacy.users.outsider.id, workspaceId: legacy.otherTeam.workspaceId, userId: legacy.users.member.id, role: 'member' });
        legacy.billing.db.prepare('DELETE FROM cloud_billing_subscriptions WHERE workspace_id=?').run(legacy.otherTeam.workspaceId);
        const all = await legacy.api('member', '/api/cloud/v1/search', 'POST', { mode: 'query', query: 'cobalt' });
        assert.strictEqual(all.status, 402, JSON.stringify(all.data));
        assert.strictEqual(all.data.error, 'subscription_required');
        assert.ok(!all.data.documents);
        const scoped = await legacy.api('member', '/api/cloud/v1/search', 'POST', { workspace_id: legacy.team.workspaceId, mode: 'query', query: 'cobalt' });
        assert.strictEqual(scoped.status, 200, JSON.stringify(scoped.data));
      } finally { await legacy.close(); }
    });
  };
};
