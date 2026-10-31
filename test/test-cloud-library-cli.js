module.exports = function (h) {
  const { assert, testAsync } = h;
  const { runCloudCommand } = require('../cli/lib/cloud-commands');
  return async function () {
    const calls = [];
    const client = { origin: 'https://smalldocs.org', loadCredential: () => ({ credential_id: 'computer-a', user_id: 'user-a' }),
      authenticated: async (endpoint, options) => {
        calls.push({ endpoint, options });
        if (endpoint === '/api/cloud/v1/library-settings') return { libraries: [{ id: 'library-b', name: 'Engineering' }] };
        if (endpoint === '/api/cloud/v1/cli/library-default') return { workspace_id: 'library-b' };
        if (endpoint.includes('/library-default')) return { workspace_id: JSON.parse(options.body).workspace_id };
        if (endpoint === '/api/cloud/v1/documents/document-a') return { document: { id: 'document-a', title: 'A document', current_revision_id: 'revision-a' }, permission: { can_manage: true } };
        if (endpoint.endsWith('/library')) return { document: { id: 'document-a', workspace_id: 'library-b' }, permission: { mode: 'custom' } };
        throw new Error('Unexpected endpoint: ' + endpoint);
      } };
    async function run(opts) {
      let out = ''; const write = process.stdout.write;
      process.stdout.write = function (chunk) { out += chunk; return true; };
      try { await runCloudCommand({ jsonFlag: true, ...opts }, { client }); return JSON.parse(out); }
      finally { process.stdout.write = write; }
    }
    await testAsync('library CLI lists accessible libraries without selecting a browser default', async () => {
      assert.strictEqual((await run({ file: 'libraries' })).libraries[0].id, 'library-b');
      assert.strictEqual(calls.at(-1).endpoint, '/api/cloud/v1/library-settings');
    });
    await testAsync('library default reads and updates the authenticated computer only', async () => {
      assert.strictEqual((await run({ file: 'library-default' })).workspace_id, 'library-b');
      await run({ file: 'library-default', extra: 'library-b' });
      assert.strictEqual(calls.at(-1).endpoint, '/api/cloud/v1/cli/credentials/computer-a/library-default');
      await run({ file: 'library-default', extra: 'clear' });
      assert.strictEqual(JSON.parse(calls.at(-1).options.body).workspace_id, null);
    });
    await testAsync('move dry-run returns a Cloud URL and permission consequence without mutation', async () => {
      calls.length = 0;
      const result = await run({ file: 'move', extra: 'document-a', accountFlag: 'library-b', dryRunFlag: true });
      assert.strictEqual(result.url, 'https://smalldocs.org/docs?cloud-document=document-a');
      assert.strictEqual(result.access_after_move, 'only_you');
      assert.ok(calls.every(call => !call.options));
    });
    await testAsync('move submits the current revision and retains the canonical document URL', async () => {
      const result = await run({ file: 'move', extra: 'document-a', accountFlag: 'library-b' });
      assert.strictEqual(JSON.parse(calls.at(-1).options.body).expected_head_revision_id, 'revision-a');
      assert.strictEqual(result.url, 'https://smalldocs.org/docs?cloud-document=document-a');
      assert.strictEqual(result.workspace_id, 'library-b');
    });
  };
};
