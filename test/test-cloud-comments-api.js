'use strict';
const crypto = require('crypto');
const { startFixture } = require('./cloud-onboarding-fixture');
const yaml = require('../cli/shared/sdocs-yaml');
const comments = require('../lib/cloud-comments');
const threads = require('../cli/shared/sdocs-comment-data');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const f = await startFixture({ singlePlan: true });
    const body = '# Guide\n\n## Production\n\nProduction retry window: 10 minutes.\n\n## Sandbox\n\nSandbox retry window: 10 minutes.\n';
    const notes = [
      { id: 'c1', kind: 'inline', quote: '10 minutes', prefix: 'Production retry window: ', suffix: '.', block: 'p:0', block_text: 'Production retry window: 10 minutes.', author: 'Ana', text: 'Use 45 minutes.', at: '2026-10-27T09:00:00Z' },
      { id: 'c2', kind: 'inline', quote: '10 minutes', prefix: 'Sandbox retry window: ', suffix: '.', block: 'p:1', block_text: 'Sandbox retry window: 10 minutes.', author: 'Ben', text: 'Keep the sandbox unchanged.' },
      { id: 'c3', kind: 'block', block: 'p:0', block_text: 'Production retry window: 10 minutes.', author: 'Ana', text: 'Reviewed.', resolved: true },
    ];
    const initial = yaml.serializeFrontMatter({ title: 'Guide', tags: ['ops', 'retry'], comments: notes }) + '\n' + body;
    async function create(markdown = initial) {
      const r = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
        account_id: f.team.workspaceId, filename: 'guide.md', markdown, idempotency_key: crypto.randomUUID() });
      assert.strictEqual(r.status, 201, JSON.stringify(r.data));
      return r.data.document;
    }
    const list = (doc, query = '', actor = 'bob') => f.api(actor, '/api/cloud/v1/documents/' + doc.id + '/comments' + query);
    const open = doc => f.api('bob', '/api/cloud/v1/documents/' + doc.id);
    const action = (doc, operation, extra = {}, actor = 'bob', preview = false) => f.api(actor,
      '/api/cloud/v1/documents/' + doc.id + '/comments/actions' + (preview ? '/preview' : ''), 'POST', {
        base_revision_id: doc.current_revision_id, idempotency_key: crypto.randomUUID(), ...operation, ...extra });
    const save = (doc, markdown) => f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/revisions', 'POST', {
      target_revision_id: doc.current_revision_id, markdown, idempotency_key: crypto.randomUUID() });
    try {
      await testAsync('Cloud feedback lists structured open notes with precise source snippets and document links', async () => {
        const doc = await create();
        const r = await list(doc);
        assert.strictEqual(r.status, 200, JSON.stringify(r.data));
        assert.deepStrictEqual(r.data.counts, { total: 3, open: 2, resolved: 1 });
        assert.deepStrictEqual(r.data.comments.map(c => c.id), ['c1', 'c2']);
        assert.strictEqual(r.data.document.markdown, undefined);
        assert.ok(r.data.comments[0].context.markdown.includes('Production retry'));
        assert.strictEqual(r.data.comments[0].anchor.source_status, 'matched');
        assert.strictEqual(r.data.comments[0].url, f.origin + '/docs?cloud-document=' + doc.id + '&comment=c1');
        assert.strictEqual(r.data.comments[0].author.display_name, 'Ana');
        assert.strictEqual(r.data.comments[0].author.user_id, undefined);
        assert.ok(JSON.stringify(r.data).length < 6000);
      });
      await testAsync('feedback pages pin a revision and retain status and context filters', async () => {
        const doc = await create();
        const a = await list(doc, '?status=all&context=none&limit=1');
        assert.strictEqual(a.data.has_more, true);
        assert.ok(!a.data.comments[0].context);
        await action(doc, { action: 'resolve', comment_id: 'c2' });
        const b = await list(doc, '?status=all&context=none&limit=1&cursor=' + encodeURIComponent(a.data.next_cursor));
        assert.strictEqual(b.status, 200, JSON.stringify(b.data));
        assert.strictEqual(b.data.comments[0].id, 'c2');
        assert.strictEqual(b.data.comments[0].status, 'open');
        assert.strictEqual(b.data.document.revision_id, doc.current_revision_id);
        assert.notStrictEqual(b.data.document.current_revision_id, doc.current_revision_id);
        const wrong = await list(doc, '?status=open&context=none&limit=1&cursor=' + encodeURIComponent(a.data.next_cursor));
        assert.strictEqual(wrong.status, 400);
      });
      await testAsync('feedback author filters use explicit metadata and stay bound to the paginated scope', async () => {
        const doc = await create();
        const a = await list(doc, '?author=ana&status=all&limit=1');
        assert.strictEqual(a.data.filtered_count, 2);
        assert.strictEqual(a.data.comments[0].id, 'c1');
        const b = await list(doc, '?author=ana&status=all&limit=1&cursor=' + encodeURIComponent(a.data.next_cursor));
        assert.strictEqual(b.data.comments[0].id, 'c3');
        const changed = await list(doc, '?author=Ben&status=all&limit=1&cursor=' + encodeURIComponent(a.data.next_cursor));
        assert.strictEqual(changed.status, 400);
        const added = await action(doc, { action: 'add', text: 'Mine.', anchor: { kind: 'inline', quote: '10 minutes', section: 'Sandbox' } });
        assert.strictEqual(added.status, 201, JSON.stringify(added.data));
        const own = await list(doc, '?author=me');
        assert.deepStrictEqual(own.data.comments.map(c => c.id), ['c4']);
        const byId = await list(doc, '?author=' + f.users.bob.id);
        assert.deepStrictEqual(byId.data.comments.map(c => c.id), ['c4']);
      });
      await testAsync('reply and resolution keep body and unrelated metadata unchanged and survive YAML normalization', async () => {
        const doc = await create();
        const r = await action(doc, { action: 'reply', comment_id: 'c1', text: 'I will check this.' });
        assert.strictEqual(r.status, 201, JSON.stringify(r.data));
        assert.strictEqual(r.data.comment.replies[0].text, 'I will check this.');
        assert.strictEqual(r.data.comment.replies[0].author.user_id, f.users.bob.id);
        const resolved = await action(r.data.document, { action: 'resolve', comment_id: 'c1', text: 'Updated after review.' });
        assert.strictEqual(resolved.status, 201, JSON.stringify(resolved.data));
        assert.strictEqual(resolved.data.comment.status, 'resolved');
        assert.strictEqual(resolved.data.comment.replies.length, 2);
        const saved = (await open(doc)).data.document;
        const state = comments.snapshot(saved.markdown);
        assert.strictEqual(state.body, comments.snapshot(initial).body);
        assert.deepStrictEqual(state.meta.tags, ['ops', 'retry']);
        assert.strictEqual(state.meta.title, 'Guide');
        assert.strictEqual(state.comments[1].text, notes[1].text);
        const normalized = require('../public/sdocs-comments').normalizeComment(state.comments[0]);
        assert.strictEqual(threads.replies(normalized.replies).length, 2);
        const reopened = await action(resolved.data.document, { action: 'reopen', comment_id: 'c1' });
        assert.strictEqual(reopened.data.comment.status, 'open');
        assert.strictEqual(reopened.data.comment.replies.length, 2);
      });
      await testAsync('feedback preview is read only and repeated no-op resolution creates no revision', async () => {
        const doc = await create();
        const p = await action(doc, { action: 'resolve', comment_id: 'c1' }, {}, 'bob', true);
        assert.strictEqual(p.status, 200, JSON.stringify(p.data));
        assert.strictEqual(p.data.preview, true);
        assert.strictEqual(p.data.revision_created, false);
        assert.strictEqual(p.data.would_change, true);
        assert.strictEqual(p.data.comment.status, 'resolved');
        assert.strictEqual((await open(doc)).data.document.current_revision_id, doc.current_revision_id);
        const no = await action(doc, { action: 'resolve', comment_id: 'c3' });
        assert.strictEqual(no.status, 201, JSON.stringify(no.data));
        assert.strictEqual(no.data.revision_created, false);
        assert.strictEqual((await open(doc)).data.document.markdown, initial);
      });
      await testAsync('deletion keeps unrelated concurrent changes but stops for new feedback on the selected thread', async () => {
        const doc = await create();
        await save(doc, initial + '\nAn independent update.\n');
        const reply = await action(doc, { action: 'reply', comment_id: 'c1', text: 'New details to read.' });
        assert.strictEqual(reply.status, 201, JSON.stringify(reply.data));
        const stale = await action(doc, { action: 'delete', comment_id: 'c1' });
        assert.strictEqual(stale.status, 409, JSON.stringify(stale.data));
        assert.strictEqual(stale.data.error, 'comment_changed');
        assert.strictEqual(stale.data.current_comment.replies_count, 1);
        const unrelated = await action(doc, { action: 'delete', comment_id: 'c2' });
        assert.strictEqual(unrelated.status, 201, JSON.stringify(unrelated.data));
        assert.strictEqual(unrelated.data.comment_id, 'c2');
        assert.strictEqual(unrelated.data.comment, null);
        const state = comments.snapshot((await open(doc)).data.document.markdown);
        assert.ok(state.body.endsWith('An independent update.\n'));
        assert.deepStrictEqual(state.comments.map(c => c.id), ['c1', 'c3']);
        assert.strictEqual(threads.replies(state.comments[0].replies)[0].text, 'New details to read.');
      });
      await testAsync('deletion receipts replay after response loss even when the selected thread no longer exists', async () => {
        const doc = await create();
        const key = crypto.randomUUID();
        const operation = { action: 'delete', comment_id: 'c1' };
        const first = await action(doc, operation, { idempotency_key: key });
        assert.strictEqual(first.status, 201, JSON.stringify(first.data));
        assert.strictEqual(first.data.comment_id, 'c1');
        assert.strictEqual(first.data.comment, null);
        const before = (await open(doc)).data.document;
        await save(before, before.markdown + '\nA later independent update.\n');
        const retry = await action(doc, operation, { idempotency_key: key });
        assert.strictEqual(retry.status, 201, JSON.stringify(retry.data));
        assert.deepStrictEqual(retry.data, first.data);
        const after = (await open(doc)).data.document;
        assert.strictEqual(after.revision_number, before.revision_number + 1);
        assert.ok(after.markdown.endsWith('A later independent update.\n'));
        const old = await list(doc, '?revision_id=' + doc.current_revision_id + '&comment_id=c1');
        assert.strictEqual(old.status, 200, JSON.stringify(old.data));
        assert.strictEqual(old.data.comments[0].text, 'Use 45 minutes.');
      });
      await testAsync('deleting portable feedback strips its marker while preserving quoted prose and custom metadata', async () => {
        const markdown = '---\ntitle: Imported\ncustom: keep this exact value\n---\n# Import\n\nA [target][^c1].\n\n[^c1]: Ana (target): Check it.\n';
        const doc = await create(markdown);
        const deleted = await action(doc, { action: 'delete', comment_id: 'c1' });
        assert.strictEqual(deleted.status, 201, JSON.stringify(deleted.data));
        const saved = (await open(doc)).data.document.markdown;
        assert.ok(saved.includes('custom: keep this exact value'));
        assert.ok(!saved.includes('[^c1]'));
        assert.ok(saved.includes('A target.'));
        assert.deepStrictEqual(comments.snapshot(saved).comments, []);
      });
      await testAsync('new Cloud comment uses rendered quote targeting and rejects ambiguous passages without saving', async () => {
        const doc = await create();
        const bad = await action(doc, { action: 'add', text: 'Check this.', anchor: { kind: 'inline', quote: '10 minutes' } });
        assert.strictEqual(bad.status, 409, JSON.stringify(bad.data));
        assert.strictEqual(bad.data.error, 'edit_ambiguous');
        assert.strictEqual(bad.data.details.match_count, 2);
        assert.strictEqual((await open(doc)).data.document.current_revision_id, doc.current_revision_id);
        const added = await action(doc, { action: 'add', text: 'Check this.', anchor: { kind: 'inline', quote: '10 minutes', section: 'Production' } });
        assert.strictEqual(added.status, 201, JSON.stringify(added.data));
        assert.strictEqual(added.data.comment.id, 'c4');
        assert.strictEqual(added.data.comment.author.user_id, f.users.bob.id);
        assert.strictEqual(added.data.comment.anchor.block, 'p:0');
        assert.ok(added.data.comment.context.markdown.includes('Production retry'));
      });
      await testAsync('adding against an old line selection follows its proven passage after source lines shift', async () => {
        const doc = await create();
        const line = initial.split('\n').findIndex(text => text === 'Production retry window: 10 minutes.') + 1;
        const changed = initial.replace('# Guide', '# Guide\n\nAn inserted paragraph.');
        await save(doc, changed);
        const added = await action(doc, { action: 'add', text: 'Old read, same passage.', anchor: { kind: 'inline', quote: '10 minutes', lines: line + ':' + line } });
        assert.strictEqual(added.status, 201, JSON.stringify(added.data));
        assert.ok(added.data.comment.context.markdown.includes('Production retry'));
        assert.ok(!added.data.comment.anchor.lines);
        const oldRemoved = (await open(doc)).data.document;
        await save(oldRemoved, oldRemoved.markdown.replace('\nProduction retry window: 10 minutes.', '\nProduction was removed.'));
        const unavailable = await action(doc, { action: 'add', text: 'Do not jump to Sandbox.', anchor: { kind: 'inline', quote: '10 minutes', lines: line + ':' + line } });
        assert.strictEqual(unavailable.status, 409, JSON.stringify(unavailable.data));
        assert.strictEqual(unavailable.data.error, 'edit_no_match');
      });
      await testAsync('old add and reattach selections cannot jump to a surviving identical paragraph after deletion', async () => {
        const source = 'Same target.\n\nSame target.\n';
        const doc = await create(source);
        const added = await action(doc, { action: 'add', text: 'First paragraph.', anchor: { kind: 'inline', quote: 'target', lines: '1:1' } });
        assert.strictEqual(added.status, 201, JSON.stringify(added.data));
        const previous = (await open(doc)).data.document;
        const state = comments.snapshot(previous.markdown);
        const shortened = comments.write({ ...state, body: 'Same target.\n' }, state.comments);
        await save(previous, shortened);
        for (const operation of [
          { action: 'add', text: 'Do not select the second paragraph.', anchor: { kind: 'inline', quote: 'target', lines: '1:1' } },
          { action: 'reattach', comment_id: 'c1', anchor: { kind: 'inline', quote: 'target', lines: (previous.markdown.split('\n').findIndex(line => line === 'Same target.') + 1) + ':' + (previous.markdown.split('\n').findIndex(line => line === 'Same target.') + 1) } },
        ]) {
          const result = await action(operation.action === 'add' ? doc : previous, operation);
          assert.strictEqual(result.status, 409, JSON.stringify(result.data));
          assert.ok(['edit_no_match', 'edit_ambiguous'].includes(result.data.error));
        }
      });
      await testAsync('feedback actions allow independent body and comment changes but reject changed target feedback', async () => {
        const doc = await create();
        await save(doc, initial + '\nOperator note.\n');
        await action(doc, { action: 'resolve', comment_id: 'c2' });
        const reply = await action(doc, { action: 'reply', comment_id: 'c1', text: 'Investigating.' });
        assert.strictEqual(reply.status, 201, JSON.stringify(reply.data));
        let state = comments.snapshot((await open(doc)).data.document.markdown);
        assert.ok(state.body.endsWith('Operator note.\n'));
        assert.strictEqual(comments.canonical(state.comments[1]).resolved, true);
        const guard = await action(doc, { action: 'resolve', comment_id: 'c1' });
        assert.strictEqual(guard.status, 409, JSON.stringify(guard.data));
        assert.strictEqual(guard.data.error, 'comment_changed');
        assert.strictEqual(guard.data.current_comment.replies_count, 1);
        const hash = await action(reply.data.document, { action: 'resolve', comment_id: 'c1', expected_comment_sha256: '0'.repeat(64) });
        assert.strictEqual(hash.data.error, 'comment_changed');
        const current = (await open(doc)).data.document;
        state = comments.snapshot(current.markdown);
        state.comments[0].text = 'Use 90 minutes instead.';
        await save(current, comments.write(state, state.comments));
        const changed = await action(reply.data.document, { action: 'reply', comment_id: 'c1', text: 'Old plan.' });
        assert.strictEqual(changed.data.error, 'comment_changed');
      });
      await testAsync('simultaneous replies preserve one thread and every distinct reply', async () => {
        const doc = await create();
        const results = await Promise.all(Array.from({ length: 6 }, (_, i) => action(doc, { action: 'reply', comment_id: 'c1', text: 'Reply ' + i })));
        assert.ok(results.every(r => r.status === 201), JSON.stringify(results.map(r => r.data)));
        const state = comments.snapshot((await open(doc)).data.document.markdown);
        assert.strictEqual(state.comments.length, 3);
        assert.strictEqual(threads.replies(state.comments[0].replies).length, 6);
        assert.strictEqual(new Set(threads.replies(state.comments[0].replies).map(r => r.id)).size, 6);
      });
      await testAsync('a head that moves during decryption retries and keeps both concurrent replies', async () => {
        const doc = await create();
        const original = f.store._decryptRevision;
        const input = text => ({ userId: f.users.bob.id, documentId: doc.id, baseRevisionId: doc.current_revision_id,
          operation: { action: 'reply', comment_id: 'c1', text }, actor: { display_name: 'Bob', user_id: f.users.bob.id }, idempotencyKey: crypto.randomUUID() });
        let decryptions = 0;
        f.store._decryptRevision = async function (...args) {
          const value = await original.apply(this, args);
          if (++decryptions === 2) await this.actOnComment(input('A concurrent reply.'));
          return value;
        };
        try { await f.store.actOnComment(input('The original reply.')); }
        finally { f.store._decryptRevision = original; }
        const state = comments.snapshot((await open(doc)).data.document.markdown);
        assert.strictEqual(state.comments.length, 3);
        assert.deepStrictEqual(threads.replies(state.comments[0].replies).map(reply => reply.text), ['A concurrent reply.', 'The original reply.']);
      });
      await testAsync('lost-response retries return the same comment revision and reject reused keys with different actions', async () => {
        const doc = await create();
        const key = crypto.randomUUID();
        const first = await action(doc, { action: 'reply', comment_id: 'c1', text: 'Once.' }, { idempotency_key: key });
        await save(first.data.document, (await open(doc)).data.document.markdown + '\nLater change.\n');
        const retry = await action(doc, { action: 'reply', comment_id: 'c1', text: 'Once.' }, { idempotency_key: key });
        assert.deepStrictEqual(retry.data, first.data);
        const mismatch = await action(doc, { action: 'resolve', comment_id: 'c1' }, { idempotency_key: key });
        assert.strictEqual(mismatch.data.error, 'idempotency_mismatch');
        const state = comments.snapshot((await open(doc)).data.document.markdown);
        assert.strictEqual(threads.replies(state.comments[0].replies).length, 1);
      });
      await testAsync('comment and targeted-edit receipts remain replayable after moving a document to another library', async () => {
        const doc = await create();
        const replyInput = { userId: f.users.bob.id, documentId: doc.id, baseRevisionId: doc.current_revision_id,
          operation: { action: 'reply', comment_id: 'c1', text: 'Once across libraries.' }, actor: { display_name: 'Bob', user_id: f.users.bob.id }, idempotencyKey: crypto.randomUUID() };
        const reply = await f.store.actOnComment(replyInput);
        const editInput = { userId: f.users.bob.id, documentId: doc.id, targetRevisionId: reply.current_revision_id,
          editRequest: { edits: [{ old_text: '10 minutes', new_text: '45 minutes', section: 'Production' }] }, idempotencyKey: crypto.randomUUID() };
        const edited = await f.store.saveTargetRevision(editInput);
        const destination = await f.store.ensurePersonalWorkspace(f.users.bob.id, 'Receipt destination');
        await f.store.moveDocument({ userId: f.users.bob.id, documentId: doc.id, projectId: destination.projectId, expectedHeadRevisionId: edited.current_revision_id });
        const before = (await open(doc)).data.document.current_revision_id;
        const replayed = await f.store.actOnComment(replyInput);
        assert.strictEqual(replayed.current_revision_id, reply.current_revision_id);
        assert.strictEqual(replayed.markdown, reply.markdown);
        const replayedEdit = await f.store.saveTargetRevision(editInput);
        assert.strictEqual(replayedEdit.current_revision_id, edited.current_revision_id);
        assert.strictEqual((await open(doc)).data.document.current_revision_id, before);
      });
      await testAsync('private or other-company feedback stays unavailable including pagination and diagnostics', async () => {
        const doc = await create();
        const page = await list(doc, '?status=all&limit=1');
        for (const actor of ['member', 'outsider']) {
          for (const query of ['', '?comment_id=c1', '?status=all&limit=1&cursor=' + encodeURIComponent(page.data.next_cursor)]) {
            const r = await list(doc, query, actor);
            assert.ok([400, 404].includes(r.status));
            assert.strictEqual(r.data.comments, undefined);
            assert.strictEqual(r.data.document, undefined);
          }
          for (const kind of ['resolve', 'delete']) {
            const r = await action(doc, { action: kind, comment_id: 'c1' }, {}, actor);
            assert.strictEqual(r.status, 404);
            assert.strictEqual(r.data.current_comment, undefined);
          }
        }
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [f.users.member.id] });
        assert.strictEqual((await list(doc, '', 'member')).status, 200);
        assert.strictEqual((await action(doc, { action: 'reply', comment_id: 'c1', text: 'Member reply.' }, {}, 'member')).status, 201);
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [] });
        assert.strictEqual((await list(doc, '', 'member')).status, 404);
      });
      await testAsync('revoking access during comment decryption or encryption prevents saving or feedback leakage', async () => {
        for (const [hook, kind] of ['_decryptRevision', '_prepareRevision'].flatMap(hook => ['resolve', 'delete'].map(kind => [hook, kind]))) {
          const doc = await create();
          f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [f.users.member.id] });
          const original = f.store[hook];
          let revoked = false;
          f.store[hook] = async function (...args) {
            const value = await original.apply(this, args);
            if (!revoked) { revoked = true; this.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [] }); }
            return value;
          };
          try {
            await assert.rejects(f.store.actOnComment({ userId: f.users.member.id, documentId: doc.id, baseRevisionId: doc.current_revision_id,
              operation: { action: kind, comment_id: 'c1' }, actor: { display_name: 'Member', user_id: f.users.member.id }, idempotencyKey: crypto.randomUUID() }),
            e => e.code === 'resource_unavailable' && !e.currentComment);
          } finally { f.store[hook] = original; }
          assert.strictEqual((await open(doc)).data.document.current_revision_id, doc.current_revision_id);
        }
      });
      await testAsync('portable footnote feedback migrates to canonical threads without losing the prose', async () => {
        const markdown = '---\ntitle: Imported\ncustom: keep this exact value\n---\n# Import\n\nA target[^c1].\n\n[^c1]: Ana (target): Check it.\n';
        const doc = await create(markdown);
        const listed = await list(doc);
        assert.strictEqual(listed.data.comments[0].id, 'c1');
        assert.strictEqual(listed.data.comments[0].anchor.source_status, 'matched');
        assert.ok(listed.data.comments[0].context.markdown.includes('A target[^c1].'));
        const reply = await action(doc, { action: 'reply', comment_id: 'c1', text: 'Received.' });
        assert.strictEqual(reply.status, 201, JSON.stringify(reply.data));
        const saved = (await open(doc)).data.document.markdown;
        assert.ok(saved.includes('custom: keep this exact value'));
        assert.ok(!saved.includes('[^c1]'));
        const state = comments.snapshot(saved);
        assert.strictEqual(state.comments.length, 1);
        assert.strictEqual(threads.replies(state.comments[0].replies)[0].text, 'Received.');
      });
      await testAsync('official portable inline exports return structured source context at original CRLF coordinates', async () => {
        const prose = require('../public/sdocs-comments');
        const markdown = prose.serializeFootnotes({ comments: [{ id: 'c1', kind: 'inline', quote: 'target', prefix: 'A ', suffix: '.', author: 'Ana', text: 'Check it.' }] }, '# Review\n\nA target.\n').replace(/\n/g, '\r\n');
        const doc = await create(markdown);
        const listed = await list(doc);
        assert.strictEqual(listed.data.comments[0].anchor.source_status, 'matched');
        assert.strictEqual(listed.data.comments[0].context.start_line, 3);
        assert.ok(listed.data.comments[0].context.markdown.includes('A [target][^c1].\r\n'));
        assert.strictEqual(listed.data.comments[0].author.display_name, 'Ana');
      });
    } finally { await f.close(); }
  };
};
