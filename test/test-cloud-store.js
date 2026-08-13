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
      ]);
      const found = store.search({ userId: member, query: 'kubernetes' });
      assert.strictEqual(found.length, 1);
      assert.strictEqual(found[0].id, document.id);
      assert.strictEqual(store.search({ userId: outsider, query: 'kubernetes' }).length, 0);
    });

    test('delete requires the current head and preserves revisions for restore', () => {
      assert.throws(() => store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: 'stale' }), (error) => error.code === 'revision_conflict');
      const deleted = store.deleteDocument({ userId: member, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id, restoreWindowMs: 60000 });
      assert.ok(deleted.deleted_at);
      assert.strictEqual(store.listDocuments({ userId: member }).length, 0);
      assert.strictEqual(store.listRevisions({ userId: member, documentId: document.id }).length, 2);
    });

    test('ciphertext relocation fails authenticated decryption', () => {
      const first = store.db.prepare('SELECT * FROM cloud_document_revisions WHERE document_id = ? ORDER BY revision_number').get(document.id);
      store.db.prepare('UPDATE cloud_document_revisions SET body_ciphertext = ? WHERE id = ?')
        .run(Buffer.from(first.body_ciphertext).fill(0, 0, 1), first.id);
      assert.throws(() => store.getDocument({ userId: member, documentId: document.id,
        revisionId: first.id, includeDeleted: true }), (error) => error.code === 'temporary_service_failure');
    });

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
};
