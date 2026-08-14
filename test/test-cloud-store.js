const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function(harness) {
  const { assert, test } = harness;
  const { CloudError, createCloudStore, createLocalKeyProvider, deriveMetadata } = require('../lib/cloud-store');

  return function() {
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
    const outsider = 'usr_outsider';
    let personal;
    let team;
    let document;

    test('metadata comes from front matter with normalized tags', () => {
      assert.deepStrictEqual(deriveMetadata('---\ntitle: Plan\ntags:\n  - Alpha\n  - beta\n  - alpha\n---\n# Ignored', 'plan.md'), {
        title: 'Plan', filename: 'plan.md', tags: ['alpha', 'beta'],
      });
      assert.strictEqual(deriveMetadata('# Heading\nBody', 'fallback.md').title, 'Heading');
    });

    test('document and revision pages preserve keyset ordering', () => {
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

    test('Cloud activation creates one personal workspace and default project', () => {
      personal = store.ensurePersonalWorkspace(owner, 'Josh');
      assert.strictEqual(personal.created, true);
      const again = store.ensurePersonalWorkspace(owner, 'Changed');
      assert.strictEqual(again.created, false);
      assert.strictEqual(again.workspaceId, personal.workspaceId);
      assert.deepStrictEqual(store.listWorkspaces(owner).map((row) => row.name), ['Josh']);
      assert.deepStrictEqual(store.listProjects(owner, personal.workspaceId).map((row) => row.name), ['Documents']);
    });

    test('workspace and project names are not stored as plaintext', () => {
      const workspace = store.db.prepare('SELECT * FROM cloud_workspaces WHERE id = ?').get(personal.workspaceId);
      const project = store.db.prepare('SELECT * FROM cloud_projects WHERE id = ?').get(personal.projectId);
      assert.strictEqual(workspace.name_ciphertext.includes(Buffer.from('Josh')), false);
      assert.strictEqual(project.name_ciphertext.includes(Buffer.from('Documents')), false);
    });

    test('team members need an explicit project grant', () => {
      team = store.createTeamWorkspace({ userId: owner, name: 'Acme', projectName: 'Product' });
      store.addWorkspaceMember({ actorUserId: owner, workspaceId: team.workspaceId, userId: member, role: 'member' });
      assert.deepStrictEqual(store.listProjects(member, team.workspaceId), []);
      store.grantProject({ actorUserId: owner, workspaceId: team.workspaceId,
        projectId: team.projectId, userId: member, role: 'viewer' });
      assert.strictEqual(store.listProjects(member, team.workspaceId)[0].role, 'viewer');
    });

    test('an editor creates an encrypted document with an immutable first revision', () => {
      store.grantProject({ actorUserId: owner, workspaceId: team.workspaceId,
        projectId: team.projectId, userId: member, role: 'editor' });
      document = store.createDocument({
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

    test('create retries return the original result and mismatched retries fail', () => {
      const retried = store.createDocument({
        userId: member, projectId: team.projectId, filename: 'roadmap.md',
        markdown: '---\ntags:\n  - planning\n  - Kubernetes\n---\n# Roadmap\nMove to Kubernetes.',
        idempotencyKey: 'create-roadmap',
      });
      assert.strictEqual(retried.id, document.id);
      assert.throws(() => store.createDocument({
        userId: member, projectId: team.projectId, filename: 'other.md', markdown: 'Other',
        idempotencyKey: 'create-roadmap',
      }), (error) => error instanceof CloudError && error.code === 'idempotency_mismatch');
    });

    test('authorized reads authenticate, decrypt, and decompress a revision', () => {
      const opened = store.getDocument({ userId: member, documentId: document.id });
      assert.ok(opened.markdown.includes('Move to Kubernetes'));
      assert.strictEqual(opened.title, 'Roadmap');
      assert.throws(() => store.getDocument({ userId: outsider, documentId: document.id }),
        (error) => error.code === 'resource_unavailable');
    });

    test('expected-head updates create immutable revisions', () => {
      clock += 1000;
      const second = store.saveRevision({
        userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id,
        markdown: '---\ntags:\n  - kubernetes\n---\n# Roadmap\nKubernetes migration complete.', filename: 'roadmap.md',
        idempotencyKey: 'save-roadmap-2',
      });
      assert.strictEqual(second.revision_number, 2);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 2);
      assert.ok(store.getDocument({ userId: member, documentId: document.id,
        revisionId: document.current_revision_id }).markdown.includes('Move to Kubernetes'));
      document = second;
    });

    test('a stale expected head returns a conflict without advancing the document', () => {
      const before = document.current_revision_id;
      assert.throws(() => store.saveRevision({
        userId: member, documentId: document.id, expectedHeadRevisionId: 'stale-revision',
        markdown: '# Bad overwrite', filename: 'roadmap.md', idempotencyKey: 'stale-save',
      }), (error) => error.code === 'revision_conflict' && error.currentRevisionId === before);
      assert.strictEqual(store.getDocument({ userId: member, documentId: document.id }).current_revision_id, before);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 2);
    });

    test('restoring an old revision creates a new immutable audited head', () => {
      const revisions = store.listRevisions({ userId: member, documentId: document.id });
      const source = revisions.find((revision) => revision.revision_number === 1);
      const previousHead = document.current_revision_id;
      clock += 1000;
      const restored = store.restoreRevision({
        userId: member, documentId: document.id, revisionId: source.id,
        expectedHeadRevisionId: previousHead, idempotencyKey: 'restore-roadmap-1',
      });
      assert.strictEqual(restored.revision_number, 3);
      assert.strictEqual(restored.restored_from_revision_id, source.id);
      assert.notStrictEqual(restored.current_revision_id, source.id);
      const opened = store.getDocument({ userId: member, documentId: document.id });
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
      const retried = store.restoreRevision({
        userId: member, documentId: document.id, revisionId: source.id,
        expectedHeadRevisionId: previousHead, idempotencyKey: 'restore-roadmap-1',
      });
      assert.strictEqual(retried.current_revision_id, restored.current_revision_id);
      assert.throws(() => store.restoreRevision({
        userId: member, documentId: document.id, revisionId: source.id,
        expectedHeadRevisionId: previousHead, idempotencyKey: 'stale-restore-roadmap',
      }), (error) => error.code === 'revision_conflict'
        && error.currentRevisionId === restored.current_revision_id);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 3);
      document = restored;
    });

    test('revision pruning keeps the latest snapshots and never deletes the current head', () => {
      let retainedDocument = store.createDocument({
        userId: owner, projectId: personal.projectId, filename: 'retention.md',
        markdown: '# Retention 1', idempotencyKey: 'create-retention',
      });
      for (let number = 2; number <= 4; number += 1) {
        retainedDocument = store.saveRevision({
          userId: owner, documentId: retainedDocument.id,
          expectedHeadRevisionId: retainedDocument.current_revision_id,
          markdown: '# Retention ' + number, filename: 'retention.md',
          idempotencyKey: 'save-retention-' + number,
        });
      }
      const before = store.listRevisions({ userId: owner, documentId: retainedDocument.id });
      const olderHead = before.find((revision) => revision.revision_number === 2);
      const latest = before.find((revision) => revision.revision_number === 4);
      store.db.prepare('UPDATE cloud_documents SET current_revision_id = ? WHERE id = ?')
        .run(olderHead.id, retainedDocument.id);
      const result = store.pruneRevisions({ documentId: retainedDocument.id, keepLatest: 1 });
      assert.strictEqual(result.deleted_count, 2);
      assert.strictEqual(result.retained_count, 2);
      assert.strictEqual(result.current_revision_id, olderHead.id);
      const after = store.listRevisions({ userId: owner, documentId: retainedDocument.id });
      assert.deepStrictEqual(after.map((revision) => revision.id).sort(), [latest.id, olderHead.id].sort());
      assert.strictEqual(store.getDocument({ userId: owner, documentId: retainedDocument.id }).revision_number, 2);
    });

    test('viewer access cannot create, update, or delete content', () => {
      store.grantProject({ actorUserId: owner, workspaceId: team.workspaceId,
        projectId: team.projectId, userId: member, role: 'viewer' });
      assert.throws(() => store.saveRevision({
        userId: member, documentId: document.id, expectedHeadRevisionId: document.current_revision_id,
        markdown: 'Denied', filename: 'roadmap.md', idempotencyKey: 'denied-save',
      }), (error) => error.code === 'resource_unavailable');
      store.grantProject({ actorUserId: owner, workspaceId: team.workspaceId,
        projectId: team.projectId, userId: member, role: 'editor' });
    });

    test('list, tags, and in-memory search return only authorized current documents', () => {
      assert.strictEqual(store.listDocuments({ userId: member }).length, 1);
      assert.deepStrictEqual(store.listTags({ userId: member }), [
        { tag: 'kubernetes', count: 1 },
        { tag: 'planning', count: 1 },
      ]);
      const found = store.search({ userId: member, query: 'kubernetes' });
      assert.strictEqual(found.length, 1);
      assert.strictEqual(found[0].id, document.id);
      assert.strictEqual(store.search({ userId: outsider, query: 'kubernetes' }).length, 0);
      assert.throws(() => store.search({ userId: owner, query: 'missing', maxDocuments: 1 }),
        (error) => error.code === 'search_limit_reached');
    });

    test('delete requires the current head and preserves revisions for restore', () => {
      assert.throws(() => store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: 'stale' }), (error) => error.code === 'revision_conflict');
      const deleted = store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id, restoreWindowMs: 60000 });
      assert.ok(deleted.deleted_at);
      assert.strictEqual(store.listDocuments({ userId: member }).length, 0);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 3);
    });

    test('soft-deleted documents can be restored before purge and exported by the owner', () => {
      const restored = store.restoreDeletedDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id });
      assert.strictEqual(restored.id, document.id);
      assert.strictEqual(store.listDocuments({ userId: member }).length, 1);
      const exported = store.exportWorkspace({ userId: owner, workspaceId: team.workspaceId });
      assert.strictEqual(exported.documents.length, 1);
      assert.strictEqual(exported.documents[0].revisions.length, 3);
      assert.ok(exported.documents[0].markdown.includes('Kubernetes'));
      assert.throws(() => store.exportWorkspace({ userId: member, workspaceId: team.workspaceId }),
        (error) => error.code === 'permission_denied');
      const events = store.listAuditEvents({ userId: owner, workspaceId: team.workspaceId });
      assert.ok(events.some((event) => event.action === 'workspace.export'));
      assert.throws(() => store.listAuditEvents({ userId: member, workspaceId: team.workspaceId }),
        (error) => error.code === 'permission_denied');
    });

    test('expired soft deletes are purged with their encrypted revisions', () => {
      const deleted = store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id, restoreWindowMs: 1000 });
      assert.ok(deleted.purge_after);
      clock += 1001;
      assert.throws(() => store.restoreDeletedDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id }),
      (error) => error.code === 'resource_unavailable');
      const purged = store.purgeDeletedDocuments({ beforeMs: clock });
      assert.strictEqual(purged.purged_count, 1);
      assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM cloud_document_revisions WHERE document_id = ?')
        .get(document.id).count, 0);
    });

    test('ciphertext relocation fails authenticated decryption', () => {
      const protectedDocument = store.createDocument({ userId: owner, projectId: personal.projectId,
        filename: 'protected.md', markdown: '# Protected', idempotencyKey: 'protected-document' });
      const first = store.db.prepare('SELECT * FROM cloud_document_revisions WHERE document_id = ? ORDER BY revision_number')
        .get(protectedDocument.id);
      const corrupted = Buffer.from(first.body_ciphertext);
      corrupted[0] ^= 1;
      store.db.prepare('UPDATE cloud_document_revisions SET body_ciphertext = ? WHERE id = ?')
        .run(corrupted, first.id);
      assert.throws(() => store.getDocument({ userId: owner, documentId: protectedDocument.id,
        revisionId: first.id, includeDeleted: true }), (error) => error.code === 'temporary_service_failure');
    });

    test('an owner can promote an active workspace member without losing ownership', () => {
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

    test('workspace admins can list and revoke only pending invitations in their workspace', () => {
      const invitation = store.createInvitation({ userId: owner, workspaceId: team.workspaceId,
        email: 'pending@example.com', role: 'member', projectGrants: [] });
      const pending = store.listWorkspaceInvitations({ userId: owner, workspaceId: team.workspaceId });
      assert.ok(pending.some((item) => item.id === invitation.id && item.email === 'pending@example.com'));
      assert.throws(() => store.listWorkspaceInvitations({ userId: outsider,
        workspaceId: team.workspaceId }), (error) => error.code === 'permission_denied');
      assert.throws(() => store.revokeWorkspaceInvitation({ userId: owner,
        workspaceId: personal.workspaceId, invitationId: invitation.id }),
      (error) => error.code === 'resource_unavailable');
      const revoked = store.revokeWorkspaceInvitation({ userId: owner,
        workspaceId: team.workspaceId, invitationId: invitation.id });
      assert.strictEqual(revoked.id, invitation.id);
      assert.strictEqual(store.listWorkspaceInvitations({ userId: owner,
        workspaceId: team.workspaceId }).some((item) => item.id === invitation.id), false);
      assert.throws(() => store.getInvitationContext({ token: invitation.token,
        verifiedEmails: ['pending@example.com'] }), (error) => error.code === 'resource_unavailable');
    });

    test('only an owner can soft delete a Team workspace and personal deletion is refused', () => {
      const purgeDocument = store.createDocument({ userId: owner, projectId: team.projectId,
        filename: 'workspace-purge.md', markdown: '# Workspace purge',
        idempotencyKey: 'workspace-purge-document' });
      const purgeRevisionId = purgeDocument.current_revision_id;
      const pendingInvitation = store.createInvitation({ userId: owner, workspaceId: team.workspaceId,
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
      assert.strictEqual(store.listWorkspaces(owner).some((row) => row.id === team.workspaceId), false);
      assert.strictEqual(store.listWorkspaces(member).some((row) => row.id === team.workspaceId), false);
      assert.throws(() => store.listProjects(owner, team.workspaceId),
        (error) => error.code === 'resource_unavailable');
      assert.strictEqual(store.listDocuments({ userId: owner, workspaceId: team.workspaceId }).length, 0);
      assert.strictEqual(store.search({ userId: owner, workspaceId: team.workspaceId,
        query: 'anything' }).length, 0);
      assert.throws(() => store.getInvitationContext({ token: pendingInvitation.token,
        verifiedEmails: ['deleted-workspace@example.com'] }),
      (error) => error.code === 'resource_unavailable');
      const recoverable = store.listDeletedWorkspaces(owner);
      assert.strictEqual(recoverable.length, 1);
      assert.strictEqual(recoverable[0].id, team.workspaceId);
      assert.strictEqual(recoverable[0].name, 'Acme');
      assert.strictEqual(store.listDeletedWorkspaces(outsider).length, 0);
      assert.throws(() => store.restoreWorkspace({ userId: outsider,
        workspaceId: team.workspaceId }), (error) => error.code === 'resource_unavailable');
      const restored = store.restoreWorkspace({ userId: owner, workspaceId: team.workspaceId });
      assert.strictEqual(Date.parse(restored.restored_at), clock);
      assert.strictEqual(store.listDeletedWorkspaces(owner).length, 0);
      assert.strictEqual(store.listWorkspaces(owner).some((row) => row.id === team.workspaceId), true);
      assert.strictEqual(store.listProjects(owner, team.workspaceId).length, 1);
      assert.strictEqual(store.getInvitationContext({ token: pendingInvitation.token,
        verifiedEmails: ['deleted-workspace@example.com'] }).workspaceId, team.workspaceId);
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

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
};
