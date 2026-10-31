const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function (h) {
  const { assert, test, testAsync } = h;
  const io = require('../cli/lib/io');
  const bindings = require('../cli/lib/cloud-bindings');
  const editTools = require('../cli/lib/cloud-edit');
  const { CloudClient, CloudCommandError, runCloudCommand, CLOUD_EDIT_HELP, CLOUD_READ_HELP } = require('../cli/lib/cloud-commands');

  test('Cloud edit parser preserves literal text and empty replacement values', () => {
    const opts = io.parseArgs(['cloud', 'edit', 'doc', '--old', '+tag\n10:30', '--new', '',
      '--section', 'Pricing', '--occurrence', '2', '--base-revision', 'base', '--json']);
    assert.strictEqual(opts.extra, 'doc');
    assert.strictEqual(opts.oldTextFlag, '+tag\n10:30');
    assert.strictEqual(opts.newTextFlag, '');
    assert.deepStrictEqual(opts.addTags, []);
    assert.deepStrictEqual(opts.annotations, []);
    assert.deepStrictEqual(editTools.editRequest(opts), { edits: [{ old_text: '+tag\n10:30', new_text: '',
      section: 'Pricing', occurrence: 2 }], reject_conflicts: false, expected_current_revision_id: undefined });
    const leadingDashes = editTools.editRequest(io.parseArgs(['cloud', 'edit', 'doc', '--old=--before', '--new=--after']));
    assert.strictEqual(leadingDashes.edits[0].old_text, '--before');
    assert.strictEqual(leadingDashes.edits[0].new_text, '--after');
  });

  test('Cloud read parser distinguishes selections from file and editor flags', () => {
    const opts = io.parseArgs(['cloud', 'read', 'doc', '--lines', '10:30', '--revision', 'old', '--json']);
    assert.strictEqual(opts.linesFlag, '10:30');
    assert.strictEqual(opts.revisionFlag, 'old');
    assert.strictEqual(opts.extra, 'doc');
    assert.deepStrictEqual(opts.cloudContentArgumentErrors, []);
    assert.ok(io.parseArgs(['cloud', 'read', 'doc', '--line', '1:4']).cloudContentArgumentErrors[0].includes('--line'));
    assert.ok(io.parseArgs(['cloud', 'edit', 'doc', '--old', '--json']).cloudContentArgumentErrors[0].includes('requires a value'));
  });

  test('inline JSON batches share file batch validation and preserve literal values', () => {
    const opts = io.parseArgs(['cloud', 'edit', 'doc', '--edits', JSON.stringify([
      { old_text: 'Draft', new_text: 'Final', section: 'Pricing' },
      { old_text: 'Remove me', new_text: '' },
    ]), '--json']);
    assert.deepStrictEqual(editTools.editRequest(opts).edits, [
      { old_text: 'Draft', new_text: 'Final', section: 'Pricing' },
      { old_text: 'Remove me', new_text: '' },
    ]);
    assert.throws(() => editTools.editRequest(io.parseArgs(['cloud', 'edit', 'doc', '--edits', '[bad]'])),
      e => e.code === 'invalid_request' && e.message.includes('--edits'));
    assert.throws(() => editTools.editRequest(io.parseArgs(['cloud', 'edit', 'doc', '--edits', '[]', '--old', 'a', '--new', 'b'])),
      e => e.code === 'invalid_request');
  });

  test('Cloud targeted edit and read help explain bases, batching, ambiguity and full replacements', () => {
    for (const text of ['old_text', 'new_text', 'context_before', '--patch-file', '--base-revision',
      '--occurrence', '--all-matches', 'edit_ambiguous', 'idempotency key', '--if-current',
      '--reject-conflicts', 'cloud pull', 'cloud push']) assert.ok(CLOUD_EDIT_HELP.includes(text), text);
    for (const text of ['--outline', '--section', '--lines', '--revision', 'sha256', 'selection']) {
      assert.ok(CLOUD_READ_HELP.includes(text), text);
    }
    assert.ok(![8211, 8212].some(code => (CLOUD_EDIT_HELP + CLOUD_READ_HELP).includes(String.fromCharCode(code))));
  });

  return async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-edit-cli-'));
    const previousHome = process.env.SDOCS_HOME;
    process.env.SDOCS_HOME = dir;
    const credential = { user_id: 'editor', access_token: 'token',
      access_token_expires_at: new Date(Date.now() + 3600000).toISOString() };
    async function capture(action) {
      const previousWrite = process.stdout.write;
      const previousErrorWrite = process.stderr.write;
      const previousExit = process.exitCode;
      let stdout = '', stderr = '';
      process.stdout.write = text => { stdout += String(text); return true; };
      process.stderr.write = text => { stderr += String(text); return true; };
      process.exitCode = undefined;
      try {
        await action();
        return { stdout, stderr, exitCode: process.exitCode || 0,
          json: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null };
      } finally {
        process.stdout.write = previousWrite;
        process.stderr.write = previousErrorWrite;
        process.exitCode = previousExit;
      }
    }
    function fakeClient(handle) {
      const calls = [];
      let credentialReads = 0;
      return { origin: 'https://cloud.test', calls,
        get credentialReads() { return credentialReads; },
        loadCredential() { credentialReads++; return credential; },
        async authenticated(endpoint, options) {
          const call = { endpoint, body: options && JSON.parse(options.body), options };
          calls.push(call);
          return handle(call);
        } };
    }
    function receipt(documentId, extra = {}) {
      return { document: { document_id: documentId, revision_id: 'saved', current_revision_id: 'saved',
        revision_number: 3, saved_sha256: bindings.hash('Saved'), matched_count: 1,
        applied_edits: [{ edit_index: 0, matched_count: 1 }], merge_classification: 'direct',
        combined: false, overlapping_edits_preserved: false, diff: { changed: true, hunks: [] }, ...extra } };
    }
    const run = (args, client) => capture(() => runCloudCommand(io.parseArgs(['cloud', ...args]), { client }));
    try {
      await testAsync('Cloud read and edit reject invalid flags before credential access or network', async () => {
        const client = fakeClient(() => { throw new Error('must not request'); });
        const invalid = [
          ['edit', 'doc', '--old', 'A', '--new', 'B', '--unknown'],
          ['edit', 'doc', '--old', 'A', '--new', 'B', '--revision', 'old'],
          ['edit', 'doc', '--old', 'A', '--new', 'B', '--section', 'A', '--lines', '1:2'],
          ['edit', 'doc', '--old', 'A', '--new', 'B', '--occurrence', '2', '--all-matches'],
          ['edit', 'doc', '--old', 'A', '--new', 'B', '--lines', '0:2'],
          ['edit', 'doc', '--old', 'A', '--new', 'B', '--occurrence', '1.5'],
          ['edit', 'doc', '--old', 'A'],
          ['edit', 'doc', '--old', '', '--new', 'B'],
          ['edit', 'doc', '--old', 'A', '--new', 'B', '--base-revision', ''],
          ['read', 'doc', '--outline', '--section', 'Pricing'],
          ['read', 'doc', '--lines', '30:10'],
          ['read', 'doc', '--section', ''],
          ['read', 'doc', '--old', 'A'],
          ['read', 'doc', 'unexpected'],
        ];
        for (const args of invalid) {
          const result = await run([...args, '--json'], client);
          assert.strictEqual(result.json.error, 'invalid_request', args.join(' '));
          assert.strictEqual(result.exitCode, 2);
        }
        assert.strictEqual(client.credentialReads, 0);
        assert.strictEqual(client.calls.length, 0);
        assert.deepStrictEqual(fs.readdirSync(dir), []);
      });

      await testAsync('Cloud read and edit help stay read-only even with incomplete flags', async () => {
        const client = fakeClient(() => { throw new Error('must not request'); });
        const edit = await run(['edit', '--old', '--help'], client);
        const read = await run(['read', '--help'], client);
        assert.ok(edit.stdout.includes('SmallDocs Cloud edit'));
        assert.ok(read.stdout.includes('SmallDocs Cloud read'));
        assert.strictEqual(edit.exitCode, 0);
        assert.strictEqual(client.credentialReads, 0);
        assert.strictEqual(client.calls.length, 0);
        assert.deepStrictEqual(fs.readdirSync(dir), []);
      });

      await testAsync('Cloud targeted reads request only selected content and preserve the full document hash', async () => {
        const hash = bindings.hash('The full document');
        const client = fakeClient(call => {
          const url = new URL(call.endpoint, 'https://cloud.test');
          assert.strictEqual(url.pathname, '/api/cloud/v1/documents/doc%2Fid/content');
          assert.strictEqual(url.searchParams.get('revision_id'), 'old');
          const outline = url.searchParams.get('outline') === 'true';
          return { document: { id: 'doc/id', revision_id: 'old', current_revision_id: 'latest', sha256: hash,
            markdown: outline ? undefined : 'Selected\n', title: 'Plan', tags: ['planning'],
            selection: { start_line: 10, end_line: 30, total_lines: 60 },
            outline: [{ heading: 'Pricing', level: 2, start_line: 10, end_line: 30 }] } };
        });
        for (const selection of [['--lines', '10:30'], ['--section', 'Pricing'], ['--outline']]) {
          const result = await run(['read', 'doc/id', ...selection, '--revision', 'old', '--json'], client);
          assert.strictEqual(result.json.revision_id, 'old');
          assert.strictEqual(result.json.current_revision_id, 'latest');
          assert.strictEqual(result.json.document_id, 'doc/id');
          assert.strictEqual(result.json.sha256, hash);
          assert.strictEqual(result.json.selection.total_lines, 60);
          assert.strictEqual(result.json.markdown, selection[0] === '--outline' ? undefined : 'Selected\n');
        }
        const plain = await run(['read', 'doc/id', '--lines', '10:30', '--revision', 'old'], client);
        assert.strictEqual(plain.stdout, 'Selected\n');
        assert.deepStrictEqual(fs.readdirSync(dir), []);
      });

      await testAsync('Cloud full read keeps its existing endpoint, historical content and exact stdout', async () => {
        const client = fakeClient(call => {
          assert.strictEqual(call.endpoint, '/api/cloud/v1/documents/doc/revisions/old');
          return { document: { id: 'doc', current_revision_id: 'old', markdown: 'Full\ncontent' } };
        });
        const plain = await run(['read', 'doc', '--revision', 'old'], client);
        assert.strictEqual(plain.stdout, 'Full\ncontent');
        const json = await run(['read', 'doc', '--revision', 'old', '--json'], client);
        assert.strictEqual(json.json.sha256, bindings.hash('Full\ncontent'));
        assert.strictEqual(json.json.markdown, 'Full\ncontent');
      });

      await testAsync('Cloud edit resolves a lightweight current head and returns a compact merge receipt', async () => {
        const client = fakeClient(call => call.endpoint.endsWith('/head')
          ? { document: { current_revision_id: 'base' } }
          : receipt('doc', { markdown: 'Do not print full Markdown', combined: true,
            overlapping_edits_preserved: true, merge_classification: 'overlapping' }));
        const result = await run(['edit', 'doc', '--old', 'A', '--new', '', '--all-matches', '--json'], client);
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(client.calls.length, 2);
        assert.strictEqual(client.calls[0].endpoint, '/api/cloud/v1/documents/doc/head');
        const request = client.calls[1].body;
        assert.strictEqual(client.calls[1].endpoint, '/api/cloud/v1/documents/doc/edits');
        assert.deepStrictEqual(request.edits, [{ old_text: 'A', new_text: '', all: true }]);
        assert.strictEqual(request.base_revision_id, 'base');
        assert.ok(request.idempotency_key);
        assert.strictEqual(request.reject_conflicts, false);
        assert.strictEqual(request.expected_current_revision_id, undefined);
        assert.strictEqual(result.json.markdown, undefined);
        assert.strictEqual(result.json.base_revision_id, 'base');
        assert.strictEqual(result.json.combined, true);
        assert.strictEqual(result.json.overlapping_edits_preserved, true);
        assert.strictEqual(result.json.url, 'https://cloud.test/docs?cloud-document=doc');
        assert.strictEqual(result.json.matched_count, 1);
        assert.strictEqual(bindings.getOperationPending('editor', 'edit', 'doc'), null);
      });

      await testAsync('Cloud edit explicit bases, conflict refusal and reviewed head are independent controls', async () => {
        const client = fakeClient(call => {
          assert.strictEqual(call.endpoint, '/api/cloud/v1/documents/explicit/edits');
          return receipt('explicit');
        });
        const result = await run(['edit', 'explicit', '--old', 'A', '--new', 'B', '--lines', '02:04',
          '--base-revision', 'retained', '--if-current', 'reviewed', '--reject-conflicts', '--json'], client);
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(client.calls.length, 1);
        assert.strictEqual(client.calls[0].body.base_revision_id, 'retained');
        assert.strictEqual(client.calls[0].body.expected_current_revision_id, 'reviewed');
        assert.strictEqual(client.calls[0].body.reject_conflicts, true);
        assert.strictEqual(client.calls[0].body.edits[0].lines, '2:4');
      });

      await testAsync('Cloud edit dry-run uses preview and preserves existing pending state byte for byte', async () => {
        bindings.setOperationPending('editor', 'edit', 'preview', { request_sha256: 'earlier',
          base_revision_id: 'earlier-base', idempotency_key: 'earlier-key' });
        const before = fs.readFileSync(bindings.pendingFile(), 'utf8');
        const client = fakeClient(call => call.endpoint.endsWith('/head')
          ? { document: { current_revision_id: 'now' } } : receipt('preview', { current_revision_id: 'now' }));
        const result = await run(['edit', 'preview', '--old', 'A', '--new', 'B', '--dry-run', '--json'], client);
        assert.strictEqual(result.json.dry_run, true);
        assert.strictEqual(client.calls[1].endpoint, '/api/cloud/v1/documents/preview/edits/preview');
        assert.strictEqual(client.calls[1].body.base_revision_id, 'now');
        assert.strictEqual(client.calls[1].body.idempotency_key, undefined);
        assert.strictEqual(fs.readFileSync(bindings.pendingFile(), 'utf8'), before);
      });

      await testAsync('Cloud edit retries a lost save response with its original base and idempotency key', async () => {
        let lost = true, head = 'original';
        const client = fakeClient(call => {
          if (call.endpoint.endsWith('/head')) return { document: { current_revision_id: head } };
          if (lost) { lost = false; throw new CloudCommandError('temporary_service_failure', 'Response lost'); }
          return receipt('retry');
        });
        const args = ['edit', 'retry', '--old', 'A', '--new', 'B', '--json'];
        const first = await run(args, client);
        assert.strictEqual(first.json.error, 'temporary_service_failure');
        const pending = bindings.getOperationPending('editor', 'edit', 'retry');
        assert.strictEqual(pending.base_revision_id, 'original');
        head = 'newer';
        const next = await run(args, client);
        assert.strictEqual(next.exitCode, 0);
        assert.strictEqual(client.calls.length, 3);
        assert.deepStrictEqual(client.calls[2].body, client.calls[1].body);
        assert.strictEqual(bindings.getOperationPending('editor', 'edit', 'retry'), null);
      });

      await testAsync('Cloud edit changed payloads and explicit base choices start new durable operations', async () => {
        const client = fakeClient(call => {
          if (call.endpoint.endsWith('/head')) return { document: { revision_id: 'head-' + client.calls.length } };
          throw new CloudCommandError('temporary_service_failure', 'Response lost');
        });
        await run(['edit', 'changed', '--old', 'A', '--new', 'B', '--json'], client);
        const first = client.calls[1].body;
        await run(['edit', 'changed', '--old', 'A', '--new', 'C', '--json'], client);
        const changed = client.calls[3].body;
        assert.notStrictEqual(changed.idempotency_key, first.idempotency_key);
        assert.notStrictEqual(changed.base_revision_id, first.base_revision_id);
        await run(['edit', 'changed', '--old', 'A', '--new', 'C', '--base-revision', 'retained', '--json'], client);
        assert.notStrictEqual(client.calls[4].body.idempotency_key, changed.idempotency_key);
        assert.strictEqual(client.calls[4].body.base_revision_id, 'retained');
      });

      await testAsync('Cloud edit accepts array and wrapped batch JSON with stable canonical retry payloads', async () => {
        const file = path.join(dir, 'edits.json');
        const edits = [{ old_text: 'A', new_text: 'B', section: 'Pricing', context_before: '\n', context_after: '\n' },
          { old_text: 'X', new_text: '', lines: '10:30', occurrence: 2 }];
        fs.writeFileSync(file, JSON.stringify(edits));
        let failOnce = true;
        const client = fakeClient(call => {
          if (call.endpoint.endsWith('/head')) return { document: { current_revision_id: 'batch-base' } };
          if (failOnce) { failOnce = false; throw new CloudCommandError('temporary_service_failure', 'Lost'); }
          return receipt('batch');
        });
        await run(['edit', 'batch', '--edits-file', file, '--json'], client);
        fs.writeFileSync(file, JSON.stringify({ edits: edits.map(edit => Object.fromEntries(Object.entries(edit).reverse())) }));
        const result = await run(['edit', 'batch', '--edits-file', file, '--json'], client);
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(client.calls.length, 3);
        assert.deepStrictEqual(client.calls[1].body.edits, edits);
        assert.deepStrictEqual(client.calls[2].body, client.calls[1].body);
      });

      await testAsync('Cloud edit rejects malformed batch schemas and conflicting input forms before authentication', async () => {
        const file = path.join(dir, 'invalid-edits.json');
        const client = fakeClient(() => { throw new Error('must not request'); });
        for (const body of ['{invalid', '[]', '{}', '{"edits":[],"other":1}',
          '[{"old_text":"A"}]', '[{"old_text":"A","new_text":"B","unknown":1}]',
          '[{"old_text":"A","new_text":"B","all":"true"}]',
          '[{"old_text":"A","new_text":"B","section":null}]',
          '[{"old_text":"A","new_text":"B","occurrence":null}]',
          '[{"old_text":"A","new_text":"B","context_before":5}]']) {
          fs.writeFileSync(file, body);
          const result = await run(['edit', 'doc', '--edits-file', file, '--json'], client);
          assert.strictEqual(result.json.error, 'invalid_request', body);
        }
        fs.writeFileSync(file, '[{"old_text":"A","new_text":"B"}]');
        for (const flags of [['--old', 'A', '--new', 'B'], ['--patch-file', 'unused.diff'],
          ['--section', 'Pricing'], ['--lines', '1:2'], ['--all-matches']]) {
          const result = await run(['edit', 'doc', '--edits-file', file, ...flags, '--json'], client);
          assert.strictEqual(result.json.error, 'invalid_request');
        }
        assert.strictEqual(client.credentialReads, 0);
        assert.strictEqual(client.calls.length, 0);
      });

      await testAsync('Cloud edit sends contextual unified diff bytes without constructing a full document', async () => {
        const patch = '--- a/plan.md\n+++ b/plan.md\n@@ -1,3 +1,3 @@\n # Plan\n-Old\n+New\n End\n';
        const file = path.join(dir, 'change.diff');
        fs.writeFileSync(file, patch);
        const client = fakeClient(() => receipt('patch'));
        const result = await run(['edit', 'patch', '--patch-file', file, '--base-revision', 'base', '--json'], client);
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(client.calls.length, 1);
        assert.strictEqual(client.calls[0].body.patch, patch);
        assert.strictEqual(client.calls[0].body.edits, undefined);
        fs.writeFileSync(file, '');
        const empty = await run(['edit', 'patch', '--patch-file', file, '--json'], client);
        assert.strictEqual(empty.json.error, 'invalid_patch');
        assert.strictEqual(empty.exitCode, 2);
      });

      await testAsync('Cloud edit preserves actionable API error details and clears refused operations', async () => {
        const details = { error: 'edit_ambiguous', message: 'Several exact matches.', matched_count: 2,
          base_revision_id: 'base', current_revision_id: 'head',
          matches: [{ start_line: 3, end_line: 3 }, { start_line: 9, end_line: 9 }] };
        const client = new CloudClient({ origin: 'https://cloud.test',
          credentials: { load: () => credential },
          fetch: async () => ({ ok: false, status: 400, json: async () => details }) });
        const result = await run(['edit', 'refused', '--old', 'A', '--new', 'B', '--base-revision', 'base', '--json'], client);
        assert.strictEqual(result.json.error, 'edit_ambiguous');
        assert.strictEqual(result.json.matched_count, 2);
        assert.deepStrictEqual(result.json.matches, details.matches);
        assert.strictEqual(result.json.base_revision_id, 'base');
        assert.strictEqual(result.exitCode, 2);
        assert.strictEqual(bindings.getOperationPending('editor', 'edit', 'refused'), null);
        for (const code of ['edit_no_match', 'section_not_found', 'section_ambiguous', 'invalid_patch',
          'overlapping_edits', 'revision_conflict']) {
          const fake = fakeClient(() => { throw new CloudCommandError(code, code, { current_revision_id: 'head' }); });
          const failure = await run(['edit', code, '--old', 'A', '--new', 'B', '--base-revision', 'base', '--json'], fake);
          assert.strictEqual(failure.json.error, code);
          assert.strictEqual(failure.exitCode, code === 'revision_conflict' ? 5 : 2);
          assert.strictEqual(bindings.getOperationPending('editor', 'edit', code), null);
        }
      });

      const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
      try {
        const crypto = require('crypto');
        const { spawnSync } = require('child_process');
        const cliState = path.join(dir, 'fixture-cli');
        fs.mkdirSync(path.join(cliState, 'cloud'), { recursive: true });
        const actualCredentials = {};
        for (const actor of ['bob', 'member']) {
          const issued = f.auth.issueDeviceAuthorization({ displayName: 'Document editor' });
          f.auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: f.users[actor].id });
          const c = f.auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
          actualCredentials[actor] = { user_id: c.userId, credential_id: c.credentialId,
            access_token: c.accessToken, refresh_token: c.refreshToken,
            access_token_expires_at: new Date(c.accessExpiresAtMs).toISOString() };
        }
        const source = '---\ntitle: Plan\ntags: [planning, service]\n---\n# Plan\n\n## Pricing\nCap: 10\nOwner: Ana\n\n## Support\nCap: 10\nOwner: Ana\n';
        async function create() {
          const response = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
            account_id: f.team.workspaceId, filename: 'plan.md', markdown: source,
            idempotency_key: crypto.randomUUID() });
          assert.strictEqual(response.status, 201, JSON.stringify(response.data));
          return response.data.document;
        }
        function cli(args, actor = 'bob') {
          fs.writeFileSync(path.join(cliState, 'cloud', 'credentials.json'), JSON.stringify({ [f.origin]: actualCredentials[actor] }));
          const child = spawnSync(process.execPath, [path.join(__dirname, '../cli/bin/sdocs-dev.js'),
            'cloud', ...args, '--json'], { encoding: 'utf8', cwd: dir, timeout: 15000,
            env: { ...process.env, SDOCS_HOME: cliState, SDOCS_CLOUD_FILE_CREDENTIALS: '1',
              SDOCS_CLOUD_URL: f.origin, SDOCS_URL: f.origin, NO_UPDATE_NOTIFIER: '1',
              SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', CI: '1' } });
          if (child.error) throw child.error;
          let json;
          try { json = JSON.parse(child.stdout); }
          catch (_) { throw new Error('CLI did not return JSON: ' + child.stdout + child.stderr); }
          return { json, exitCode: child.status };
        }

        await testAsync('real Cloud CLI reads sections and outlines, previews an edit, and verifies its saved revision', async () => {
          const doc = await create();
          const outline = cli(['read', doc.id, '--outline']);
          assert.strictEqual(outline.exitCode, 0, JSON.stringify(outline.json));
          assert.deepStrictEqual(outline.json.outline.map(entry => entry.title), ['Plan', 'Pricing', 'Support']);
          assert.strictEqual(outline.json.markdown, undefined);
          const selected = cli(['read', doc.id, '--section', 'Pricing']);
          assert.strictEqual(selected.json.markdown, '## Pricing\nCap: 10\nOwner: Ana\n\n');
          assert.strictEqual(selected.json.sha256, bindings.hash(source));
          const ambiguous = cli(['edit', doc.id, '--old', 'Cap: 10', '--new', 'Cap: 20']);
          assert.strictEqual(ambiguous.exitCode, 2);
          assert.strictEqual(ambiguous.json.error, 'edit_ambiguous');
          assert.strictEqual(ambiguous.json.details.match_count, 2);
          assert.ok(ambiguous.json.details.candidates[0].section.includes('Pricing'));
          const args = ['edit', doc.id, '--old', 'Cap: 10', '--new', 'Cap: 20', '--section', 'Pricing'];
          const preview = cli([...args, '--dry-run']);
          assert.strictEqual(preview.exitCode, 0, JSON.stringify(preview.json));
          assert.strictEqual(preview.json.dry_run, true);
          assert.strictEqual(preview.json.current_revision_id, doc.current_revision_id);
          assert.strictEqual(preview.json.markdown, undefined);
          const saved = cli([...args, '--if-current', preview.json.current_revision_id]);
          assert.strictEqual(saved.exitCode, 0, JSON.stringify(saved.json));
          assert.deepStrictEqual(saved.json.diff, preview.json.diff);
          const expected = source.replace('Cap: 10', 'Cap: 20');
          assert.strictEqual(saved.json.saved_sha256, bindings.hash(expected));
          assert.strictEqual(saved.json.markdown, undefined);
          assert.deepStrictEqual(saved.json.tags, doc.tags);
          const verified = cli(['read', doc.id, '--revision', saved.json.revision_id]);
          assert.strictEqual(verified.json.markdown, expected);
          const old = cli(['read', doc.id, '--lines', '8:9', '--revision', doc.current_revision_id]);
          assert.strictEqual(old.json.markdown, 'Cap: 10\nOwner: Ana\n');
          assert.strictEqual(old.json.revision_id, doc.current_revision_id);
          assert.strictEqual(old.json.current_revision_id, saved.json.revision_id);
        });

        await testAsync('real Cloud CLI applies batch JSON and contextual patches to a shared editable document', async () => {
          const doc = await create();
          f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id,
            mode: 'custom', memberUserIds: [f.users.member.id] });
          const file = path.join(dir, 'shared-edits.json');
          fs.writeFileSync(file, JSON.stringify({ edits: [
            { old_text: 'Cap: 10', new_text: 'Cap: 30', section: 'Pricing' },
            { old_text: 'Owner: Ana', new_text: 'Owner: Ben', section: 'Support' },
          ] }));
          const saved = cli(['edit', doc.id, '--edits-file', file], 'member');
          assert.strictEqual(saved.exitCode, 0, JSON.stringify(saved.json));
          assert.strictEqual(saved.json.applied_edit_count, 2);
          assert.strictEqual(saved.json.matched_count, 2);
          const patchFile = path.join(dir, 'shared.diff');
          fs.writeFileSync(patchFile, '--- a/plan.md\n+++ b/plan.md\n@@ -7,3 +7,3 @@\n ## Pricing\n-Cap: 30\n+Cap: 40\n Owner: Ana\n');
          const patched = cli(['edit', doc.id, '--patch-file', patchFile], 'member');
          assert.strictEqual(patched.exitCode, 0, JSON.stringify(patched.json));
          const verified = cli(['read', doc.id], 'member');
          assert.strictEqual(verified.json.markdown,
            source.replace('Cap: 10', 'Cap: 40').replace('## Support\nCap: 10\nOwner: Ana', '## Support\nCap: 10\nOwner: Ben'));
          f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [] });
          const denied = cli(['edit', doc.id, '--old', 'Cap: 40', '--new', 'Cap: 50'], 'member');
          assert.strictEqual(denied.exitCode, 4);
          assert.strictEqual(denied.json.error, 'resource_unavailable');
          assert.ok(denied.json.message.includes('access has changed'));
          assert.strictEqual(denied.json.details, undefined);
        });

        await testAsync('real Cloud save response loss reuses the durable CLI operation after the head advances', async () => {
          const doc = await create();
          let loseResponse = true;
          const calls = [];
          const client = new CloudClient({ origin: f.origin,
            credentials: { load: () => actualCredentials.bob },
            fetch: async (url, options) => {
              calls.push({ url, body: options && options.body });
              const response = await fetch(url, options);
              if (loseResponse && url.endsWith('/edits')) {
                loseResponse = false;
                assert.strictEqual(response.status, 201);
                await response.arrayBuffer();
                throw new Error('Fixture lost the committed response');
              }
              return response;
            } });
          const args = ['edit', doc.id, '--old', 'Cap: 10', '--new', 'Cap: 20', '--section', 'Pricing', '--json'];
          const first = await run(args, client);
          assert.strictEqual(first.json.error, 'temporary_service_failure');
          const committed = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document;
          assert.strictEqual(committed.revision_number, 2);
          const independent = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
            base_revision_id: committed.current_revision_id,
            edits: [{ old_text: 'Owner: Ana', new_text: 'Owner: Ben', section: 'Support' }],
            idempotency_key: crypto.randomUUID() });
          assert.strictEqual(independent.status, 201);
          const retry = await run(args, client);
          assert.strictEqual(retry.exitCode, 0, JSON.stringify(retry.json));
          assert.strictEqual(retry.json.revision_id, committed.current_revision_id);
          assert.strictEqual(calls.length, 3);
          assert.strictEqual(calls[1].body, calls[2].body);
          const current = (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document;
          assert.strictEqual(current.revision_number, 3);
          assert.ok(current.markdown.includes('Owner: Ben'));
          assert.strictEqual(bindings.getOperationPending(f.users.bob.id, 'edit', doc.id), null);
        });
      } finally { await f.close(); }
    } finally {
      if (previousHome === undefined) delete process.env.SDOCS_HOME;
      else process.env.SDOCS_HOME = previousHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
};
