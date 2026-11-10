'use strict';
const assert = require('assert'), crypto = require('crypto');
const { startFixture } = require('./cloud-onboarding-fixture');
const yaml = require('../cli/shared/sdocs-yaml');

module.exports = function (h) { return async function () {
  const f = await startFixture({ singlePlan: true });
  const owner = f.users.bob.id;
  const grant = f.auth.issueDeviceAuthorization({ displayName: 'Writing agent' });
  f.auth.approveDeviceAuthorization({ userCode: grant.userCode, userId: owner });
  const credential = f.auth.pollDeviceAuthorization({ deviceCode: grant.deviceCode });
  const original = yaml.serializeFrontMatter({ tags: ['delivery'], styles: { fontSize: 18 },
    comments: [{ id: 'c1', kind: 'inline', quote: 'Original paragraph.', text: 'Check the wording.' }] }) + '\n# Delivery\n\nOriginal paragraph.\n';
  const reason = 'Clarify the handover after the release review.';
  async function create(key) { return f.store.createDocument({ userId: owner, projectId: f.team.projectId,
    markdown: original, filename: 'delivery.md', sourceFile: { absolute_path: '/private/delivery.md' }, idempotencyKey: key }); }
  async function agent(endpoint, body, method = 'POST') {
    const response = await fetch(f.origin + endpoint, { method, headers: { Authorization: 'Bearer ' + credential.accessToken,
      Origin: f.origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  async function save(doc, text = 'Updated paragraph.', explanation = reason, key = crypto.randomUUID()) {
    return agent('/api/cloud/v1/documents/' + doc.id + '/edits', { base_revision_id: doc.current_revision_id,
      edits: [{ old_text: 'Original paragraph.', new_text: text, section: 'Delivery' }], edit_reason: explanation, idempotency_key: key });
  }
  try {
    await h.testAsync('CLI reason parsing preserves literal explanations and missing reasons fail before login', async () => {
      const io = require('../cli/lib/io');
      const explanation = 'Use the approved date, after "review".\nKeep the scope.';
      for (const args of [['--reason', explanation], ['--reason=' + explanation]]) {
        const parsed = io.parseArgs(['cloud', 'edit', 'doc', '--old', 'a', '--new', 'b', ...args]);
        assert.strictEqual(parsed.reasonText, explanation);
      }
      const child = require('child_process').spawnSync(process.execPath,
        [require('path').join(__dirname, '../cli/bin/sdocs-dev.js'), 'cloud', 'edit', 'doc', '--old', 'a', '--new', 'b', '--json'],
        { encoding: 'utf8', env: { ...process.env, SDOCS_HOME: require('path').join(f.dir, 'empty-cli'), SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', NO_UPDATE_NOTIFIER: '1' } });
      assert.strictEqual(child.status, 2, child.stdout + child.stderr);
      const output = JSON.parse(child.stdout); assert.strictEqual(output.error, 'edit_reason_required'); assert.ok(output.message.includes('--reason'));
    });
    await h.testAsync('every agent revision path requires an explanation without saving partial changes', async () => {
      const doc = await create('required'); const base = '/api/cloud/v1/documents/' + doc.id;
      const requests = [
        [base + '/edits', { base_revision_id: doc.current_revision_id, edits: [{ old_text: 'Original', new_text: 'New', section: 'Delivery' }] }],
        [base + '/revisions', { target_revision_id: doc.current_revision_id, markdown: original.replace('Original', 'New') }],
        [base + '/revisions', { expected_head_revision_id: doc.current_revision_id, markdown: original.replace('Original', 'New') }],
        [base + '/tags', { expected_head_revision_id: doc.current_revision_id, tags: ['review'] }, 'PATCH'],
        [base + '/comments/actions', { base_revision_id: doc.current_revision_id, action: 'delete', comment_id: 'c1' }],
        [base + '/revisions/' + doc.current_revision_id + '/restore', { expected_head_revision_id: doc.current_revision_id }],
      ];
      for (const [url, body, method] of requests) {
        const r = await agent(url, { ...body, idempotency_key: crypto.randomUUID() }, method);
        assert.strictEqual(r.status, 400, JSON.stringify(r.data)); assert.strictEqual(r.data.error, 'edit_reason_required');
        assert.ok(r.data.message.includes('--reason'));
      }
      assert.strictEqual((await save(doc, 'Updated paragraph.', '   ')).data.error, 'edit_reason_required');
      assert.strictEqual(f.store.listRevisions({ userId: owner, documentId: doc.id }).length, 1);
    });
    await h.testAsync('reasons are encrypted, returned through both histories, and do not become document text', async () => {
      const doc = await create('encrypted'); const saved = await save(doc);
      assert.strictEqual(saved.status, 201, JSON.stringify(saved.data)); assert.strictEqual(saved.data.document.edit_reason, reason);
      const row = f.store.db.prepare('SELECT * FROM cloud_document_revisions WHERE id=?').get(saved.data.document.revision_id);
      assert.strictEqual(row.has_edit_reason, 1); assert.strictEqual(row.metadata_ciphertext.includes(Buffer.from(reason)), false);
      const opened = await f.store.getDocument({ userId: owner, documentId: doc.id }); assert.ok(!opened.markdown.includes(reason));
      const bodyDecrypt = f.store._decryptRevision; f.store._decryptRevision = async () => { throw new Error('History must not open bodies'); };
      try {
        const page = f.store.listDocumentHistory({ userId: owner, documentId: doc.id, limit: 20 });
        assert.strictEqual((await f.store.withRevisionReasons({ userId: owner, documentId: doc.id }, page.entries))[0].edit_reason, reason);
      } finally { f.store._decryptRevision = bodyDecrypt; }
      const history = await agent('/api/cloud/v1/documents/' + doc.id + '/history', undefined, 'GET');
      const revisions = await agent('/api/cloud/v1/documents/' + doc.id + '/revisions', undefined, 'GET');
      assert.strictEqual(history.data.entries[0].edit_reason, reason); assert.strictEqual(history.data.entries[0].is_you, true);
      assert.strictEqual(revisions.data.revisions[0].edit_reason, reason);
    });
    await h.testAsync('a reason participates in retry identity and a different reason alone creates no revision', async () => {
      const doc = await create('idempotent'), key = crypto.randomUUID();
      const first = await save(doc, 'Updated paragraph.', reason, key), replay = await save(doc, 'Updated paragraph.', reason, key);
      assert.strictEqual(first.data.document.revision_id, replay.data.document.revision_id);
      assert.strictEqual((await save(doc, 'Updated paragraph.', 'Another explanation', key)).data.error, 'idempotency_mismatch');
      const current = await f.store.getDocument({ userId: owner, documentId: doc.id });
      const noOp = await f.store.saveTargetRevision({ userId: owner, documentId: doc.id, credentialId: credential.credentialId,
        targetRevisionId: current.current_revision_id, markdown: current.markdown, editReason: 'Check the existing wording.', idempotencyKey: 'no-op' });
      assert.strictEqual(noOp.revision_created, false); assert.strictEqual(noOp.current_revision_id, current.current_revision_id);
    });
    await h.testAsync('long explanations have bounded history previews and remain available in full', async () => {
      const doc = await create('long-reason'), explanation = 'Review context. '.repeat(500);
      const saved = await save(doc, 'Updated paragraph.', explanation);
      assert.strictEqual(saved.status, 201, JSON.stringify(saved.data));
      const history = await agent('/api/cloud/v1/documents/' + doc.id + '/history', undefined, 'GET');
      assert.strictEqual(history.data.entries[0].edit_reason.length, 512);
      assert.strictEqual(history.data.entries[0].edit_reason_truncated, true);
      const listing = await f.store.listDocuments({ userId: owner, projectId: f.team.projectId });
      assert.strictEqual(listing.find(row => row.id === doc.id).edit_reason, undefined);
      const version = await agent('/api/cloud/v1/documents/' + doc.id + '/revisions/' + saved.data.document.revision_id, undefined, 'GET');
      assert.strictEqual(version.data.document.edit_reason, explanation.trim());
    });
    await h.testAsync('opening a saved version makes one private independent copy of exactly that version', async () => {
      const doc = await create('copy'); await save(doc);
      const current = f.store.getDocumentHead({ userId: owner, documentId: doc.id });
      const request = { idempotency_key: 'copy-retry' }, endpoint = '/api/cloud/v1/documents/' + doc.id + '/revisions/' + doc.current_revision_id + '/copy';
      const first = await f.api('bob', endpoint, 'POST', request), replay = await f.api('bob', endpoint, 'POST', request);
      assert.strictEqual(first.status, 201, JSON.stringify(first.data)); assert.strictEqual(first.data.document.id, replay.data.document.id);
      assert.notStrictEqual(first.data.document.id, doc.id); assert.strictEqual(first.data.document.revision_number, 1);
      const copy = await f.store.getDocument({ userId: owner, documentId: first.data.document.id });
      assert.strictEqual(copy.markdown, original); assert.deepStrictEqual(copy.tags, ['delivery']); assert.strictEqual(copy.source_file, undefined);
      assert.deepStrictEqual(first.data.permission.member_user_ids, [owner]);
      assert.strictEqual(f.store.getDocumentHead({ userId: owner, documentId: doc.id }).current_revision_id, current.current_revision_id);
      assert.strictEqual(f.store.listRevisions({ userId: owner, documentId: copy.id }).length, 1);
      assert.strictEqual((await f.api('member', '/api/cloud/v1/documents/' + copy.id)).status, 404);
    });
    await h.testAsync('the real CLI can open a retained version as an independent private document', async () => {
      const fs = require('fs'), path = require('path'); const home = path.join(f.dir, 'copy-cli');
      fs.mkdirSync(path.join(home, 'cloud'), { recursive: true });
      fs.writeFileSync(path.join(home, 'cloud', 'credentials.json'), JSON.stringify({ [f.origin]: {
        user_id: credential.userId, credential_id: credential.credentialId, access_token: credential.accessToken,
        refresh_token: credential.refreshToken, access_token_expires_at: new Date(credential.accessExpiresAtMs).toISOString(),
      } }));
      const doc = await create('cli-copy'); await save(doc);
      const child = require('child_process').spawnSync(process.execPath,
        [path.join(__dirname, '../cli/bin/sdocs-dev.js'), 'cloud', 'copy', doc.id, '--revision', doc.current_revision_id, '--no-open', '--json'],
        { encoding: 'utf8', env: { ...process.env, SDOCS_HOME: home, SDOCS_CLOUD_URL: f.origin, SDOCS_CLOUD_FILE_CREDENTIALS: '1', SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', NO_UPDATE_NOTIFIER: '1' } });
      assert.strictEqual(child.status, 0, child.stdout + child.stderr); const output = JSON.parse(child.stdout);
      assert.strictEqual(output.ok, true); assert.notStrictEqual(output.document_id, doc.id);
      assert.strictEqual(output.revision_number, 1); assert.ok(output.url.endsWith(output.document_id));
      assert.strictEqual((await f.store.getDocument({ userId: owner, documentId: output.document_id })).markdown, original);
      assert.deepStrictEqual(output.permission.member_user_ids, [owner]);
    });
    await h.testAsync('copies and reason reads respect company isolation and permission revocation during asynchronous work', async () => {
      const doc = await create('isolation'); await save(doc);
      const endpoint = '/api/cloud/v1/documents/' + doc.id + '/revisions/' + doc.current_revision_id + '/copy';
      for (const who of ['outsider', 'member']) assert.strictEqual((await f.api(who, endpoint, 'POST', { idempotency_key: who })).status, 404);
      f.store.setDocumentPermission({ userId: owner, documentId: doc.id, mode: 'custom', memberUserIds: [owner, f.users.member.id] });
      const page = f.store.listDocumentHistory({ userId: f.users.member.id, documentId: doc.id, limit: 20 });
      const decrypt = f.store._decryptRevisionMetadata;
      f.store._decryptRevisionMetadata = async function (row) { const value = await decrypt.call(this, row);
        this.setDocumentPermission({ userId: owner, documentId: doc.id, mode: 'custom', memberUserIds: [owner] }); return value; };
      try { await assert.rejects(f.store.withRevisionReasons({ userId: f.users.member.id, documentId: doc.id }, page.entries), e => e.code === 'resource_unavailable'); }
      finally { f.store._decryptRevisionMetadata = decrypt; }
      f.store.setDocumentPermission({ userId: owner, documentId: doc.id, mode: 'custom', memberUserIds: [owner, f.users.member.id] });
      const read = f.store._decryptRevision;
      f.store._decryptRevision = async function (row) { const value = await read.call(this, row);
        this.setDocumentPermission({ userId: owner, documentId: doc.id, mode: 'custom', memberUserIds: [owner] }); return value; };
      const count = f.store.db.prepare('SELECT count(*) AS n FROM cloud_documents').get().n;
      try { await assert.rejects(f.store.copyRevision({ userId: f.users.member.id, documentId: doc.id, revisionId: doc.current_revision_id, idempotencyKey: 'revoked' }), e => e.code === 'resource_unavailable'); }
      finally { f.store._decryptRevision = read; }
      assert.strictEqual(f.store.db.prepare('SELECT count(*) AS n FROM cloud_documents').get().n, count);
    });
    await h.testAsync('reasons survive project-key rotation and a document move without plaintext storage', async () => {
      const doc = await create('rotation'); await save(doc);
      await require('../lib/cloud-key-rotation').rotateProjectKey(f.store, { projectId: f.team.projectId });
      let page = f.store.listDocumentHistory({ userId: owner, documentId: doc.id, limit: 20 });
      assert.strictEqual((await f.store.withRevisionReasons({ userId: owner, documentId: doc.id }, page.entries))[0].edit_reason, reason);
      const target = await f.store.ensurePersonalWorkspace(owner, 'Personal');
      const head = f.store.getDocumentHead({ userId: owner, documentId: doc.id });
      await f.store.moveDocument({ userId: owner, documentId: doc.id, projectId: target.projectId, expectedHeadRevisionId: head.current_revision_id });
      page = f.store.listDocumentHistory({ userId: owner, documentId: doc.id, limit: 20 });
      assert.strictEqual((await f.store.withRevisionReasons({ userId: owner, documentId: doc.id }, page.entries))[0].edit_reason, reason);
    });
  } finally { await f.close(); }
}; };
