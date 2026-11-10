const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const destination = require('../cli/lib/cloud-destination');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-destination-'));
    const project = path.join(root, 'project');
    const nested = path.join(project, 'docs', 'notes');
    fs.mkdirSync(nested, { recursive: true });
    const config = (dir, library) => fs.writeFileSync(path.join(dir, '.sdocs.json'), JSON.stringify({ library }));
    const select = opts => destination.selection({ cwd: nested, env: {}, ...opts });
    try {
      await testAsync('folder selection walks ancestors and the nearest configuration wins', async () => {
        config(root, 'Root'); config(project, 'Engineering');
        assert.deepStrictEqual(select(), { source: 'folder', value: 'Engineering', config_file: path.join(project, '.sdocs.json') });
        config(path.dirname(nested), 'Research');
        assert.strictEqual(select().value, 'Research');
        fs.unlinkSync(path.join(path.dirname(nested), '.sdocs.json'));
        assert.strictEqual(select().value, 'Engineering');
      });
      await testAsync('explicit and environment selections override folder configuration and installation defaults', async () => {
        assert.strictEqual(select({ accountFlag: 'explicit', env: { SDOCS_LIBRARY: 'env' } }).value, 'explicit');
        assert.deepStrictEqual(select({ env: { SDOCS_LIBRARY: '  Research  ' } }), { source: 'environment', value: 'Research' });
        assert.strictEqual(select({ fallbackAccountId: 'installed' }).value, 'Engineering');
        fs.unlinkSync(path.join(project, '.sdocs.json')); fs.unlinkSync(path.join(root, '.sdocs.json'));
        assert.deepStrictEqual(select({ fallbackAccountId: 'installed' }), { source: 'installation_default', value: 'installed' });
        assert.strictEqual(select(), null);
      });
      await testAsync('malformed, empty and non-file configuration reports its path without falling back', async () => {
        const file = path.join(project, '.sdocs.json');
        for (const text of ['{bad', '{}', 'null', '[]', '{"library":false}', '{"library":"   "}']) {
          fs.writeFileSync(file, text);
          assert.throws(() => select(), error => error.code === 'invalid_request' && error.data.config_file === file);
          assert.strictEqual(select({ accountFlag: 'override' }).value, 'override');
          assert.strictEqual(select({ env: { SDOCS_LIBRARY: 'override' } }).value, 'override');
        }
        fs.unlinkSync(file); fs.mkdirSync(file);
        assert.throws(() => select(), error => error.code === 'invalid_request');
        fs.rmdirSync(file);
      });
      await testAsync('name matching handles exact spelling, unique case-insensitive names, Unicode and duplicates', async () => {
        const libraries = [{ id: 'a', name: 'Engineering' }, { id: 'b', name: 'engineering' },
          { id: 'c', name: 'Caf\u00e9' }, { id: 'd', name: 'Duplicate' }, { id: 'e', name: 'Duplicate' }];
        const client = { origin: 'https://example.test', authenticated: async endpoint => {
          assert.strictEqual(endpoint, '/api/cloud/v1/library-settings'); return { libraries };
        } };
        assert.strictEqual(await destination.resolve(client, { source: 'environment', value: 'Engineering' }), 'a');
        assert.strictEqual(await destination.resolve(client, { source: 'environment', value: 'CAFE\u0301' }), 'c');
        for (const value of ['ENGINEERING', 'Duplicate']) await assert.rejects(
          destination.resolve(client, { source: 'environment', value }),
          error => error.code === 'account_selection_required' && error.data.accounts.length === 2);
        await assert.rejects(destination.resolve(client, { source: 'environment', value: 'Other company' }),
          error => error.code === 'resource_unavailable' && !JSON.stringify(error.data).includes('Duplicate'));
        const noLookup = { authenticated: () => { throw new Error('IDs do not need a name lookup'); } };
        assert.strictEqual(await destination.resolve(noLookup, { source: 'folder', value: 'A1111111-2222-3333-4444-555555555555' }), 'a1111111-2222-3333-4444-555555555555');
        assert.strictEqual(await destination.resolve(noLookup, { source: 'flag', value: 'legacy-id' }), 'legacy-id');
      });
      await testAsync('a lost create response retries the same library and operation even if its configured name is renamed', async () => {
        const previous = { cwd: process.cwd(), home: process.env.SDOCS_HOME, library: process.env.SDOCS_LIBRARY };
        process.env.SDOCS_HOME = path.join(root, 'retry-state'); process.env.SDOCS_LIBRARY = 'Engineering';
        process.chdir(nested);
        try {
          const file = path.join(nested, 'retry.md'); fs.writeFileSync(file, '# Retry');
          const uploads = []; let lookups = 0;
          const client = { origin: 'https://example.test', loadCredential: () => ({ user_id: 'test-user' }),
            authenticated: async (endpoint, options) => {
              if (endpoint === '/api/cloud/v1/library-settings') {
                lookups++; assert.strictEqual(lookups, 1); return { libraries: [{ id: 'library-a', name: 'Engineering' }] };
              }
              assert.strictEqual(endpoint, '/api/cloud/v1/account/documents');
              uploads.push(JSON.parse(options.body));
              if (uploads.length === 1) throw new Error('response lost after saving');
              return { document: { id: 'saved-document', current_revision_id: 'revision-one', tags: [] } };
            } };
          const { autoSyncOpen } = require('../cli/lib/cloud-commands');
          await assert.rejects(autoSyncOpen({ file }, { client, silent: true }), /response lost/);
          const retried = await autoSyncOpen({ file }, { client, silent: true });
          assert.strictEqual(retried.documentId, 'saved-document');
          assert.strictEqual(uploads[1].account_id, 'library-a');
          assert.strictEqual(uploads[0].idempotency_key, uploads[1].idempotency_key);
          assert.strictEqual(lookups, 1);
          const equivalentFile = path.join(nested, 'equivalent-selector.md'); fs.writeFileSync(equivalentFile, '# Equivalent selection');
          const equivalentUploads = [];
          const equivalentClient = { ...client, authenticated: async (endpoint, options) => {
            if (endpoint === '/api/cloud/v1/library-settings') return { libraries: [{ id: 'library-a', name: 'Engineering' }] };
            equivalentUploads.push(JSON.parse(options.body));
            if (equivalentUploads.length === 1) throw new Error('response lost');
            return { document: { id: 'equivalent-document', current_revision_id: 'revision-one', tags: [] } };
          } };
          await assert.rejects(autoSyncOpen({ file: equivalentFile }, { client: equivalentClient, silent: true }), /response lost/);
          await autoSyncOpen({ file: equivalentFile, accountFlag: 'library-a' }, { client: equivalentClient, silent: true });
          assert.strictEqual(equivalentUploads[0].idempotency_key, equivalentUploads[1].idempotency_key);
          const bindings = require('../cli/lib/cloud-bindings');
          const legacyFile = path.join(nested, 'legacy-create.md'); fs.writeFileSync(legacyFile, '# Legacy pending save');
          bindings.setPending('test-user', legacyFile, { operation: 'create', destination: 'old-default',
            sha256: bindings.hash(fs.readFileSync(legacyFile)), idempotency_key: 'legacy-key' });
          lookups = 0;
          await autoSyncOpen({ file: legacyFile }, { client, silent: true });
          assert.strictEqual(uploads.at(-1).account_id, 'library-a');
          assert.notStrictEqual(uploads.at(-1).idempotency_key, 'legacy-key');
        } finally {
          process.chdir(previous.cwd);
          if (previous.home == null) delete process.env.SDOCS_HOME; else process.env.SDOCS_HOME = previous.home;
          if (previous.library == null) delete process.env.SDOCS_LIBRARY; else process.env.SDOCS_LIBRARY = previous.library;
        }
      });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }

    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
    const home = path.join(f.dir, 'cli-home');
    const prefix = path.join(home, '.sdocs');
    const repo = path.join(home, 'project');
    const child = path.join(repo, 'notes');
    fs.mkdirSync(child, { recursive: true }); fs.mkdirSync(path.join(prefix, 'cloud'), { recursive: true });
    const machine = f.auth.issueDeviceAuthorization({ displayName: 'Folder test' });
    f.auth.approveDeviceAuthorization({ userCode: machine.userCode, userId: f.users.josh.id });
    const c = f.auth.pollDeviceAuthorization({ deviceCode: machine.deviceCode });
    fs.writeFileSync(path.join(prefix, 'cloud', 'credentials.json'), JSON.stringify({ [f.origin]: {
      credential_id: c.credentialId, user_id: c.userId, access_token: c.accessToken,
      access_token_expires_at: new Date(c.accessExpiresAtMs).toISOString(), refresh_token: c.refreshToken,
    } }));
    function cli(args, opts = {}) {
      const result = spawnSync(process.execPath, [path.join(__dirname, '../cli/bin/sdocs-dev.js'), ...args, '--reason', 'Apply the requested document update', '--json'], {
        cwd: opts.cwd || child, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, HOME: home, SDOCS_HOME: prefix, SDOCS_CLOUD_FILE_CREDENTIALS: '1',
          SDOCS_CLOUD_URL: f.origin, SDOCS_URL: f.origin, SDOCS_LIBRARY: opts.library || '',
          SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', SDOCS_NO_UPDATE_CHECK: '1', CI: '1' },
      });
      if (result.error) throw result.error;
      let data; try { data = args.includes('--help') ? { help: result.stdout } : JSON.parse(result.stdout); } catch (_) { throw new Error(result.stdout + result.stderr); }
      return { code: result.status, data };
    }
    let personal, engineering, research, bound;
    const file = name => { const value = path.join(home, name + '.md'); fs.writeFileSync(value, '# ' + name + '\n'); return value; };
    function save(name, opts = {}, extra = []) { return cli([file(name), '--cloud', '--no-open', '+destination-test', ...extra], opts); }
    function success(result) { assert.strictEqual(result.code, 0, JSON.stringify(result.data)); return result.data; }
    async function workspaceOf(data) { return (await f.api('josh', '/api/cloud/v1/documents/' + data.document_id)).data.document.workspace_id; }
    try {
      personal = (await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})).data.workspaces[0].id;
      engineering = (await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Engineering' })).data.workspace.workspaceId;
      research = (await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Research' })).data.workspace.workspaceId;
      success(cli(['cloud', 'library-default', personal]));
      await testAsync('real CLI saves in a folder library by name, even when the input file is outside that folder', async () => {
        config(repo, 'Engineering');
        bound = success(save('folder-engineering'));
        assert.strictEqual(await workspaceOf(bound), engineering);
        assert.strictEqual(bound.library_selection.source, 'folder');
        assert.strictEqual(bound.library_selection.config_file, fs.realpathSync(path.join(repo, '.sdocs.json')));
        assert.deepStrictEqual(bound.tags, ['destination-test']);
      });
      await testAsync('real CLI environment and explicit overrides win without changing the machine default', async () => {
        assert.strictEqual(await workspaceOf(success(save('environment-research', { library: 'Research' }))), research);
        assert.strictEqual(await workspaceOf(success(save('explicit-personal', { library: 'Research' }, ['--account', personal]))), personal);
        assert.strictEqual(success(cli(['cloud', 'library-default'])).workspace_id, personal);
      });
      await testAsync('installation defaults agree for status and new saves, below folder and process defaults', async () => {
        const setupFile = path.join(prefix, 'setup.json');
        fs.writeFileSync(setupFile, JSON.stringify({ schemaVersion: 1, skillEdition: 'cloud', cloudAccountId: research, setupCompleted: true }));
        try {
          assert.strictEqual(success(cli(['cloud', 'status'])).account.id, engineering);
          fs.unlinkSync(path.join(repo, '.sdocs.json'));
          assert.strictEqual(success(cli(['cloud', 'status'])).account.id, research);
          assert.strictEqual(await workspaceOf(success(save('installation-research'))), research);
          assert.strictEqual(success(cli(['cloud', 'status'], { library: 'Engineering' })).account.id, engineering);
        } finally { fs.unlinkSync(setupFile); config(repo, 'Engineering'); }
      });
      await testAsync('nested overrides and library IDs select new documents, while calls outside the project use the computer default', async () => {
        config(child, research);
        assert.strictEqual(await workspaceOf(success(save('nested-research'))), research);
        fs.unlinkSync(path.join(child, '.sdocs.json'));
        const input = path.join(child, 'outside-call.md'); fs.writeFileSync(input, '# Called outside the project');
        assert.strictEqual(await workspaceOf(success(cli([input, '--cloud', '--no-open'], { cwd: home }))), personal);
      });
      await testAsync('bound files stay in their original library across folder, environment and explicit changes', async () => {
        config(repo, 'Research');
        const original = path.join(home, 'folder-engineering.md');
        fs.appendFileSync(original, '\nAn edit after changing defaults.\n');
        const saved = success(cli([original, '--cloud', '--no-open', '--account', personal], { library: 'Research' }));
        assert.strictEqual(saved.document_id, bound.document_id);
        assert.strictEqual(saved.library_selection.source, 'binding');
        assert.strictEqual(await workspaceOf(saved), engineering);
        fs.writeFileSync(path.join(repo, '.sdocs.json'), '{bad');
        assert.strictEqual(success(cli([original, '--cloud', '--no-open'])).document_id, bound.document_id);
      });
      await testAsync('status and account-scoped discovery resolve the same folder selection, while search retains its wider scope', async () => {
        config(repo, 'Engineering');
        const status = success(cli(['cloud', 'status']));
        assert.strictEqual(status.account.id, engineering);
        assert.strictEqual(status.library_selection.library_id, engineering);
        assert.strictEqual(success(cli(['cloud', 'members'])).account_id, engineering);
        assert.ok(success(cli(['cloud', 'tags'])).tags.some(tag => tag.tag === 'destination-test'));
        assert.ok(success(cli(['cloud', 'permission-groups'])).permission_groups);
        const search = success(cli(['cloud', 'search', '--tag', 'destination-test']));
        assert.ok(search.documents.some(doc => doc.workspace_id === engineering));
        assert.ok(search.documents.some(doc => doc.workspace_id === research));
      });
      await testAsync('missing names, duplicate names, malformed config and foreign library IDs never fall back or create a document', async () => {
        const count = () => f.store.db.prepare('SELECT COUNT(*) AS n FROM cloud_documents').get().n;
        const before = count();
        config(repo, 'Unavailable company');
        assert.strictEqual(save('missing').data.error, 'resource_unavailable');
        config(repo, f.otherTeam.workspaceId);
        assert.strictEqual(save('foreign').code, 4);
        assert.strictEqual(cli(['cloud', 'status']).code, 4);
        fs.writeFileSync(path.join(repo, '.sdocs.json'), '{bad');
        assert.strictEqual(save('malformed').data.error, 'invalid_request');
        success(cli(['cloud', 'status', '--help']));
        assert.strictEqual(count(), before);
        for (let i = 0; i < 2; i++) await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Duplicated' });
        config(repo, 'Duplicated');
        const duplicate = save('duplicate');
        assert.strictEqual(duplicate.data.error, 'account_selection_required');
        assert.strictEqual(duplicate.data.accounts.length, 2);
        assert.strictEqual(count(), before);
      });
    } finally { await f.close(); }
  };
};
