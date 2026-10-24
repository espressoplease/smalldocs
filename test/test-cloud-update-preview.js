const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { createCloudStore, createLocalKeyProvider, CloudError } = require('../lib/cloud-store');
const { mergeTargetRevision } = require('../lib/cloud-merge');
const textDiff = require('../cli/shared/sdocs-text-diff');
const yaml = require('../cli/shared/sdocs-yaml');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-update-preview-'));
    const store = createCloudStore({ dbPath: path.join(dir, 'store.db'),
      keyProvider: createLocalKeyProvider({ masterKey: Buffer.alloc(32, 9), environment: 'test' }),
      idempotencySecret: 'update-preview-test-idempotency-secret' });
    let sequence = 0;
    const library = await store.createTeamWorkspace({ userId: 'owner', name: 'Research', projectName: 'Documents' });
    store.addWorkspaceMember({ actorUserId: 'owner', workspaceId: library.workspaceId, userId: 'editor', role: 'member' });
    const create = (markdown) => store.createDocument({ userId: 'owner', projectId: library.projectId,
      filename: 'policy.md', markdown, idempotencyKey: 'create-' + ++sequence });
    const save = (document, markdown) => store.saveRevision({ userId: 'owner', documentId: document.id,
      expectedHeadRevisionId: document.current_revision_id, markdown, idempotencyKey: 'save-' + ++sequence });
    const request = (document, markdown, extra = {}) => ({ userId: 'owner', documentId: document.id,
      targetRevisionId: document.current_revision_id, markdown, ...extra });
    function snapshot() {
      const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      return JSON.stringify(tables.map(({ name }) => [name, store.db.prepare('SELECT * FROM "' + name + '"').all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
    }
    async function pauseMethod(name, operation, change, pauseAt = 1) {
      const original = store[name];
      let release, started;
      const gate = new Promise(resolve => { release = resolve; });
      const waiting = new Promise(resolve => { started = resolve; });
      let paused = false;
      let calls = 0;
      store[name] = async function (...args) {
        const result = await original.apply(this, args);
        calls += 1;
        if (!paused && calls === pauseAt) { paused = true; started(); await gate; }
        return result;
      };
      try {
        const pending = operation();
        await waiting;
        await change();
        release();
        return await pending;
      } finally { release(); store[name] = original; }
    }
    try {
      await testAsync('shared text diff preserves positions, newline differences and patch content', async () => {
        const before = '# A\n\nOld\n\nEnd\n';
        const after = '# A\n\nNew\nExtra\n\nEnd';
        const diff = textDiff.compare(before, after);
        assert.strictEqual(diff.changed, true);
        assert.strictEqual(diff.hunks[0].before_line, 3);
        assert.strictEqual(diff.hunks[0].after_line, 3);
        const lines = textDiff.splitLines(before);
        for (const edit of textDiff.diffEdits(lines, textDiff.splitLines(after)).reverse()) {
          lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
        }
        assert.strictEqual(lines.join(''), after);
        assert.strictEqual(textDiff.compare(after, after).hunks.length, 0);
        assert.strictEqual(textDiff.compare('', 'a').added_lines, 1);
        assert.strictEqual(textDiff.compare('a', '').removed_lines, 1);
      });
      for (const [name, base, current, proposed] of [
        ['scalar', '# Policy\nCap: 10\n', '# Policy\nCap: 20\n', '# Policy\nCap: 30\n'],
        ['YAML', '---\ntitle: Base\n---\nBody\n', '---\ntitle: Human\n---\nBody\n', '---\ntitle: Agent\n---\nBody\n'],
        ['JSON', '# Config\n```json\n{"amount":100}\n```\n', '# Config\n```json\n{"amount":200}\n```\n', '# Config\n```json\n{"amount":300}\n```\n'],
        ['deletion versus edit', '# Notes\nSecret: old\n', '# Notes\n', '# Notes\nSecret: changed\n'],
      ]) {
        await testAsync('target merge diagnoses overlapping ' + name + ' changes without hiding either version', async () => {
          const merged = mergeTargetRevision(base, current, proposed);
          assert.strictEqual(merged.combined, true);
          assert.strictEqual(merged.conflicts.length, 1);
          const conflict = merged.conflicts[0];
          assert.strictEqual(conflict.kind, 'text');
          assert.ok(conflict.base_start_line >= 1);
          assert.notStrictEqual(conflict.current, conflict.proposed);
          assert.ok(base.replace(/"/g, '').includes(conflict.base.replace(/"/g, '')));
          assert.ok(current.replace(/"/g, '').includes(conflict.current.replace(/"/g, '')));
          assert.ok(proposed.replace(/"/g, '').includes(conflict.proposed.replace(/"/g, '')));
        });
      }
      await testAsync('new comment id collisions are diagnosed while default merges preserve both comments', async () => {
        const current = { id: 'c1', kind: 'block', block: 'p:0', author: 'Ana', text: 'Human comment' };
        const proposed = { id: 'c1', kind: 'block', block: 'p:0', author: 'Bob', text: 'Agent comment' };
        const body = '# Comments\n\nParagraph.\n';
        const merged = mergeTargetRevision(body, yaml.serializeFrontMatter({ comments: [current] }) + '\n' + body,
          yaml.serializeFrontMatter({ comments: [proposed] }) + '\n' + body);
        assert.strictEqual(merged.combined, true);
        assert.deepStrictEqual(merged.conflicts, [{ kind: 'comment', reason: 'id_collision', comment_id: 'c1',
          base: null, current, proposed }]);
        const saved = yaml.parseFrontMatter(merged.markdown).meta.comments;
        assert.deepStrictEqual(saved.map(comment => comment.text), ['Human comment', 'Agent comment']);
        assert.strictEqual(new Set(saved.map(comment => comment.id)).size, 2);
      });
      await testAsync('filename-only target updates preview and create a metadata revision consistently', async () => {
        const base = await create('Body\n');
        const input = request(base, 'Body\n', { filename: 'after.md', idempotencyKey: 'rename-only' });
        const preview = await store.previewTargetRevision(input);
        assert.strictEqual(preview.filename, 'after.md');
        assert.strictEqual(preview.metadata_changed, true);
        assert.strictEqual(preview.would_change, true);
        assert.strictEqual(preview.diff.changed, false);
        const saved = await store.saveTargetRevision(input);
        assert.strictEqual(saved.filename, preview.filename);
        assert.strictEqual(saved.title, preview.title);
        assert.strictEqual(saved.metadata_changed, true);
        assert.strictEqual(saved.revision_created, true);
        assert.strictEqual(saved.would_change, true);
        assert.strictEqual(saved.content_sha256, preview.content_sha256);
        const opened = await store.getDocument({ userId: 'owner', documentId: base.id });
        assert.strictEqual(opened.filename, 'after.md');
        assert.strictEqual(opened.markdown, 'Body\n');
        const again = await store.saveTargetRevision(request(saved, 'Body\n', { filename: 'after.md', idempotencyKey: 'rename-unchanged' }));
        assert.strictEqual(again.revision_created, false);
        assert.strictEqual(again.would_change, false);
      });
      await testAsync('moving a document rekeys mutation receipts atomically and preserves principal-scoped retries', async () => {
        const destination = await store.createTeamWorkspace({ userId: 'owner', name: 'Destination', projectName: 'Documents' });
        store.addWorkspaceMember({ actorUserId: 'owner', workspaceId: destination.workspaceId, userId: 'new-member', role: 'member' });
        const base = await create('# Moving receipts\n');
        const firstInput = { userId: 'owner', documentId: base.id, expectedHeadRevisionId: base.current_revision_id,
          markdown: '# Moving receipts\nFirst edit.\n', idempotencyKey: 'move-expected-receipt' };
        const first = await store.saveRevision(firstInput);
        const targetInput = request(first, '# Moving receipts\nSecond edit.\n', { idempotencyKey: 'move-target-receipt' });
        const second = await store.saveTargetRevision(targetInput);
        const restoreInput = { userId: 'owner', documentId: base.id, revisionId: base.current_revision_id,
          expectedHeadRevisionId: second.current_revision_id, idempotencyKey: 'move-restore-receipt' };
        const restored = await store.restoreRevision(restoreInput);
        store.setDocumentPermission({ userId: 'owner', documentId: base.id, mode: 'custom', memberUserIds: ['editor'] });
        const memberInput = request(restored, '# Moving receipts\nMember edit.\n', { userId: 'editor', idempotencyKey: 'move-member-receipt' });
        const memberSave = await store.saveTargetRevision(memberInput);
        const moved = await store.moveDocument({ userId: 'owner', documentId: base.id, projectId: destination.projectId,
          expectedHeadRevisionId: memberSave.current_revision_id });
        assert.strictEqual(moved.workspace_id, destination.workspaceId);
        const receipts = store._documentMutationReceipts(base.id);
        assert.strictEqual(receipts.length, 4);
        for (const row of receipts) assert.strictEqual(JSON.parse(row.response_json).project_id, destination.projectId);
        const originalKey = store._projectKey;
        store._projectKey = async function (projectId, version) {
          if (projectId === library.projectId) throw new Error('Old source key must not be used for moved mutation retries');
          return originalKey.call(this, projectId, version);
        };
        try {
          assert.deepStrictEqual(await store.saveRevision(firstInput), first);
          assert.deepStrictEqual(await store.saveTargetRevision(targetInput), second);
          assert.deepStrictEqual(await store.restoreRevision(restoreInput), restored);
        } finally { store._projectKey = originalKey; }
        await assert.rejects(store.saveTargetRevision(memberInput), error => error.code === 'resource_unavailable');
        store.setDocumentPermission({ userId: 'owner', documentId: base.id, mode: 'custom', memberUserIds: ['new-member'] });
        const outsiderReplay = await store.saveTargetRevision({ ...targetInput, userId: 'new-member' });
        assert.notStrictEqual(outsiderReplay.current_revision_id, second.current_revision_id);
        assert.strictEqual(store.db.prepare(`SELECT COUNT(*) AS n FROM cloud_idempotency_records
          WHERE resource_id = ? AND idempotency_key = ?`).get(base.id, targetInput.idempotencyKey).n, 2);
      });
      await testAsync('a no-op receipt committed while a move prepares is rekeyed in the same move transaction', async () => {
        const destination = await store.createTeamWorkspace({ userId: 'owner', name: 'Concurrent destination', projectName: 'Documents' });
        const base = await create('# Concurrent move\n');
        const retryInput = request(base, '# Concurrent move\n', { idempotencyKey: 'move-concurrent-noop' });
        let receipt;
        await pauseMethod('_prepareRevision', () => store.moveDocument({ userId: 'owner', documentId: base.id,
          projectId: destination.projectId, expectedHeadRevisionId: base.current_revision_id }), async () => {
          receipt = await store.saveTargetRevision(retryInput);
          assert.strictEqual(receipt.revision_created, false);
        });
        const record = store.db.prepare('SELECT response_json FROM cloud_idempotency_records WHERE idempotency_key = ?')
          .get(retryInput.idempotencyKey);
        assert.strictEqual(JSON.parse(record.response_json).project_id, destination.projectId);
        assert.deepStrictEqual(await store.saveTargetRevision(retryInput), receipt);
      });
      for (const operation of ['target-noop', 'target-save', 'expected-head-save', 'restore']) {
        await testAsync('a second-process move cannot leave a stale-key receipt from ' + operation, async () => {
          const destination = await store.createTeamWorkspace({ userId: 'owner', name: 'Process destination ' + operation, projectName: 'Documents' });
          const base = await create('# Process race\nOriginal.\n');
          const head = operation === 'restore' ? await save(base, '# Process race\nLatest.\n') : base;
          const idempotencyKey = 'process-move-' + operation;
          const input = operation === 'expected-head-save'
            ? { userId: 'owner', documentId: base.id, expectedHeadRevisionId: head.current_revision_id,
              markdown: '# Process race\nUpdated.\n', idempotencyKey }
            : operation === 'restore'
              ? { userId: 'owner', documentId: base.id, expectedHeadRevisionId: head.current_revision_id,
                revisionId: base.current_revision_id, idempotencyKey }
              : request(head, operation === 'target-noop' ? '# Process race\nOriginal.\n' : '# Process race\nUpdated.\n', { idempotencyKey });
          const run = () => operation === 'restore' ? store.restoreRevision(input)
            : operation === 'expected-head-save' ? store.saveRevision(input) : store.saveTargetRevision(input);
          const worker = `const {createCloudStore,createLocalKeyProvider}=require(process.argv[1]);
            const store=createCloudStore({dbPath:process.argv[2],keyProvider:createLocalKeyProvider({masterKey:Buffer.alloc(32,9),environment:'test'}),idempotencySecret:'update-preview-test-idempotency-secret'});
            store.moveDocument({userId:'owner',documentId:process.argv[3],projectId:process.argv[4],expectedHeadRevisionId:process.argv[5]})
              .then(result=>{process.stdout.write(JSON.stringify({workspace_id:result.workspace_id}));store.close();})
              .catch(error=>{store.close();process.stderr.write(error.code||error.message);process.exitCode=1;});`;
          const moveInSecondProcess = () => {
            const output = execFileSync(process.execPath, ['-e', worker, path.join(__dirname, '../lib/cloud-store'),
              path.join(dir, 'store.db'), base.id, destination.projectId, head.current_revision_id],
            { env: process.env, timeout: 10000, encoding: 'utf8' });
            assert.strictEqual(JSON.parse(output).workspace_id, destination.workspaceId);
          };
          const method = operation.startsWith('target') ? '_targetMergeDiagnostics' : '_prepareRevision';
          const original = store[method];
          let moved = false;
          if (method === '_targetMergeDiagnostics') {
            store[method] = function (...args) {
              const result = original.apply(this, args);
              if (!moved) { moved = true; moveInSecondProcess(); }
              return result;
            };
          } else {
            store[method] = async function (...args) {
              const result = await original.apply(this, args);
              if (!moved) { moved = true; moveInSecondProcess(); }
              return result;
            };
          }
          try { await assert.rejects(run(), error => error.code === 'temporary_service_failure'); }
          finally { store[method] = original; }
          assert.strictEqual(moved, true);
          assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS n FROM cloud_idempotency_records WHERE idempotency_key = ?')
            .get(idempotencyKey).n, 0);
          const unchanged = await store.getDocument({ userId: 'owner', documentId: base.id });
          assert.strictEqual(unchanged.workspace_id, destination.workspaceId);
          assert.strictEqual(unchanged.current_revision_id, head.current_revision_id);
          assert.strictEqual(unchanged.markdown, operation === 'restore' ? '# Process race\nLatest.\n' : '# Process race\nOriginal.\n');
          const retry = await run();
          assert.strictEqual(retry.id, base.id);
          const receipt = store.db.prepare('SELECT response_json FROM cloud_idempotency_records WHERE idempotency_key = ?').get(idempotencyKey);
          assert.strictEqual(JSON.parse(receipt.response_json).project_id, destination.projectId);
          assert.deepStrictEqual(await run(), retry);
        });
      }
      await testAsync('failed move authorization leaves encrypted mutation receipts and document location unchanged', async () => {
        const destination = await store.createTeamWorkspace({ userId: 'owner', name: 'Denied destination', projectName: 'Documents' });
        const base = await create('# Move rollback\n');
        const changed = await store.saveTargetRevision(request(base, '# Move rollback\nChanged.\n', { idempotencyKey: 'rollback-receipt' }));
        const before = snapshot();
        await assert.rejects(store.moveDocument({ userId: 'owner', documentId: base.id, projectId: destination.projectId,
          expectedHeadRevisionId: changed.current_revision_id, beforeCommit() { throw new CloudError('subscription_read_only'); } }),
        error => error.code === 'subscription_read_only');
        assert.strictEqual(snapshot(), before);
      });
      await testAsync('preview returns the merge and hashes without changing any database table', async () => {
        const base = await create('# Policy\nOwner: Ana\n\nCap: 10\n');
        const head = await save(base, '# Policy\nOwner: Bob\n\nCap: 10\n');
        const before = snapshot();
        const preview = await store.previewTargetRevision(request(base, '# Policy\nOwner: Ana\n\nCap: 30\n', { idempotencyKey: 'preview-unused' }));
        assert.strictEqual(snapshot(), before);
        assert.strictEqual(preview.preview, true);
        assert.strictEqual(preview.current_revision_id, head.current_revision_id);
        assert.strictEqual(preview.merged_from_revision_id, head.current_revision_id);
        assert.strictEqual(preview.merge_classification, 'rebased');
        assert.strictEqual(preview.would_change, true);
        assert.strictEqual(preview.conflict_count, 0);
        assert.strictEqual(preview.diff.changed, true);
        assert.deepStrictEqual(preview.diff.hunks[0].before, ['Cap: 10\n']);
        assert.deepStrictEqual(preview.diff.hunks[0].after, ['Cap: 30\n']);
        assert.strictEqual(preview.markdown, '# Policy\nOwner: Bob\n\nCap: 30\n');
        assert.strictEqual(preview.content_sha256, crypto.createHash('sha256').update(preview.markdown).digest('hex'));
        const saved = await store.saveTargetRevision(request(base, '# Policy\nOwner: Ana\n\nCap: 30\n', {
          expectedCurrentRevisionId: preview.current_revision_id, rejectConflicts: true, idempotencyKey: 'preview-commit' }));
        assert.strictEqual(saved.content_sha256, preview.content_sha256);
        assert.strictEqual(saved.revision_created, true);
        assert.strictEqual(saved.workspace_id, library.workspaceId);
        assert.strictEqual(saved.project_id, library.projectId);
      });
      await testAsync('strict saves refuse overlapping edits without revisions, audit, idempotency or index writes', async () => {
        const base = await create('# Policy\nCap: 10\n');
        const head = await save(base, '# Policy\nCap: 20\n');
        const before = snapshot();
        await assert.rejects(store.saveTargetRevision(request(base, '# Policy\nCap: 30\n', {
          rejectConflicts: true, idempotencyKey: 'strict-overlap' })), error => error.code === 'revision_conflict' &&
          error.reason === 'overlapping_edits' && error.currentRevisionId === head.current_revision_id && error.conflicts.length === 1);
        assert.strictEqual(snapshot(), before);
        const preview = await store.previewTargetRevision(request(base, '# Policy\nCap: 30\n', { rejectConflicts: true }));
        assert.strictEqual(preview.conflict_count, 1);
        assert.strictEqual(snapshot(), before);
      });
      await testAsync('unchanged target saves report no new revision and preserve the index head', async () => {
        const base = await create('# Stable\n');
        const result = await store.saveTargetRevision(request(base, '# Stable\n', { idempotencyKey: 'noop-save' }));
        assert.strictEqual(result.revision_created, false);
        assert.strictEqual(result.would_change, false);
        assert.strictEqual(result.current_revision_id, base.current_revision_id);
        assert.strictEqual(store.listRevisions({ userId: 'owner', documentId: base.id }).length, 1);
      });
      await testAsync('a reviewed head cannot be replaced by a later edit before commit', async () => {
        const base = await create('# Review\nCap: 10\n');
        const preview = await store.previewTargetRevision(request(base, '# Review\nCap: 20\n'));
        const head = await save(base, '# Review\nCap: 10\n\nOperator note.\n');
        const before = snapshot();
        await assert.rejects(store.saveTargetRevision(request(base, '# Review\nCap: 20\n', {
          expectedCurrentRevisionId: preview.current_revision_id, idempotencyKey: 'stale-review' })), error =>
          error.code === 'revision_conflict' && error.reason === 'reviewed_head_changed' && error.currentRevisionId === head.current_revision_id);
        assert.strictEqual(snapshot(), before);
      });
      await testAsync('a reviewed save rechecks its head after asynchronous encryption', async () => {
        const base = await create('# Review\nCap: 10\n');
        let concurrent;
        await assert.rejects(pauseMethod('_prepareRevision', () => store.saveTargetRevision(request(base, '# Review\nCap: 20\n', {
          expectedCurrentRevisionId: base.current_revision_id, idempotencyKey: 'race-review' })), async () => {
          concurrent = await save(base, '# Review\nCap: 99\n');
        }), error => error.code === 'revision_conflict' && error.currentRevisionId === concurrent.current_revision_id);
        assert.strictEqual((await store.getDocument({ userId: 'owner', documentId: base.id })).markdown, '# Review\nCap: 99\n');
        assert.strictEqual(store.listRevisions({ userId: 'owner', documentId: base.id }).length, 2);
      });
      await testAsync('strict conflict protection rechecks a concurrent replacement after encryption', async () => {
        const base = await create('# Race\nCap: 10\n');
        let concurrent;
        await assert.rejects(pauseMethod('_prepareRevision', () => store.saveTargetRevision(request(base, '# Race\nCap: 20\n', {
          rejectConflicts: true, idempotencyKey: 'race-overlap' })), async () => {
          concurrent = await save(base, '# Race\nCap: 99\n');
        }), error => error.code === 'revision_conflict' && error.reason === 'overlapping_edits' &&
          error.currentRevisionId === concurrent.current_revision_id && error.conflicts[0].current === 'Cap: 99\n');
        assert.strictEqual(store.listRevisions({ userId: 'owner', documentId: base.id }).length, 2);
        assert.strictEqual((await store.getDocument({ userId: 'owner', documentId: base.id })).markdown, '# Race\nCap: 99\n');
      });
      await testAsync('preview retries when its head changes during decryption', async () => {
        const base = await create('# Race\nOwner: Ana\n\nCap: 10\n');
        const firstHead = await save(base, '# Race\nOwner: Bob\n\nCap: 10\n');
        let concurrent;
        const preview = await pauseMethod('_decryptRevision', () => store.previewTargetRevision(request(base, '# Race\nOwner: Ana\n\nCap: 20\n')), async () => {
          concurrent = await save(firstHead, '# Race\nOwner: Claire\n\nCap: 10\n');
        }, 2);
        assert.strictEqual(preview.current_revision_id, concurrent.current_revision_id);
        assert.strictEqual(preview.markdown, '# Race\nOwner: Claire\n\nCap: 20\n');
        assert.strictEqual(preview.merge_retry_count, 1);
      });
      for (const operation of ['preview', 'save']) {
        await testAsync(operation + ' refuses plaintext and writes after access is revoked during asynchronous work', async () => {
          const base = await create('# Private\nCap: 10\n');
          store.setDocumentPermission({ userId: 'owner', documentId: base.id, mode: 'custom', memberUserIds: ['editor'] });
          const input = request(base, '# Private\nCap: 20\n', { userId: 'editor', idempotencyKey: 'revoked-' + operation });
          await assert.rejects(pauseMethod(operation === 'save' ? '_prepareRevision' : '_decryptRevision', () =>
            operation === 'save' ? store.saveTargetRevision(input) : store.previewTargetRevision(input), async () => {
            store.setDocumentPermission({ userId: 'owner', documentId: base.id, mode: 'custom', memberUserIds: [] });
          }), error => error.code === 'resource_unavailable');
          assert.strictEqual(store.listRevisions({ userId: 'owner', documentId: base.id }).length, 1);
        });
      }
      await testAsync('preview does not leak another library document or revision via supplied merge bases', async () => {
        const base = await create('# Private owner content\n');
        await assert.rejects(store.previewTargetRevision(request(base, '# Attempt', { userId: 'outsider', targetMarkdown: '# Claimed base' })), error => error.code === 'resource_unavailable');
        const other = await create('# Other content\n');
        await assert.rejects(store.previewTargetRevision(request(base, '# Attempt', { targetRevisionId: other.current_revision_id })), error => error.code === 'target_too_old');
      });
      await testAsync('preview and strict save can recover a pruned base without reviving history', async () => {
        const markdown = '# Pruned\nOwner: Ana\n\nCap: 10\n';
        const base = await create(markdown);
        const head = await save(base, '# Pruned\nOwner: Bob\n\nCap: 10\n');
        store.pruneRevisions({ documentId: base.id, keepPrevious: 0, retainAfterMs: Date.now() + 1000 });
        const before = snapshot();
        const preview = await store.previewTargetRevision(request(base, '# Pruned\nOwner: Ana\n\nCap: 20\n', { targetMarkdown: markdown }));
        assert.strictEqual(preview.target_recovered, true);
        assert.strictEqual(preview.current_revision_id, head.current_revision_id);
        assert.strictEqual(snapshot(), before);
        const saved = await store.saveTargetRevision(request(base, '# Pruned\nOwner: Ana\n\nCap: 20\n', {
          targetMarkdown: markdown, rejectConflicts: true, expectedCurrentRevisionId: head.current_revision_id,
          idempotencyKey: 'pruned-reviewed' }));
        assert.strictEqual(saved.content_sha256, preview.content_sha256);
        assert.strictEqual(store.listRevisions({ userId: 'owner', documentId: base.id }).length, 2);
      });
      await testAsync('guard options participate in idempotency and replays cannot bypass revocation', async () => {
        const base = await create('# Idempotent\n');
        store.setDocumentPermission({ userId: 'owner', documentId: base.id, mode: 'custom', memberUserIds: ['editor'] });
        const input = request(base, '# Idempotent\nUpdated.\n', { userId: 'editor', rejectConflicts: true,
          expectedCurrentRevisionId: base.current_revision_id, idempotencyKey: 'guarded-idempotency' });
        const first = await store.saveTargetRevision(input);
        assert.deepStrictEqual(await store.saveTargetRevision(input), first);
        await assert.rejects(store.saveTargetRevision({ ...input, rejectConflicts: false }), error => error.code === 'idempotency_mismatch');
        store.setDocumentPermission({ userId: 'owner', documentId: base.id, mode: 'custom', memberUserIds: [] });
        await assert.rejects(store.saveTargetRevision(input), error => error.code === 'resource_unavailable');
      });
      await testAsync('all document mutation receipts keep content and metadata out of raw database and WAL bytes', async () => {
        const canary = 'ReceiptCanary' + crypto.randomBytes(12).toString('hex');
        const base = await create('# ' + canary + '\n\nOriginal.\n');
        const head = await save(base, '# ' + canary + '\n\nHuman replacement.\n');
        const merged = await store.saveTargetRevision(request(base, '# ' + canary + '\n\nAgent replacement.\n', {
          idempotencyKey: 'sealed-target' }));
        await store.restoreRevision({ userId: 'owner', documentId: base.id, revisionId: base.current_revision_id,
          expectedHeadRevisionId: merged.current_revision_id, idempotencyKey: 'sealed-restore' });
        const receipts = store.db.prepare('SELECT response_json FROM cloud_idempotency_records').all();
        assert.ok(receipts.length > 4);
        for (const row of receipts) assert.strictEqual(JSON.parse(row.response_json).encrypted_response, 1);
        for (const suffix of ['', '-wal']) {
          const file = path.join(dir, 'store.db') + suffix;
          if (fs.existsSync(file)) assert.strictEqual(fs.readFileSync(file).includes(Buffer.from(canary)), false);
        }
        assert.notStrictEqual(head.current_revision_id, merged.current_revision_id);
      });
      await testAsync('legacy receipt migration seals old plaintext, scrubs active DB and WAL, and preserves exact retries', async () => {
        const canary = 'LegacyCanary' + crypto.randomBytes(12).toString('hex');
        const base = await create('# Legacy\n');
        const input = request(base, '# Legacy\n' + canary + '\n', { idempotencyKey: 'legacy-receipt' });
        const result = await store.saveTargetRevision(input);
        store.db.prepare(`UPDATE cloud_idempotency_records SET response_json = ?, response_encrypted = 0 WHERE idempotency_key = ?`)
          .run(JSON.stringify(result), input.idempotencyKey);
        store.db.prepare(`INSERT INTO cloud_idempotency_records
          (principal_id, endpoint, resource_id, idempotency_key, request_digest, response_json, created_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run('former-owner', 'documents.revisions.target', 'purged-document', 'orphaned-receipt', 'old-digest', JSON.stringify({ markdown: canary }), Date.now());
        assert.ok(['', '-wal'].some(suffix => {
          const file = path.join(dir, 'store.db') + suffix;
          return fs.existsSync(file) && fs.readFileSync(file).includes(Buffer.from(canary));
        }));
        const migrated = await store.encryptDocumentIdempotencyReceipts();
        assert.deepStrictEqual(migrated, { migrated: 1, orphaned_removed: 1 });
        assert.deepStrictEqual(await store.saveTargetRevision(input), result);
        assert.deepStrictEqual(await store.encryptDocumentIdempotencyReceipts(), { migrated: 0, orphaned_removed: 0 });
        for (const suffix of ['', '-wal']) {
          const file = path.join(dir, 'store.db') + suffix;
          if (fs.existsSync(file)) assert.strictEqual(fs.readFileSync(file).includes(Buffer.from(canary)), false);
        }
      });
      await testAsync('an interrupted legacy scrub resumes after every receipt has already been encrypted', async () => {
        const canary = 'InterruptedCanary' + crypto.randomBytes(12).toString('hex');
        const base = await create('# Interrupted\n');
        const input = request(base, '# Interrupted\n' + canary + '\n', { idempotencyKey: 'interrupted-receipt' });
        const saved = await store.saveTargetRevision(input);
        store.db.prepare(`UPDATE cloud_idempotency_records SET response_json = ?, response_encrypted = 0
          WHERE idempotency_key = ?`).run(JSON.stringify(saved), input.idempotencyKey);
        const original = store.db.exec;
        store.db.exec = function (sql) {
          if (sql === 'VACUUM') throw new Error('Simulated migration interruption');
          return original.call(this, sql);
        };
        try {
          await assert.rejects(store.encryptDocumentIdempotencyReceipts(), /Simulated migration interruption/);
        } finally { store.db.exec = original; }
        assert.strictEqual(store.db.prepare(`SELECT response_encrypted FROM cloud_idempotency_records WHERE idempotency_key = ?`)
          .get(input.idempotencyKey).response_encrypted, 1);
        assert.ok(store.db.prepare(`SELECT 1 FROM cloud_maintenance_state WHERE name = 'idempotency_receipts_scrub_pending'`).get());
        assert.deepStrictEqual(await store.encryptDocumentIdempotencyReceipts(), { migrated: 0, orphaned_removed: 0 });
        assert.strictEqual(store.db.prepare(`SELECT 1 FROM cloud_maintenance_state WHERE name = 'idempotency_receipts_scrub_pending'`).get(), undefined);
        for (const suffix of ['', '-wal']) {
          const file = path.join(dir, 'store.db') + suffix;
          if (fs.existsSync(file)) assert.strictEqual(fs.readFileSync(file).includes(Buffer.from(canary)), false);
        }
        assert.deepStrictEqual(await store.saveTargetRevision(input), saved);
      });
      await testAsync('encrypted receipt AAD uses the same normalized idempotency key as record lookup', async () => {
        const input = { userId: 'owner', projectId: library.projectId, filename: 'normalized.md', markdown: '# Normalized\n' };
        const first = await store.createDocument({ ...input, idempotencyKey: '  normalized-receipt  ' });
        assert.deepStrictEqual(await store.createDocument({ ...input, idempotencyKey: 'normalized-receipt' }), first);
      });
      await testAsync('a sealed receipt cannot be downgraded to attacker-controlled legacy plaintext', async () => {
        const base = await create('# Downgrade\n');
        const input = request(base, '# Downgrade\nReal response.\n', { idempotencyKey: 'downgrade-receipt' });
        await store.saveTargetRevision(input);
        store.db.prepare(`UPDATE cloud_idempotency_records SET response_json = ? WHERE idempotency_key = ?`)
          .run(JSON.stringify({ markdown: 'Forged response', id: base.id }), input.idempotencyKey);
        const before = snapshot();
        await assert.rejects(store.saveTargetRevision(input), error => error.code === 'temporary_service_failure');
        await store.encryptDocumentIdempotencyReceipts();
        assert.strictEqual(snapshot(), before);
        const record = store.db.prepare(`SELECT response_json, response_encrypted FROM cloud_idempotency_records WHERE idempotency_key = ?`)
          .get(input.idempotencyKey);
        assert.strictEqual(record.response_encrypted, 1);
        assert.strictEqual(JSON.parse(record.response_json).encrypted_response, undefined);
        const destination = await store.createTeamWorkspace({ userId: 'owner', name: 'Downgrade destination', projectName: 'Documents' });
        const beforeMove = snapshot();
        const head = store.getDocumentHead({ userId: 'owner', documentId: base.id });
        await assert.rejects(store.moveDocument({ userId: 'owner', documentId: base.id, projectId: destination.projectId,
          expectedHeadRevisionId: head.current_revision_id }), error => error.code === 'temporary_service_failure');
        assert.strictEqual(snapshot(), beforeMove);
      });
      await testAsync('sealed receipts authenticate their idempotency context against ciphertext relocation', async () => {
        const input = { userId: 'owner', projectId: library.projectId, filename: 'sealed.md', markdown: '# Sealed\n' };
        await store.createDocument({ ...input, idempotencyKey: 'sealed-context-a' });
        await store.createDocument({ ...input, idempotencyKey: 'sealed-context-b' });
        const row = store.db.prepare('SELECT response_json FROM cloud_idempotency_records WHERE idempotency_key = ?').get('sealed-context-a');
        store.db.prepare('UPDATE cloud_idempotency_records SET response_json = ? WHERE idempotency_key = ?')
          .run(row.response_json, 'sealed-context-b');
        await assert.rejects(store.createDocument({ ...input, idempotencyKey: 'sealed-context-b' }), error => error.code === 'temporary_service_failure');
      });
      await testAsync('transactional replay cannot disclose a concurrent successful response after access revocation', async () => {
        const base = await create('# Replay race\n');
        store.setDocumentPermission({ userId: 'owner', documentId: base.id, mode: 'custom', memberUserIds: ['editor'] });
        const input = request(base, '# Replay race\nSaved.\n', { userId: 'editor', idempotencyKey: 'concurrent-replay' });
        await assert.rejects(pauseMethod('_prepareRevision', () => store.saveTargetRevision(input), async () => {
          await store.saveTargetRevision(input);
          store.setDocumentPermission({ userId: 'owner', documentId: base.id, mode: 'custom', memberUserIds: [] });
        }), error => error.code === 'resource_unavailable');
        assert.strictEqual(store.listRevisions({ userId: 'owner', documentId: base.id }).length, 2);
      });
      await testAsync('preview rechecks entitlements and a denial leaves every table unchanged', async () => {
        const base = await create('# Billing\n');
        const before = snapshot();
        await assert.rejects(store.previewTargetRevision(request(base, '# Changed\n', {
          beforeCommit: () => { throw new CloudError('subscription_read_only'); } })), error => error.code === 'subscription_read_only');
        assert.strictEqual(snapshot(), before);
      });
    } finally {
      store.close(); fs.rmSync(dir, { recursive: true, force: true });
    }

    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
    try {
      let base;
      await testAsync('HTTP preview returns current permission-scoped content without changing revision history', async () => {
        base = await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
          filename: 'review.md', markdown: '# Review\nCap: 10\n', idempotencyKey: 'http-base' });
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: base.id, mode: 'custom', memberUserIds: [f.users.member.id] });
        const before = f.store.listRevisions({ userId: f.users.bob.id, documentId: base.id });
        const response = await f.api('member', '/api/cloud/v1/documents/' + base.id + '/revisions/preview', 'POST', {
          target_revision_id: base.current_revision_id, markdown: '# Review\nCap: 20\n' });
        assert.strictEqual(response.status, 200, JSON.stringify(response.data));
        assert.strictEqual(response.data.document.preview, true);
        assert.strictEqual(response.data.document.current_revision_id, base.current_revision_id);
        assert.deepStrictEqual(f.store.listRevisions({ userId: f.users.bob.id, documentId: base.id }), before);
        const account = await f.api('member', '/api/cloud/v1/account?account_id=' + f.team.workspaceId);
        assert.strictEqual(account.data.account.can_create_document, false);
        assert.strictEqual(account.data.account.write_entitlement, true);
        assert.strictEqual(account.data.account.can_edit_shared_documents, true);
        const old = await f.api('member', '/api/cloud/v1/documents/' + base.id + '/revisions/' + base.current_revision_id);
        assert.strictEqual(old.data.permission.can_manage, false);
        assert.strictEqual(old.data.permission.can_edit, true);
      });
      await testAsync('HTTP guarded save reports both conflicts and refuses writes after a review becomes stale', async () => {
        const head = await f.store.saveRevision({ userId: f.users.bob.id, documentId: base.id,
          expectedHeadRevisionId: base.current_revision_id, markdown: '# Review\nCap: 99\n', idempotencyKey: 'http-concurrent' });
        const endpoint = '/api/cloud/v1/documents/' + base.id + '/revisions';
        const conflict = await f.api('member', endpoint, 'POST', { target_revision_id: base.current_revision_id,
          markdown: '# Review\nCap: 20\n', reject_conflicts: true, idempotency_key: 'http-conflict' });
        assert.strictEqual(conflict.status, 409, JSON.stringify(conflict.data));
        assert.strictEqual(conflict.data.reason, 'overlapping_edits');
        assert.strictEqual(conflict.data.conflict_count, 1);
        assert.strictEqual(conflict.data.conflicts[0].current, 'Cap: 99\n');
        const stale = await f.api('member', endpoint, 'POST', { target_revision_id: base.current_revision_id,
          markdown: '# Review\nCap: 20\n', expected_current_revision_id: base.current_revision_id, idempotency_key: 'http-stale' });
        assert.strictEqual(stale.status, 409);
        assert.strictEqual(stale.data.current_revision_id, head.current_revision_id);
        assert.strictEqual(f.store.listRevisions({ userId: f.users.bob.id, documentId: base.id }).length, 2);
      });
      await testAsync('HTTP preview protects cross-organization documents and validates guard fields', async () => {
        const endpoint = '/api/cloud/v1/documents/' + base.id + '/revisions/preview';
        const outsider = await f.api('outsider', endpoint, 'POST', { target_revision_id: base.current_revision_id, markdown: '# Probe' });
        assert.strictEqual(outsider.status, 404);
        assert.strictEqual(outsider.data.document, undefined);
        const invalid = await f.api('bob', endpoint, 'POST', { target_revision_id: base.current_revision_id, markdown: '# Probe', reject_conflicts: 'yes' });
        assert.strictEqual(invalid.status, 400);
      });
    } finally { await f.close(); }
  };
};
