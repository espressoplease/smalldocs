'use strict';
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { startFixture } = require('./cloud-onboarding-fixture');

module.exports = function (h) { return async function () {
  const f = await startFixture({ singlePlan: true });
  const owner = f.users.bob.id;
  async function create(key, credentialId) {
    return f.store.createDocument({ userId: owner, projectId: f.team.projectId, credentialId,
      markdown: '# Launch notes\n\nOriginal paragraph.\n', filename: 'launch-notes.md', idempotencyKey: key });
  }
  async function save(doc, text, options = {}) {
    return f.store.saveTargetRevision({ userId: owner, documentId: doc.id,
      targetRevisionId: doc.current_revision_id, markdown: '# Launch notes\n\n' + text + '\n',
      idempotencyKey: crypto.randomUUID(), editReason: 'Apply the requested document update', ...options });
  }
  try {
    await h.testAsync('history groups consecutive browser saves and preserves interleaved writers', async () => {
      let doc = await create('history-groups'); const session = crypto.randomUUID();
      doc = await save(doc, 'First', { editSessionId: session }); doc = await save(doc, 'Second', { editSessionId: session });
      let page = f.store.listDocumentHistory({ userId: owner, documentId: doc.id, limit: 20 });
      assert.deepStrictEqual(page.entries.map(e => e.save_count), [2, 1]);
      doc = await save(doc, 'Agent', { credentialId: 'agent-credential', editReason: 'Apply the requested document update', editSessionId: session });
      doc = await save(doc, 'Browser again', { editSessionId: session });
      page = f.store.listDocumentHistory({ userId: owner, documentId: doc.id, limit: 20 });
      assert.deepStrictEqual(page.entries.map(e => e.kind), ['browser', 'agent', 'browser', 'created']);
      assert.deepStrictEqual(page.entries.map(e => e.save_count), [1, 1, 2, 1]);
      assert.strictEqual(page.entries[1].edit_session_id, null);
    });
    await h.testAsync('agent creation is not an update and the indicator survives retention pruning', async () => {
      let doc = await create('history-retention', 'agent-credential');
      assert.strictEqual(f.store.getDocumentHead({ userId: owner, documentId: doc.id }).activity.has_agent_edits, false);
      const unchanged = await f.store.saveTargetRevision({ userId: owner, documentId: doc.id,
        targetRevisionId: doc.current_revision_id, markdown: '# Launch notes\n\nOriginal paragraph.\n', credentialId: 'agent-credential', editReason: 'Apply the requested document update', idempotencyKey: 'history-agent-no-op' });
      assert.strictEqual(unchanged.revision_created, false);
      assert.strictEqual(f.store.getDocumentHead({ userId: owner, documentId: doc.id }).activity.has_agent_edits, false);
      doc = await save(doc, 'Agent edit', { credentialId: 'agent-credential', editReason: 'Apply the requested document update' });
      doc = await save(doc, 'Browser edit');
      f.store.pruneRevisions({ documentId: doc.id, retainAfterMs: Date.now() + 1000 });
      const activity = f.store.getDocumentHead({ userId: owner, documentId: doc.id }).activity;
      assert.strictEqual(activity.has_agent_edits, true); assert.strictEqual(activity.last_agent_revision_id, null);
      assert.strictEqual(f.store.listDocumentHistory({ userId: owner, documentId: doc.id, limit: 20 }).entries.length, 1);
    });
    await h.testAsync('history pagination returns each grouped update once without decrypting documents', async () => {
      let doc = await create('history-pages');
      for (let n = 0; n < 9; n++) doc = await save(doc, 'Edit ' + n, { editSessionId: crypto.randomUUID() });
      const decrypt = f.store._decryptRevision; let decryptions = 0;
      f.store._decryptRevision = async function () { decryptions++; throw new Error('History must not decrypt content'); };
      try {
        const found = []; let after;
        do { const page = f.store.listDocumentHistory({ userId: owner, documentId: doc.id, limit: 3, after }); found.push(...page.entries.map(e => e.id)); after = page.nextPosition; } while (after);
        assert.strictEqual(found.length, 10); assert.strictEqual(new Set(found).size, 10); assert.strictEqual(decryptions, 0);
        f.store.getDocumentHead({ userId: owner, documentId: doc.id }); assert.strictEqual(decryptions, 0);
      } finally { f.store._decryptRevision = decrypt; }
    });
    await h.testAsync('history and signed cursors cannot cross a document, user or company boundary', async () => {
      let doc = await create('history-permissions'); for (let n = 0; n < 3; n++) doc = await save(doc, 'Edit ' + n);
      const path = '/api/cloud/v1/documents/' + doc.id + '/history?limit=1';
      const page = await f.api('bob', path); assert.strictEqual(page.status, 200); assert.ok(page.data.next_cursor);
      assert.strictEqual((await f.api('outsider', path)).status, 404); assert.strictEqual((await f.api('member', path)).status, 404);
      f.store.setDocumentPermission({ userId: owner, documentId: doc.id, mode: 'custom', memberUserIds: [owner, f.users.member.id] });
      assert.strictEqual((await f.api('member', path)).status, 200);
      assert.strictEqual((await f.api('member', path + '&cursor=' + encodeURIComponent(page.data.next_cursor))).status, 400);
      const other = await create('history-other'); assert.strictEqual((await f.api('bob', '/api/cloud/v1/documents/' + other.id + '/history?cursor=' + encodeURIComponent(page.data.next_cursor))).status, 400);
      f.store.setDocumentPermission({ userId: owner, documentId: doc.id, mode: 'custom', memberUserIds: [owner] });
      assert.strictEqual((await f.api('member', path)).status, 404);
      const revision = page.data.entries[0].revision_id;
      assert.strictEqual((await f.api('member', '/api/cloud/v1/documents/' + doc.id + '/revisions/' + revision)).status, 404);
    });
    await h.testAsync('session attribution is validated and participates in save idempotency', async () => {
      const doc = await create('history-idempotency'), session = crypto.randomUUID();
      const input = { userId: owner, documentId: doc.id, targetRevisionId: doc.current_revision_id,
        markdown: '# Launch notes\n\nSaved\n', editSessionId: session, idempotencyKey: 'history-same-operation' };
      const first = await f.store.saveTargetRevision(input), replay = await f.store.saveTargetRevision(input);
      assert.strictEqual(first.current_revision_id, replay.current_revision_id);
      await assert.rejects(f.store.saveTargetRevision({ ...input, editSessionId: crypto.randomUUID() }), error => error.code === 'idempotency_mismatch');
      await assert.rejects(f.store.saveTargetRevision({ ...input, editSessionId: 'wrong' }), error => error.code === 'invalid_request');
      const noOp = await f.store.saveTargetRevision({ ...input, targetRevisionId: first.current_revision_id, idempotencyKey: 'history-no-op' });
      assert.strictEqual(noOp.revision_created, false); assert.strictEqual(f.store.listRevisions({ userId: owner, documentId: doc.id }).length, 2);
    });
    await h.testAsync('a browser cannot claim an agent identity through request metadata', async () => {
      const doc = await create('history-browser-origin');
      const result = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/revisions', 'POST', {
        target_revision_id: doc.current_revision_id, markdown: '# Launch notes\n\nBrowser update\n',
        idempotency_key: 'history-browser-spoof', edit_session_id: crypto.randomUUID(), credential_id: 'forged-agent', source: 'agent',
      });
      assert.strictEqual(result.status, 201); assert.strictEqual(result.data.document.activity.latest.kind, 'browser');
      assert.strictEqual(result.data.document.activity.has_agent_edits, false);
    });
    await h.testAsync('legacy history upgrades without decrypting or rewriting revision bodies', async () => {
      let doc = await create('history-migration', 'assistant'); doc = await save(doc, 'Saved by an assistant', { credentialId: 'assistant', editReason: 'Apply the requested document update' });
      const file = path.join(f.dir, 'history-upgrade.db'); await f.store.db.backup(file);
      const Database = require('better-sqlite3'), legacy = new Database(file);
      const before = legacy.prepare('SELECT id,body_ciphertext FROM cloud_document_revisions ORDER BY id').all();
      legacy.exec('DROP INDEX cloud_revision_history_metadata_idx; ALTER TABLE cloud_document_revisions DROP COLUMN edit_session_id; ALTER TABLE cloud_documents DROP COLUMN agent_edit_seen;'); legacy.close();
      let keyCalls = 0;
      const provider = new Proxy(f.store.keyProvider, { get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { keyCalls++; return value.apply(target, args); } : value; } });
      const upgraded = require('../lib/cloud-store').createCloudStore({ dbPath: file, keyProvider: provider, idempotencySecret: f.store.idempotencySecret });
      try {
        assert.strictEqual(upgraded.getDocumentHead({ userId: owner, documentId: doc.id }).activity.has_agent_edits, true);
        assert.strictEqual(upgraded.listDocumentHistory({ userId: owner, documentId: doc.id, limit: 20 }).entries[0].kind, 'agent');
        assert.strictEqual(keyCalls, 0); assert.deepStrictEqual(upgraded.db.prepare('SELECT id,body_ciphertext FROM cloud_document_revisions ORDER BY id').all(), before);
      } finally { upgraded.close(); }
    });
  } finally { await f.close(); }
}; };
