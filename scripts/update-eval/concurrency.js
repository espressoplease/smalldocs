'use strict';
// Two real CLI processes and a lost-response retry against disposable HTTP stores.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { startFixture } = require('../../test/cloud-onboarding-fixture');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-update-concurrency-'));
  const f = await startFixture({ singlePlan: true });
  let proxy;
  const results = [];
  const library = await f.store.createTeamWorkspace({ userId: f.users.bob.id, name: 'Concurrent editing', projectName: 'Documents' });
  f.store.addWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: library.workspaceId, userId: f.users.member.id, role: 'member' });
  f.billing.upsertSubscription({ workspaceId: library.workspaceId, plan: 'team', status: 'active', provider: 'manual' });
  function credential(user, origin, folder) {
    const state = path.join(root, folder, 'state');
    fs.mkdirSync(path.join(state, 'cloud'), { recursive: true, mode: 0o700 });
    const issued = f.auth.issueDeviceAuthorization({ displayName: 'Concurrency evaluator' });
    f.auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: f.users[user].id });
    const token = f.auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
    fs.writeFileSync(path.join(state, 'cloud/credentials.json'), JSON.stringify({ [origin]: {
      access_token: token.accessToken, refresh_token: token.refreshToken,
      access_token_expires_at: new Date(token.accessExpiresAtMs).toISOString(),
    } }), { mode: 0o600 });
    return { state, origin };
  }
  const bob = credential('bob', f.origin, 'bob'), member = credential('member', f.origin, 'member');
  function cli(actor, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve(__dirname, '../../cli/bin/sdocs-dev.js'), ...args, '--json'], {
        cwd: root, env: { ...process.env, SDOCS_HOME: actor.state, SDOCS_CLOUD_URL: actor.origin,
          SDOCS_CLOUD_FILE_CREDENTIALS: '1', SDOCS_NO_SETUP: '1', NO_UPDATE_NOTIFIER: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject); child.on('exit', code => {
        try { resolve({ code, data: JSON.parse(stdout), stderr }); }
        catch (_) { reject(new Error('CLI did not return JSON: ' + stdout + stderr)); }
      });
    });
  }
  async function make(markdown) {
    const doc = await f.store.createDocument({ userId: f.users.bob.id, projectId: library.projectId,
      filename: 'original-policy.md', markdown, idempotencyKey: crypto.randomUUID() });
    f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'custom', memberUserIds: [f.users.member.id] });
    return doc;
  }
  async function pullBoth(doc, prefix) {
    const files = [path.join(root, prefix + '-bob.md'), path.join(root, prefix + '-agent.md')];
    const pulled = await Promise.all([cli(bob, ['cloud', 'pull', doc.id, '--output', files[0]]), cli(member, ['cloud', 'pull', doc.id, '--output', files[1]])]);
    assert.ok(pulled.every(result => result.code === 0)); return files;
  }
  async function current(doc) { return f.store.getDocument({ userId: f.users.bob.id, documentId: doc.id }); }
  try {
    const base = '# Policy\n\nOwner: Ana\n\nCap: 10\n';
    const independent = await make(base), independentFiles = await pullBoth(independent, 'independent');
    fs.writeFileSync(independentFiles[0], base.replace('Ana', 'Bob'));
    fs.writeFileSync(independentFiles[1], base.replace('10', '30'));
    const parallel = await Promise.all([cli(bob, ['cloud', 'push', independentFiles[0]]), cli(member, ['cloud', 'push', independentFiles[1]])]);
    assert.ok(parallel.every(result => result.code === 0));
    const saved = await current(independent);
    assert.strictEqual(saved.markdown, base.replace('Ana', 'Bob').replace('10', '30'));
    assert.strictEqual(saved.filename, 'original-policy.md');
    assert.strictEqual(saved.revision_number, 3);
    results.push({ scenario: 'simultaneous_independent_cli_saves', passed: true, classifications: parallel.map(result => result.data.merge_classification) });

    const overlap = await make(base), overlapFiles = await pullBoth(overlap, 'overlap');
    fs.writeFileSync(overlapFiles[0], base.replace('10', '20'));
    fs.writeFileSync(overlapFiles[1], base.replace('10', '30'));
    const overlapped = await Promise.all([cli(bob, ['cloud', 'push', overlapFiles[0]]), cli(member, ['cloud', 'push', overlapFiles[1]])]);
    assert.ok(overlapped.every(result => result.code === 0));
    const both = await current(overlap);
    assert.ok(both.markdown.includes('Cap: 20\n') && both.markdown.includes('Cap: 30\n'));
    assert.strictEqual(both.revision_number, 3);
    assert.ok(overlapped.some(result => result.data.overlapping_edits_preserved));
    const log = await cli(member, ['cloud', 'history', overlap.id, '--diffs']);
    assert.strictEqual(log.code, 0);
    assert.strictEqual(log.data.revisions.length, 3);
    assert.ok(log.data.revisions.every(revision => revision.diff_available && revision.diff));
    results.push({ scenario: 'simultaneous_overlapping_cli_saves_keep_both_and_expose_changelog', passed: true, revision_count: log.data.revisions.length });

    const guarded = await make(base), guardedFiles = await pullBoth(guarded, 'guarded');
    fs.writeFileSync(guardedFiles[0], base.replace('10', '20'));
    fs.writeFileSync(guardedFiles[1], base.replace('10', '30'));
    const strict = await Promise.all([cli(bob, ['cloud', 'push', guardedFiles[0], '--reject-conflicts']), cli(member, ['cloud', 'push', guardedFiles[1], '--reject-conflicts'])]);
    assert.deepStrictEqual(strict.map(result => result.code).sort(), [0, 5]);
    assert.strictEqual((await current(guarded)).revision_number, 2);
    results.push({ scenario: 'explicit_strict_mode_is_optional_and_atomic', passed: true });

    let drop = true;
    proxy = http.createServer(async (request, response) => {
      try {
        let body = ''; for await (const part of request) body += part;
        const upstream = await fetch(f.origin + request.url, { method: request.method,
          headers: { Authorization: request.headers.authorization || '', 'Content-Type': 'application/json' }, body: ['GET', 'HEAD'].includes(request.method) ? undefined : body });
        const text = await upstream.text();
        if (drop && request.method === 'POST' && /\/revisions$/.test(request.url) && upstream.ok) { drop = false; request.socket.destroy(); return; }
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' }).end(text);
      } catch (_) { response.writeHead(502).end('{"ok":false,"error":"temporary_service_failure"}'); }
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const proxyOrigin = 'http://127.0.0.1:' + proxy.address().port;
    const retryActor = credential('member', proxyOrigin, 'retry');
    const retried = await make(base), retryFile = path.join(root, 'retry.md');
    assert.strictEqual((await cli(retryActor, ['cloud', 'pull', retried.id, '--output', retryFile])).code, 0);
    fs.writeFileSync(retryFile, base.replace('10', '40'));
    const lost = await cli(retryActor, ['cloud', 'push', retryFile]);
    assert.strictEqual(lost.data.error, 'temporary_service_failure');
    const once = await current(retried);
    assert.strictEqual(once.revision_number, 2);
    const retry = await cli(retryActor, ['cloud', 'push', retryFile]);
    assert.strictEqual(retry.code, 0);
    assert.strictEqual(retry.data.revision_id, once.current_revision_id);
    assert.strictEqual((await current(retried)).revision_number, 2);
    results.push({ scenario: 'response_lost_after_commit_replays_exact_revision_without_duplicate', passed: true });

    f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: retried.id, mode: 'custom', memberUserIds: [] });
    const revoked = await cli(retryActor, ['cloud', 'push', retryFile]);
    assert.strictEqual(revoked.data.error, 'resource_unavailable');
    results.push({ scenario: 'unchanged_push_cannot_claim_success_after_revocation', passed: true });

    const report = { passed: true, generated_at: new Date().toISOString(), results };
    if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (proxy) await new Promise(resolve => proxy.close(resolve));
    await f.close(); fs.rmSync(root, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; });
