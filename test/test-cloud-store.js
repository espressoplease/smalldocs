const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SDocYaml = require('../cli/shared/sdocs-yaml');
const { mergeTargetRevision } = require('../lib/cloud-merge');

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
  const { CloudError, createCloudStore, createLocalKeyProvider, deriveMetadata,
    defaultInviteDomainFromEmail } = require('../lib/cloud-store');
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
    const mergeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-merge-store-'));
    const mergeStore = createCloudStore({
      dbPath: path.join(mergeDir, 'cloud.db'), keyProvider,
      idempotencySecret: 'merge-idempotency-secret-32-bytes', now: () => clock,
    });
    const owner = 'usr_owner';
    const member = 'usr_member';
    const collaborator = 'usr_collaborator';
    const outsider = 'usr_outsider';
    let personal;
    let team;
    let document;
    let mergePersonal;
    let targetDocument;

    await testAsync('target merge applies a proposal unchanged when its target is current', async () => {
      const merged = mergeTargetRevision('# Plan\n\nOriginal.\n', '# Plan\n\nOriginal.\n',
        '# Plan\n\nUpdated.\n');
      assert.strictEqual(merged.markdown, '# Plan\n\nUpdated.\n');
      assert.strictEqual(merged.classification, 'clean');
      assert.strictEqual(merged.combined, false);
    });

    await testAsync('target merge combines edits to separate Markdown lines', async () => {
      const base = '# Plan\n\nOwner: Ana\n\nStatus: Draft\n';
      const current = '# Plan\n\nOwner: Josh\n\nStatus: Draft\n';
      const proposed = '# Plan\n\nOwner: Ana\n\nStatus: Ready\n';
      const merged = mergeTargetRevision(base, current, proposed);
      assert.strictEqual(merged.markdown, '# Plan\n\nOwner: Josh\n\nStatus: Ready\n');
      assert.strictEqual(merged.classification, 'rebased');
      assert.strictEqual(merged.combined, false);
    });

    await testAsync('target merge preserves both overlapping paragraph replacements', async () => {
      const base = '# Plan\n\nThe launch is on Monday.\n';
      const current = '# Plan\n\nThe launch is on Tuesday.\n';
      const proposed = '# Plan\n\nThe launch is after legal review.\n';
      const merged = mergeTargetRevision(base, current, proposed);
      assert.ok(merged.markdown.includes('The launch is on Tuesday.'));
      assert.ok(merged.markdown.includes('The launch is after legal review.'));
      assert.strictEqual(merged.classification, 'combined');
      assert.strictEqual(merged.combined, true);
    });

    await testAsync('target merge keeps an insertion made inside a concurrently deleted range', async () => {
      const base = '# Plan\n\nKeep this section.\n\nDelete this section.\n\nEnd.\n';
      const current = '# Plan\n\nEnd.\n';
      const proposed = '# Plan\n\nKeep this section.\n\nNew collaborator text.\n\nDelete this section.\n\nEnd.\n';
      const merged = mergeTargetRevision(base, current, proposed);
      assert.ok(merged.markdown.includes('New collaborator text.'));
      assert.strictEqual(merged.classification, 'combined');
    });

    await testAsync('target merge keeps concurrent Cloud comments with unique ids and names', async () => {
      const body = '# Review\n\nShared paragraph.\n';
      const base = body;
      const current = SDocYaml.serializeFrontMatter({ comments: [{
        id: 'c1', kind: 'block', block: 'p:0', author: 'Ana Bell', text: 'Ana note',
      }] }) + '\n' + body;
      const proposed = SDocYaml.serializeFrontMatter({ comments: [{
        id: 'c1', kind: 'block', block: 'p:0', author: 'Josh Summers', text: 'Josh note',
      }] }) + '\n' + body;
      const merged = mergeTargetRevision(base, current, proposed);
      const parsed = SDocYaml.parseFrontMatter(merged.markdown);
      assert.strictEqual(parsed.body, body);
      assert.strictEqual(parsed.meta.comments.length, 2);
      assert.deepStrictEqual(parsed.meta.comments.map((comment) => comment.author).sort(),
        ['Ana Bell', 'Josh Summers']);
      assert.strictEqual(new Set(parsed.meta.comments.map((comment) => comment.id)).size, 2);
      assert.strictEqual(merged.classification, 'combined');
    });

    await testAsync('existing notification batches gain encrypted note columns', async () => {
      const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-note-migration-'));
      const migrationPath = path.join(migrationDir, 'cloud.db');
      const Database = require('better-sqlite3');
      const legacy = new Database(migrationPath);
      legacy.exec(`
        CREATE TABLE cloud_notification_batches (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          actor_user_id TEXT NOT NULL,
          actor_credential_id TEXT,
          idempotency_key TEXT NOT NULL,
          request_digest TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          UNIQUE(actor_user_id, idempotency_key)
        )
      `);
      legacy.close();
      const migrated = createCloudStore({ dbPath: migrationPath, keyProvider,
        idempotencySecret: 'migration-idempotency-secret-32-bytes' });
      try {
        const columns = migrated.db.prepare(
          'PRAGMA table_info(cloud_notification_batches)').all().map((column) => column.name);
        assert.ok(columns.includes('note_ciphertext'));
        assert.ok(columns.includes('note_nonce'));
      } finally {
        migrated.close();
        fs.rmSync(migrationDir, { recursive: true, force: true });
      }
    });

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

    await testAsync('workspace administration stays opaque outside the account', async () => {
      const unavailable = (error) => error.code === 'resource_unavailable';
      const denied = (error) => error.code === 'permission_denied';

      await assert.rejects(store.createProject({ userId: outsider,
        workspaceId: team.workspaceId, name: 'Outside project' }), unavailable);
      assert.throws(() => store.listWorkspaceMembers({ userId: outsider,
        workspaceId: team.workspaceId }), unavailable);
      assert.throws(() => store.setWorkspaceInviteDomains({ userId: outsider,
        workspaceId: team.workspaceId, domains: ['outside.example'] }), unavailable);
      await assert.rejects(store.createInvitation({ userId: outsider,
        workspaceId: team.workspaceId, email: 'outside@example.com', role: 'member',
        projectGrants: [] }), unavailable);
      await assert.rejects(store.listWorkspaceInvitations({ userId: outsider,
        workspaceId: team.workspaceId }), unavailable);
      assert.throws(() => store.revokeWorkspaceInvitation({ userId: outsider,
        workspaceId: team.workspaceId, invitationId: 'missing' }), unavailable);
      assert.throws(() => store.removeWorkspaceMember({ actorUserId: outsider,
        workspaceId: team.workspaceId, userId: member }), unavailable);
      assert.throws(() => store.grantProject({ actorUserId: outsider,
        workspaceId: team.workspaceId, projectId: team.projectId,
        userId: member, role: 'viewer' }), unavailable);
      assert.throws(() => store.transferWorkspaceOwnership({ actorUserId: outsider,
        workspaceId: team.workspaceId, targetUserId: member }), unavailable);
      assert.throws(() => store.deleteWorkspace({ userId: outsider,
        workspaceId: team.workspaceId }), unavailable);
      await assert.rejects(store.exportWorkspace({ userId: outsider,
        workspaceId: team.workspaceId }), unavailable);
      assert.throws(() => store.listAuditEvents({ userId: outsider,
        workspaceId: team.workspaceId }), unavailable);

      await assert.rejects(store.createProject({ userId: member,
        workspaceId: team.workspaceId, name: 'Member project' }), denied);
      assert.throws(() => store.listWorkspaceMembers({ userId: member,
        workspaceId: team.workspaceId }), denied);
      await assert.rejects(store.exportWorkspace({ userId: member,
        workspaceId: team.workspaceId }), denied);
      assert.throws(() => store.listAuditEvents({ userId: member,
        workspaceId: team.workspaceId }), denied);
    });

    await testAsync('team invite defaults use company email domains but not public providers', async () => {
      assert.strictEqual(defaultInviteDomainFromEmail('Owner@Acme.com'), 'acme.com');
      assert.strictEqual(defaultInviteDomainFromEmail('owner@gmail.com'), null);
      assert.strictEqual(defaultInviteDomainFromEmail('not-an-email'), null);
      const seeded = await store.createTeamWorkspace({
        userId: owner, name: 'Seeded', inviteDomains: ['@Example.org'],
      });
      assert.deepStrictEqual(store.getWorkspaceInvitePolicy({
        userId: owner, workspaceId: seeded.workspaceId,
      }).domains, ['example.org']);
    });

    await testAsync('admins approve company domains and members invite only within them', async () => {
      assert.deepStrictEqual(store.getWorkspaceInvitePolicy({ userId: member,
        workspaceId: team.workspaceId }), {
        domains: [], can_manage: false, can_invite: false,
      });
      assert.throws(() => store.setWorkspaceInviteDomains({ userId: owner,
        workspaceId: team.workspaceId, domains: ['gmail.com'] }),
      (error) => error.code === 'public_email_domain');
      assert.throws(() => store.setWorkspaceInviteDomains({ userId: member,
        workspaceId: team.workspaceId, domains: ['acme.com'] }),
      (error) => error.code === 'permission_denied');

      assert.deepStrictEqual(store.setWorkspaceInviteDomains({ userId: owner,
        workspaceId: team.workspaceId, domains: ['@Acme.com', 'acme.com'] }), {
        domains: ['acme.com'], can_manage: true, can_invite: true,
      });
      assert.deepStrictEqual(store.getWorkspaceInvitePolicy({ userId: member,
        workspaceId: team.workspaceId }), {
        domains: ['acme.com'], can_manage: false, can_invite: true,
      });

      const invitation = await store.createInvitation({ userId: member,
        workspaceId: team.workspaceId, email: 'colleague@acme.com', role: 'member',
        allowMemberInvite: true,
        projectGrants: [{ projectId: team.projectId, role: 'viewer' }] });
      assert.strictEqual(invitation.email, 'colleague@acme.com');
      await assert.rejects(() => store.createInvitation({ userId: member,
        workspaceId: team.workspaceId, email: 'friend@other.example', role: 'member',
        allowMemberInvite: true,
        projectGrants: [] }), (error) => error.code === 'permission_denied');
      await assert.rejects(() => store.createInvitation({ userId: member,
        workspaceId: team.workspaceId, email: 'admin@acme.com', role: 'admin',
        allowMemberInvite: true,
        projectGrants: [] }), (error) => error.code === 'permission_denied');
      await assert.rejects(() => store.createInvitation({ userId: member,
        workspaceId: team.workspaceId, email: 'other@acme.com', role: 'member',
        projectGrants: [] }), (error) => error.code === 'permission_denied');
      store.addWorkspaceMember({ actorUserId: owner, workspaceId: team.workspaceId,
        userId: collaborator, role: 'admin' });
      const adminInvitation = await store.createInvitation({ userId: collaborator,
        workspaceId: team.workspaceId, email: 'new-admin@other.example', role: 'admin',
        projectGrants: [] });
      assert.strictEqual(adminInvitation.role, 'admin');
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

    await testAsync('a target revision merges a stale writer with the current document', async () => {
      mergePersonal = await mergeStore.ensurePersonalWorkspace(owner, 'Merge tests');
      targetDocument = await mergeStore.createDocument({
        userId: owner, projectId: mergePersonal.projectId, filename: 'target-merge.md',
        markdown: '# Roadmap\nOwner: Team\n\nStatus: Planned.',
        idempotencyKey: 'target-merge-base',
      });
      const targetRevisionId = targetDocument.current_revision_id;
      clock += 1000;
      const remote = await mergeStore.saveRevision({
        userId: owner, documentId: targetDocument.id, expectedHeadRevisionId: targetRevisionId,
        markdown: '# Roadmap\nOwner: Ana\n\nStatus: Planned.',
        filename: 'target-merge.md', idempotencyKey: 'target-remote-save',
      });
      clock += 1000;
      const merged = await mergeStore.saveTargetRevision({
        userId: owner, documentId: targetDocument.id, targetRevisionId,
        markdown: '# Roadmap\nOwner: Team\n\nStatus: Complete.',
        filename: 'target-merge.md', idempotencyKey: 'target-merge-save',
      });
      assert.strictEqual(merged.revision_number, remote.revision_number + 1);
      assert.strictEqual(merged.target_revision_id, targetRevisionId);
      assert.strictEqual(merged.merged_from_revision_id, remote.current_revision_id);
      assert.strictEqual(merged.merge_classification, 'rebased');
      assert.ok(merged.markdown.includes('Owner: Ana'));
      assert.ok(merged.markdown.includes('Status: Complete.'));
      const opened = await mergeStore.getDocument({ userId: owner, documentId: targetDocument.id });
      assert.strictEqual(opened.markdown, merged.markdown);
      targetDocument = merged;
    });

    await testAsync('target revision retries are idempotent and missing targets do not write', async () => {
      const target = mergeStore.listRevisions({ userId: owner, documentId: targetDocument.id })
        .find((revision) => revision.revision_number === 2);
      const input = {
        userId: owner, documentId: targetDocument.id, targetRevisionId: target.id,
        markdown: '# Roadmap\n\nAgent follow-up.', filename: 'target-merge.md',
        idempotencyKey: 'target-idempotent-save',
      };
      const first = await mergeStore.saveTargetRevision(input);
      const replay = await mergeStore.saveTargetRevision(input);
      assert.deepStrictEqual(replay, first);
      const before = mergeStore.listRevisions({ userId: owner,
        documentId: targetDocument.id }).length;
      await assert.rejects(() => mergeStore.saveTargetRevision(Object.assign({}, input, {
        targetRevisionId: 'missing-target', idempotencyKey: 'missing-target-save',
      })), (error) => error.code === 'target_too_old' &&
        error.currentRevisionId === first.current_revision_id);
      assert.strictEqual(mergeStore.listRevisions({ userId: owner,
        documentId: targetDocument.id }).length,
        before);
      targetDocument = first;
    });

    await testAsync('a client merge base recovers a target after its server revision is pruned', async () => {
      const baseMarkdown = '# Pruned base\n\nOwner: Team\n\nStatus: Draft.\n';
      const base = await mergeStore.createDocument({
        userId: owner, projectId: mergePersonal.projectId, filename: 'pruned-base.md',
        markdown: baseMarkdown, idempotencyKey: 'pruned-base-create',
      });
      clock += 1000;
      const remote = await mergeStore.saveRevision({
        userId: owner, documentId: base.id,
        expectedHeadRevisionId: base.current_revision_id,
        markdown: '# Pruned base\n\nOwner: Ana\n\nStatus: Draft.\n',
        filename: 'pruned-base.md', idempotencyKey: 'pruned-base-remote',
      });
      const pruned = mergeStore.pruneRevisions({ documentId: base.id, keepPrevious: 0,
        retainAfterMs: clock + 1 });
      assert.strictEqual(pruned.deleted_count, 1);
      const recovered = await mergeStore.saveTargetRevision({
        userId: owner, documentId: base.id, targetRevisionId: base.current_revision_id,
        targetMarkdown: baseMarkdown,
        markdown: '# Pruned base\n\nOwner: Team\n\nStatus: Ready.\n',
        filename: 'pruned-base.md', idempotencyKey: 'pruned-base-recovered',
      });
      assert.strictEqual(recovered.target_recovered, true);
      assert.strictEqual(recovered.merged_from_revision_id, remote.current_revision_id);
      assert.ok(recovered.markdown.includes('Owner: Ana'));
      assert.ok(recovered.markdown.includes('Status: Ready.'));
    });

    await testAsync('a client merge base recovers a tag update after pruning', async () => {
      const baseMarkdown = '---\ntags:\n  - draft\n---\n# Pruned tags\n\nStatus: Draft.\n';
      const base = await mergeStore.createDocument({
        userId: owner, projectId: mergePersonal.projectId, filename: 'pruned-tags.md',
        markdown: baseMarkdown, idempotencyKey: 'pruned-tags-create',
      });
      clock += 1000;
      const remote = await mergeStore.saveRevision({
        userId: owner, documentId: base.id,
        expectedHeadRevisionId: base.current_revision_id,
        markdown: '---\ntags:\n  - draft\n---\n# Pruned tags\n\nStatus: Reviewed.\n',
        filename: 'pruned-tags.md', idempotencyKey: 'pruned-tags-remote',
      });
      mergeStore.pruneRevisions({ documentId: base.id, keepPrevious: 0,
        retainAfterMs: clock + 1 });
      const recovered = await mergeStore.updateDocumentTags({
        userId: owner, documentId: base.id, targetRevisionId: base.current_revision_id,
        targetMarkdown: baseMarkdown, filename: 'pruned-tags.md', tags: ['release'],
        idempotencyKey: 'pruned-tags-recovered',
      });
      assert.strictEqual(recovered.target_recovered, true);
      assert.strictEqual(recovered.merged_from_revision_id, remote.current_revision_id);
      assert.ok(recovered.markdown.includes('Status: Reviewed.'));
      assert.deepStrictEqual(SDocYaml.parseFrontMatter(recovered.markdown).meta.tags, ['release']);
    });

    await testAsync('target-based tag updates preserve a concurrent body edit', async () => {
      const taggedBase = await mergeStore.createDocument({
        userId: owner, projectId: mergePersonal.projectId, filename: 'tag-merge.md',
        markdown: '---\ntags:\n  - draft\n---\n# Tag merge\n\nStatus: Draft.\n',
        idempotencyKey: 'tag-merge-base',
      });
      const targetRevisionId = taggedBase.current_revision_id;
      const remote = await mergeStore.saveRevision({
        userId: owner, documentId: taggedBase.id,
        expectedHeadRevisionId: targetRevisionId,
        markdown: '---\ntags:\n  - draft\n---\n# Tag merge\n\nStatus: Reviewed.\n',
        filename: 'tag-merge.md', idempotencyKey: 'tag-merge-remote',
      });
      const tagged = await mergeStore.updateDocumentTags({
        userId: owner, documentId: taggedBase.id, targetRevisionId,
        tags: ['release'], idempotencyKey: 'tag-merge-target',
      });
      assert.strictEqual(tagged.merged_from_revision_id, remote.current_revision_id);
      assert.strictEqual(tagged.target_revision_id, targetRevisionId);
      assert.ok(tagged.markdown.includes('Status: Reviewed.'));
      assert.deepStrictEqual(SDocYaml.parseFrontMatter(tagged.markdown).meta.tags, ['release']);
    });

    await testAsync('simultaneous target saves retry and preserve both writers', async () => {
      const base = await mergeStore.createDocument({
        userId: owner, projectId: mergePersonal.projectId, filename: 'parallel.md',
        markdown: '# Parallel\n', idempotencyKey: 'parallel-base',
      });
      const writes = await Promise.all([
        mergeStore.saveTargetRevision({ userId: owner, documentId: base.id,
          targetRevisionId: base.current_revision_id,
          markdown: '# Parallel\n\nWriter A.\n', filename: 'parallel.md',
          idempotencyKey: 'parallel-a' }),
        mergeStore.saveTargetRevision({ userId: owner, documentId: base.id,
          targetRevisionId: base.current_revision_id,
          markdown: '# Parallel\n\nWriter B.\n', filename: 'parallel.md',
          idempotencyKey: 'parallel-b' }),
      ]);
      assert.deepStrictEqual(writes.map((item) => item.revision_number).sort(), [2, 3]);
      const opened = await mergeStore.getDocument({ userId: owner, documentId: base.id });
      assert.ok(opened.markdown.includes('Writer A.'));
      assert.ok(opened.markdown.includes('Writer B.'));
      assert.strictEqual(opened.revision_number, 3);
      assert.strictEqual(writes.some((item) => item.combined), true);
    });

    await testAsync('target revision preserves concurrent named Cloud comments', async () => {
      const base = await mergeStore.createDocument({
        userId: owner, projectId: mergePersonal.projectId, filename: 'comments.md',
        markdown: '# Review\n\nShared paragraph.\n', idempotencyKey: 'comments-base',
      });
      const anaMarkdown = SDocYaml.serializeFrontMatter({ comments: [{
        id: 'c1', kind: 'block', block: 'p:0', author: 'Ana Bell', text: 'Ana note',
      }] }) + '\n# Review\n\nShared paragraph.\n';
      const joshMarkdown = SDocYaml.serializeFrontMatter({ comments: [{
        id: 'c1', kind: 'block', block: 'p:0', author: 'Josh Summers', text: 'Josh note',
      }] }) + '\n# Review\n\nShared paragraph.\n';
      const ana = await mergeStore.saveRevision({ userId: owner, documentId: base.id,
        expectedHeadRevisionId: base.current_revision_id, markdown: anaMarkdown,
        filename: 'comments.md', idempotencyKey: 'comments-ana' });
      const merged = await mergeStore.saveTargetRevision({ userId: owner, documentId: base.id,
        targetRevisionId: base.current_revision_id, markdown: joshMarkdown,
        filename: 'comments.md', idempotencyKey: 'comments-josh' });
      const parsed = SDocYaml.parseFrontMatter(merged.markdown);
      assert.deepStrictEqual(parsed.meta.comments.map((comment) => comment.author).sort(),
        ['Ana Bell', 'Josh Summers']);
      assert.strictEqual(new Set(parsed.meta.comments.map((comment) => comment.id)).size, 2);
      assert.strictEqual(merged.merged_from_revision_id, ana.current_revision_id);
      assert.strictEqual(merged.comment_id_remaps.length, 1);
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

    await testAsync('shared documents are classified without creating notification state', async () => {
      store.setDocumentPermission({ userId: member, documentId: document.id,
        mode: 'custom', memberUserIds: [collaborator] });
      const owned = (await store.listDocuments({ userId: member }))[0];
      const shared = (await store.listDocuments({ userId: collaborator }))[0];
      assert.strictEqual(owned.shared_with_me, false);
      assert.strictEqual(owned.created_by_user_id, member);
      assert.strictEqual(shared.shared_with_me, true);
      assert.strictEqual(shared.created_by_user_id, member);
    });

    await testAsync('one notification batches multiple accessible documents for existing members', async () => {
      const second = await store.createDocument({ userId: member, projectId: team.projectId,
        filename: 'decisions.md', markdown: '# Decisions', idempotencyKey: 'create-decisions' });
      store.setDocumentPermission({ userId: member, documentId: second.id,
        mode: 'custom', memberUserIds: [collaborator] });
      const notification = await store.createDocumentNotification({
        userId: member,
        credentialId: 'cli-build-server',
        documentIds: [document.id, second.id],
        recipientUserIds: [collaborator],
        note: 'Review these before Monday.\nThe release note changed.',
        idempotencyKey: 'notify-release-documents',
      });
      assert.strictEqual(notification.created, true);
      assert.deepStrictEqual(notification.document_ids, [document.id, second.id]);
      assert.deepStrictEqual(notification.recipient_user_ids, [collaborator]);
      const storedNote = store.db.prepare(`
        SELECT note_ciphertext, note_nonce FROM cloud_notification_batches WHERE id = ?
      `).get(notification.id);
      assert.strictEqual(storedNote.note_ciphertext.includes(Buffer.from('Review these')), false);
      assert.strictEqual(storedNote.note_nonce.length, 12);
      const replay = await store.createDocumentNotification({
        userId: member,
        credentialId: 'cli-build-server',
        documentIds: [document.id, second.id],
        recipientUserIds: [collaborator],
        note: 'Review these before Monday.\r\nThe release note changed.',
        idempotencyKey: 'notify-release-documents',
      });
      assert.strictEqual(replay.id, notification.id);
      assert.strictEqual(replay.created, false);
      await assert.rejects(() => store.createDocumentNotification({
        userId: member, documentIds: [document.id, second.id],
        recipientUserIds: [collaborator], note: 'A different note.',
        idempotencyKey: 'notify-release-documents',
      }), (error) => error.code === 'idempotency_mismatch');
      const delivery = await store.getDocumentNotificationDelivery({
        batchId: notification.id, recipientUserId: collaborator,
      });
      assert.strictEqual(delivery.skipped, false);
      assert.strictEqual(delivery.note, 'Review these before Monday.\nThe release note changed.');
      assert.deepStrictEqual(delivery.documents.map((item) => item.title), ['Roadmap', 'Decisions']);
      assert.strictEqual(delivery.actor_credential_id, 'cli-build-server');
      await assert.rejects(() => store.createDocumentNotification({ userId: member,
        documentIds: [document.id], recipientUserIds: [outsider], idempotencyKey: 'notify-outsider' }),
      (error) => error.code === 'invalid_request');
      await assert.rejects(() => store.createDocumentNotification({ userId: member,
        documentIds: [document.id], recipientUserIds: [owner], idempotencyKey: 'notify-admin' }),
      (error) => error.code === 'permission_denied');
      const editorNotification = await store.createDocumentNotification({
        userId: collaborator, credentialId: 'cli-editor-machine',
        documentIds: [document.id], recipientUserIds: [member],
        note: 'I checked this version.', idempotencyKey: 'notify-by-editor',
      });
      assert.strictEqual(editorNotification.created, true);
      const editorDelivery = await store.getDocumentNotificationDelivery({
        batchId: editorNotification.id, recipientUserId: member,
      });
      assert.strictEqual(editorDelivery.actor_user_id, collaborator);
      assert.strictEqual(editorDelivery.actor_credential_id, 'cli-editor-machine');
      assert.strictEqual(editorDelivery.note, 'I checked this version.');
      await assert.rejects(() => store.createDocumentNotification({
        userId: member, documentIds: [document.id], recipientUserIds: [collaborator],
        note: { text: 'not plain text' }, idempotencyKey: 'notify-invalid-note',
      }), (error) => error.code === 'invalid_request');

      store.setDocumentPermission({ userId: member, documentId: second.id,
        mode: 'custom', memberUserIds: [] });
      const afterRemoval = await store.getDocumentNotificationDelivery({
        batchId: notification.id, recipientUserId: collaborator,
      });
      assert.deepStrictEqual(afterRemoval.documents.map((item) => item.id), [document.id]);
      store.db.prepare('DELETE FROM cloud_documents WHERE id = ?').run(second.id);
      store.setDocumentPermission({ userId: member, documentId: document.id,
        mode: 'custom', memberUserIds: [] });
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
      (error) => error.code === 'resource_unavailable');
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
        workspaceId: team.workspaceId }), (error) => error.code === 'resource_unavailable');
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
      (error) => error.code === 'resource_unavailable');
      store.addWorkspaceMember({ actorUserId: owner, workspaceId: team.workspaceId,
        userId: collaborator, role: 'admin' });
      assert.throws(() => store.deleteWorkspace({ userId: collaborator,
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

    await testAsync('billing retention can permanently remove a Personal workspace', async () => {
      const billingOwner = 'usr_billing_owner';
      const billingPersonal = await store.ensurePersonalWorkspace(billingOwner, 'Billing Owner');
      const billingDocument = await store.createDocument({ userId: billingOwner,
        projectId: billingPersonal.projectId, filename: 'billing-retention.md',
        markdown: '# Billing retention', idempotencyKey: 'billing-retention-document' });
      const context = await store.getWorkspaceBillingContext(billingPersonal.workspaceId);
      assert.strictEqual(context.name, 'Billing Owner');
      assert.deepStrictEqual(context.ownerUserIds, [billingOwner]);
      assert.deepStrictEqual(store.listWorkspaceOwnerUserIds(billingPersonal.workspaceId),
        [billingOwner]);
      assert.strictEqual(store.purgeWorkspaceForBilling({
        workspaceId: billingPersonal.workspaceId,
      }).purged_count, 1);
      assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM cloud_workspaces WHERE id = ?')
        .get(billingPersonal.workspaceId).count, 0);
      assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM cloud_documents WHERE id = ?')
        .get(billingDocument.id).count, 0);
      assert.strictEqual(store.purgeWorkspaceForBilling({
        workspaceId: billingPersonal.workspaceId,
      }).purged_count, 0);
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
        const teamWorkspace = await managedStore.createTeamWorkspace({
          userId: 'managed-user', name: 'Managed Team', projectName: 'Documents',
        });
        managedStore.addWorkspaceMember({ actorUserId: 'managed-user',
          workspaceId: teamWorkspace.workspaceId, userId: 'managed-recipient', role: 'member' });
        managedStore.grantProject({ actorUserId: 'managed-user',
          workspaceId: teamWorkspace.workspaceId, projectId: teamWorkspace.projectId,
          userId: 'managed-recipient', role: 'viewer' });
        const sharedDocument = await managedStore.createDocument({
          userId: 'managed-user', projectId: teamWorkspace.projectId,
          filename: 'shared.md', markdown: '# Shared', idempotencyKey: 'managed-shared-create',
        });
        managedStore.setDocumentPermission({ userId: 'managed-user',
          documentId: sharedDocument.id, mode: 'custom', memberUserIds: ['managed-recipient'] });
        const notification = await managedStore.createDocumentNotification({
          userId: 'managed-user', documentIds: [sharedDocument.id],
          recipientUserIds: ['managed-recipient'], note: 'Encrypted by managed KMS.',
          idempotencyKey: 'managed-notification',
        });
        const delivery = await managedStore.getDocumentNotificationDelivery({
          batchId: notification.id, recipientUserId: 'managed-recipient',
        });
        assert.strictEqual(delivery.note, 'Encrypted by managed KMS.');
        managedProvider.clearCache();
        kmsUnavailable = true;
        const notificationCount = managedStore.db.prepare(
          'SELECT COUNT(*) AS count FROM cloud_notification_batches').get().count;
        await assert.rejects(managedStore.createDocumentNotification({
          userId: 'managed-user', documentIds: [sharedDocument.id],
          recipientUserIds: ['managed-recipient'], note: 'This cannot be encrypted.',
          idempotencyKey: 'managed-notification-kms-failure',
        }), (error) => error.code === 'temporary_service_failure');
        assert.strictEqual(managedStore.db.prepare(
          'SELECT COUNT(*) AS count FROM cloud_notification_batches').get().count,
        notificationCount);
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

    mergeStore.close();
    fs.rmSync(mergeDir, { recursive: true, force: true });
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
};
