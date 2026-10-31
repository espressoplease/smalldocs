'use strict';
const { startFixture } = require('./cloud-onboarding-fixture');
const { compactDiff } = require('../lib/cloud-edit-response');
const crypto = require('crypto');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const f = await startFixture({ singlePlan: true });
    const initial = '---\ntitle: Service guide\ntags: [operations, service]\n---\n# Service guide\n\n## Production\nRetry window: 10 minutes.\nOwner: Ana.\n\n## Sandbox\nRetry window: 10 minutes.\nOwner: Ana.\n';
    async function create(markdown = initial) {
      const r = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
        account_id: f.team.workspaceId, filename: 'guide.md', markdown, idempotency_key: crypto.randomUUID() });
      assert.strictEqual(r.status, 201, JSON.stringify(r.data));
      return r.data.document;
    }
    const open = (id, actor = 'bob') => f.api(actor, '/api/cloud/v1/documents/' + id);
    const edit = (doc, edits, extra = {}, actor = 'bob', preview = false) => f.api(actor,
      '/api/cloud/v1/documents/' + doc.id + '/edits' + (preview ? '/preview' : ''), 'POST', {
        base_revision_id: doc.current_revision_id, edits, idempotency_key: crypto.randomUUID(), ...extra });
    const replacement = { old_text: 'Retry window: 10 minutes.', new_text: 'Retry window: 25 minutes.', section: 'Production' };
    try {
      await testAsync('partial Cloud reads return selected text, heading outline and full revision hash', async () => {
        const doc = await create();
        const part = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/content?section=Production');
        assert.strictEqual(part.status, 200, JSON.stringify(part.data));
        assert.ok(part.data.document.markdown.includes('## Production'));
        assert.ok(!part.data.document.markdown.includes('## Sandbox'));
        assert.strictEqual(part.data.document.selection.start_line, 7);
        assert.strictEqual(part.data.document.sha256, crypto.createHash('sha256').update(initial).digest('hex'));
        const outline = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/content?outline=true');
        assert.strictEqual(outline.status, 200);
        assert.strictEqual(outline.data.document.markdown, undefined);
        assert.deepStrictEqual(outline.data.document.outline.map(e => e.title), ['Service guide', 'Production', 'Sandbox']);
        const lines = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/content?lines=8%3A9');
        assert.strictEqual(lines.data.document.markdown, 'Retry window: 10 minutes.\nOwner: Ana.\n');
      });
      await testAsync('ambiguous Cloud replacement returns section candidates and creates no revision', async () => {
        const doc = await create();
        const r = await edit(doc, [{ old_text: replacement.old_text, new_text: replacement.new_text }]);
        assert.strictEqual(r.status, 409, JSON.stringify(r.data));
        assert.strictEqual(r.data.error, 'edit_ambiguous');
        assert.strictEqual(r.data.details.match_count, 2);
        assert.strictEqual(r.data.details.candidates.length, 2);
        assert.ok(r.data.details.candidates[0].section.includes('Production'));
        assert.strictEqual((await open(doc.id)).data.document.current_revision_id, doc.current_revision_id);
      });
      await testAsync('section replacement preserves full content metadata and returns a compact verified receipt', async () => {
        const doc = await create();
        const permission = f.store.getDocumentPermission({ userId: f.users.bob.id, documentId: doc.id });
        const r = await edit(doc, [replacement]);
        assert.strictEqual(r.status, 201, JSON.stringify(r.data));
        const receipt = r.data.document;
        const expected = initial.replace(replacement.old_text, replacement.new_text);
        const saved = (await open(doc.id)).data.document;
        assert.strictEqual(saved.markdown, expected);
        assert.deepStrictEqual(saved.tags, doc.tags);
        assert.strictEqual(saved.filename, doc.filename);
        assert.strictEqual(receipt.markdown, undefined);
        assert.strictEqual(receipt.metadata_changed, false);
        assert.strictEqual(receipt.base_revision_id, doc.current_revision_id);
        assert.strictEqual(receipt.saved_sha256, crypto.createHash('sha256').update(expected).digest('hex'));
        assert.strictEqual(receipt.diff.added_lines, 1);
        assert.strictEqual(receipt.matched_count, 1);
        assert.strictEqual(receipt.url, f.origin + '/docs?cloud-document=' + doc.id);
        assert.deepStrictEqual(f.store.getDocumentPermission({ userId: f.users.bob.id, documentId: doc.id }), permission);
        const old = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/content?section=Production&revision_id=' + doc.current_revision_id);
        assert.ok(old.data.document.markdown.includes(replacement.old_text));
      });
      await testAsync('batch matching is atomic and all selectors refer to the original base', async () => {
        const doc = await create();
        const bad = await edit(doc, [replacement, { old_text: 'Missing text', new_text: 'Oops' }]);
        assert.strictEqual(bad.data.error, 'edit_no_match');
        assert.strictEqual((await open(doc.id)).data.document.markdown, initial);
        const r = await edit(doc, [replacement, { old_text: 'Owner: Ana.', new_text: 'Owner: Ben.', section: 'Sandbox' }]);
        assert.strictEqual(r.status, 201, JSON.stringify(r.data));
        assert.strictEqual(r.data.document.applied_edit_count, 2);
        assert.strictEqual((await open(doc.id)).data.document.markdown,
          initial.replace(replacement.old_text, replacement.new_text).replace('## Sandbox\nRetry window: 10 minutes.\nOwner: Ana.', '## Sandbox\nRetry window: 10 minutes.\nOwner: Ben.'));
      });
      await testAsync('Cloud edit previews do not save and match the subsequent saved diff', async () => {
        const doc = await create();
        const r = await edit(doc, [replacement], {}, 'bob', true);
        assert.strictEqual(r.status, 200, JSON.stringify(r.data));
        assert.strictEqual(r.data.document.preview, true);
        assert.strictEqual(r.data.document.markdown, undefined);
        assert.strictEqual((await open(doc.id)).data.document.current_revision_id, doc.current_revision_id);
        const saved = await edit(doc, [replacement]);
        assert.deepStrictEqual(saved.data.document.diff, r.data.document.diff);
      });
      await testAsync('stale targeted edits merge independent changes and preserve both overlapping passages', async () => {
        const doc = await create();
        await edit(doc, [{ old_text: 'Owner: Ana.', new_text: 'Owner: Ben.', section: 'Sandbox' }]);
        const merged = await edit(doc, [replacement]);
        assert.strictEqual(merged.status, 201, JSON.stringify(merged.data));
        let saved = (await open(doc.id)).data.document;
        assert.ok(saved.markdown.includes('Owner: Ben.'));
        assert.ok(saved.markdown.includes('Retry window: 25 minutes.'));
        assert.ok(saved.markdown.startsWith(initial.slice(0, initial.indexOf('# Service guide'))));
        const overlap = await edit(doc, [{ ...replacement, new_text: 'Retry window: 40 minutes.' }]);
        assert.strictEqual(overlap.status, 201, JSON.stringify(overlap.data));
        assert.strictEqual(overlap.data.document.overlapping_edits_preserved, true);
        assert.ok(overlap.data.document.overlaps[0].current.includes('25 minutes'));
        assert.ok(overlap.data.document.overlaps[0].proposed.includes('40 minutes'));
        saved = (await open(doc.id)).data.document;
        assert.ok(saved.markdown.includes('Retry window: 25 minutes.'));
        assert.ok(saved.markdown.includes('Retry window: 40 minutes.'));
        assert.ok(saved.markdown.includes('Owner: Ben.'));
        const refused = await edit(doc, [{ ...replacement, new_text: 'Retry window: 50 minutes.' }], { reject_conflicts: true });
        assert.strictEqual(refused.data.error, 'revision_conflict');
        assert.strictEqual((await open(doc.id)).data.document.current_revision_id, saved.current_revision_id);
      });
      await testAsync('idempotent edit retries return the original revision before rematching an old base', async () => {
        const doc = await create();
        const key = crypto.randomUUID();
        const [a, b] = await Promise.all([edit(doc, [replacement], { idempotency_key: key }), edit(doc, [replacement], { idempotency_key: key })]);
        assert.strictEqual(a.status, 201, JSON.stringify(a.data));
        assert.deepStrictEqual(a.data.document, b.data.document);
        assert.strictEqual(a.data.document.revision_number, 2);
        const mismatch = await edit(doc, [{ ...replacement, new_text: 'Other' }], { idempotency_key: key });
        assert.strictEqual(mismatch.data.error, 'idempotency_mismatch');
        const noop = await edit(a.data.document, [{ old_text: 'Owner: Ana.', new_text: 'Owner: Ana.', section: 'Production' }]);
        assert.strictEqual(noop.data.document.revision_created, false);
      });
      await testAsync('missing edit bases return current revision context without silently changing the base', async () => {
        const doc = await create();
        const result = await edit(doc, [replacement], { base_revision_id: crypto.randomUUID() });
        assert.strictEqual(result.status, 409);
        assert.strictEqual(result.data.error, 'target_too_old');
        assert.strictEqual(result.data.current_revision_id, doc.current_revision_id);
        assert.strictEqual((await open(doc.id)).data.document.current_revision_id, doc.current_revision_id);
      });
      await testAsync('edits share the existing full-document revision path and readable history', async () => {
        const doc = await create();
        const full = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/revisions', 'POST', {
          target_revision_id: doc.current_revision_id, markdown: initial + '\nWhole-file addition.\n', idempotency_key: crypto.randomUUID() });
        assert.strictEqual(full.status, 201);
        const r = await edit(full.data.document, [replacement]);
        assert.strictEqual(r.status, 201);
        assert.ok((await open(doc.id)).data.document.markdown.endsWith('Whole-file addition.\n'));
        const history = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/revisions');
        assert.strictEqual(history.data.revisions.length, 3);
      });
      await testAsync('targeted reads, edit diagnostics and history do not cross private or company boundaries', async () => {
        const doc = await create();
        for (const actor of ['member', 'outsider']) {
          const read = await f.api(actor, '/api/cloud/v1/documents/' + doc.id + '/content?section=Production');
          assert.strictEqual(read.status, 404);
          const r = await edit(doc, [replacement], {}, actor);
          assert.strictEqual(r.status, 404);
          assert.strictEqual(r.data.details, undefined);
        }
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [f.users.member.id] });
        assert.strictEqual((await edit(doc, [replacement], {}, 'member')).status, 201);
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [] });
        assert.strictEqual((await edit(doc, [replacement], {}, 'member')).status, 404);
      });
      await testAsync('permission revoked while decrypting prevents candidate diagnostics and saving', async () => {
        const doc = await create();
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [f.users.member.id] });
        const original = f.store._decryptRevision;
        f.store._decryptRevision = async function (...args) {
          const content = await original.apply(this, args);
          this.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [] });
          return content;
        };
        try {
          await assert.rejects(f.store.saveTargetRevision({ userId: f.users.member.id, documentId: doc.id,
            targetRevisionId: doc.current_revision_id, editRequest: { edits: [{ old_text: 'Owner: Ana.', new_text: 'Ben' }] }, idempotencyKey: crypto.randomUUID() }),
          e => e.code === 'resource_unavailable' && !e.details);
        } finally { f.store._decryptRevision = original; }
        assert.strictEqual((await open(doc.id)).data.document.current_revision_id, doc.current_revision_id);
      });
      await testAsync('large edit verification diffs advertise truncation and retain totals', async () => {
        const diff = compactDiff({ changed: true, added_lines: 1, removed_lines: 1,
          hunks: [{ before_line: 1, after_line: 1, before: ['a'.repeat(50000)], after: ['b'.repeat(50000)] }] });
        assert.strictEqual(diff.truncated, true);
        assert.strictEqual(diff.total_hunks, 1);
        assert.ok(JSON.stringify(diff).length < 7000);
      });
      await testAsync('parallel targeted writers preserve every independent edit without extra duplicate revisions', async () => {
        const body = '# Parallel\n\n' + Array.from({ length: 12 }, (_, i) => 'Field ' + i + ': before.').join('\n') + '\n';
        const doc = await create(body);
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => edit(doc, [
          { old_text: 'Field ' + i + ': before.', new_text: 'Field ' + i + ': after.' },
        ])));
        assert.ok(results.every(r => r.status === 201), JSON.stringify(results.filter(r => r.status !== 201).map(r => r.data)));
        const saved = (await open(doc.id)).data.document;
        assert.strictEqual(saved.markdown, body.replace(/: before\./g, ': after.'));
        assert.strictEqual(saved.revision_number, 13);
      });
      await testAsync('replacement expansion enforces the existing document limit in preview and save without a revision', async () => {
        const doc = await create('# Capacity\n\n' + 'a'.repeat(1024));
        const edits = [{ old_text: 'a', new_text: 'b'.repeat(20000), all: true }];
        for (const preview of [true, false]) {
          const result = await edit(doc, edits, {}, 'bob', preview);
          assert.strictEqual(result.status, 413, JSON.stringify(result.data));
          assert.strictEqual(result.data.error, 'file_too_large');
        }
        assert.strictEqual((await open(doc.id)).data.document.current_revision_id, doc.current_revision_id);
      });
    } finally { await f.close(); }
  };
};
