'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createCloudStore, createLocalKeyProvider } = require('../lib/cloud-store');
const { createManagedKmsKeyProvider } = require('../lib/cloud-kms');
const { rotateProjectKey, projectKeyStatus } = require('../lib/cloud-key-rotation');
const { backupCloudStore, verifyCloudStore } = require('../lib/cloud-key-recovery');

function fakeKms() {
  const roots = new Map([[1, crypto.randomBytes(32)]]);
  return { roots, current: 1, failWrap: false,
    async encrypt(input) {
      if (this.failWrap) throw Object.assign(new Error('unavailable'), { code: 'AccessDeniedException' });
      const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', roots.get(this.current), nonce);
      cipher.setAAD(Buffer.from(JSON.stringify(input.encryptionContext)));
      return { ciphertext: Buffer.concat([nonce, cipher.update(input.plaintext), cipher.final(), cipher.getAuthTag()]),
        keyId: 'root:' + this.current };
    },
    async decrypt(input) {
      const version = Number(input.keyReference.split(':')[1]), value = input.ciphertext;
      const cipher = crypto.createDecipheriv('aes-256-gcm', roots.get(version), value.subarray(0, 12));
      cipher.setAAD(Buffer.from(JSON.stringify(input.encryptionContext)));
      cipher.setAuthTag(value.subarray(-16));
      return { plaintext: Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]) };
    } };
}

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

