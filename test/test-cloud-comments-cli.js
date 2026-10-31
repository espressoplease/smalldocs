const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function (h) {
  const { assert, test, testAsync } = h;
  const io = require('../cli/lib/io');
  const bindings = require('../cli/lib/cloud-bindings');
  const comments = require('../cli/lib/cloud-comments');
  const { CloudClient, CloudCommandError, runCloudCommand, CLOUD_COMMENTS_HELP } = require('../cli/lib/cloud-commands');

  test('Cloud comments grammar preserves literal reply and quoted source text', () => {
    const opts = io.parseArgs(['cloud', 'comments', 'doc', '--id', 'c7', '--reply', '+tag\n10:30', '--json']);
    assert.strictEqual(opts.commentReplyFlag, '+tag\n10:30');
    assert.deepStrictEqual(opts.addTags, []);
    assert.deepStrictEqual(opts.annotations, []);
    assert.deepStrictEqual(comments.requestOptions(opts, 'https://cloud.test').action,
      { action: 'reply', comment_id: 'c7', text: '+tag\n10:30' });
    const add = comments.requestOptions(io.parseArgs(['cloud', 'comments', 'doc', '--add', '--text=--note',
      '--quote=--source', '--lines', '02:04']), 'https://cloud.test');
    assert.deepStrictEqual(add.action, { action: 'add', text: '--note',
      anchor: { kind: 'inline', quote: '--source', lines: '2:4' } });
  });

  test('Cloud comments help connects feedback with scoped editing, handling and retry', () => {
    for (const text of ['cloud search', 'cloud read', 'cloud edit', '--status', '--context', '--cursor',
      '--base-revision', '--reply', '--resolve', '--reopen', '--delete', '--add', '--reattach', '45 minutes', 'comment_changed',
      'comment_unavailable', 'target_too_old', 'edit_ambiguous', 'idempotency key', 'sha256', '25',
      '--author', '--pages', '--all', 'complete', 'metadata filters', 'comment_id', 'all its replies', '90-day retention']) {
      assert.ok(CLOUD_COMMENTS_HELP.includes(text), text);
    }
    assert.ok(![8211, 8212].some(code => CLOUD_COMMENTS_HELP.includes(String.fromCharCode(code))));
  });

  test('Cloud comments deletion targets one thread with optional preview and explicit base', () => {
    const opts = io.parseArgs(['cloud', 'comments', 'doc', '--id', 'c7', '--delete',
      '--base-revision', 'base', '--dry-run', '--json']);
    assert.deepStrictEqual(comments.requestOptions(opts, 'https://cloud.test').action,
      { action: 'delete', comment_id: 'c7' });
    assert.strictEqual(opts.baseRevisionFlag, 'base');
    assert.strictEqual(opts.dryRunFlag, true);
  });

  test('Cloud comments reattach grammar carries a scoped quote and preserves comment identity', () => {
    const opts = io.parseArgs(['cloud', 'comments', 'doc', '--id', 'c7', '--reattach',
      '--quote', '45 minutes', '--section', 'Production', '--base-revision', 'base', '--dry-run', '--json']);
    assert.deepStrictEqual(comments.requestOptions(opts, 'https://cloud.test').action,
      { action: 'reattach', comment_id: 'c7', anchor: { kind: 'inline', quote: '45 minutes', section: 'Production' } });
    assert.strictEqual(opts.baseRevisionFlag, 'base');
    assert.strictEqual(opts.dryRunFlag, true);
  });

  test('Cloud comments author and page options remain separate from search author filters', () => {
    const opts = io.parseArgs(['cloud', 'comments', 'doc', '--author', 'Priya Example', '--pages', '3', '--json']);
    assert.strictEqual(opts.commentAuthorFlag, 'Priya Example');
    assert.strictEqual(opts.commentPagesFlag, '3');
    assert.strictEqual(opts.authorFlags, undefined);
    const requested = comments.requestOptions(opts, 'https://cloud.test');
    assert.strictEqual(requested.query.author, 'Priya Example');
    assert.strictEqual(requested.pageLimit, 3);
    assert.deepStrictEqual(io.parseArgs(['cloud', 'search', 'plan', '--author', 'person-id']).authorFlags, ['person-id']);
  });

  return async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-comments-cli-'));
    const previousHome = process.env.SDOCS_HOME;
    process.env.SDOCS_HOME = dir;
    const credential = { user_id: 'reviewer' };
    async function capture(action) {
      const previousWrite = process.stdout.write, previousError = process.stderr.write, previousExit = process.exitCode;
      let stdout = '', stderr = '';
      process.stdout.write = text => { stdout += String(text); return true; };
      process.stderr.write = text => { stderr += String(text); return true; };
      process.exitCode = undefined;
      try {
        await action();
        return { stdout, stderr, exitCode: process.exitCode || 0,
          json: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null };
      } finally {
        process.stdout.write = previousWrite; process.stderr.write = previousError; process.exitCode = previousExit;
      }
    }
    function fakeClient(handle) {
      let credentialReads = 0;
      const client = { origin: 'https://cloud.test', calls: [],
        get credentialReads() { return credentialReads; },
        loadCredential() { credentialReads++; return credential; },
        async authenticated(endpoint, options) {
          const call = { endpoint, options, body: options && JSON.parse(options.body) };
          client.calls.push(call);
          return handle(call);
        } };
      return client;
    }
    function listing(extra = {}) {
      return { ok: true, schema_version: 1,
        document: { id: 'doc', title: 'Plan', revision_id: 'base', current_revision_id: 'base' },
        permission: { can_edit: true }, counts: { open: 1, resolved: 1, total: 2 },
        comments: [{ id: 'c7', sha256: 'note-hash', status: 'open', text: 'Correct this.',
          author: { display_name: 'Priya' }, replies: [], anchor: { kind: 'inline', quote: '10 minutes' },
          context: { markdown: 'Limit: 10 minutes.', start_line: 8, end_line: 8 } }],
        returned_count: 1, has_more: false, next_cursor: null, ...extra };
    }
    function saved(extra = {}) {
      return { ok: true, document: { id: 'doc', revision_id: 'saved', current_revision_id: 'saved' },
        action: 'resolve', comment: { id: 'c7', status: 'resolved', replies: [] }, revision_created: true, ...extra };
    }
    const run = (args, client) => capture(() => runCloudCommand(io.parseArgs(['cloud', 'comments', ...args]), { client }));
    try {
      await testAsync('Cloud comments rejects invalid grammar and combinations before auth or requests', async () => {
        const client = fakeClient(() => { throw new Error('must not request'); });
        const invalid = [[], ['doc', '--status', 'pending'], ['doc', '--status='], ['doc', '--context='],
          ['doc', '--limit', '0'], ['doc', '--limit', '2.5'], ['doc', '--id', 'other'],
          ['doc', '--reply', 'text'], ['doc', '--id', 'c7', '--reply', ''], ['doc', '--delete'],
          ['doc', '--id', 'c7', '--delete', '--resolve'], ['doc', '--id', 'c7', '--delete', '--reply', 'text'],
          ['doc', '--id', 'c7', '--delete', '--note', 'text'], ['doc', '--id', 'c7', '--delete', '--text', 'text'],
          ['doc', '--id', 'c7', '--delete', '--all'], ['doc', '--id', 'c7', '--delete', '--status', 'all'],
          ['doc', '--id', 'c7', '--resolve', '--reopen'], ['doc', '--note', 'text'],
          ['doc', '--id', 'c7', '--reopen', '--note', 'text'], ['doc', '--dry-run'],
          ['doc', '--id', 'c7', '--resolve', '--revision', 'old'],
          ['doc', '--id', 'c7', '--resolve', '--base-revision', ''],
          ['doc', '--id', 'c7', '--resolve', '--status', 'all'], ['doc', '--add', '--text', 'note'],
          ['doc', '--add', '--text', 'note', '--quote', 'source', '--id', 'c7'],
          ['doc', '--add', '--text', 'note', '--quote', 'source', '--section', 'A', '--lines', '1:3'],
          ['doc', '--add', '--text', 'note', '--quote', 'source', '--lines', '3:1'],
          ['doc', '--id', 'c7', '--resolve', '--text', 'note'], ['doc', '--unknown'],
          ['doc', '--reattach', '--quote', '45 minutes'], ['doc', '--id', 'c7', '--reattach'],
          ['doc', '--id', 'c7', '--reattach', '--quote', '45 minutes', '--reply', 'text'],
          ['doc', '--id', 'c7', '--reattach', '--quote', '45 minutes', '--text', 'text'],
          ['doc', '--id', 'c7', '--reattach', '--quote', '45 minutes', '--note', 'text'],
          ['doc', '--id', 'c7', '--reattach', '--quote', '45 minutes', '--section', 'A', '--lines', '1:3'],
          ['doc', 'extra'], ['doc', '--id', '--json'], ['doc', '--cursor', ''],
          ['doc', '--author', ''], ['doc', '--pages', '0'], ['doc', '--pages', '1.5'],
          ['doc', '--all', '--pages', '2'], ['doc', '--id', 'c7', '--resolve', '--author', 'Priya'],
          ['doc', '--id', 'c7', '--reply', 'text', '--all'], ['doc', '--id', 'c7', '--reopen', '--pages', '2'],
          ['https://elsewhere.test/docs?cloud-document=doc'], ['https://cloud.test/wrong?cloud-document=doc'],
          ['https://user@cloud.test/docs?cloud-document=doc'], ['https://cloud.test/docs'],
          ['https://cloud.test/docs?cloud-document=doc&cloud-document=other']];
        for (const args of invalid) {
          const result = await run([...args, '--json'], client);
          assert.strictEqual(result.json.error, 'invalid_request', JSON.stringify(args));
          assert.strictEqual(result.exitCode, 2);
        }
        assert.strictEqual(client.credentialReads, 0);
        assert.strictEqual(client.calls.length, 0);
      });

      await testAsync('Cloud comments listing uses compact defaults and preserves structured context and subscription', async () => {
        const client = fakeClient(call => {
          const url = new URL(call.endpoint, client.origin);
          assert.strictEqual(url.pathname, '/api/cloud/v1/documents/doc/comments');
          assert.strictEqual(url.searchParams.get('status'), 'open');
          assert.strictEqual(url.searchParams.get('context'), 'snippet');
          assert.strictEqual(url.searchParams.get('limit'), '25');
          return listing();
        });
        client.subscription = { notices: [{ code: 'trial_warning', message: 'Trial notice' }] };
        const result = await run(['doc', '--json'], client);
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.json.document_id, 'doc');
        assert.strictEqual(result.json.url, 'https://cloud.test/docs?cloud-document=doc');
        assert.strictEqual(result.json.comments[0].context.markdown, 'Limit: 10 minutes.');
        assert.strictEqual(result.json.counts.total, 2);
        assert.strictEqual(result.json.notices[0].code, 'trial_warning');
        assert.strictEqual(result.json.markdown, undefined);
        assert.deepStrictEqual(fs.readdirSync(dir), []);
      });

      await testAsync('Cloud comments passes pagination, historical, focused and URL selections without full reads', async () => {
        const client = fakeClient(() => listing({ document: { id: 'doc/id', revision_id: 'old', current_revision_id: 'latest' } }));
        const result = await run(['https://cloud.test/docs?cloud-document=doc%2Fid', '--id', 'c7',
          '--limit', '4', '--cursor', 'opaque+/=', '--revision', 'old', '--context', 'none', '--json'], client);
        const url = new URL(client.calls[0].endpoint, client.origin);
        assert.strictEqual(url.pathname, '/api/cloud/v1/documents/doc%2Fid/comments');
        assert.strictEqual(url.searchParams.get('status'), 'all');
        assert.strictEqual(url.searchParams.get('comment_id'), 'c7');
        assert.strictEqual(url.searchParams.get('limit'), '4');
        assert.strictEqual(url.searchParams.get('cursor'), 'opaque+/=');
        assert.strictEqual(url.searchParams.get('revision_id'), 'old');
        assert.strictEqual(url.searchParams.get('context'), 'none');
        assert.strictEqual(result.json.revision_id, 'old');
        assert.strictEqual(result.json.document.current_revision_id, 'latest');
        await run(['doc', '--id', 'c7', '--status', 'resolved', '--json'], client);
        assert.strictEqual(new URL(client.calls[1].endpoint, client.origin).searchParams.get('status'), 'resolved');
      });

      await testAsync('Cloud comments author filtering and automatic pages preserve snapshot filters and total counts', async () => {
        function clientFor(author) {
          return fakeClient(call => {
            const query = new URL(call.endpoint, 'https://cloud.test').searchParams;
            assert.strictEqual(query.get('author'), author);
            assert.strictEqual(query.get('status'), 'all');
            assert.strictEqual(query.get('limit'), '1');
            assert.strictEqual(query.get('context'), 'none');
            const page = Number(query.get('cursor') || '1');
            return listing({ comments: [{ id: 'c' + page, author: { display_name: author } }],
              counts: { total: 9, open: 5, resolved: 4 }, has_more: page < 3,
              next_cursor: page < 3 ? String(page + 1) : null });
          });
        }
        const allClient = clientFor('PrIyA');
        const all = await run(['doc', '--author', 'PrIyA', '--status', 'all', '--limit', '1', '--context', 'none', '--all', '--json'], allClient);
        assert.strictEqual(all.exitCode, 0);
        assert.deepStrictEqual(all.json.comments.map(note => note.id), ['c1', 'c2', 'c3']);
        assert.strictEqual(all.json.complete, true);
        assert.strictEqual(all.json.returned_count, 3);
        assert.strictEqual(all.json.pages_fetched, 3);
        assert.strictEqual(all.json.next_cursor, null);
        assert.deepStrictEqual(all.json.counts, { total: 9, open: 5, resolved: 4 });
        const partialClient = clientFor('me');
        const first = await run(['doc', '--author', 'me', '--status', 'all', '--limit', '1', '--context', 'none', '--pages', '2', '--json'], partialClient);
        assert.strictEqual(first.json.complete, false);
        assert.strictEqual(first.json.returned_count, 2);
        assert.strictEqual(first.json.next_cursor, '3');
        assert.strictEqual(first.json.pages_fetched, 2);
        const last = await run(['doc', '--author', 'me', '--status', 'all', '--limit', '1', '--context', 'none',
          '--cursor', first.json.next_cursor, '--all', '--json'], partialClient);
        assert.strictEqual(last.json.complete, true);
        assert.strictEqual(last.json.started_from_cursor, true);
        assert.strictEqual(last.json.returned_count, 1);
        assert.strictEqual(last.json.comments[0].id, 'c3');
      });

      await testAsync('Cloud comments pagination reports partial results for failed or invalid continuations', async () => {
        for (const mode of ['request_failed', 'repeated_cursor', 'changed_snapshot']) {
          const client = fakeClient(() => {
            if (client.calls.length === 1) return listing({ has_more: true, next_cursor: 'next' });
            if (mode === 'request_failed') throw new CloudCommandError('rate_limited', 'Retry later.');
            if (mode === 'changed_snapshot') return listing({ document: { id: 'doc', revision_id: 'other' } });
            return listing({ comments: [{ id: 'c8' }], has_more: true, next_cursor: 'next' });
          });
          const result = await run(['doc', '--all', '--json'], client);
          assert.strictEqual(result.json.ok, false);
          assert.strictEqual(result.json.error, mode === 'request_failed' ? 'rate_limited' : 'temporary_service_failure');
          assert.strictEqual(result.json.partial_result.complete, false);
          assert.strictEqual(result.json.partial_result.returned_count, mode === 'repeated_cursor' ? 2 : 1);
          assert.strictEqual(result.json.partial_result.revision_id, 'base');
          assert.strictEqual(result.json.partial_result.next_cursor, 'next');
          assert.strictEqual(client.calls.length, 2);
        }
      });

      await testAsync('Cloud comment actions use a focused base read and fingerprint and preserve receipt projection', async () => {
        for (const [flags, action, text] of [[['--reply', 'Updated.'], 'reply', 'Updated.'],
          [['--resolve', '--note', 'Checked.'], 'resolve', 'Checked.'], [['--reopen'], 'reopen', undefined]]) {
          const client = fakeClient(call => call.options ? saved({ action }) : listing());
          const result = await run(['doc', '--id', 'c7', ...flags, '--base-revision', 'base', '--json'], client);
          assert.strictEqual(result.exitCode, 0);
          const query = new URL(client.calls[0].endpoint, client.origin).searchParams;
          assert.strictEqual(query.get('revision_id'), 'base');
          assert.strictEqual(query.get('context'), 'none');
          assert.strictEqual(query.get('status'), 'all');
          const request = client.calls[1].body;
          assert.strictEqual(client.calls[1].endpoint, '/api/cloud/v1/documents/doc/comments/actions');
          assert.strictEqual(request.action, action);
          assert.strictEqual(request.comment_id, 'c7');
          assert.strictEqual(request.base_revision_id, 'base');
          assert.strictEqual(request.expected_comment_sha256, 'note-hash');
          assert.strictEqual(request.text, text);
          assert.ok(request.idempotency_key);
          assert.strictEqual(result.json.comment.id, 'c7');
          assert.strictEqual(result.json.revision_id, 'saved');
          assert.strictEqual(bindings.getOperationPending('reviewer', 'comments', 'doc'), null);
        }
      });

      await testAsync('Cloud reattach previews a scoped anchor and retries its original fingerprint after response loss', async () => {
        const args = ['reattach', '--id', 'c7', '--reattach', '--quote', '45 minutes', '--lines', '02:04',
          '--base-revision', 'base', '--json'];
        const preview = fakeClient(call => call.options ? saved({ action: 'reattach', preview: true }) : listing());
        assert.strictEqual((await run([...args, '--dry-run'], preview)).exitCode, 0);
        assert.strictEqual(preview.calls[1].endpoint, '/api/cloud/v1/documents/reattach/comments/actions/preview');
        assert.deepStrictEqual(preview.calls[1].body.anchor, { kind: 'inline', quote: '45 minutes', lines: '2:4' });
        assert.strictEqual(preview.calls[1].body.expected_comment_sha256, 'note-hash');
        assert.strictEqual(preview.calls[1].body.idempotency_key, undefined);
        let loseResponse = true;
        const client = fakeClient(call => {
          if (!call.options) return listing();
          if (loseResponse) { loseResponse = false; throw new CloudCommandError('temporary_service_failure', 'Response lost'); }
          return saved({ action: 'reattach' });
        });
        assert.strictEqual((await run(args, client)).json.error, 'temporary_service_failure');
        assert.strictEqual((await run(args, client)).exitCode, 0);
        assert.strictEqual(client.calls.length, 3);
        assert.deepStrictEqual(client.calls[1].body, client.calls[2].body);
        assert.strictEqual(client.calls[1].body.action, 'reattach');
        assert.strictEqual(client.calls[1].body.comment_id, 'c7');
        assert.strictEqual(client.calls[1].body.text, undefined);
        assert.strictEqual(bindings.getOperationPending('reviewer', 'comments', 'reattach'), null);
      });

      await testAsync('Cloud comment dry-run uses preview without touching an earlier durable operation', async () => {
        bindings.setOperationPending('reviewer', 'comments', 'preview', { request_sha256: 'earlier', request: { idempotency_key: 'earlier' } });
        const before = fs.readFileSync(bindings.pendingFile(), 'utf8');
        const client = fakeClient(call => call.options ? saved({ preview: true, revision_created: false }) : listing());
        const result = await run(['preview', '--id', 'c7', '--resolve', '--dry-run', '--json'], client);
        assert.strictEqual(result.json.dry_run, true);
        assert.strictEqual(client.calls[1].endpoint, '/api/cloud/v1/documents/preview/comments/actions/preview');
        assert.strictEqual(client.calls[1].body.idempotency_key, undefined);
        assert.strictEqual(fs.readFileSync(bindings.pendingFile(), 'utf8'), before);
      });

      await testAsync('Cloud deletion previews and retries a committed removal without rereading a missing thread', async () => {
        const args = ['delete-retry', '--id', 'c7', '--delete', '--json'];
        const receipt = { action: 'delete', comment_id: 'c7', comment: null };
        const preview = fakeClient(call => call.options ? saved({ ...receipt, preview: true, revision_created: false }) : listing());
        const dry = await run([...args, '--dry-run'], preview);
        assert.strictEqual(dry.exitCode, 0, JSON.stringify(dry.json));
        assert.strictEqual(dry.json.comment_id, 'c7');
        assert.strictEqual(dry.json.comment, null);
        assert.strictEqual(preview.calls[1].endpoint, '/api/cloud/v1/documents/delete-retry/comments/actions/preview');
        assert.strictEqual(preview.calls[1].body.idempotency_key, undefined);
        assert.strictEqual(bindings.getOperationPending('reviewer', 'comments', 'delete-retry'), null);
        let committed = false;
        const client = fakeClient(call => {
          if (!call.options) {
            assert.strictEqual(committed, false, 'must retry the original operation after the comment is deleted');
            return listing();
          }
          if (!committed) { committed = true; throw new CloudCommandError('temporary_service_failure', 'Response lost'); }
          return saved(receipt);
        });
        assert.strictEqual((await run(args, client)).json.error, 'temporary_service_failure');
        const retry = await run(args, client);
        assert.strictEqual(retry.exitCode, 0, JSON.stringify(retry.json));
        assert.strictEqual(retry.json.comment_id, 'c7');
        assert.strictEqual(retry.json.comment, null);
        assert.strictEqual(client.calls.length, 3);
        assert.deepStrictEqual(client.calls[1].body, client.calls[2].body);
        assert.strictEqual(client.calls[1].body.expected_comment_sha256, 'note-hash');
        assert.strictEqual(bindings.getOperationPending('reviewer', 'comments', 'delete-retry'), null);
      });

      await testAsync('Cloud comment lost-response retry retains the original hash, base and idempotency key', async () => {
        let failOnce = true;
        const client = fakeClient(call => {
          if (!call.options) return listing();
          if (failOnce) { failOnce = false; throw new CloudCommandError('temporary_service_failure', 'Response lost'); }
          return saved();
        });
        const args = ['retry', '--id', 'c7', '--resolve', '--note', 'Addressed.', '--json'];
        assert.strictEqual((await run(args, client)).json.error, 'temporary_service_failure');
        assert.ok(bindings.getOperationPending('reviewer', 'comments', 'retry'));
        assert.strictEqual((await run(args, client)).exitCode, 0);
        assert.strictEqual(client.calls.length, 3);
        assert.deepStrictEqual(client.calls[1].body, client.calls[2].body);
        assert.strictEqual(bindings.getOperationPending('reviewer', 'comments', 'retry'), null);
      });

      await testAsync('Cloud comment changed payloads start new operations and changed-note errors preserve server feedback', async () => {
        const client = fakeClient(call => {
          if (!call.options) return listing();
          throw new CloudCommandError('temporary_service_failure', 'Response lost');
        });
        await run(['changed', '--id', 'c7', '--reply', 'First', '--json'], client);
        await run(['changed', '--id', 'c7', '--reply', 'Second', '--json'], client);
        assert.notStrictEqual(client.calls[1].body.idempotency_key, client.calls[3].body.idempotency_key);
        const conflict = fakeClient(() => { throw new CloudCommandError('comment_changed', 'The note changed.',
          { current_revision_id: 'newer', comment: { id: 'c7', text: 'New request' } }); });
        const result = await run(['changed', '--id', 'c7', '--reply', 'Second', '--json'], conflict);
        assert.strictEqual(result.exitCode, 5);
        assert.strictEqual(result.json.current_revision_id, 'newer');
        assert.strictEqual(result.json.comment.text, 'New request');
        assert.strictEqual(bindings.getOperationPending('reviewer', 'comments', 'changed'), null);
      });

      await testAsync('Cloud add uses a lightweight head and scoped quote without inventing a comment hash', async () => {
        const client = fakeClient(call => call.options ? saved({ action: 'add' }) : { document: { current_revision_id: 'head' } });
        const result = await run(['doc', '--add', '--text', 'Check the limit.', '--quote', '10 minutes', '--section', 'Production', '--json'], client);
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(client.calls[0].endpoint, '/api/cloud/v1/documents/doc/head');
        assert.deepStrictEqual(client.calls[1].body.anchor, { kind: 'inline', quote: '10 minutes', section: 'Production' });
        assert.strictEqual(client.calls[1].body.base_revision_id, 'head');
        assert.strictEqual(client.calls[1].body.expected_comment_sha256, undefined);
        const explicit = fakeClient(() => saved({ action: 'add' }));
        await run(['doc', '--add', '--text', 'Check.', '--quote', '10 minutes', '--base-revision', 'retained', '--json'], explicit);
        assert.strictEqual(explicit.calls.length, 1);
        assert.strictEqual(explicit.calls[0].body.base_revision_id, 'retained');
      });

      await testAsync('Cloud comment missing and malformed focused reads never submit an action', async () => {
        for (const response of [listing({ comments: [] }), listing({ comments: [{ id: 'c7' }] }),
          listing({ document: { id: 'doc' } })]) {
          const client = fakeClient(() => response);
          const result = await run(['missing', '--id', 'c7', '--resolve', '--json'], client);
          assert.ok(['comment_unavailable', 'temporary_service_failure'].includes(result.json.error));
          assert.strictEqual(client.calls.length, 1);
          assert.strictEqual(bindings.getOperationPending('reviewer', 'comments', 'missing'), null);
        }
      });

      await testAsync('Cloud comment unavailable responses preserve unknown-save pending state and explain recovery', async () => {
        const client = fakeClient(call => {
          if (!call.options) return listing();
          throw new CloudCommandError('resource_unavailable', 'Unavailable');
        });
        const result = await run(['unavailable', '--id', 'c7', '--resolve', '--json'], client);
        assert.strictEqual(result.exitCode, 4);
        assert.ok(result.json.message.includes('confirm access'));
        assert.ok(bindings.getOperationPending('reviewer', 'comments', 'unavailable'));
      });

      const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
      try {
        const crypto = require('crypto');
        const yaml = require('../cli/shared/sdocs-yaml');
        const { spawnSync } = require('child_process');
        const cliState = path.join(dir, 'fixture-cli');
        fs.mkdirSync(path.join(cliState, 'cloud'), { recursive: true });
        const actualCredentials = {};
        for (const actor of ['bob', 'member']) {
          const issued = f.auth.issueDeviceAuthorization({ displayName: 'Document reviewer' });
          f.auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: f.users[actor].id });
          const c = f.auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
          actualCredentials[actor] = { user_id: c.userId, credential_id: c.credentialId,
            access_token: c.accessToken, refresh_token: c.refreshToken,
            access_token_expires_at: new Date(c.accessExpiresAtMs).toISOString() };
        }
        const body = '# Plan\n\n## Production\n\nMaximum retry window: 10 minutes.\n\n## Sandbox\n\nMaximum retry window: 10 minutes.\n';
        const source = yaml.serializeFrontMatter({ title: 'Launch plan', tags: ['planning'],
          comments: [{ id: 'c1', kind: 'inline', block: 'p:0', quote: '10 minutes',
            prefix: 'Maximum retry window: ', suffix: '.', author: 'Priya', at: '2026-10-01T10:00:00Z',
            text: 'Correct the production limit.' },
          { id: 'c2', kind: 'block', block: 'p:1', block_text: 'Maximum retry window: 10 minutes.',
            author: 'Priya', at: '2026-10-01T11:00:00Z', text: 'Already checked the sandbox.', resolved: true },
          { id: 'c3', kind: 'inline', block: 'p:1', quote: 'Maximum retry window', suffix: ': 10 minutes.',
            author: 'Ana', at: '2026-10-01T12:00:00Z', text: 'Keep the sandbox separate.' }] }) + '\n' + body;
        async function create() {
          const response = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
            account_id: f.team.workspaceId, filename: 'launch-plan.md', markdown: source,
            idempotency_key: crypto.randomUUID() });
          assert.strictEqual(response.status, 201, JSON.stringify(response.data));
          f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: response.data.document.id,
            mode: 'custom', memberUserIds: [f.users.member.id] });
          return response.data.document;
        }
        function cli(args, actor = 'bob') {
          fs.writeFileSync(path.join(cliState, 'cloud', 'credentials.json'), JSON.stringify({ [f.origin]: actualCredentials[actor] }));
          const child = spawnSync(process.execPath, [path.join(__dirname, '../cli/bin/sdocs-dev.js'),
            'cloud', 'comments', ...args, '--json'], { encoding: 'utf8', cwd: dir, timeout: 15000,
            env: { ...process.env, SDOCS_HOME: cliState, SDOCS_CLOUD_FILE_CREDENTIALS: '1',
              SDOCS_CLOUD_URL: f.origin, SDOCS_URL: f.origin, NO_UPDATE_NOTIFIER: '1',
              SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', CI: '1' } });
          if (child.error) throw child.error;
          let json;
          try { json = JSON.parse(child.stdout); }
          catch (_) { throw new Error('CLI did not return JSON: ' + child.stdout + child.stderr); }
          return { json, exitCode: child.status };
        }
        async function current(documentId) {
          const response = await f.api('bob', '/api/cloud/v1/documents/' + documentId);
          assert.strictEqual(response.status, 200, JSON.stringify(response.data));
          return response.data.document;
        }

        await testAsync('real Cloud comments CLI lists honest anchor state, comment URLs, pages and historical feedback', async () => {
          const doc = await create();
          const listed = cli([doc.id]);
          assert.strictEqual(listed.exitCode, 0, JSON.stringify(listed.json));
          assert.strictEqual(listed.json.markdown, undefined);
          assert.strictEqual(listed.json.document.markdown, undefined);
          assert.deepStrictEqual(listed.json.comments.map(note => note.id), ['c1', 'c3']);
          assert.deepStrictEqual(listed.json.counts, { total: 3, open: 2, resolved: 1 });
          const note = listed.json.comments[0];
          assert.strictEqual(new URL(note.url).searchParams.get('comment'), 'c1');
          assert.strictEqual(new URL(note.url).searchParams.get('cloud-document'), doc.id);
          assert.match(note.sha256, /^[a-f0-9]{64}$/);
          assert.strictEqual(note.anchor.match_status, 'ambiguous');
          assert.strictEqual(note.context, null);
          const first = cli([listed.json.url, '--status', 'all', '--limit', '1', '--context', 'none']);
          assert.strictEqual(first.json.returned_count, 1);
          assert.strictEqual(first.json.has_more, true);
          assert.strictEqual(first.json.comments[0].context, null);
          const next = cli([doc.id, '--status', 'all', '--limit', '1', '--context', 'none', '--cursor', first.json.next_cursor]);
          assert.strictEqual(next.json.comments[0].id, 'c2');
          const resolved = cli([doc.id, '--id', 'c2']);
          assert.strictEqual(resolved.json.comments[0].status, 'resolved');
          const saved = cli([doc.id, '--id', 'c1', '--reply', 'Production checked.']);
          assert.strictEqual(saved.exitCode, 0, JSON.stringify(saved.json));
          const old = cli([doc.id, '--id', 'c1', '--revision', doc.current_revision_id]);
          assert.strictEqual(old.json.revision_id, doc.current_revision_id);
          assert.strictEqual(old.json.document.current_revision_id, saved.json.revision_id);
          assert.deepStrictEqual(old.json.comments[0].replies, []);
        });

        await testAsync('real Cloud comments CLI filters authors and aggregates signed snapshot pages', async () => {
          const doc = await create();
          const first = cli([doc.id, '--author', 'pRiYa', '--status', 'all', '--limit', '1', '--pages', '1']);
          assert.strictEqual(first.exitCode, 0, JSON.stringify(first.json));
          assert.strictEqual(first.json.comments[0].id, 'c1');
          assert.strictEqual(first.json.complete, false);
          assert.strictEqual(first.json.returned_count, 1);
          assert.deepStrictEqual(first.json.counts, { total: 3, open: 2, resolved: 1 });
          for (const section of ['Production', 'Sandbox']) {
            const added = cli([doc.id, '--add', '--text', 'New review for ' + section, '--quote', '10 minutes', '--section', section]);
            assert.strictEqual(added.exitCode, 0, JSON.stringify(added.json));
          }
          const continuation = cli([doc.id, '--author', 'pRiYa', '--status', 'all', '--limit', '1',
            '--cursor', first.json.next_cursor, '--all']);
          assert.strictEqual(continuation.exitCode, 0, JSON.stringify(continuation.json));
          assert.strictEqual(continuation.json.complete, true);
          assert.strictEqual(continuation.json.started_from_cursor, true);
          assert.strictEqual(continuation.json.comments[0].id, 'c2');
          assert.strictEqual(continuation.json.revision_id, first.json.revision_id);
          assert.deepStrictEqual(continuation.json.counts, first.json.counts);
          const allPriya = cli([doc.id, '--author', 'Priya', '--status', 'all', '--limit', '1', '--all']);
          assert.strictEqual(allPriya.exitCode, 0, JSON.stringify(allPriya.json));
          assert.deepStrictEqual(allPriya.json.comments.map(note => note.id), ['c1', 'c2']);
          assert.strictEqual(allPriya.json.complete, true);
          assert.strictEqual(allPriya.json.pages_fetched, 2);
          assert.deepStrictEqual(allPriya.json.counts, { total: 5, open: 4, resolved: 1 });
          for (const author of ['me', f.users.bob.id, 'bOb ExAmPlE']) {
            const own = cli([doc.id, '--author', author, '--limit', '1', '--all']);
            assert.strictEqual(own.exitCode, 0, JSON.stringify(own.json));
            assert.deepStrictEqual(own.json.comments.map(note => note.id), ['c4', 'c5']);
            assert.strictEqual(own.json.complete, true);
            assert.strictEqual(own.json.returned_count, 2);
          }
          const exact = cli([doc.id, '--author', 'Pri', '--status', 'all', '--all']);
          assert.strictEqual(exact.json.returned_count, 0);
          const differentUser = cli([doc.id, '--author', 'me', '--all'], 'member');
          assert.strictEqual(differentUser.exitCode, 0, JSON.stringify(differentUser.json));
          assert.strictEqual(differentUser.json.returned_count, 0);
        });

        await testAsync('real Cloud comments CLI deletes complete threads, retains history and preserves document text and other notes', async () => {
          const doc = await create();
          const replied = cli([doc.id, '--id', 'c1', '--reply', 'Production checked.']);
          assert.strictEqual(replied.exitCode, 0, JSON.stringify(replied.json));
          const before = await current(doc.id);
          const preview = cli([doc.id, '--id', 'c1', '--delete', '--dry-run']);
          assert.strictEqual(preview.exitCode, 0, JSON.stringify(preview.json));
          assert.strictEqual(preview.json.action, 'delete');
          assert.strictEqual(preview.json.comment_id, 'c1');
          assert.strictEqual(preview.json.comment, null);
          assert.strictEqual(preview.json.revision_created, false);
          assert.strictEqual((await current(doc.id)).current_revision_id, before.current_revision_id);
          const deleted = cli([doc.id, '--id', 'c1', '--delete'], 'member');
          assert.strictEqual(deleted.exitCode, 0, JSON.stringify(deleted.json));
          assert.strictEqual(deleted.json.action, 'delete');
          assert.strictEqual(deleted.json.comment_id, 'c1');
          assert.strictEqual(deleted.json.comment, null);
          assert.strictEqual(deleted.json.revision_created, true);
          const after = await current(doc.id);
          const parsed = yaml.parseFrontMatter(after.markdown);
          assert.strictEqual(parsed.body, body);
          assert.strictEqual(parsed.meta.title, 'Launch plan');
          assert.deepStrictEqual(parsed.meta.tags, ['planning']);
          assert.deepStrictEqual(parsed.meta.comments, yaml.parseFrontMatter(before.markdown).meta.comments.slice(1));
          const history = cli([doc.id, '--revision', before.current_revision_id, '--id', 'c1']);
          assert.strictEqual(history.exitCode, 0, JSON.stringify(history.json));
          assert.strictEqual(history.json.comments[0].replies[0].text, 'Production checked.');
          const absent = cli([doc.id, '--id', 'c1', '--delete']);
          assert.strictEqual(absent.json.error, 'comment_unavailable');
          for (const id of ['c2', 'c3']) {
            const result = cli([doc.id, '--id', id, '--delete']);
            assert.strictEqual(result.exitCode, 0, JSON.stringify(result.json));
            assert.strictEqual(result.json.comment_id, id);
          }
          const empty = yaml.parseFrontMatter((await current(doc.id)).markdown);
          assert.strictEqual(empty.meta.comments, undefined);
          assert.strictEqual(empty.body, body);
          assert.deepStrictEqual(empty.meta.tags, ['planning']);
        });

        await testAsync('real Cloud comments CLI previews and adds a scoped quote without changing document body', async () => {
          const doc = await create();
          const ambiguous = cli([doc.id, '--add', '--text', 'Check this.', '--quote', '10 minutes']);
          assert.strictEqual(ambiguous.exitCode, 2, JSON.stringify(ambiguous.json));
          assert.strictEqual(ambiguous.json.error, 'edit_ambiguous');
          const args = [doc.id, '--add', '--text', 'Confirm the approved production value.',
            '--quote', '10 minutes', '--section', 'Production'];
          const preview = cli([...args, '--dry-run']);
          assert.strictEqual(preview.exitCode, 0, JSON.stringify(preview.json));
          assert.strictEqual(preview.json.preview, true);
          assert.strictEqual(preview.json.dry_run, true);
          assert.strictEqual(preview.json.revision_id, doc.current_revision_id);
          assert.strictEqual((await current(doc.id)).current_revision_id, doc.current_revision_id);
          const added = cli(args, 'member');
          assert.strictEqual(added.exitCode, 0, JSON.stringify(added.json));
          assert.strictEqual(added.json.action, 'add');
          assert.strictEqual(added.json.comment.id, 'c4');
          assert.strictEqual(new URL(added.json.comment.url).searchParams.get('comment'), 'c4');
          assert.strictEqual(new URL(added.json.comment.url).searchParams.get('cloud-document'), doc.id);
          assert.strictEqual(added.json.comment.author.user_id, f.users.member.id);
          assert.strictEqual(added.json.comment.anchor.quote, '10 minutes');
          assert.ok(added.json.comment.context.section.includes('Production'));
          assert.strictEqual(added.json.markdown, undefined);
          assert.match(added.json.saved_sha256, /^[a-f0-9]{64}$/);
          const stored = yaml.parseFrontMatter((await current(doc.id)).markdown);
          assert.strictEqual(stored.body, body);
          assert.strictEqual(stored.meta.comments.length, 4);
        });

        await testAsync('real Cloud comments CLI replies, resolves with a note, reopens and preserves original feedback', async () => {
          const doc = await create();
          const replied = cli([doc.id, '--id', 'c1', '--reply', 'Updated the production value.'], 'member');
          assert.strictEqual(replied.exitCode, 0, JSON.stringify(replied.json));
          assert.strictEqual(replied.json.comment.replies.length, 1);
          assert.strictEqual(replied.json.comment.replies[0].author.user_id, f.users.member.id);
          const args = [doc.id, '--id', 'c1', '--resolve', '--note', 'Checked the saved content.'];
          const preview = cli([...args, '--dry-run']);
          assert.strictEqual(preview.exitCode, 0, JSON.stringify(preview.json));
          assert.strictEqual(preview.json.comment.status, 'resolved');
          assert.strictEqual(cli([doc.id, '--id', 'c1']).json.comments[0].status, 'open');
          const resolved = cli(args);
          assert.strictEqual(resolved.exitCode, 0, JSON.stringify(resolved.json));
          assert.strictEqual(resolved.json.comment.status, 'resolved');
          assert.strictEqual(resolved.json.comment.replies.length, 2);
          assert.strictEqual(cli([doc.id]).json.comments.some(note => note.id === 'c1'), false);
          assert.strictEqual(cli([doc.id, '--id', 'c1']).json.comments[0].status, 'resolved');
          const reopened = cli([doc.id, '--id', 'c1', '--reopen']);
          assert.strictEqual(reopened.exitCode, 0, JSON.stringify(reopened.json));
          assert.strictEqual(reopened.json.comment.status, 'open');
          assert.strictEqual(reopened.json.comment.text, 'Correct the production limit.');
          assert.strictEqual(reopened.json.comment.author.display_name, 'Priya');
          assert.strictEqual(reopened.json.comment.replies.length, 2);
          const stored = yaml.parseFrontMatter((await current(doc.id)).markdown);
          assert.strictEqual(stored.body, body);
          assert.strictEqual(stored.meta.comments.length, 3);
        });

        await testAsync('real Cloud comments CLI preserves independent edits and reports changed feedback on a stale base', async () => {
          const doc = await create();
          const independent = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
            base_revision_id: doc.current_revision_id,
            edits: [{ old_text: '10 minutes', new_text: '20 minutes', section: 'Production' }],
            idempotency_key: crypto.randomUUID() });
          assert.strictEqual(independent.status, 201, JSON.stringify(independent.data));
          const replied = cli([doc.id, '--id', 'c1', '--reply', 'Updated and checked.', '--base-revision', doc.current_revision_id]);
          assert.strictEqual(replied.exitCode, 0, JSON.stringify(replied.json));
          const changed = cli([doc.id, '--id', 'c1', '--resolve', '--base-revision', doc.current_revision_id]);
          assert.strictEqual(changed.exitCode, 5, JSON.stringify(changed.json));
          assert.strictEqual(changed.json.error, 'comment_changed');
          assert.strictEqual(changed.json.current_comment.id, 'c1');
          assert.strictEqual(changed.json.current_comment.replies_count, 1);
          const stored = await current(doc.id);
          assert.strictEqual(stored.current_revision_id, replied.json.revision_id);
          assert.strictEqual(yaml.parseFrontMatter(stored.markdown).body,
            body.replace('10 minutes', '20 minutes'));
          const refreshed = cli([doc.id, '--id', 'c1', '--resolve']);
          assert.strictEqual(refreshed.exitCode, 0, JSON.stringify(refreshed.json));
        });

        await testAsync('real Cloud comments CLI reattaches a lost anchor while preserving original note, replies and status', async () => {
          const doc = await create();
          const original = cli([doc.id, '--id', 'c1', '--resolve', '--note', 'Approved the revised limit.']);
          assert.strictEqual(original.exitCode, 0, JSON.stringify(original.json));
          const edit = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
            base_revision_id: original.json.revision_id,
            edits: [{ old_text: '10 minutes', new_text: '45 minutes', section: 'Production' },
              { old_text: '10 minutes', new_text: '45 minutes', section: 'Sandbox' }],
            idempotency_key: crypto.randomUUID() });
          assert.strictEqual(edit.status, 201, JSON.stringify(edit.data));
          const read = cli([doc.id, '--id', 'c1']);
          assert.strictEqual(read.exitCode, 0, JSON.stringify(read.json));
          assert.ok(['lost', 'ambiguous'].includes(read.json.comments[0].anchor.match_status));
          const args = [doc.id, '--id', 'c1', '--reattach', '--quote', '45 minutes', '--section', 'Production',
            '--base-revision', read.json.revision_id];
          const preview = cli([...args, '--dry-run']);
          assert.strictEqual(preview.exitCode, 0, JSON.stringify(preview.json));
          assert.strictEqual(preview.json.comment.anchor.quote, '45 minutes');
          assert.strictEqual((await current(doc.id)).current_revision_id, read.json.revision_id);
          const saved = cli(args);
          assert.strictEqual(saved.exitCode, 0, JSON.stringify(saved.json));
          assert.strictEqual(saved.json.action, 'reattach');
          assert.strictEqual(saved.json.comment.anchor.quote, '45 minutes');
          assert.ok(saved.json.comment.context.section.includes('Production'));
          assert.strictEqual(saved.json.comment.id, original.json.comment.id);
          assert.strictEqual(saved.json.comment.uid, original.json.comment.uid);
          assert.strictEqual(saved.json.comment.text, original.json.comment.text);
          assert.deepStrictEqual(saved.json.comment.author, original.json.comment.author);
          assert.deepStrictEqual(saved.json.comment.replies, original.json.comment.replies);
          assert.strictEqual(saved.json.comment.status, 'resolved');
          const stored = yaml.parseFrontMatter((await current(doc.id)).markdown);
          assert.strictEqual(stored.body, body.replaceAll('10 minutes', '45 minutes'));
          assert.strictEqual(stored.meta.comments.length, 3);
        });

        await testAsync('real Cloud comment response loss replays once after an independent document revision', async () => {
          const doc = await create();
          let loseResponse = true;
          const calls = [];
          const client = new CloudClient({ origin: f.origin,
            credentials: { load: () => actualCredentials.bob },
            fetch: async (url, options) => {
              calls.push({ url, body: options && options.body });
              const response = await fetch(url, options);
              if (loseResponse && url.endsWith('/comments/actions')) {
                loseResponse = false;
                assert.strictEqual(response.status, 201);
                await response.arrayBuffer();
                throw new Error('Fixture lost the committed response');
              }
              return response;
            } });
          const args = [doc.id, '--id', 'c1', '--reply', 'One response only.', '--json'];
          const first = await run(args, client);
          assert.strictEqual(first.json.error, 'temporary_service_failure');
          const committed = await current(doc.id);
          assert.strictEqual(committed.revision_number, 2);
          const independent = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
            base_revision_id: committed.current_revision_id,
            edits: [{ old_text: '10 minutes', new_text: '30 minutes', section: 'Sandbox' }],
            idempotency_key: crypto.randomUUID() });
          assert.strictEqual(independent.status, 201, JSON.stringify(independent.data));
          const retry = await run(args, client);
          assert.strictEqual(retry.exitCode, 0, JSON.stringify(retry.json));
          assert.strictEqual(retry.json.revision_id, committed.current_revision_id);
          assert.strictEqual(calls.length, 3);
          assert.strictEqual(calls[1].body, calls[2].body);
          const stored = await current(doc.id);
          assert.strictEqual(stored.revision_number, 3);
          const parsed = yaml.parseFrontMatter(stored.markdown);
          assert.strictEqual(require('../cli/shared/sdocs-comment-data').replies(parsed.meta.comments[0].replies).length, 1);
          assert.ok(parsed.body.includes('Maximum retry window: 30 minutes.'));
          assert.strictEqual(bindings.getOperationPending(f.users.bob.id, 'comments', doc.id), null);
        });
      } finally { await f.close(); }
    } finally {
      if (previousHome === undefined) delete process.env.SDOCS_HOME; else process.env.SDOCS_HOME = previousHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
};
