const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function(harness) {
  const { assert, test, testAsync } = harness;
  const io = require('../cli/lib/io');
  const credentials = require('../cli/lib/cloud-credentials');
  const bindings = require('../cli/lib/cloud-bindings');
  const { CloudClient, runCloudCommand, filterTags } = require('../cli/lib/cloud-commands');

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

  return async function() {
    console.log('\n-- Cloud CLI Tests ------------------------------------\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-cli-'));
    const previousHome = process.env.SDOCS_HOME;
    const previousFileCredentials = process.env.SDOCS_CLOUD_FILE_CREDENTIALS;
    process.env.SDOCS_HOME = dir;
    process.env.SDOCS_CLOUD_FILE_CREDENTIALS = '1';

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
      assert.ok(fs.existsSync(path.join(dir, 'cloud', 'bases', 'usr-1', 'doc-1', 'rev-1.md')));
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
      assert.strictEqual(result.base_revision_id, 'rev-current');
    });

    await testAsync('cloud push writes combined Cloud content back to an unchanged agent file', async () => {
      const mergedSource = path.join(dir, 'merged.md');
      const local = '# Plan\n\nAgent edit.';
      const merged = '# Plan\n\nHuman edit.\n\nAgent edit.';
      fs.writeFileSync(mergedSource, local);
      bindings.set('usr-1', mergedSource, { document_id: 'doc-merge', revision_id: 'rev-base',
        content_sha256: bindings.hash('# Plan\n\nBase.'), updated_at: '2026-08-14T00:00:00.000Z' });
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
          pageCalls.push({ cursor, limit: url.searchParams.get('limit') });
          return pages[cursor];
        },
      };
      const result = await capture(() => runCloudCommand({ file: 'ls', limitFlag: 3,
        jsonFlag: true }, { client: pagingClient }));
      assert.deepStrictEqual(result.documents.map((document) => document.id), ['doc-a', 'doc-b', 'doc-c']);
      assert.strictEqual(result.next_cursor, 'cursor-3');
      assert.deepStrictEqual(pageCalls, [
        { cursor: '', limit: '3' },
        { cursor: 'cursor-1', limit: '2' },
        { cursor: 'cursor-2', limit: '1' },
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
        tagFilters: ['platform'], limitFlag: 1, jsonFlag: true }, { client: searchClient }));
      assert.deepStrictEqual(requestBody.tags, ['platform']);
      assert.strictEqual(requestBody.limit, 1);
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