module.exports = h => async function () {
  const { assert, testAsync } = h;
  const secret = 'rotation-test-idempotency-secret';
  async function fixture(run, local) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-key-rotation-'));
    const kms = fakeKms(), masterKey = crypto.randomBytes(32);
    const provider = () => local ? createLocalKeyProvider({ masterKey, environment: 'test' })
      : createManagedKmsKeyProvider({ kmsClient: kms, keyId: 'root:current', environment: 'test' });
    const resources = [];
    const open = file => {
      const keyProvider = provider(), store = createCloudStore({ dbPath: file || path.join(dir, 'cloud.db'), keyProvider, idempotencySecret: secret });
      resources.push({ store, keyProvider }); return store;
    };
    const store = open();
    try {
      const team = await store.createTeamWorkspace({ userId: 'owner', name: 'Harbour' });
      store.addWorkspaceMember({ actorUserId: 'owner', workspaceId: team.workspaceId, userId: 'member', role: 'member' });
      const foreign = await store.createTeamWorkspace({ userId: 'outsider', name: 'Other company' });
      const create = { userId: 'owner', projectId: team.projectId, filename: 'plan.md', idempotencyKey: 'create-plan',
        sourceFile: { absolute_path: '/work/plan.md', relative_path: 'plan.md' },
        markdown: '---\ntags:\n  - launch\n  - planning\n---\n# Plan\n\nFirst passage.\n' };
      const first = await store.createDocument(create);
      store.setDocumentPermission({ userId: 'owner', documentId: first.id, mode: 'everyone' });
      const save = { userId: 'owner', documentId: first.id, expectedHeadRevisionId: first.current_revision_id,
        filename: 'plan.md', idempotencyKey: 'save-plan', markdown: create.markdown.replace('First passage.', 'Second passage.') };
      const head = await store.saveRevision(save);
      const privateDoc = await store.createDocument({ ...create, sourceFile: undefined, idempotencyKey: 'private-plan', markdown: '# Private\n\nConfidential harbour.' });
      const foreignDoc = await store.createDocument({ ...create, userId: 'outsider', projectId: foreign.projectId,
        sourceFile: undefined, idempotencyKey: 'foreign-plan', markdown: '# Other company\n\nUnrelated material.' });
      await run({ dir, kms, masterKey, provider, open, store, team, foreign, first, head, create, save, privateDoc, foreignDoc });
    } finally {
      for (const resource of resources.reverse()) {
        try { resource.store.close(); } catch (_) {}
        if (resource.keyProvider.clearCache) resource.keyProvider.clearCache();
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  await testAsync('rotation preserves history, source paths, replay receipts, permissions and company isolation', () => fixture(async f => {
    const foreignBefore = f.store.db.prepare('SELECT * FROM cloud_document_revisions WHERE document_id=?').get(f.foreignDoc.id);
    const result = await rotateProjectKey(f.store, { projectId: f.team.projectId });
    assert.strictEqual(result.active_version, 2);
    assert.strictEqual(result.revisions, 3);
    assert.strictEqual(projectKeyStatus(f.store, f.team.projectId).retained_versions.length, 2);
    const cold = f.open();
    assert.strictEqual((await cold.getDocument({ userId: 'owner', documentId: f.head.id })).markdown, f.save.markdown);
    assert.deepStrictEqual((await cold.getDocument({ userId: 'owner', documentId: f.head.id })).source_file, f.create.sourceFile);
    assert.strictEqual((await cold.getDocument({ userId: 'owner', documentId: f.head.id, revisionId: f.first.current_revision_id })).markdown, f.create.markdown);
    assert.strictEqual((await cold.getDocument({ userId: 'member', documentId: f.head.id })).source_file, undefined);
    await assert.rejects(cold.getDocument({ userId: 'member', documentId: f.privateDoc.id }), { code: 'resource_unavailable' });
    await assert.rejects(cold.getDocument({ userId: 'outsider', documentId: f.head.id }), { code: 'resource_unavailable' });
    assert.deepStrictEqual(await cold.createDocument(f.create), f.first);
    assert.deepStrictEqual(await cold.saveRevision(f.save), f.head);
    assert.deepStrictEqual(cold.db.prepare('SELECT * FROM cloud_document_revisions WHERE document_id=?').get(f.foreignDoc.id), foreignBefore);
    assert.strictEqual((await verifyCloudStore(cold)).ok, true);
  }));

  await testAsync('rotation rebuilds every search mode and permitted tag facet under the new key', () => fixture(async f => {
    assert.deepStrictEqual(f.first.tags, ['launch', 'planning']);
    assert.strictEqual((await f.store.searchPage({ userId: 'member', tags: ['launch'] })).documents.length, 1);
    const before = f.store.db.prepare('SELECT term_hash FROM cloud_search_terms WHERE project_id=? ORDER BY term_hash').all(f.team.projectId);
    await rotateProjectKey(f.store, { projectId: f.team.projectId });
    const cold = f.open();
    for (const input of [
      { query: 'Second passage' }, { query: 'cond pass' }, { tags: ['launch'] },
      { tagsAny: ['launch', 'absent'], tagsNone: ['private'] },
      { expression: { field: 'text', match: 'term', value: 'passage' } },
      { expression: { field: 'body', match: 'phrase', value: 'Second passage' } },
      { expression: { field: 'text', match: 'prefix', value: 'pass' } },
      { expression: { op: 'and', clauses: [
        { field: 'tag', value: 'launch' },
        { op: 'not', clause: { field: 'text', match: 'term', value: 'Confidential' } },
      ] } },
    ]) {
      const result = await cold.searchPage({ userId: 'member', workspaceIds: [f.team.workspaceId], facets: ['tags'], ...input });
      assert.ok(result.documents.some(doc => doc.id === f.head.id), JSON.stringify({ input, result }));
      assert.ok(!result.documents.some(doc => doc.id === f.privateDoc.id));
    }
    assert.strictEqual((await cold.searchPage({ userId: 'outsider', query: 'passage' })).documents.length, 0);
    const after = cold.db.prepare('SELECT term_hash FROM cloud_search_terms WHERE project_id=? ORDER BY term_hash').all(f.team.projectId);
    assert.ok(after.length && !after.some(row => before.some(old => old.term_hash.equals(row.term_hash))));
    assert.strictEqual(cold.searchIndex.status().ready, true);
  }));

  await testAsync('new saves, comments, restores and cross-library moves work after repeated rotations', () => fixture(async f => {
    await rotateProjectKey(f.store, { projectId: f.team.projectId });
    await rotateProjectKey(f.store, { projectId: f.team.projectId });
    const cold = f.open();
    let changed = await cold.saveRevision({ ...f.save, expectedHeadRevisionId: f.head.current_revision_id,
      idempotencyKey: 'version-three-save', markdown: '# Changed\n\nAfter rotation.' });
    assert.strictEqual(cold.db.prepare('SELECT project_key_version FROM cloud_document_revisions WHERE id=?').get(changed.current_revision_id).project_key_version, 3);
    const commentInput = { userId: 'owner', actor: { display_name: 'Owner', user_id: 'owner' }, documentId: changed.id, baseRevisionId: changed.current_revision_id,
      idempotencyKey: 'comment-after-rotation', operation: { action: 'add', text: 'Checked the new key.',
        anchor: { kind: 'inline', quote: 'After rotation.' } } };
    const commented = await cold.actOnComment(commentInput);
    assert.strictEqual((await cold.actOnComment(commentInput)).current_revision_id, commented.current_revision_id);
    changed = await cold.actOnComment({ userId: 'owner', actor: { display_name: 'Owner', user_id: 'owner' }, documentId: changed.id,
      baseRevisionId: commented.current_revision_id, idempotencyKey: 'resolve-after-rotation',
      operation: { action: 'resolve', comment_id: commented.comment_id } });
    const restored = await cold.restoreRevision({ userId: 'owner', documentId: changed.id,
      revisionId: f.first.current_revision_id, expectedHeadRevisionId: changed.current_revision_id, idempotencyKey: 'restore-after-rotation' });
    assert.strictEqual((await cold.getDocument({ userId: 'owner', documentId: changed.id })).markdown, f.create.markdown);
    const personal = await cold.ensurePersonalWorkspace('owner', 'Personal');
    await rotateProjectKey(cold, { projectId: personal.projectId });
    const moved = await cold.moveDocument({ userId: 'owner', documentId: changed.id,
      projectId: personal.projectId, expectedHeadRevisionId: restored.current_revision_id });
    assert.strictEqual(moved.project_id, personal.projectId);
    assert.strictEqual(moved.markdown, f.create.markdown);
    assert.deepStrictEqual(moved.source_file, f.create.sourceFile);
    await assert.rejects(cold.getDocument({ userId: 'member', documentId: moved.id }), { code: 'resource_unavailable' });
    assert.strictEqual((await verifyCloudStore(cold)).ok, true);
  }));

  await testAsync('soft-deleted documents retain their revisions and restore after rotation', () => fixture(async f => {
    f.store.deleteDocument({ userId: 'owner', documentId: f.head.id, expectedHeadRevisionId: f.head.current_revision_id });
    await rotateProjectKey(f.store, { projectId: f.team.projectId });
    const cold = f.open();
    const deleted = await cold.getDocument({ userId: 'owner', documentId: f.head.id, includeDeleted: true });
    assert.strictEqual(deleted.markdown, f.save.markdown);
    await cold.restoreDeletedDocument({ userId: 'owner', documentId: f.head.id, expectedHeadRevisionId: f.head.current_revision_id });
    assert.strictEqual((await cold.getDocument({ userId: 'owner', documentId: f.head.id })).markdown, f.save.markdown);
    assert.strictEqual((await cold.searchPage({ userId: 'owner', tags: ['launch'] })).documents.length, 1);
  }));

  await testAsync('a late authentication failure rolls back all ciphertext, keys and the search index', () => fixture(async f => {
    const row = f.store.db.prepare('SELECT * FROM cloud_document_source_files WHERE document_id=?').get(f.head.id);
    const corrupt = Buffer.from(row.source_ciphertext); corrupt[0] ^= 1;
    f.store.db.prepare('UPDATE cloud_document_source_files SET source_ciphertext=? WHERE document_id=?').run(corrupt, f.head.id);
    const revisions = f.store.db.prepare('SELECT * FROM cloud_document_revisions ORDER BY id').all();
    const terms = f.store.db.prepare('SELECT * FROM cloud_search_terms ORDER BY id').all();
    await assert.rejects(rotateProjectKey(f.store, { projectId: f.team.projectId }), { code: 'temporary_service_failure' });
    assert.strictEqual(projectKeyStatus(f.store, f.team.projectId).active_version, 1);
    assert.strictEqual(projectKeyStatus(f.store, f.team.projectId).retained_versions.length, 1);
    assert.deepStrictEqual(f.store.db.prepare('SELECT * FROM cloud_document_revisions ORDER BY id').all(), revisions);
    assert.deepStrictEqual(f.store.db.prepare('SELECT * FROM cloud_search_terms ORDER BY id').all(), terms);
    f.store.db.prepare('UPDATE cloud_document_source_files SET source_ciphertext=? WHERE document_id=?').run(row.source_ciphertext, f.head.id);
    await rotateProjectKey(f.store, { projectId: f.team.projectId });
    assert.strictEqual((await verifyCloudStore(f.open())).ok, true);
  }));

  await testAsync('KMS failure and a stale rotation request leave the active key unchanged', () => fixture(async f => {
    f.kms.failWrap = true;
    await assert.rejects(rotateProjectKey(f.store, { projectId: f.team.projectId }), { code: 'temporary_service_failure' });
    assert.strictEqual(f.store._projectKeyVersion(f.team.projectId), 1);
    f.kms.failWrap = false;
    await rotateProjectKey(f.store, { projectId: f.team.projectId, expectedVersion: 1 });
    await assert.rejects(rotateProjectKey(f.store, { projectId: f.team.projectId, expectedVersion: 1 }), { code: 'temporary_service_failure' });
    assert.strictEqual(f.store._projectKeyVersion(f.team.projectId), 2);
  }));

  await testAsync('an in-flight save cannot commit old-key ciphertext after another connection rotates', () => fixture(async f => {
    const ready = deferred(), resume = deferred();
    const original = f.store._prepareRevision.bind(f.store);
    f.store._prepareRevision = async input => { const result = await original(input); ready.resolve(); await resume.promise; return result; };
    const input = { ...f.save, expectedHeadRevisionId: f.head.current_revision_id, idempotencyKey: 'paused-save', markdown: '# Saved after retry' };
    const pending = f.store.saveRevision(input);
    await ready.promise;
    await rotateProjectKey(f.open(), { projectId: f.team.projectId });
    resume.resolve();
    await assert.rejects(pending, { code: 'temporary_service_failure' });
    f.store._prepareRevision = original;
    assert.strictEqual((await f.store.getDocument({ userId: 'owner', documentId: f.head.id })).markdown, f.save.markdown);
    const saved = await f.store.saveRevision(input);
    assert.strictEqual((await f.store.getDocument({ userId: 'owner', documentId: saved.id })).markdown, input.markdown);
  }));

  await testAsync('a search spanning a cross-connection rotation fails with a retryable error', () => fixture(async f => {
    const original = f.store._projectKey.bind(f.store), other = f.open();
    let once = true;
    f.store._projectKey = async (...args) => {
      const key = await original(...args);
      if (once && args[0] === f.team.projectId) { once = false; await rotateProjectKey(other, { projectId: f.team.projectId }); }
      return key;
    };
    await assert.rejects(f.store.searchPage({ userId: 'member', query: 'passage' }), { code: 'temporary_service_failure' });
    assert.strictEqual((await f.store.searchPage({ userId: 'member', query: 'passage' })).documents.length, 1);
  }));

  await testAsync('cold restores open backups from before and after KMS and project-key rotation', () => fixture(async f => {
    const before = await backupCloudStore(f.store, path.join(f.dir, 'before.db'));
    f.kms.roots.set(2, crypto.randomBytes(32)); f.kms.current = 2;
    await rotateProjectKey(f.store, { projectId: f.team.projectId });
    const after = await backupCloudStore(f.store, path.join(f.dir, 'after.db'));
    for (const backup of [before, after]) {
      assert.strictEqual(fs.statSync(backup.path).mode & 0o777, 0o600);
      assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(backup.path)).digest('hex'), backup.sha256);
      const restored = f.open(backup.path);
      assert.strictEqual((await verifyCloudStore(restored)).ok, true);
      assert.strictEqual((await restored.getDocument({ userId: 'owner', documentId: f.head.id, revisionId: f.first.current_revision_id })).markdown, f.create.markdown);
    }
    f.kms.roots.delete(1);
    await assert.rejects(verifyCloudStore(f.open(before.path)), { code: 'temporary_service_failure' });
    await assert.rejects(backupCloudStore(f.store, before.path), { code: 'EEXIST' });
  }));

  await testAsync('operator commands back up, rotate and verify without altering the saved backup', () => fixture(async f => {
    const backup = path.join(f.dir, 'operator.db');
    const env = { ...process.env, CLOUD_ENVIRONMENT: 'test', CLOUD_DB: path.join(f.dir, 'cloud.db'),
      CLOUD_KMS_KEY_ID: '', CLOUD_MASTER_KEY: f.masterKey.toString('base64'), CLOUD_IDEMPOTENCY_SECRET: secret };
    const run = args => spawnSync(process.execPath, ['ops/cloud-key-rotation.js', ...args], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
    let result = run(['rotate', '--project', f.team.projectId, '--backup', backup]);
    assert.strictEqual(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.strictEqual(receipt.active_version, 2);
    result = run(['verify-backup', '--backup', backup, '--sha256', receipt.backup.sha256]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).ok, true);
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex'), receipt.backup.sha256);
    assert.notStrictEqual(run(['verify-backup', '--backup', backup, '--sha256', '0'.repeat(64)]).status, 0);
    assert.strictEqual(f.store._projectKeyVersion(f.team.projectId), 2);
  }, true));

  await testAsync('process death halfway through rotation restores the original committed project', () => fixture(async f => {
    const before = f.store.db.prepare('SELECT * FROM cloud_document_revisions ORDER BY id').all();
    const program = `
      const {createCloudStore,createLocalKeyProvider}=require('./lib/cloud-store');
      const {rotateProjectKey}=require('./lib/cloud-key-rotation');
      const store=createCloudStore({dbPath:process.env.CLOUD_DB,
        keyProvider:createLocalKeyProvider({masterKey:process.env.CLOUD_MASTER_KEY,environment:'test'}),
        idempotencySecret:process.env.CLOUD_IDEMPOTENCY_SECRET});
      store.searchIndex.commit=()=>process.kill(process.pid,'SIGKILL');
      rotateProjectKey(store,{projectId:process.env.TEST_PROJECT_ID}).catch(()=>process.exit(2));
    `;
    const child = spawnSync(process.execPath, ['-e', program], { cwd: path.join(__dirname, '..'),
      env: { ...process.env, CLOUD_DB: path.join(f.dir, 'cloud.db'), CLOUD_MASTER_KEY: f.masterKey.toString('base64'),
        CLOUD_IDEMPOTENCY_SECRET: secret, TEST_PROJECT_ID: f.team.projectId }, encoding: 'utf8' });
    assert.strictEqual(child.signal, 'SIGKILL', child.stderr);
    const cold = f.open();
    assert.strictEqual(cold._projectKeyVersion(f.team.projectId), 1);
    assert.deepStrictEqual(cold.db.prepare('SELECT * FROM cloud_document_revisions ORDER BY id').all(), before);
    assert.strictEqual((await verifyCloudStore(cold)).ok, true);
    assert.deepStrictEqual(await cold.saveRevision(f.save), f.head);
  }, true));
};
