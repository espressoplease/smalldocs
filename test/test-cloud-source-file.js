const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { startFixture } = require('./cloud-onboarding-fixture');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const f = await startFixture({ singlePlan: true });
    const source = { absolute_path: '/Users/alex/private-origin-unique/reports/brief.md', relative_path: 'reports/brief.md' };
    const markdown = '---\ntags: [planning]\n---\n# Brief\n\nShared content.\n';
    async function create(sourceFile = source, actor = 'bob') {
      const r = await f.api(actor, '/api/cloud/v1/account/documents', 'POST', {
        account_id: f.team.workspaceId, filename: 'brief.md', markdown,
        source_file: sourceFile, idempotency_key: crypto.randomUUID() });
      assert.strictEqual(r.status, 201, JSON.stringify(r.data));
      return r.data.document;
    }
    const read = (doc, actor = 'bob', suffix = '') => f.api(actor, '/api/cloud/v1/documents/' + doc.id + suffix);
    const set = (doc, actor, sourceFile) => f.api(actor, '/api/cloud/v1/documents/' + doc.id + '/source-file', 'PUT', { source_file: sourceFile });
    try {
      await testAsync('creator source files persist encrypted, stay outside Markdown and are hidden from shared readers and admins', async () => {
        const doc = await create();
        assert.deepStrictEqual(doc.source_file, source);
        const owner = await read(doc);
        assert.deepStrictEqual(owner.data.document.source_file, source);
        assert.strictEqual(owner.data.document.markdown, markdown);
        const stored = f.store.db.prepare('SELECT * FROM cloud_document_source_files WHERE document_id=?').get(doc.id);
        assert.ok(Buffer.isBuffer(stored.source_ciphertext));
        assert.ok(!stored.source_ciphertext.includes(Buffer.from(source.absolute_path)));
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'everyone' });
        f.store.addWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
          userId: f.users.member.id, role: 'admin' });
        for (const suffix of ['', '/revisions/' + doc.current_revision_id]) {
          const shared = await read(doc, 'member', suffix);
          assert.strictEqual(shared.status, 200, JSON.stringify(shared.data));
          assert.strictEqual(shared.data.document.source_file, undefined);
          assert.ok(!JSON.stringify(shared.data).includes('private-origin-unique'));
        }
        assert.strictEqual((await set(doc, 'member', { absolute_path: '/fake/path.md' })).status, 403);
        assert.strictEqual((await read(doc, 'outsider')).status, 404);
        assert.strictEqual((await set(doc, 'outsider', source)).status, 404);
        const found = await f.api('member', '/api/cloud/v1/search', 'POST', { workspace_id: f.team.workspaceId, query: 'private-origin-unique' });
        assert.strictEqual(found.status, 200, JSON.stringify(found.data));
        assert.strictEqual(found.data.documents.length, 0);
      });
      await testAsync('a library owner cannot see a different creator source path', async () => {
        const doc = await create(source, 'member');
        f.store.setDocumentPermission({ userId: f.users.member.id, documentId: doc.id, mode: 'everyone' });
        const owner = await read(doc);
        assert.strictEqual(owner.status, 200, JSON.stringify(owner.data));
        assert.strictEqual(owner.data.document.source_file, undefined);
        assert.strictEqual((await read(doc, 'member')).data.document.source_file.absolute_path, source.absolute_path);
        assert.strictEqual((await set(doc, 'bob', source)).status, 403);
      });
      await testAsync('private source survives collaborator revisions and library moves without joining revision content', async () => {
        const doc = await create();
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'everyone' });
        const saved = await f.api('member', '/api/cloud/v1/documents/' + doc.id + '/revisions', 'POST', {
          expected_head_revision_id: doc.current_revision_id, markdown: markdown + '\nMember edit.\n',
          idempotency_key: crypto.randomUUID() });
        assert.strictEqual(saved.status, 201, JSON.stringify(saved.data));
        assert.ok(!JSON.stringify(saved.data).includes('private-origin-unique'));
        assert.deepStrictEqual((await read(doc)).data.document.source_file, source);
        const destination = await f.store.ensurePersonalWorkspace(f.users.bob.id, 'Research');
        await f.store.moveDocument({ userId: f.users.bob.id, documentId: doc.id, projectId: destination.projectId,
          expectedHeadRevisionId: saved.data.document.current_revision_id });
        const moved = await read(doc);
        assert.deepStrictEqual(moved.data.document.source_file, source);
        assert.strictEqual(moved.data.document.markdown, markdown + '\nMember edit.\n');
        const stored = f.store.db.prepare('SELECT project_id FROM cloud_document_source_files WHERE document_id=?').get(doc.id);
        assert.strictEqual(stored.project_id, destination.projectId);
      });
      await testAsync('source updates do not create content revisions and invalid values never save', async () => {
        const doc = await create(null);
        assert.strictEqual((await set(doc, 'bob', { absolute_path: 42 })).status, 400);
        const saved = await set(doc, 'bob', source);
        assert.strictEqual(saved.status, 200, JSON.stringify(saved.data));
        const opened = await read(doc);
        assert.deepStrictEqual(opened.data.document.source_file, source);
        assert.strictEqual(opened.data.document.current_revision_id, doc.current_revision_id);
        assert.strictEqual(opened.data.document.markdown, markdown);
      });
      await testAsync('revocation during private source decryption prevents disclosure or source updates', async () => {
        for (const operation of ['read', 'write']) {
          f.store.addWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
            userId: f.users.member.id, role: 'member' });
          f.store.grantProject({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
            projectId: f.team.projectId, userId: f.users.member.id, role: 'editor' });
          const doc = await create(source, 'member');
          const hook = operation === 'read' ? '_readSourceFile' : '_prepareSourceFile';
          const original = f.store[hook];
          f.store[hook] = async function (...args) {
            const value = await original.apply(this, args);
            this.removeWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId, userId: f.users.member.id });
            return value;
          };
          try {
            await assert.rejects(operation === 'read'
              ? f.store.getDocument({ userId: f.users.member.id, documentId: doc.id })
              : f.store.setDocumentSourceFile({ userId: f.users.member.id, documentId: doc.id, sourceFile: { absolute_path: '/new/path.md' } }),
            e => e.code === 'resource_unavailable');
          } finally { f.store[hook] = original; }
        }
      });
      await testAsync('the CLI captures relative and absolute paths and backfills older creator documents on unchanged opens', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-source-cli-'));
        try {
          const issued = f.auth.issueDeviceAuthorization({ displayName: 'Workstation' });
          f.auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: f.users.bob.id });
          const token = f.auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
          fs.mkdirSync(path.join(dir, 'state', 'cloud'), { recursive: true });
          fs.writeFileSync(path.join(dir, 'state', 'cloud', 'credentials.json'), JSON.stringify({ [f.origin]: {
            user_id: token.userId, credential_id: token.credentialId, access_token: token.accessToken,
            refresh_token: token.refreshToken, access_token_expires_at: new Date(token.accessExpiresAtMs).toISOString() } }));
          function cli(args) {
            const r = spawnSync(process.execPath, [path.join(__dirname, '../cli/bin/sdocs-dev.js'), ...args, '--json'], {
              cwd: dir, encoding: 'utf8', timeout: 20000, env: { ...process.env, SDOCS_HOME: path.join(dir, 'state'),
                SDOCS_CLOUD_URL: f.origin, SDOCS_CLOUD_FILE_CREDENTIALS: '1', SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', NO_UPDATE_NOTIFIER: '1' } });
            const value = JSON.parse(r.stdout);
            assert.strictEqual(r.status, 0, JSON.stringify(value)); return value;
          }
          fs.mkdirSync(path.join(dir, 'reports'));
          fs.writeFileSync(path.join(dir, 'reports', 'brief.md'), markdown);
          const created = cli(['reports/brief.md', '--cloud', '--account', f.team.workspaceId, '--no-open']);
          const own = (await read({ id: created.document_id })).data.document;
          assert.deepStrictEqual(own.source_file, { absolute_path: fs.realpathSync(path.join(dir, 'reports', 'brief.md')), relative_path: 'reports/brief.md' });
          const legacy = await create(null);
          cli(['cloud', 'pull', legacy.id, '--output', 'old.md']);
          cli(['old.md', '--cloud', '--no-open']);
          const old = (await read(legacy)).data.document;
          assert.strictEqual(old.source_file.relative_path, 'old.md');
          assert.strictEqual(old.current_revision_id, legacy.current_revision_id);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
      });
    } finally { await f.close(); }
  };
};
