const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function(harness) {
  const { assert, test, testAsync } = harness;
  const io = require('../cli/lib/io');
  const credentials = require('../cli/lib/cloud-credentials');
  const bindings = require('../cli/lib/cloud-bindings');
  const { CloudClient, runCloudCommand, filterTags, skillInstallCommand, CLOUD_HELP } =
    require('../cli/lib/cloud-commands');

  test('cloud CLI parser captures nested action flags', () => {
    const parsed = io.parseArgs(['cloud', 'pull', 'doc-id', '--revision', 'rev-id',
      '--output', 'plan.md', '--no-bind', '--force', '--json']);
    assert.strictEqual(parsed.subcommand, 'cloud');
    assert.strictEqual(parsed.file, 'pull');
    assert.strictEqual(parsed.extra, 'doc-id');
    assert.strictEqual(parsed.revisionFlag, 'rev-id');
    assert.strictEqual(parsed.outputPath, 'plan.md');
    assert.strictEqual(parsed.noBindFlag, true);
    assert.strictEqual(parsed.forceFlag, true);
    assert.strictEqual(parsed.jsonFlag, true);
  });

  test('cloud CLI parser captures account permission and member flags', () => {
    const parsed = io.parseArgs(['cloud', 'access', 'doc-id', '--account', 'acct-id',
      '--member', 'usr-a', '--member', 'usr-b', '--json']);
    assert.strictEqual(parsed.accountFlag, 'acct-id');
    assert.deepStrictEqual(parsed.memberFlags, ['usr-a', 'usr-b']);
  });

  test('cloud CLI parser captures notification documents and shared filtering', () => {
    const parsed = io.parseArgs(['cloud', 'notify', 'doc-a', '--document', 'doc-b',
      '--document', 'doc-c', '--member', 'usr-a', '--note', 'Review these together.',
      '--shared-with-me', '--json']);
    assert.strictEqual(parsed.extra, 'doc-a');
    assert.deepStrictEqual(parsed.documentFlags, ['doc-b', 'doc-c']);
    assert.deepStrictEqual(parsed.memberFlags, ['usr-a']);
    assert.strictEqual(parsed.noteText, 'Review these together.');
    assert.strictEqual(parsed.sharedWithMeFlag, true);
  });

  test('cloud CLI tag filters require every requested tag', () => {
    const documents = [{ id: 'a', tags: ['auth', 'api'] }, { id: 'b', tags: ['auth'] }];
    assert.deepStrictEqual(filterTags(documents, ['AUTH', 'api']).map((item) => item.id), ['a']);
  });

  test('Cloud skill install commands preserve the selected server origin', () => {
    assert.strictEqual(skillInstallCommand('https://cloud-staging.smalldocs.org', true),
      'npx skills@latest add https://cloud-staging.smalldocs.org/agent-skills/cloud --global');
    assert.strictEqual(skillInstallCommand('https://smalldocs.org', false),
      'npx skills@latest add https://smalldocs.org/agent-skills/standard --global');
  });

  test('Cloud help documents search result fields and read/update workflows', () => {
    assert.ok(CLOUD_HELP.includes('Search is case-insensitive substring matching'));
    assert.ok(CLOUD_HELP.includes('matches[]'));
    assert.ok(CLOUD_HELP.includes('--no-bind'));
    assert.ok(CLOUD_HELP.includes('sdoc cloud push ./plan.md --json'));
  });

  return async function() {
    console.log('\n-- Cloud CLI Tests ------------------------------------\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-cli-'));
    const previousHome = process.env.SDOCS_HOME;
    const previousFileCredentials = process.env.SDOCS_CLOUD_FILE_CREDENTIALS;
    process.env.SDOCS_HOME = dir;
    process.env.SDOCS_CLOUD_FILE_CREDENTIALS = '1';

    await testAsync('macOS Keychain stores a short wrapping key and round-trips arbitrary-length credentials', async () => {
      const previous = process.env.SDOCS_HOME;
      const isolated = path.join(dir, 'keychain-roundtrip');
      process.env.SDOCS_HOME = isolated;
      const items = new Map();
      const writes = [];
      const ops = {
        read(accountName) { return items.get(accountName) || null; },
        write(accountName, value) {
          writes.push({ accountName, value });
          items.set(accountName, value.slice(0, 128));
        },
        remove(accountName) { items.delete(accountName); },
      };
      const credential = {
        credential_id: 'cli-keychain',
        user_id: 'usr-keychain',
        access_token: 'access-' + 'a'.repeat(900),
        access_token_expires_at: '2099-01-01T00:00:00.000Z',
        refresh_token: 'refresh-' + 'r'.repeat(300),
      };
      try {
        credentials.keychainSave('https://cloud.example', credential, ops);
        assert.strictEqual(writes.length, 1);
        assert.ok(writes[0].value.length < 128);
        assert.ok(!writes[0].value.includes(credential.refresh_token));
        assert.deepStrictEqual(credentials.keychainLoad('https://cloud.example', ops), credential);
        const encryptedFile = path.join(credentials.cloudDir(), fs.readdirSync(credentials.cloudDir())
          .find((name) => name.endsWith('.enc')));
        const encrypted = fs.readFileSync(encryptedFile, 'utf8');
        assert.ok(!encrypted.includes(credential.access_token));
        assert.ok(!encrypted.includes(credential.refresh_token));
        assert.strictEqual(fs.statSync(encryptedFile).mode & 0o777, 0o600);
        assert.strictEqual(fs.statSync(path.dirname(encryptedFile)).mode & 0o777, 0o700);

        const envelope = JSON.parse(encrypted);
        envelope.tag = envelope.tag.slice(0, -2);
        fs.writeFileSync(encryptedFile, JSON.stringify(envelope));
        assert.strictEqual(credentials.keychainLoad('https://cloud.example', ops), null);
      } finally {
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('macOS Keychain replaces a truncated legacy credential and removes both stores on logout', async () => {
      const previous = process.env.SDOCS_HOME;
      process.env.SDOCS_HOME = path.join(dir, 'keychain-truncated');
      const origin = 'https://truncated.example';
      const accountName = Buffer.from(origin).toString('base64url');
      const items = new Map([[accountName, '{"credential_id":"old","access_token":"' + 'x'.repeat(88)]]);
      const ops = {
        read(name) { return items.get(name) || null; },
        write(name, value) { items.set(name, value.slice(0, 128)); },
        remove(name) { items.delete(name); },
      };
      const credential = { credential_id: 'new', refresh_token: 'refresh-' + 'z'.repeat(250) };
      try {
        assert.strictEqual(credentials.keychainLoad(origin, ops), null);
        credentials.keychainSave(origin, credential, ops);
        assert.deepStrictEqual(credentials.keychainLoad(origin, ops), credential);
        credentials.keychainDelete(origin, ops);
        assert.strictEqual(items.has(accountName), false);
        assert.deepStrictEqual(fs.readdirSync(credentials.cloudDir())
          .filter((name) => name.endsWith('.enc')), []);
      } finally {
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('macOS migrates an explicit file fallback when the old Keychain item is truncated', async () => {
      const previous = process.env.SDOCS_HOME;
      process.env.SDOCS_HOME = path.join(dir, 'keychain-file-migration');
      const origin = 'https://fallback.example';
      const accountName = Buffer.from(origin).toString('base64url');
      const items = new Map([[accountName, '{"credential_id":"old","access_token":"truncated']]);
      const ops = {
        read(name) { return items.get(name) || null; },
        write(name, value) { items.set(name, value.slice(0, 128)); },
        remove(name) { items.delete(name); },
      };
      const credential = { credential_id: 'fallback', refresh_token: 'file-secret' };
      try {
        credentials.atomicWrite(credentials.credentialFile(), { [origin]: credential });
        assert.deepStrictEqual(credentials.macLoad(origin, ops), credential);
        assert.strictEqual(fs.existsSync(credentials.credentialFile()), false);
        assert.deepStrictEqual(credentials.keychainLoad(origin, ops), credential);
      } finally {
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('macOS Keychain keeps the credential out of process arguments', async () => {
      const previous = process.env.SDOCS_HOME;
      process.env.SDOCS_HOME = path.join(dir, 'keychain-arguments');
      const credential = { refresh_token: 'argument-secret-' + 's'.repeat(200) };
      let invocation;
      try {
        credentials.keychainSave('https://arguments.example', credential,
          (command, args, options) => {
            invocation = { command, args, options };
            return { status: 0 };
          });
        assert.strictEqual(invocation.command, '/usr/bin/expect');
        assert.strictEqual(invocation.args[0], '-c');
        assert.ok(invocation.args[1].includes('retype.*item'));
        assert.ok(invocation.options.input.length < 129);
        assert.ok(!invocation.options.input.includes(credential.refresh_token));
        assert.ok(!invocation.args.join(' ').includes(credential.refresh_token));
        assert.strictEqual(invocation.options.env.SDOCS_KEYCHAIN_ACCOUNT,
          Buffer.from('https://arguments.example').toString('base64url'));
      } finally {
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('macOS Keychain read and write failures preserve existing encrypted files', async () => {
      const previous = process.env.SDOCS_HOME;
      process.env.SDOCS_HOME = path.join(dir, 'keychain-failures');
      const origin = 'https://keychain-failure.example';
      const oldFile = credentials.encryptedCredentialFile(origin);
      const oldValue = 'previous-encrypted-value';
      const credential = { refresh_token: 'replacement-secret' };
      try {
        credentials.atomicWrite(oldFile, { sentinel: oldValue });
        assert.throws(() => credentials.keychainSave(origin, credential, {
          read() { throw new Error('Keychain unavailable'); },
          write() { throw new Error('must not write'); },
          remove() {},
        }), /Keychain unavailable/);
        assert.ok(fs.readFileSync(oldFile, 'utf8').includes(oldValue));

        assert.throws(() => credentials.keychainSave(origin, credential, {
          read() { return null; },
          write() { throw new Error('Keychain write failed'); },
          remove() {},
        }), /Keychain write failed/);
        assert.ok(fs.readFileSync(oldFile, 'utf8').includes(oldValue));
        assert.deepStrictEqual(fs.readdirSync(credentials.cloudDir())
          .filter((name) => name.endsWith('.enc')), [path.basename(oldFile)]);
      } finally {
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('Windows DPAPI store round-trips credentials without plaintext files or secret arguments', async () => {
      const previous = process.env.SDOCS_HOME;
      process.env.SDOCS_HOME = path.join(dir, 'windows-dpapi');
      const calls = [];
      const execute = (command, args, options) => {
        calls.push({ command, args, input: options.input });
        if (args.join(' ').includes('::Protect(')) {
          return { status: 0, stdout: Buffer.from('wrapped:' + options.input).toString('base64') };
        }
        const decoded = Buffer.from(options.input, 'base64').toString('utf8');
        return { status: 0, stdout: decoded.replace(/^wrapped:/, '') };
      };
      const origin = 'https://windows.example';
      const credential = { refresh_token: 'windows-secret-' + 'w'.repeat(500) };
      try {
        credentials.windowsSave(origin, credential, execute);
        assert.deepStrictEqual(credentials.windowsLoad(origin, execute), credential);
        assert.strictEqual(fs.existsSync(credentials.credentialFile()), false);
        assert.strictEqual(fs.existsSync(credentials.dpapiCredentialFile(origin)), true);
        assert.ok(!fs.readFileSync(credentials.dpapiCredentialFile(origin), 'utf8')
          .includes(credential.refresh_token));
        assert.ok(calls.every((call) => !call.args.join(' ').includes(credential.refresh_token)));
        assert.ok(calls.every((call) => call.command === 'powershell.exe'));
        credentials.windowsRemove(origin, execute);
        assert.strictEqual(credentials.windowsLoad(origin, execute), null);
      } finally {
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('Windows migrates the legacy plaintext store into DPAPI on first use', async () => {
      const previous = process.env.SDOCS_HOME;
      process.env.SDOCS_HOME = path.join(dir, 'windows-migration');
      const execute = (_command, args, options) => {
        if (args.join(' ').includes('::Protect(')) {
          return { status: 0, stdout: Buffer.from(options.input).toString('base64') };
        }
        return { status: 0, stdout: Buffer.from(options.input, 'base64').toString('utf8') };
      };
      const origin = 'https://legacy-windows.example';
      const credential = { refresh_token: 'legacy-secret' };
      try {
        credentials.atomicWrite(credentials.credentialFile(), { [origin]: credential });
        assert.deepStrictEqual(credentials.windowsLoad(origin, execute), credential);
        assert.strictEqual(fs.existsSync(credentials.credentialFile()), false);
        assert.strictEqual(fs.existsSync(credentials.dpapiCredentialFile(origin)), true);
      } finally {
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('Windows stores each origin independently and preserves a valid file on DPAPI failure', async () => {
      const previous = process.env.SDOCS_HOME;
      process.env.SDOCS_HOME = path.join(dir, 'windows-independent');
      const execute = (_command, args, options) => {
        if (args.join(' ').includes('::Protect(')) {
          return { status: 0, stdout: Buffer.from(options.input).toString('base64') };
        }
        return { status: 0, stdout: Buffer.from(options.input, 'base64').toString('utf8') };
      };
      const one = 'https://one-windows.example';
      const two = 'https://two-windows.example';
      try {
        credentials.windowsSave(one, { refresh_token: 'one' }, execute);
        credentials.windowsSave(two, { refresh_token: 'two' }, execute);
        assert.notStrictEqual(credentials.dpapiCredentialFile(one), credentials.dpapiCredentialFile(two));
        credentials.windowsRemove(one, execute);
        assert.deepStrictEqual(credentials.windowsLoad(two, execute), { refresh_token: 'two' });

        const before = fs.readFileSync(credentials.dpapiCredentialFile(two), 'utf8');
        assert.throws(() => credentials.windowsSave(two, { refresh_token: 'replacement' },
          () => ({ status: 0, stdout: '' })), /Windows could not protect/);
        assert.strictEqual(fs.readFileSync(credentials.dpapiCredentialFile(two), 'utf8'), before);
      } finally {
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('Windows retries plaintext cleanup after a transient migration failure', async () => {
      const previous = process.env.SDOCS_HOME;
      process.env.SDOCS_HOME = path.join(dir, 'windows-cleanup-retry');
      const execute = (_command, args, options) => {
        if (args.join(' ').includes('::Protect(')) {
          return { status: 0, stdout: Buffer.from(options.input).toString('base64') };
        }
        return { status: 0, stdout: Buffer.from(options.input, 'base64').toString('utf8') };
      };
      const origin = 'https://cleanup-windows.example';
      const credential = { refresh_token: 'cleanup-secret' };
      const originalUnlink = fs.unlinkSync;
      try {
        credentials.atomicWrite(credentials.credentialFile(), { [origin]: credential });
        fs.unlinkSync = function(file, ...args) {
          if (path.resolve(file) === path.resolve(credentials.credentialFile())) {
            const error = new Error('file locked');
            error.code = 'EACCES';
            throw error;
          }
          return originalUnlink.call(fs, file, ...args);
        };
        assert.deepStrictEqual(credentials.windowsLoad(origin, execute), credential);
        assert.strictEqual(fs.existsSync(credentials.dpapiCredentialFile(origin)), true);
        assert.strictEqual(fs.existsSync(credentials.credentialFile()), true);

        fs.unlinkSync = originalUnlink;
        assert.deepStrictEqual(credentials.windowsLoad(origin, execute), credential);
        assert.strictEqual(fs.existsSync(credentials.credentialFile()), false);
      } finally {
        fs.unlinkSync = originalUnlink;
        process.env.SDOCS_HOME = previous;
      }
    });

    await testAsync('file credential fallback is owner-only and account-scoped', async () => {
      credentials.save('https://one.example', { refresh_token: 'secret-one' });
      credentials.save('https://two.example', { refresh_token: 'secret-two' });
      assert.strictEqual(credentials.load('https://one.example').refresh_token, 'secret-one');
      assert.strictEqual(fs.statSync(credentials.credentialFile()).mode & 0o777, 0o600);
      credentials.remove('https://one.example');
      assert.strictEqual(credentials.load('https://one.example'), null);
      assert.strictEqual(credentials.load('https://two.example').refresh_token, 'secret-two');
    });

    const account = { credential_id: 'cli-1', user_id: 'usr-1', access_token: 'access',
      access_token_expires_at: '2099-01-01T00:00:00.000Z', refresh_token: 'refresh' };
    const calls = [];
    const fakeClient = {
      origin: 'https://cloud.test',
      credentials: { remove() {} },
      loadCredential() { return account; },
      async authenticated(endpoint, options) {
        calls.push({ endpoint, options });
        if (endpoint === '/api/cloud/v1/account/documents') {
          return { account: { id: 'acct-1' }, document: { id: 'doc-1',
            current_revision_id: 'rev-1', revision_number: 1,
            updated_at: '2026-08-14T00:00:00.000Z', tags: ['release'] } };
        }
        if (endpoint === '/api/cloud/v1/account/members') {
          return { account_id: 'acct-1', members: [
            { user_id: 'usr-1', email: 'you@example.com', is_you: true },
            { user_id: 'usr-2', email: 'tom@example.com', is_you: false },
          ] };
        }
        if (endpoint === '/api/cloud/v1/account/tags') {
          return { account_id: 'acct-1', tags: [{ tag: 'release', count: 2 }] };
        }
        if (endpoint === '/api/cloud/v1/account/permission-groups') {
          return { account_id: 'acct-1', permission_groups: [
            { document_id: 'doc-1', mode: 'custom', member_user_ids: ['usr-1'] },
          ] };
        }
        if (endpoint === '/api/cloud/v1/documents/doc-1/permission') {
          return { permission: { document_id: 'doc-1', mode: 'custom',
            member_user_ids: ['usr-1', 'usr-2'] } };
        }
        if (endpoint === '/api/cloud/v1/documents/doc-1/tags') {
          return { document: { id: 'doc-1', current_revision_id: 'rev-tags',
            revision_number: 3, tags: ['release', 'planning'] } };
        }
        if (endpoint === '/api/cloud/v1/notifications') {
          return { notification: { id: 'notification-1',
            document_ids: ['doc-1', 'doc-2'], recipient_user_ids: ['usr-2'] } };
        }
        if (endpoint === '/api/cloud/v1/documents/doc-1/revisions' && options && options.method === 'POST') {
          const request = JSON.parse(options.body);
          return { document: { id: 'doc-1', current_revision_id: 'rev-2', revision_number: 2,
            updated_at: '2026-08-14T00:01:00.000Z', tags: ['release'],
            markdown: request.markdown, merge_classification: 'clean', combined: false,
            comment_id_remaps: [] } };
        }
        if (endpoint.startsWith('/api/cloud/v1/documents/doc-1/revisions?')) {
          const cursor = new URL(endpoint, 'https://cloud.test').searchParams.get('cursor');
          if (!cursor) return { revisions: [
            { id: 'rev-2', parent_revision_id: 'rev-1', revision_number: 2,
              created_by_user_id: 'usr-1', created_by_credential_id: 'cli-1',
              created_at: '2026-08-14T00:01:00.000Z', compressed_size: 20, uncompressed_size: 30 },
          ], next_cursor: 'history-cursor' };
          if (cursor === 'history-cursor') return { revisions: [
            { id: 'rev-1', parent_revision_id: null, revision_number: 1,
              created_by_user_id: 'usr-1', created_by_credential_id: 'cli-1',
              created_at: '2026-08-14T00:00:00.000Z', compressed_size: 18, uncompressed_size: 28 },
          ], next_cursor: null };
        }
        if (endpoint === '/api/cloud/v1/documents/doc-1/revisions/rev-1/restore') {
          return { document: { id: 'doc-1', current_revision_id: 'rev-3', revision_number: 3,
            restored_from_revision_id: 'rev-1', updated_at: '2026-08-14T00:02:00.000Z',
            tags: ['release'] } };
        }
        if (endpoint === '/api/cloud/v1/documents/doc-1') {
          return { document: { id: 'doc-1', current_revision_id: 'rev-2', revision_number: 2,
            updated_at: '2026-08-14T00:01:00.000Z', tags: ['release'], markdown: '# Release\nDone' } };
        }
        if (endpoint === '/api/cloud/v1/documents/deleted') {
          return { documents: [{ id: 'doc-1', title: 'Release', current_revision_id: 'rev-2',
            purge_after: '2026-09-14T00:00:00.000Z' }] };
        }
        if (endpoint === '/api/cloud/v1/documents/doc-1/restore') {
          return { document: { id: 'doc-1', current_revision_id: 'rev-2', revision_number: 2,
            tags: ['release'] } };
        }
        throw new Error('unexpected endpoint ' + endpoint);
      },
    };

    await testAsync('Cloud login JSON offers the Cloud-aware replacement skill', async () => {
      const client = {
        origin: 'https://cloud.test',
        loadCredential() { return account; },
        async authenticated() { return { user: { id: 'usr-1', email: 'agent@example.com' } }; },
      };
      const result = await capture(() => runCloudCommand({ file: 'login', jsonFlag: true }, { client }));
      assert.strictEqual(result.skill_mode, 'cloud');
      assert.strictEqual(result.already_logged_in, true);
      assert.ok(result.skill_install_command.includes('/agent-skills/cloud'));
    });

    await testAsync('Cloud logout leaves the installed skill and offers an explicit restore', async () => {
      const client = {
        origin: 'https://cloud.test',
        credentials: { remove() { throw new Error('no credential should be removed'); } },
        loadCredential() { return null; },
      };
      const result = await capture(() => runCloudCommand({ file: 'logout', jsonFlag: true }, { client }));
      assert.strictEqual(result.skill_unchanged, true);
      assert.ok(result.standard_skill_install_command.includes('/agent-skills/standard'));
    });

    async function capture(command) {
      let output = '';
      const original = process.stdout.write;
      process.stdout.write = function (value) { output += value; return true; };
      process.exitCode = 0;
      try { await command(); } finally { process.stdout.write = original; }
      return JSON.parse(output);
    }

    async function captureStreams(command) {
      let stdout = '';
      let stderr = '';
      const originalOut = process.stdout.write;
      const originalError = process.stderr.write;
      process.stdout.write = function(value) { stdout += value; return true; };
      process.stderr.write = function(value) { stderr += value; return true; };
      process.exitCode = 0;
      try { await command(); } finally {
        process.stdout.write = originalOut;
        process.stderr.write = originalError;
      }
      return { stdout, stderr, exitCode: process.exitCode };
    }

    await testAsync('bare cloud command explains capabilities without authentication or network access', async () => {
      let authenticated = false;
      const client = {
        loadCredential() { return null; },
        async authenticated() { authenticated = true; throw new Error('must not authenticate'); },
      };
      const result = await captureStreams(() => runCloudCommand({ file: null, jsonFlag: true }, { client }));
      const body = JSON.parse(result.stdout);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.command, 'cloud.overview');
      assert.strictEqual(body.cloud_available, true);
      assert.strictEqual(body.connected, false);
      assert.strictEqual(body.next_action, 'sdoc cloud login');
      assert.ok(body.capabilities.includes('revision_history'));
      assert.strictEqual(authenticated, false);
    });

    await testAsync('bare cloud command points a connected machine to explicit status', async () => {
      const client = { loadCredential() { return account; } };
      const result = await captureStreams(() => runCloudCommand({ file: null, jsonFlag: true }, { client }));
      const body = JSON.parse(result.stdout);
      assert.strictEqual(body.connected, true);
      assert.strictEqual(body.next_action, 'sdoc cloud status --json');
    });

    function entitlementClient(error, status) {
      return new CloudClient({
        origin: 'https://cloud.test',
        credentials: {
          load() { return account; },
          save() {},
          remove() {},
        },
        fetch: async () => ({
          ok: false,
          status: status || 402,
          json: async () => ({ ok: false, error, message: 'opaque server message' }),
        }),
      });
    }

    const source = path.join(dir, 'release.md');
    fs.writeFileSync(source, '# Release\nDraft');
    await testAsync('cloud create uploads headlessly and creates a persistent binding', async () => {
      const result = await capture(() => runCloudCommand({ file: 'create', extra: source,
        accountFlag: 'acct-1', jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.command, 'cloud.create');
      assert.strictEqual(result.document_id, 'doc-1');
      assert.strictEqual(bindings.get('usr-1', source).revision_id, 'rev-1');
      const baseFile = path.join(dir, 'cloud', 'bases', 'usr-1', 'doc-1', 'rev-1.md');
      assert.ok(fs.existsSync(baseFile));
      assert.strictEqual(fs.statSync(baseFile).mode & 0o777, 0o600);
      assert.strictEqual(bindings.readBase('usr-1', 'doc-1', 'rev-1'), '# Release\nDraft');
      assert.strictEqual(bindings.readBase('usr-1', '../../outside', 'rev-1'), null);
    });

    await testAsync('cloud create uses the default account without exposing projects', async () => {
      const accountSource = path.join(dir, 'account-release.md');
      fs.writeFileSync(accountSource, '# Account release');
      const result = await capture(() => runCloudCommand({ file: 'create', extra: accountSource,
        jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(result.account_id, 'acct-1');
      assert.strictEqual(Object.hasOwn(result, 'project_id'), false);
      assert.ok(calls.some((call) => call.endpoint === '/api/cloud/v1/account/documents'));
    });

    await testAsync('cloud lists account members, tags, and document permission groups', async () => {
      const memberResult = await capture(() => runCloudCommand({ file: 'members',
        jsonFlag: true }, { client: fakeClient }));
      const tagResult = await capture(() => runCloudCommand({ file: 'tags',
        jsonFlag: true }, { client: fakeClient }));
      const groupResult = await capture(() => runCloudCommand({ file: 'permission-groups',
        jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(memberResult.members[1].user_id, 'usr-2');
      assert.strictEqual(tagResult.tags[0].tag, 'release');
      assert.strictEqual(groupResult.permission_groups[0].document_id, 'doc-1');
    });

    await testAsync('cloud assigns document members and tags', async () => {
      const accessResult = await capture(() => runCloudCommand({ file: 'access', extra: 'doc-1',
        memberFlags: ['usr-2'], jsonFlag: true }, { client: fakeClient }));
      const tagResult = await capture(() => runCloudCommand({ file: 'tag', extra: 'doc-1',
        tagFilters: ['release', 'planning'], jsonFlag: true }, { client: fakeClient }));
      assert.deepStrictEqual(accessResult.permission.member_user_ids, ['usr-1', 'usr-2']);
      assert.deepStrictEqual(tagResult.tags, ['release', 'planning']);
    });

    await testAsync('cloud notifies existing members about one or more documents', async () => {
      const callStart = calls.length;
      const result = await capture(() => runCloudCommand({ file: 'notify', extra: 'doc-1',
        documentFlags: ['doc-2'], memberFlags: ['usr-2'],
        noteText: 'Review these together.', jsonFlag: true },
      { client: fakeClient }));
      assert.strictEqual(result.notification_id, 'notification-1');
      assert.deepStrictEqual(result.document_ids, ['doc-1', 'doc-2']);
      const call = calls.slice(callStart).find((item) =>
        item.endpoint === '/api/cloud/v1/notifications');
      const body = JSON.parse(call.options.body);
      assert.deepStrictEqual(body.document_ids, ['doc-1', 'doc-2']);
      assert.deepStrictEqual(body.recipient_user_ids, ['usr-2']);
      assert.strictEqual(body.note, 'Review these together.');
      assert.ok(body.idempotency_key);
    });

    await testAsync('cloud push uses the bound base revision and advances only after success', async () => {
      fs.writeFileSync(source, '# Release\nDone');
      const result = await capture(() => runCloudCommand({ file: 'push', extra: source,
        jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(result.revision_id, 'rev-2');
      const request = JSON.parse(calls.find((call) => call.endpoint.endsWith('/revisions')).options.body);
      assert.strictEqual(request.target_revision_id, 'rev-1');
      assert.strictEqual(request.target_markdown,
        bindings.readBase('usr-1', 'doc-1', 'rev-1'));
      assert.strictEqual(bindings.get('usr-1', source).revision_id, 'rev-2');
    });

    await testAsync('cloud push explicit identities override a stale local binding after conflict resolution', async () => {
      fs.writeFileSync(source, '# Release\nMerged result');
      const callStart = calls.length;
      const result = await capture(() => runCloudCommand({ file: 'push', extra: source,
        documentFlag: 'doc-1', baseRevisionFlag: 'rev-current', jsonFlag: true },
      { client: fakeClient }));
      const request = JSON.parse(calls.slice(callStart)[0].options.body);
      assert.strictEqual(request.target_revision_id, 'rev-current');
      assert.strictEqual(request.target_markdown, undefined);
      assert.strictEqual(result.base_revision_id, 'rev-current');
    });

    await testAsync('cloud push writes combined Cloud content back to an unchanged agent file', async () => {
      const mergedSource = path.join(dir, 'merged.md');
      const local = '# Plan\n\nAgent edit.';
      const merged = '# Plan\n\nHuman edit.\n\nAgent edit.';
      fs.writeFileSync(mergedSource, local);
      bindings.set('usr-1', mergedSource, { document_id: 'doc-merge', revision_id: 'rev-base',
        content_sha256: bindings.hash('# Plan\n\nBase.'), updated_at: '2026-08-14T00:00:00.000Z' });
      bindings.cacheBase('usr-1', 'doc-merge', 'rev-base', '# Plan\n\nBase.');
      let request;
      const mergedClient = {
        loadCredential() { return account; },
        async authenticated(endpoint, options) {
          request = JSON.parse(options.body);
          return { document: { id: 'doc-merge', current_revision_id: 'rev-merged',
            revision_number: 3, updated_at: '2026-08-14T00:02:00.000Z', tags: [],
            markdown: merged, merge_classification: 'combined', combined: true,
            comment_id_remaps: [] } };
        },
      };
      const result = await capture(() => runCloudCommand({ file: 'push', extra: mergedSource,
        jsonFlag: true }, { client: mergedClient }));
      assert.strictEqual(request.target_revision_id, 'rev-base');
      assert.strictEqual(request.target_markdown, '# Plan\n\nBase.');
      assert.strictEqual(fs.readFileSync(mergedSource, 'utf8'), merged);
      assert.strictEqual(bindings.get('usr-1', mergedSource).revision_id, 'rev-merged');
      assert.strictEqual(bindings.get('usr-1', mergedSource).content_sha256,
        bindings.hash(merged));
      assert.strictEqual(result.combined, true);
      assert.strictEqual(result.local_updated_from_cloud, true);
    });

    await testAsync('cloud push does not overwrite edits made while an upload is in flight', async () => {
      const changingSource = path.join(dir, 'changing.md');
      fs.writeFileSync(changingSource, '# Plan\n\nFirst agent edit.');
      bindings.set('usr-1', changingSource, { document_id: 'doc-changing',
        revision_id: 'rev-base', content_sha256: bindings.hash('# Plan\n\nBase.'),
        updated_at: '2026-08-14T00:00:00.000Z' });
      const changingClient = {
        loadCredential() { return account; },
        async authenticated() {
          fs.writeFileSync(changingSource, '# Plan\n\nSecond agent edit.');
          return { document: { id: 'doc-changing', current_revision_id: 'rev-cloud',
            revision_number: 2, updated_at: '2026-08-14T00:01:00.000Z', tags: [],
            markdown: '# Plan\n\nHuman edit.\n\nFirst agent edit.',
            merge_classification: 'combined', combined: true, comment_id_remaps: [] } };
        },
      };
      const result = await capture(() => runCloudCommand({ file: 'push', extra: changingSource,
        jsonFlag: true }, { client: changingClient }));
      assert.strictEqual(fs.readFileSync(changingSource, 'utf8'), '# Plan\n\nSecond agent edit.');
      assert.strictEqual(bindings.get('usr-1', changingSource).revision_id, 'rev-base');
      assert.strictEqual(result.local_changed_after_upload, true);
      assert.strictEqual(result.local_updated_from_cloud, false);
    });

    await testAsync('cloud history returns stable revision JSON', async () => {
      const result = await capture(() => runCloudCommand({ file: 'history', extra: 'doc-1',
        jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.command, 'cloud.history');
      assert.strictEqual(result.document_id, 'doc-1');
      assert.strictEqual(result.revisions.length, 2);
      assert.strictEqual(result.revisions[0].id, 'rev-2');
      assert.strictEqual(result.revisions[0].revision_number, 2);
      assert.strictEqual(result.next_cursor, null);
    });

    await testAsync('cloud ls follows cursors until it returns the requested limit', async () => {
      const pageCalls = [];
      const pages = {
        '': { documents: [{ id: 'doc-a', title: 'A', tags: [] }], next_cursor: 'cursor-1' },
        'cursor-1': { documents: [{ id: 'doc-b', title: 'B', tags: [] }], next_cursor: 'cursor-2' },
        'cursor-2': { documents: [{ id: 'doc-c', title: 'C', tags: [] }], next_cursor: 'cursor-3' },
      };
      const pagingClient = {
        async authenticated(endpoint) {
          const url = new URL(endpoint, 'https://cloud.test');
          const cursor = url.searchParams.get('cursor') || '';
          pageCalls.push({ cursor, limit: url.searchParams.get('limit'),
            account: url.searchParams.get('workspace_id') });
          return pages[cursor];
        },
      };
      const result = await capture(() => runCloudCommand({ file: 'ls', accountFlag: 'acct-docs',
        limitFlag: 3, jsonFlag: true }, { client: pagingClient }));
      assert.deepStrictEqual(result.documents.map((document) => document.id), ['doc-a', 'doc-b', 'doc-c']);
      assert.strictEqual(result.next_cursor, 'cursor-3');
      assert.deepStrictEqual(pageCalls, [
        { cursor: '', limit: '3', account: 'acct-docs' },
        { cursor: 'cursor-1', limit: '2', account: 'acct-docs' },
        { cursor: 'cursor-2', limit: '1', account: 'acct-docs' },
      ]);
    });

    await testAsync('cloud restore reads the current head and sends an idempotent expected-head write', async () => {
      const callStart = calls.length;
      const result = await capture(() => runCloudCommand({ file: 'restore', extra: 'doc-1',
        revisionFlag: 'rev-1', jsonFlag: true }, { client: fakeClient }));
      const restoreCalls = calls.slice(callStart);
      assert.strictEqual(restoreCalls.length, 2);
      assert.strictEqual(restoreCalls[0].endpoint, '/api/cloud/v1/documents/doc-1');
      assert.strictEqual(restoreCalls[1].endpoint, '/api/cloud/v1/documents/doc-1/revisions/rev-1/restore');
      assert.strictEqual(restoreCalls[1].options.method, 'POST');
      const request = JSON.parse(restoreCalls[1].options.body);
      assert.strictEqual(request.expected_head_revision_id, 'rev-2');
      assert.strictEqual(typeof request.idempotency_key, 'string');
      assert.ok(request.idempotency_key.length > 20);
      assert.deepStrictEqual(result, {
        ok: true,
        command: 'cloud.restore',
        document_id: 'doc-1',
        base_revision_id: 'rev-2',
        restored_from_revision_id: 'rev-1',
        revision_id: 'rev-3',
        revision_number: 3,
        tags: ['release'],
      });
      assert.strictEqual(bindings.getOperationPending('usr-1', 'restore', 'doc-1:rev-1'), null);
    });

    await testAsync('cloud deleted documents can be discovered and restored', async () => {
      const deleted = await capture(() => runCloudCommand({ file: 'deleted', jsonFlag: true },
        { client: fakeClient }));
      assert.strictEqual(deleted.documents[0].current_revision_id, 'rev-2');
      const restored = await capture(() => runCloudCommand({ file: 'undelete', extra: 'doc-1',
        baseRevisionFlag: 'rev-2', jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(restored.command, 'cloud.undelete');
      assert.strictEqual(restored.revision_id, 'rev-2');
    });

    await testAsync('cloud pull refuses to replace an unbound file without force', async () => {
      const output = path.join(dir, 'existing.md');
      fs.writeFileSync(output, 'local');
      const result = await capture(() => runCloudCommand({ file: 'pull', extra: 'doc-1',
        outputPath: output, jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'unsafe_local_state');
      assert.strictEqual(process.exitCode, 6);
      assert.strictEqual(fs.readFileSync(output, 'utf8'), 'local');
    });

    await testAsync('cloud pull protects bound paths and historical revisions', async () => {
      const output = path.join(dir, 'bound-output.md');
      fs.writeFileSync(output, '# Existing');
      bindings.set('usr-1', output, { document_id: 'doc-other', revision_id: 'rev-other',
        content_sha256: bindings.hash('# Existing') });
      const different = await capture(() => runCloudCommand({ file: 'pull', extra: 'doc-1',
        outputPath: output, jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(different.error, 'unsafe_local_state');
      const noBind = await capture(() => runCloudCommand({ file: 'pull', extra: 'doc-1',
        outputPath: output, noBindFlag: true, jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(noBind.error, 'unsafe_local_state');
      const historicalOutput = path.join(dir, 'historical.md');
      const historical = await capture(() => runCloudCommand({ file: 'pull', extra: 'doc-1',
        revisionFlag: 'rev-1', outputPath: historicalOutput, jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(historical.error, 'unsafe_local_state');
      assert.strictEqual(fs.existsSync(historicalOutput), false);
    });

    await testAsync('cloud search sends tag filters before the server limit', async () => {
      let requestBody;
      const searchClient = {
        async authenticated(endpoint, options) {
          assert.strictEqual(endpoint, '/api/cloud/v1/search');
          requestBody = JSON.parse(options.body);
          return { documents: [{ id: 'doc-tagged', tags: ['platform'] }] };
        },
      };
      const result = await capture(() => runCloudCommand({ file: 'search', extra: 'kubernetes',
        accountFlag: 'acct-platform', tagFilters: ['platform'], limitFlag: 1, jsonFlag: true },
      { client: searchClient }));
      assert.deepStrictEqual(requestBody.tags, ['platform']);
      assert.strictEqual(requestBody.limit, 1);
      assert.strictEqual(requestBody.workspace_id, 'acct-platform');
      assert.strictEqual(result.documents[0].id, 'doc-tagged');
    });

    await testAsync('local Cloud file commands report login_required before using account state', async () => {
      const noCredential = { loadCredential() { return null; } };
      const commands = [
        { file: 'create', extra: source, accountFlag: 'acct-1', jsonFlag: true },
        { file: 'pull', extra: 'doc-1', outputPath: path.join(dir, 'signed-out.md'), jsonFlag: true },
        { file: 'push', extra: source, jsonFlag: true },
      ];
      for (const opts of commands) {
        const result = await captureStreams(() => runCloudCommand(opts, { client: noCredential }));
        const body = JSON.parse(result.stdout);
        assert.strictEqual(body.error, 'login_required');
        assert.strictEqual(result.exitCode, 3);
        assert.strictEqual(result.stderr, '');
      }
    });

    await testAsync('Cloud network failures have stable temporary-service JSON and exit behavior', async () => {
      const client = new CloudClient({
        origin: 'https://cloud.test',
        credentials: { load() { return account; }, save() {}, remove() {} },
        fetch: async () => { throw new Error('socket closed'); },
      });
      const result = await captureStreams(() => runCloudCommand({ file: 'status', jsonFlag: true }, { client }));
      const body = JSON.parse(result.stdout);
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.command, 'cloud.status');
      assert.strictEqual(body.error, 'temporary_service_failure');
      assert.strictEqual(body.message, 'Could not reach SmallDocs Cloud.');
      assert.strictEqual(result.exitCode, 7);
      assert.strictEqual(result.stderr, '');
    });

    await testAsync('multi-account status requires an explicit account and lists the choices', async () => {
      const client = new CloudClient({
        origin: 'https://cloud.test',
        credentials: { load() { return account; }, save() {}, remove() {} },
        fetch: async () => ({ ok: false, status: 409, json: async () => ({
          ok: false, error: 'account_selection_required', accounts: [
            { id: 'acct-personal', name: 'Josh Summers' },
            { id: 'acct-team', name: 'SmallDocs' },
          ],
        }) }),
      });
      const result = await captureStreams(() => runCloudCommand({ file: 'status', jsonFlag: true },
        { client }));
      const body = JSON.parse(result.stdout);
      assert.strictEqual(body.error, 'account_selection_required');
      assert.ok(body.message.includes('Choose an account with --account.'));
      assert.ok(body.message.includes('SmallDocs (acct-team)'));
      assert.strictEqual(result.exitCode, 4);
    });

    await testAsync('cloud create explains a required subscription and exits nonzero', async () => {
      const fresh = path.join(dir, 'new-cloud-file.md');
      fs.writeFileSync(fresh, '# New document');
      const result = await captureStreams(() => runCloudCommand({ file: 'create', extra: fresh,
        accountFlag: 'acct-1' }, { client: entitlementClient('subscription_required') }));
      assert.strictEqual(result.stdout, '');
      assert.strictEqual(result.exitCode, 4);
      assert.ok(result.stderr.includes('active SmallDocs Cloud subscription'));
      assert.ok(result.stderr.includes('Subscribe: https://cloud.test/cloud#pricing'));
    });

    await testAsync('cloud push emits one stable JSON error for a read-only subscription', async () => {
      fs.writeFileSync(source, '# Release\nChanged again');
      const result = await captureStreams(() => runCloudCommand({ file: 'push', extra: source,
        jsonFlag: true }, { client: entitlementClient('read_only') }));
      const lines = result.stdout.trim().split('\n');
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(result.exitCode, 4);
      assert.deepStrictEqual(JSON.parse(lines[0]), {
        ok: false,
        error: 'subscription_read_only',
        message: 'This Cloud account is read-only because its subscription is not active. Ask an account owner to update billing.',
        http_status: 402,
        action: 'manage_billing',
        billing_url: 'https://cloud.test/cloud/admin',
        command: 'cloud.push',
      });
    });

    await testAsync('cloud delete sends the expected head and preserves JSON entitlement details', async () => {
      const client = entitlementClient('payment_grace_expired');
      let request;
      const originalFetch = client.fetch;
      client.fetch = async (url, options) => { request = { url, options }; return originalFetch(url, options); };
      const result = await captureStreams(() => runCloudCommand({ file: 'delete', extra: 'doc-1',
        baseRevisionFlag: 'rev-2', jsonFlag: true }, { client }));
      const body = JSON.parse(result.stdout);
      assert.strictEqual(request.options.method, 'DELETE');
      assert.deepStrictEqual(JSON.parse(request.options.body), { expected_head_revision_id: 'rev-2' });
      assert.strictEqual(body.command, 'cloud.delete');
      assert.strictEqual(body.error, 'payment_grace_expired');
      assert.strictEqual(body.action, 'manage_billing');
      assert.strictEqual(body.billing_url, 'https://cloud.test/cloud/admin');
      assert.strictEqual(body.ok, false);
      assert.strictEqual(result.exitCode, 4);
      assert.strictEqual(result.stderr, '');
    });

    process.exitCode = 0;
    if (previousHome === undefined) delete process.env.SDOCS_HOME; else process.env.SDOCS_HOME = previousHome;
    if (previousFileCredentials === undefined) delete process.env.SDOCS_CLOUD_FILE_CREDENTIALS;
    else process.env.SDOCS_CLOUD_FILE_CREDENTIALS = previousFileCredentials;
    fs.rmSync(dir, { recursive: true, force: true });
  };
};
