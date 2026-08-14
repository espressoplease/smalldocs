const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function(harness) {
  const { assert, test, testAsync } = harness;
  const io = require('../cli/lib/io');
  const credentials = require('../cli/lib/cloud-credentials');
  const bindings = require('../cli/lib/cloud-bindings');
  const { runCloudCommand, filterTags } = require('../cli/lib/cloud-commands');

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
        if (endpoint === '/api/cloud/v1/documents') {
          return { document: { id: 'doc-1', current_revision_id: 'rev-1', revision_number: 1,
            updated_at: '2026-08-14T00:00:00.000Z', tags: ['release'] } };
        }
        if (endpoint === '/api/cloud/v1/documents/doc-1/revisions') {
          return { document: { id: 'doc-1', current_revision_id: 'rev-2', revision_number: 2,
            updated_at: '2026-08-14T00:01:00.000Z', tags: ['release'] } };
        }
        if (endpoint === '/api/cloud/v1/documents/doc-1') {
          return { document: { id: 'doc-1', current_revision_id: 'rev-2', revision_number: 2,
            updated_at: '2026-08-14T00:01:00.000Z', tags: ['release'], markdown: '# Release\nDone' } };
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

    const source = path.join(dir, 'release.md');
    fs.writeFileSync(source, '# Release\nDraft');
    await testAsync('cloud create uploads headlessly and creates a persistent binding', async () => {
      const result = await capture(() => runCloudCommand({ file: 'create', extra: source,
        projectFlag: 'project-1', jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.command, 'cloud.create');
      assert.strictEqual(result.document_id, 'doc-1');
      assert.strictEqual(bindings.get('usr-1', source).revision_id, 'rev-1');
      assert.ok(fs.existsSync(path.join(dir, 'cloud', 'bases', 'usr-1', 'doc-1', 'rev-1.md')));
    });

    await testAsync('cloud push uses the bound base revision and advances only after success', async () => {
      fs.writeFileSync(source, '# Release\nDone');
      const result = await capture(() => runCloudCommand({ file: 'push', extra: source,
        jsonFlag: true }, { client: fakeClient }));
      assert.strictEqual(result.revision_id, 'rev-2');
      const request = JSON.parse(calls.find((call) => call.endpoint.endsWith('/revisions')).options.body);
      assert.strictEqual(request.expected_head_revision_id, 'rev-1');
      assert.strictEqual(bindings.get('usr-1', source).revision_id, 'rev-2');
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

    process.exitCode = 0;
    if (previousHome === undefined) delete process.env.SDOCS_HOME; else process.env.SDOCS_HOME = previousHome;
    if (previousFileCredentials === undefined) delete process.env.SDOCS_CLOUD_FILE_CREDENTIALS;
    else process.env.SDOCS_CLOUD_FILE_CREDENTIALS = previousFileCredentials;
    fs.rmSync(dir, { recursive: true, force: true });
  };
};
