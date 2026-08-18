const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function createAsyncKms(rootKey) {
  function contextBytes(context) {
    return Buffer.from(JSON.stringify(context), 'utf8');
  }
  return {
    async encrypt(input) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', rootKey, nonce);
      cipher.setAAD(contextBytes(input.encryptionContext));
      const body = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
      return {
        ciphertext: Buffer.concat([nonce, body, cipher.getAuthTag()]),
        keyId: 'kms://odd-solutions/smalldocs/7',
      };
    },
    async decrypt(input) {
      const value = input.ciphertext;
      const nonce = value.subarray(0, 12);
      const body = value.subarray(12, value.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', rootKey, nonce);
      decipher.setAAD(contextBytes(input.encryptionContext));
      decipher.setAuthTag(value.subarray(value.length - 16));
      return { plaintext: Buffer.concat([decipher.update(body), decipher.final()]) };
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

module.exports = function(harness) {
  const { assert, testAsync } = harness;
  const { CloudError, createCloudStore, createLocalKeyProvider, deriveMetadata } = require('../lib/cloud-store');
  const { createManagedKmsKeyProvider } = require('../lib/cloud-kms');

  return async function() {
    console.log('\n-- Cloud Store Tests ----------------------------------\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-store-'));
    let clock = 1700000000000;
    const keyProvider = createLocalKeyProvider({
      masterKey: Buffer.alloc(32, 7), environment: 'test',
    });
    const store = createCloudStore({
      dbPath: path.join(dir, 'cloud.db'), keyProvider,
      idempotencySecret: 'test-idempotency-secret-32-bytes', now: () => clock,
    });
    const owner = 'usr_owner';
    const member = 'usr_member';
    const collaborator = 'usr_collaborator';
    const outsider = 'usr_outsider';
    let personal;
    let team;
    let document;

    await testAsync('metadata comes from front matter with normalized tags', async () => {
      assert.deepStrictEqual(deriveMetadata('---\ntitle: Plan\ntags:\n  - Alpha\n  - beta\n  - alpha\n---\n# Ignored', 'plan.md'), {
        title: 'Plan', filename: 'plan.md', tags: ['alpha', 'beta'],
      });
      assert.strictEqual(deriveMetadata('# Heading\nBody', 'fallback.md').title, 'Heading');
    });

    await testAsync('document and revision pages preserve keyset ordering', async () => {
      const documents = [
        { id: 'doc-a', updated_at: '2026-08-14T12:00:00.000Z' },
        { id: 'doc-b', updated_at: '2026-08-14T12:00:00.000Z' },
        { id: 'doc-c', updated_at: '2026-08-14T11:00:00.000Z' },
      ];
      const firstDocuments = store.pageDocuments(documents, { limit: 2 });
      assert.deepStrictEqual(firstDocuments.documents.map((item) => item.id), ['doc-a', 'doc-b']);
      assert.deepStrictEqual(firstDocuments.nextPosition,
        { updated_at: '2026-08-14T12:00:00.000Z', id: 'doc-b' });
      assert.deepStrictEqual(store.pageDocuments(documents,
        { limit: 2, after: firstDocuments.nextPosition }).documents.map((item) => item.id), ['doc-c']);

      const revisions = [
        { id: 'rev-3', revision_number: 3 },
        { id: 'rev-2', revision_number: 2 },
        { id: 'rev-1', revision_number: 1 },
      ];
      const firstRevisions = store.pageRevisions(revisions, { limit: 1 });
      assert.deepStrictEqual(firstRevisions.revisions.map((item) => item.id), ['rev-3']);
      assert.deepStrictEqual(store.pageRevisions(revisions,
        { limit: 2, after: firstRevisions.nextPosition }).revisions.map((item) => item.id),
      ['rev-2', 'rev-1']);
    });

    await testAsync('Cloud activation creates one personal workspace and default project', async () => {
      personal = await store.ensurePersonalWorkspace(owner, 'Josh');
      assert.strictEqual(personal.created, true);
      const again = await store.ensurePersonalWorkspace(owner, 'Changed');
      assert.strictEqual(again.created, false);
      assert.strictEqual(again.workspaceId, personal.workspaceId);
      assert.deepStrictEqual((await store.listWorkspaces(owner)).map((row) => row.name), ['Josh']);
      assert.deepStrictEqual(store.listWorkspaceMemberships(owner), [
        { id: personal.workspaceId, kind: 'personal', role: 'owner' },
      ]);
      assert.deepStrictEqual((await store.listProjects(owner, personal.workspaceId)).map((row) => row.name), ['Documents']);
    });

    await testAsync('workspace and project names are not stored as plaintext', async () => {
      const workspace = store.db.prepare('SELECT * FROM cloud_workspaces WHERE id = ?').get(personal.workspaceId);
      const project = store.db.prepare('SELECT * FROM cloud_projects WHERE id = ?').get(personal.projectId);
      assert.strictEqual(workspace.name_ciphertext.includes(Buffer.from('Josh')), false);
      assert.strictEqual(project.name_ciphertext.includes(Buffer.from('Documents')), false);
    });

    await testAsync('team members need an explicit project grant', async () => {
      team = await store.createTeamWorkspace({ userId: owner, name: 'Acme', projectName: 'Product' });
      store.addWorkspaceMember({ actorUserId: owner, workspaceId: team.workspaceId, userId: member, role: 'member' });
      assert.deepStrictEqual(await store.listProjects(member, team.workspaceId), []);
      store.grantProject({ actorUserId: owner, workspaceId: team.workspaceId,
        projectId: team.projectId, userId: member, role: 'viewer' });
      assert.strictEqual((await store.listProjects(member, team.workspaceId))[0].role, 'viewer');
    });

    await testAsync('commit authorization can stop encrypted writes at the transaction boundary', async () => {
      const deny = () => { throw new CloudError('subscription_read_only'); };
      const projectCount = store.db.prepare(
        'SELECT COUNT(*) AS count FROM cloud_projects WHERE workspace_id = ?').get(team.workspaceId).count;
      await assert.rejects(store.createProject({
        userId: owner, workspaceId: team.workspaceId, name: 'Blocked', beforeCommit: deny,
      }), (error) => error.code === 'subscription_read_only');
      assert.strictEqual(store.db.prepare(
        'SELECT COUNT(*) AS count FROM cloud_projects WHERE workspace_id = ?').get(team.workspaceId).count,
      projectCount);

      const invitationCount = store.db.prepare(
        'SELECT COUNT(*) AS count FROM cloud_invitations WHERE workspace_id = ?').get(team.workspaceId).count;
      await assert.rejects(store.createInvitation({
        userId: owner, workspaceId: team.workspaceId, email: 'blocked@example.com',
        projectGrants: [], beforeCommit: deny,
      }), (error) => error.code === 'subscription_read_only');
      assert.strictEqual(store.db.prepare(
        'SELECT COUNT(*) AS count FROM cloud_invitations WHERE workspace_id = ?').get(team.workspaceId).count,
      invitationCount);

      const invite = await store.createInvitation({
        userId: owner, workspaceId: team.workspaceId, email: 'outsider@example.com',
        projectGrants: [{ projectId: team.projectId, role: 'viewer' }],
      });
      await assert.rejects(store.acceptInvitation({
        userId: outsider, token: invite.token, verifiedEmails: ['outsider@example.com'], beforeCommit: deny,
      }), (error) => error.code === 'subscription_read_only');
      assert.strictEqual(store.db.prepare(`
        SELECT COUNT(*) AS count FROM cloud_workspace_memberships
        WHERE workspace_id = ? AND user_id = ? AND status = 'active'
      `).get(team.workspaceId, outsider).count, 0);

      const documentCount = store.db.prepare(
        'SELECT COUNT(*) AS count FROM cloud_documents WHERE workspace_id = ?').get(team.workspaceId).count;
      await assert.rejects(store.createDocument({
        userId: owner, projectId: team.projectId, filename: 'blocked.md',
        markdown: '# Blocked', idempotencyKey: 'blocked-create', beforeCommit: deny,
      }), (error) => error.code === 'subscription_read_only');
      assert.strictEqual(store.db.prepare(
        'SELECT COUNT(*) AS count FROM cloud_documents WHERE workspace_id = ?').get(team.workspaceId).count,
      documentCount);
    });

    await testAsync('an editor creates an encrypted document with an immutable first revision', async () => {
      store.grantProject({ actorUserId: owner, workspaceId: team.workspaceId,
        projectId: team.projectId, userId: member, role: 'editor' });
      document = await store.createDocument({
        userId: member, projectId: team.projectId, filename: 'roadmap.md',
        markdown: '---\ntags:\n  - planning\n  - Kubernetes\n---\n# Roadmap\nMove to Kubernetes.',
        idempotencyKey: 'create-roadmap',
      });
      assert.strictEqual(document.revision_number, 1);
      assert.deepStrictEqual(document.tags, ['planning', 'kubernetes']);
      const revision = store.db.prepare('SELECT * FROM cloud_document_revisions WHERE id = ?').get(document.current_revision_id);
      assert.strictEqual(revision.body_ciphertext.includes(Buffer.from('Kubernetes')), false);
      assert.strictEqual(revision.metadata_ciphertext.includes(Buffer.from('roadmap')), false);
      assert.strictEqual(revision.body_nonce.length, 12);
      assert.strictEqual(revision.metadata_nonce.length, 12);
      assert.notDeepStrictEqual(revision.body_nonce, revision.metadata_nonce);
    });

    await testAsync('create retries return the original result and mismatched retries fail', async () => {
      const retried = await store.createDocument({
        userId: member, projectId: team.projectId, filename: 'roadmap.md',
        markdown: '---\ntags:\n  - planning\n  - Kubernetes\n---\n# Roadmap\nMove to Kubernetes.',
        idempotencyKey: 'create-roadmap',
      });
      assert.strictEqual(retried.id, document.id);
      await assert.rejects(() => store.createDocument({
        userId: member, projectId: team.projectId, filename: 'other.md', markdown: 'Other',
        idempotencyKey: 'create-roadmap',
      }), (error) => error instanceof CloudError && error.code === 'idempotency_mismatch');
    });

    await testAsync('authorized reads authenticate, decrypt, and decompress a revision', async () => {
      const opened = await store.getDocument({ userId: member, documentId: document.id });
      assert.ok(opened.markdown.includes('Move to Kubernetes'));
      assert.strictEqual(opened.title, 'Roadmap');
      await assert.rejects(() => store.getDocument({ userId: owner, documentId: document.id }),
        (error) => error.code === 'resource_unavailable');
      await assert.rejects(() => store.getDocument({ userId: outsider, documentId: document.id }),
        (error) => error.code === 'resource_unavailable');
    });

    await testAsync('document permission groups support You, Everyone, and selected members', async () => {
      store.addWorkspaceMember({ actorUserId: owner, workspaceId: team.workspaceId,
        userId: collaborator, role: 'member' });
      assert.deepStrictEqual(store.getDocumentPermission({ userId: member,
        documentId: document.id }).member_user_ids, [member]);
      const custom = store.setDocumentPermission({ userId: member, documentId: document.id,
        mode: 'custom', memberUserIds: [collaborator] });
      assert.strictEqual(custom.mode, 'custom');
      assert.deepStrictEqual(custom.member_user_ids, [member, collaborator]);
      assert.ok((await store.getDocument({ userId: collaborator,
        documentId: document.id })).markdown.includes('Move to Kubernetes'));
      assert.throws(() => store.setDocumentPermission({ userId: collaborator,
        documentId: document.id, mode: 'everyone' }),
      (error) => error.code === 'permission_denied');
      const everyone = store.setDocumentPermission({ userId: member, documentId: document.id,
        mode: 'everyone', memberUserIds: [] });
      assert.strictEqual(everyone.mode, 'everyone');
      assert.ok((await store.getDocument({ userId: owner,
        documentId: document.id })).markdown.includes('Move to Kubernetes'));
      const onlyYou = store.setDocumentPermission({ userId: member, documentId: document.id,
        mode: 'custom', memberUserIds: [] });
      assert.deepStrictEqual(onlyYou.member_user_ids, [member]);
      await assert.rejects(() => store.getDocument({ userId: collaborator,
        documentId: document.id }), (error) => error.code === 'resource_unavailable');
    });

    await testAsync('expected-head updates create immutable revisions', async () => {
      clock += 1000;
      const second = await store.saveRevision({
        userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id,
        markdown: '---\ntags:\n  - kubernetes\n---\n# Roadmap\nKubernetes migration complete.', filename: 'roadmap.md',
        idempotencyKey: 'save-roadmap-2',
      });
      assert.strictEqual(second.revision_number, 2);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 2);
      assert.ok((await store.getDocument({ userId: member, documentId: document.id,
        revisionId: document.current_revision_id })).markdown.includes('Move to Kubernetes'));
      document = second;
    });

    await testAsync('a stale expected head returns a conflict without advancing the document', async () => {
      const before = document.current_revision_id;
      await assert.rejects(() => store.saveRevision({
        userId: member, documentId: document.id, expectedHeadRevisionId: 'stale-revision',
        markdown: '# Bad overwrite', filename: 'roadmap.md', idempotencyKey: 'stale-save',
      }), (error) => error.code === 'revision_conflict' && error.currentRevisionId === before);
      assert.strictEqual((await store.getDocument({ userId: member, documentId: document.id })).current_revision_id, before);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 2);
    });

    await testAsync('commit authorization blocks revision writes after encryption', async () => {
      const deny = () => { throw new CloudError('subscription_read_only'); };
      const before = document.current_revision_id;
      const revisionCount = store.listRevisions({ userId: member, documentId: document.id }).length;
      await assert.rejects(store.saveRevision({
        userId: member, documentId: document.id, expectedHeadRevisionId: before,
        markdown: '# Blocked save', filename: 'roadmap.md', idempotencyKey: 'blocked-save',
        beforeCommit: deny,
      }), (error) => error.code === 'subscription_read_only');
      assert.strictEqual((await store.getDocument({
        userId: member, documentId: document.id,
      })).current_revision_id, before);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length,
        revisionCount);

      const source = store.listRevisions({ userId: member, documentId: document.id })
        .find((revision) => revision.revision_number === 1);
      await assert.rejects(store.restoreRevision({
        userId: member, documentId: document.id, revisionId: source.id,
        expectedHeadRevisionId: before, idempotencyKey: 'blocked-restore', beforeCommit: deny,
      }), (error) => error.code === 'subscription_read_only');
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length,
        revisionCount);
    });

    await testAsync('restoring an old revision creates a new immutable audited head', async () => {
      const revisions = store.listRevisions({ userId: member, documentId: document.id });
      const source = revisions.find((revision) => revision.revision_number === 1);
      const previousHead = document.current_revision_id;
      clock += 1000;
      const restored = await store.restoreRevision({
        userId: member, documentId: document.id, revisionId: source.id,
        expectedHeadRevisionId: previousHead, idempotencyKey: 'restore-roadmap-1',
      });
      assert.strictEqual(restored.revision_number, 3);
      assert.strictEqual(restored.restored_from_revision_id, source.id);
      assert.notStrictEqual(restored.current_revision_id, source.id);
      const opened = await store.getDocument({ userId: member, documentId: document.id });
      assert.ok(opened.markdown.includes('Move to Kubernetes'));
      const restoredRow = store.db.prepare('SELECT * FROM cloud_document_revisions WHERE id = ?')
        .get(restored.current_revision_id);
      assert.strictEqual(restoredRow.parent_revision_id, previousHead);
      const sourceRow = store.db.prepare('SELECT * FROM cloud_document_revisions WHERE id = ?').get(source.id);
      assert.notDeepStrictEqual(restoredRow.body_ciphertext, sourceRow.body_ciphertext);
      const audit = store.db.prepare(`
        SELECT action FROM cloud_audit_events
        WHERE resource_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1
      `).get(document.id);
      assert.strictEqual(audit.action, 'document.revision.restore');
      const retried = await store.restoreRevision({
        userId: member, documentId: document.id, revisionId: source.id,
        expectedHeadRevisionId: previousHead, idempotencyKey: 'restore-roadmap-1',
      });
      assert.strictEqual(retried.current_revision_id, restored.current_revision_id);
      await assert.rejects(() => store.restoreRevision({
        userId: member, documentId: document.id, revisionId: source.id,
        expectedHeadRevisionId: previousHead, idempotencyKey: 'stale-restore-roadmap',
      }), (error) => error.code === 'revision_conflict'
        && error.currentRevisionId === restored.current_revision_id);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 3);
      document = restored;
    });

    await testAsync('revision pruning keeps three recent restore points for at most 90 days', async () => {
      let retainedDocument = await store.createDocument({
        userId: owner, projectId: personal.projectId, filename: 'retention.md',
        markdown: '# Retention 1', idempotencyKey: 'create-retention',
      });
      for (let number = 2; number <= 5; number += 1) {
        clock += 1000;
        retainedDocument = await store.saveRevision({
          userId: owner, documentId: retainedDocument.id,
          expectedHeadRevisionId: retainedDocument.current_revision_id,
          markdown: '# Retention ' + number, filename: 'retention.md',
          idempotencyKey: 'save-retention-' + number,
        });
      }
      const recent = store.pruneRevisions({ documentId: retainedDocument.id, keepPrevious: 3,
        retainAfterMs: clock - 90 * 24 * 60 * 60 * 1000 });
      assert.strictEqual(recent.deleted_count, 1);
      assert.strictEqual(recent.retained_count, 4);
      assert.strictEqual(recent.oldest_retained_previous_created_at_ms, clock - 3000);
      assert.deepStrictEqual(store.listRevisions({ userId: owner, documentId: retainedDocument.id })
        .map((revision) => revision.revision_number), [5, 4, 3, 2]);

      clock += 90 * 24 * 60 * 60 * 1000 + 1;
      const expired = store.pruneRevisions({ documentId: retainedDocument.id, keepPrevious: 3,
        retainAfterMs: clock - 90 * 24 * 60 * 60 * 1000 });
      assert.strictEqual(expired.deleted_count, 3);
      assert.strictEqual(expired.retained_count, 1);
      assert.strictEqual(expired.oldest_retained_previous_created_at_ms, null);
      assert.deepStrictEqual(store.listRevisions({ userId: owner, documentId: retainedDocument.id })
        .map((revision) => revision.revision_number), [5]);
      assert.strictEqual((await store.getDocument({ userId: owner,
        documentId: retainedDocument.id })).revision_number, 5);
    });

    await testAsync('the document owner keeps edit access when a legacy project role changes', async () => {
      store.grantProject({ actorUserId: owner, workspaceId: team.workspaceId,
        projectId: team.projectId, userId: member, role: 'viewer' });
      assert.strictEqual(store.getDocumentPermission({ userId: member,
        documentId: document.id }).can_manage, true);
      store.grantProject({ actorUserId: owner, workspaceId: team.workspaceId,
        projectId: team.projectId, userId: member, role: 'editor' });
    });

    await testAsync('list, tags, and in-memory search return only authorized current documents', async () => {
      assert.strictEqual((await store.listDocuments({ userId: member })).length, 1);
      assert.deepStrictEqual(await store.listTags({ userId: member }), [
        { tag: 'kubernetes', count: 1 },
        { tag: 'planning', count: 1 },
      ]);
      const found = await store.search({ userId: member, query: 'kubernetes' });
      assert.strictEqual(found.length, 1);
      assert.strictEqual(found[0].id, document.id);
      assert.strictEqual(found[0].matches[0].line, 4);
      assert.strictEqual((await store.search({ userId: member, query: 'kubernetes',
        tags: ['planning'], limit: 1 })).length, 1);
      assert.strictEqual((await store.search({ userId: member, query: 'kubernetes',
        tags: ['another-tag'], limit: 1 })).length, 0);
      assert.strictEqual((await store.search({ userId: outsider, query: 'kubernetes' })).length, 0);
      assert.deepStrictEqual(await store.search({ userId: owner,
        query: 'missing', maxDocuments: 1 }), []);
    });

    await testAsync('delete requires the current head and preserves revisions for restore', async () => {
      assert.throws(() => store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: 'stale' }), (error) => error.code === 'revision_conflict');
      const deleted = store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id, restoreWindowMs: 60000 });
      assert.ok(deleted.deleted_at);
      assert.deepStrictEqual(store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id }), deleted);
      const recoverable = await store.listDeletedDocuments({ userId: member });
      assert.strictEqual(recoverable.length, 1);
      assert.strictEqual(recoverable[0].id, document.id);
      assert.strictEqual(recoverable[0].project.name, 'Product');
      assert.strictEqual((await store.listDocuments({ userId: member })).length, 0);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 3);
    });

    await testAsync('soft-deleted documents can be restored before purge and exported by the owner', async () => {
      const restored = await store.restoreDeletedDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id });
      assert.strictEqual(restored.id, document.id);
      assert.strictEqual((await store.listDeletedDocuments({ userId: member })).length, 0);
      assert.strictEqual((await store.listDocuments({ userId: member })).length, 1);
      const exported = await store.exportWorkspace({ userId: owner, workspaceId: team.workspaceId });
      assert.strictEqual(exported.documents.length, 0);
      await assert.rejects(() => store.exportWorkspace({ userId: member, workspaceId: team.workspaceId }),
        (error) => error.code === 'permission_denied');
      const events = store.listAuditEvents({ userId: owner, workspaceId: team.workspaceId });
      assert.ok(events.some((event) => event.action === 'workspace.export'));
      assert.throws(() => store.listAuditEvents({ userId: member, workspaceId: team.workspaceId }),
        (error) => error.code === 'permission_denied');
    });

    await testAsync('expired soft deletes are purged with their encrypted revisions', async () => {
      const deleted = store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id, restoreWindowMs: 1000 });
      assert.ok(deleted.purge_after);
      clock += 1001;
      await assert.rejects(() => store.restoreDeletedDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id }),
      (error) => error.code === 'resource_unavailable');
      const purged = store.purgeDeletedDocuments({ beforeMs: clock });
      assert.strictEqual(purged.purged_count, 1);
      assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM cloud_document_revisions WHERE document_id = ?')
        .get(document.id).count, 0);
    });

    await testAsync('ciphertext relocation fails authenticated decryption', async () => {
      const protectedDocument = await store.createDocument({ userId: owner, projectId: personal.projectId,
        filename: 'protected.md', markdown: '# Protected', idempotencyKey: 'protected-document' });
      const first = store.db.prepare('SELECT * FROM cloud_document_revisions WHERE document_id = ? ORDER BY revision_number')
        .get(protectedDocument.id);
      const corrupted = Buffer.from(first.body_ciphertext);
      corrupted[0] ^= 1;
      store.db.prepare('UPDATE cloud_document_revisions SET body_ciphertext = ? WHERE id = ?')
        .run(corrupted, first.id);
      await assert.rejects(() => store.getDocument({ userId: owner, documentId: protectedDocument.id,
        revisionId: first.id, includeDeleted: true }), (error) => error.code === 'temporary_service_failure');
    });

    await testAsync('an owner can promote an active workspace member without losing ownership', async () => {
      const result = store.transferWorkspaceOwnership({ actorUserId: owner,
        workspaceId: team.workspaceId, targetUserId: member });
      assert.strictEqual(result.owner_user_id, member);
      assert.strictEqual(result.retained_owner_user_id, owner);
      const roles = store.listWorkspaceMembers({ userId: owner, workspaceId: team.workspaceId })
        .filter((row) => row.user_id === owner || row.user_id === member)
        .map((row) => row.role).sort();
      assert.deepStrictEqual(roles, ['owner', 'owner']);
      assert.throws(() => store.transferWorkspaceOwnership({ actorUserId: outsider,
        workspaceId: team.workspaceId, targetUserId: owner }),
      (error) => error.code === 'permission_denied');
      assert.throws(() => store.transferWorkspaceOwnership({ actorUserId: owner,
        workspaceId: team.workspaceId, targetUserId: outsider }),
      (error) => error.code === 'resource_unavailable');
      const events = store.listAuditEvents({ userId: owner, workspaceId: team.workspaceId });
      assert.ok(events.some((event) => event.action === 'workspace.owner.add' &&
        event.resource_id === member));
    });

    await testAsync('workspace admins can list and revoke only pending invitations in their workspace', async () => {
      const invitation = await store.createInvitation({ userId: owner, workspaceId: team.workspaceId,
        email: 'pending@example.com', role: 'member', projectGrants: [] });
      const pending = await store.listWorkspaceInvitations({ userId: owner, workspaceId: team.workspaceId });
      assert.ok(pending.some((item) => item.id === invitation.id && item.email === 'pending@example.com'));
      await assert.rejects(() => store.listWorkspaceInvitations({ userId: outsider,
        workspaceId: team.workspaceId }), (error) => error.code === 'permission_denied');
      assert.throws(() => store.revokeWorkspaceInvitation({ userId: owner,
        workspaceId: personal.workspaceId, invitationId: invitation.id }),
      (error) => error.code === 'resource_unavailable');
      const revoked = store.revokeWorkspaceInvitation({ userId: owner,
        workspaceId: team.workspaceId, invitationId: invitation.id });
      assert.strictEqual(revoked.id, invitation.id);
      assert.strictEqual((await store.listWorkspaceInvitations({ userId: owner,
        workspaceId: team.workspaceId })).some((item) => item.id === invitation.id), false);
      await assert.rejects(() => store.getInvitationContext({ token: invitation.token,
        verifiedEmails: ['pending@example.com'] }), (error) => error.code === 'resource_unavailable');
    });

    await testAsync('only an owner can soft delete a Team workspace and personal deletion is refused', async () => {
      const purgeDocument = await store.createDocument({ userId: owner, projectId: team.projectId,
        filename: 'workspace-purge.md', markdown: '# Workspace purge',
        idempotencyKey: 'workspace-purge-document' });
      const purgeRevisionId = purgeDocument.current_revision_id;
      const pendingInvitation = await store.createInvitation({ userId: owner, workspaceId: team.workspaceId,
        email: 'deleted-workspace@example.com', role: 'member', projectGrants: [] });
      assert.throws(() => store.deleteWorkspace({ userId: owner,
        workspaceId: personal.workspaceId }),
      (error) => error.code === 'personal_workspace_cannot_be_deleted');
      assert.throws(() => store.deleteWorkspace({ userId: outsider,
        workspaceId: team.workspaceId }),
      (error) => error.code === 'permission_denied');
      const deleted = store.deleteWorkspace({ userId: owner,
        workspaceId: team.workspaceId, restoreWindowMs: 1000 });
      assert.strictEqual(Date.parse(deleted.deleted_at), clock);
      assert.strictEqual(Date.parse(deleted.purge_after), clock + 1000);
      assert.strictEqual((await store.listWorkspaces(owner)).some((row) => row.id === team.workspaceId), false);
      assert.strictEqual((await store.listWorkspaces(member)).some((row) => row.id === team.workspaceId), false);
      await assert.rejects(() => store.listProjects(owner, team.workspaceId),
        (error) => error.code === 'resource_unavailable');
      assert.strictEqual((await store.listDocuments({ userId: owner,
        workspaceId: team.workspaceId })).length, 0);
      assert.strictEqual((await store.search({ userId: owner, workspaceId: team.workspaceId,
        query: 'anything' })).length, 0);
      await assert.rejects(() => store.getInvitationContext({ token: pendingInvitation.token,
        verifiedEmails: ['deleted-workspace@example.com'] }),
      (error) => error.code === 'resource_unavailable');
      const recoverable = await store.listDeletedWorkspaces(owner);
      assert.strictEqual(recoverable.length, 1);
      assert.strictEqual(recoverable[0].id, team.workspaceId);
      assert.strictEqual(recoverable[0].name, 'Acme');
      assert.strictEqual((await store.listDeletedWorkspaces(outsider)).length, 0);
      assert.throws(() => store.restoreWorkspace({ userId: outsider,
        workspaceId: team.workspaceId }), (error) => error.code === 'resource_unavailable');
      const restored = store.restoreWorkspace({ userId: owner, workspaceId: team.workspaceId });
      assert.strictEqual(Date.parse(restored.restored_at), clock);
      assert.strictEqual((await store.listDeletedWorkspaces(owner)).length, 0);
      assert.strictEqual((await store.listWorkspaces(owner)).some((row) => row.id === team.workspaceId), true);
      assert.strictEqual((await store.listProjects(owner, team.workspaceId)).length, 1);
      assert.strictEqual((await store.getInvitationContext({ token: pendingInvitation.token,
        verifiedEmails: ['deleted-workspace@example.com'] })).workspaceId, team.workspaceId);
      store.deleteWorkspace({ userId: owner, workspaceId: team.workspaceId, restoreWindowMs: 1000 });
      assert.strictEqual(store.purgeDeletedWorkspaces({ beforeMs: clock,
        workspaceId: team.workspaceId }).purged_count, 0);
      clock += 1001;
      assert.strictEqual(store.purgeDeletedWorkspaces({ beforeMs: clock,
        workspaceId: team.workspaceId }).purged_count, 1);
      assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM cloud_workspaces WHERE id = ?')
        .get(team.workspaceId).count, 0);
      assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM cloud_projects WHERE workspace_id = ?')
        .get(team.workspaceId).count, 0);
      assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM cloud_documents WHERE id = ?')
        .get(purgeDocument.id).count, 0);
      assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM cloud_document_revisions WHERE id = ?')
        .get(purgeRevisionId).count, 0);
      assert.strictEqual(store.db.prepare(`
        SELECT COUNT(*) AS count FROM cloud_idempotency_records
        WHERE resource_id = ? OR resource_id = ?
      `).get(team.projectId, purgeDocument.id).count, 0);
    });

    await testAsync('an asynchronous managed KMS provider round-trips store content', async () => {
      const managedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-store-managed-'));
      const workingKms = createAsyncKms(Buffer.alloc(32, 21));
      let kmsUnavailable = false;
      const managedProvider = createManagedKmsKeyProvider({
        kmsClient: {
          encrypt(input) {
            if (kmsUnavailable) return Promise.reject(new Error('KMS unavailable'));
            return workingKms.encrypt(input);
          },
          decrypt(input) {
            if (kmsUnavailable) return Promise.reject(new Error('KMS unavailable'));
            return workingKms.decrypt(input);
          },
        },
        keyId: 'kms://odd-solutions/smalldocs', environment: 'test',
      });
      const managedStore = createCloudStore({
        dbPath: path.join(managedDir, 'cloud.db'), keyProvider: managedProvider,
        idempotencySecret: 'managed-idempotency-secret-32-bytes',
      });
      try {
        const workspace = await managedStore.ensurePersonalWorkspace('managed-user', 'Managed');
        const created = await managedStore.createDocument({
          userId: 'managed-user', projectId: workspace.projectId,
          filename: 'managed.md', markdown: '# Managed\n\nEncrypted asynchronously.',
          idempotencyKey: 'managed-create',
        });
        const opened = await managedStore.getDocument({
          userId: 'managed-user', documentId: created.id,
        });
        assert.strictEqual(opened.markdown, '# Managed\n\nEncrypted asynchronously.');
        assert.deepStrictEqual((await managedStore.listProjects(
          'managed-user', workspace.workspaceId)).map((project) => project.name), ['Documents']);
        managedProvider.clearCache();
        kmsUnavailable = true;
        const replayed = await managedStore.createDocument({
          userId: 'managed-user', projectId: workspace.projectId,
          filename: 'managed.md', markdown: '# Managed\n\nEncrypted asynchronously.',
          idempotencyKey: 'managed-create',
        });
        assert.strictEqual(replayed.id, created.id);
        assert.strictEqual(replayed.current_revision_id, created.current_revision_id);
        await assert.rejects(managedStore.createDocument({
          userId: 'managed-user', projectId: workspace.projectId,
          filename: 'changed.md', markdown: '# Changed', idempotencyKey: 'managed-create',
        }), (error) => error.code === 'idempotency_mismatch');
      } finally {
        managedStore.close();
        managedProvider.clearCache();
        fs.rmSync(managedDir, { recursive: true, force: true });
      }
    });

    await testAsync('KMS failure while preparing a restore leaves the document deleted', async () => {
      const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-store-restore-'));
      const workingKms = createAsyncKms(Buffer.alloc(32, 22));
      let failDecrypt = false;
      const restoreProvider = createManagedKmsKeyProvider({
        kmsClient: {
          encrypt: (input) => workingKms.encrypt(input),
          decrypt(input) {
            if (failDecrypt) return Promise.reject(new Error('KMS unavailable'));
            return workingKms.decrypt(input);
          },
        },
        keyId: 'kms://odd-solutions/smalldocs', environment: 'test',
      });
      const restoreStore = createCloudStore({
        dbPath: path.join(restoreDir, 'cloud.db'), keyProvider: restoreProvider,
        idempotencySecret: 'restore-idempotency-secret-32-bytes',
      });
      try {
        const workspace = await restoreStore.ensurePersonalWorkspace('restore-user', 'Restore');
        const created = await restoreStore.createDocument({
          userId: 'restore-user', projectId: workspace.projectId,
          filename: 'restore.md', markdown: '# Restore', idempotencyKey: 'restore-create',
        });
        restoreStore.deleteDocument({ userId: 'restore-user', documentId: created.id,
          expectedHeadRevisionId: created.current_revision_id });
        restoreProvider.clearCache();
        failDecrypt = true;
        await assert.rejects(restoreStore.restoreDeletedDocument({
          userId: 'restore-user', documentId: created.id,
          expectedHeadRevisionId: created.current_revision_id,
        }), (error) => error.code === 'temporary_service_failure');
        const row = restoreStore.db.prepare(
          'SELECT deleted_at_ms FROM cloud_documents WHERE id = ?').get(created.id);
        assert.notStrictEqual(row.deleted_at_ms, null);
        failDecrypt = false;
        restoreProvider.clearCache();
        await assert.rejects(restoreStore.restoreDeletedDocument({
          userId: 'restore-user', documentId: created.id,
          expectedHeadRevisionId: created.current_revision_id,
          beforeCommit() { throw new CloudError('subscription_read_only'); },
        }), (error) => error.code === 'subscription_read_only');
        assert.notStrictEqual(restoreStore.db.prepare(
          'SELECT deleted_at_ms FROM cloud_documents WHERE id = ?').get(created.id).deleted_at_ms, null);
      } finally {
        restoreStore.close();
        restoreProvider.clearCache();
        fs.rmSync(restoreDir, { recursive: true, force: true });
      }
    });

    await testAsync('revoked access cannot return plaintext after an awaited KMS decrypt', async () => {
      const revokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-store-revoke-'));
      const workingKms = createAsyncKms(Buffer.alloc(32, 23));
      const decryptStarted = deferred();
      const releaseDecrypt = deferred();
      let blockDecrypt = false;
      const revokeProvider = createManagedKmsKeyProvider({
        kmsClient: {
          encrypt: (input) => workingKms.encrypt(input),
          decrypt(input) {
            if (!blockDecrypt) return workingKms.decrypt(input);
            decryptStarted.resolve();
            return releaseDecrypt.promise.then(() => workingKms.decrypt(input));
          },
        },
        keyId: 'kms://odd-solutions/smalldocs', environment: 'test',
      });
      const revokeStore = createCloudStore({
        dbPath: path.join(revokeDir, 'cloud.db'), keyProvider: revokeProvider,
        idempotencySecret: 'revoke-idempotency-secret-32-bytes',
      });
      try {
        const workspace = await revokeStore.createTeamWorkspace({
          userId: 'revoke-owner', name: 'Revoke', projectName: 'Documents',
        });
        revokeStore.addWorkspaceMember({ actorUserId: 'revoke-owner', workspaceId: workspace.workspaceId,
          userId: 'revoked-member', role: 'member' });
        revokeStore.grantProject({ actorUserId: 'revoke-owner', workspaceId: workspace.workspaceId,
          projectId: workspace.projectId, userId: 'revoked-member', role: 'viewer' });
        const created = await revokeStore.createDocument({
          userId: 'revoke-owner', projectId: workspace.projectId,
          filename: 'revoked.md', markdown: '# Must not be returned', idempotencyKey: 'revoke-create',
        });
        revokeStore.setDocumentPermission({ userId: 'revoke-owner', documentId: created.id,
          mode: 'custom', memberUserIds: ['revoked-member'] });
        revokeProvider.clearCache();
        blockDecrypt = true;
        const opening = revokeStore.getDocument({ userId: 'revoked-member', documentId: created.id });
        await decryptStarted.promise;
        revokeStore.removeWorkspaceMember({ actorUserId: 'revoke-owner', workspaceId: workspace.workspaceId,
          userId: 'revoked-member' });
        releaseDecrypt.resolve();
        await assert.rejects(opening, (error) => error.code === 'resource_unavailable');
      } finally {
        releaseDecrypt.resolve();
        revokeStore.close();
        revokeProvider.clearCache();
        fs.rmSync(revokeDir, { recursive: true, force: true });
      }
    });

    await testAsync('managed KMS failure leaves workspace creation atomic and hides provider codes', async () => {
      const failedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-store-kms-failure-'));
      const failedProvider = createManagedKmsKeyProvider({
        kmsClient: {
          async encrypt() { throw Object.assign(new Error('provider detail'), { code: 'provider_secret_code' }); },
          async decrypt() { throw new Error('not reached'); },
        },
        keyId: 'kms://odd-solutions/smalldocs', environment: 'test',
      });
      const failedStore = createCloudStore({
        dbPath: path.join(failedDir, 'cloud.db'), keyProvider: failedProvider,
        idempotencySecret: 'failed-idempotency-secret-32-bytes',
      });
      try {
        await assert.rejects(
          failedStore.ensurePersonalWorkspace('failed-user', 'Failure'),
          (error) => error instanceof CloudError && error.code === 'temporary_service_failure' &&
            !String(error.message).includes('provider_secret_code') && error.cause === undefined,
        );
        assert.strictEqual(failedStore.db.prepare(
          'SELECT COUNT(*) AS count FROM cloud_workspaces').get().count, 0);
        assert.strictEqual(failedStore.db.prepare(
          'SELECT COUNT(*) AS count FROM cloud_projects').get().count, 0);
      } finally {
        failedStore.close();
        failedProvider.clearCache();
        fs.rmSync(failedDir, { recursive: true, force: true });
      }
    });

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
};
