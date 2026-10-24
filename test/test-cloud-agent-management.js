const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { TRIAL_WARNING_MS } = require('../lib/cloud-trial-policy');
module.exports = function (h) {
  const { testAsync, assert } = h;
  return async function () {
    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
    const { api, auth, store, billing, users } = f;
    const home = path.join(f.dir, 'agent-home'); fs.mkdirSync(home);
    const prefix = path.join(home, '.sdocs'); fs.mkdirSync(path.join(prefix, 'cloud'), { recursive: true });
    const credentials = {};
    for (const key of ['josh', 'member', 'outsider']) {
      const issued = auth.issueDeviceAuthorization({ displayName: 'Agent ' + key });
      auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: users[key].id });
      const c = auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
      credentials[key] = { credential_id: c.credentialId, user_id: c.userId,
        access_token: c.accessToken, access_token_expires_at: new Date(c.accessExpiresAtMs).toISOString(), refresh_token: c.refreshToken };
    }
    function cli(args, key = 'josh') {
      fs.writeFileSync(path.join(prefix, 'cloud', 'credentials.json'), JSON.stringify({ [f.origin]: credentials[key] }));
      const result = spawnSync(process.execPath, [path.join(__dirname, '../cli/bin/sdocs-dev.js'), ...args, '--json'], {
        encoding: 'utf8', cwd: home, timeout: 15000, env: { ...process.env, HOME: home, SDOCS_HOME: prefix,
          SDOCS_CLOUD_FILE_CREDENTIALS: '1', SDOCS_CLOUD_URL: f.origin, SDOCS_URL: f.origin,
          NO_UPDATE_NOTIFIER: '1', SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', CI: '1' } });
      if (result.error) throw result.error;
      let data; try { data = JSON.parse(result.stdout); } catch (_) { throw new Error(result.stdout + result.stderr); }
      return { code: result.status, data };
    }
    let library, document, file, invitation;
    try {
      await testAsync('old accounts keep legacy navigation, new accounts default to Cloud, and preferences survive restart', async () => {
        const dbPath = path.join(f.dir, 'auth-migration.db');
        const options = { dbPath, pepper: 'migration-test-secret'.repeat(4) };
        let migration = require('../lib/cloud-auth').createAuthStore(options);
        const old = migration.signInWithVerifiedEmail('existing@example.test').user;
        migration.close();
        const Database = require('better-sqlite3');
        const db = new Database(dbPath);
        db.exec('ALTER TABLE cloud_auth_users DROP COLUMN legacy_library_enabled'); db.close();
        migration = require('../lib/cloud-auth').createAuthStore(options);
        assert.strictEqual(migration.getUser(old.id).legacyLibraryEnabled, true);
        const fresh = migration.signInWithVerifiedEmail('new@example.test').user;
        assert.strictEqual(fresh.legacyLibraryEnabled, false);
        migration.updateLibraryPreference(old.id, false); migration.close();
        migration = require('../lib/cloud-auth').createAuthStore(options);
        assert.strictEqual(migration.getUser(old.id).legacyLibraryEnabled, false);
        migration.close();
      });
      await testAsync('new accounts default to Cloud and can persist legacy navigation without changing names', async () => {
        await api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
        library = store.listWorkspaceMemberships(users.josh.id)[0].id;
        assert.strictEqual((await api('josh', '/api/cloud/v1/me')).data.user.legacy_library_enabled, false);
        const changed = await api('josh', '/api/cloud/v1/me/preferences', 'PATCH', { legacy_library_enabled: true, user_id: users.outsider.id });
        assert.strictEqual(changed.status, 200); assert.strictEqual(changed.data.user.first_name, 'Josh');
        assert.strictEqual(auth.getUser(users.outsider.id).legacyLibraryEnabled, false);
        assert.strictEqual((await api('josh', '/library')).status, 200);
        await api('josh', '/api/cloud/v1/me/preferences', 'PATCH', { legacy_library_enabled: false });
        assert.strictEqual((await api('josh', '/library')).headers.get('location'), '/library?scope=cloud');
        assert.strictEqual((await api('josh', '/api/cloud/v1/me/preferences', 'PATCH', { legacy_library_enabled: 'false' })).status, 400);
      });
      await testAsync('real CLI saves include trial state and confirmed tags in one JSON receipt', async () => {
        file = path.join(home, 'operations-report.md'); fs.writeFileSync(file, '# Operations report\n\nCustomer imports are idempotent.\n');
        const result = cli([file, '--cloud', '--no-open', '+operations']);
        assert.strictEqual(result.code, 0, JSON.stringify(result.data));
        assert.strictEqual(result.data.subscription.phase, 'trial');
        assert.deepStrictEqual(result.data.tags, ['operations']);
        document = result.data;
      });
      await testAsync('the seven-day warning keeps saves working and returns payment and feedback links', async () => {
        billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now() - 1000, users.josh.id);
        fs.appendFileSync(file, '\nRetry with backoff.\n');
        const result = cli([file, '--cloud', '--no-open']);
        assert.strictEqual(result.code, 0, JSON.stringify(result.data));
        assert.strictEqual(result.data.subscription.phase, 'trial_warning');
        assert.strictEqual(result.data.notices[0].feedback_requested, true);
        assert.strictEqual(result.data.subscription.subscribe_url, f.origin + '/cloud/subscribe');
        assert.strictEqual(result.data.subscription.feedback_url, f.origin + '/cloud/trial-feedback');
        const summary = cli(['cloud', 'billing']);
        assert.strictEqual(summary.data.phase, 'trial_warning');
        assert.strictEqual((await api('josh', '/docs?cloud-document=' + document.document_id)).status, 200);
        const invited = cli(['cloud', 'invite', users.gmail.email, '--account', library]);
        assert.strictEqual(invited.code, 0, JSON.stringify(invited.data));
        const token = new URL(invited.data.invitation.accept_url).searchParams.get('token');
        const joined = await api('gmail', '/api/cloud/v1/invitations/' + token + '/accept', 'POST', {});
        assert.strictEqual(joined.status, 200, JSON.stringify(joined.data));
        assert.strictEqual((await api('gmail', '/api/cloud/v1/documents/' + document.document_id)).status, 404);
      });
      await testAsync('after the extra week every content route refuses CLI access and pages open the paywall', async () => {
        billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now() - TRIAL_WARNING_MS - 1000, users.josh.id);
        for (const args of [['cloud','read',document.document_id], ['cloud','search','imports'], ['cloud','tags'], [file,'--cloud','--no-open']]) {
          const result = cli(args);
          assert.strictEqual(result.code, 4, JSON.stringify(result.data));
          assert.strictEqual(result.data.error, 'trial_payment_required');
          assert.strictEqual(result.data.subscription.phase, 'payment_required');
          assert.ok(!result.data.markdown);
        }
        for (const url of ['/api/cloud/v1/documents/' + document.document_id + '/revisions','/api/cloud/v1/documents/deleted']) {
          assert.strictEqual((await api('josh', url)).status, 402);
        }
        for (const url of ['/library?scope=cloud','/docs?cloud-document=' + document.document_id]) {
          assert.strictEqual((await api('josh', url)).headers.get('location'), '/cloud/subscribe');
        }
        assert.strictEqual((await api('josh', '/cloud/subscribe')).status, 200);
      });
      await testAsync('billing and exact settings links remain available without charging or modifying a default', async () => {
        const summary = cli(['cloud','billing']); assert.strictEqual(summary.code, 0);
        assert.strictEqual(summary.data.phase, 'payment_required');
        for (const [args, suffix] of [[['cloud','subscribe','--no-open'],'/cloud/subscribe'],
          [['cloud','settings','people','--account',library,'--no-open'],'/cloud/admin?panel=people&workspace_id=' + library],
          [['cloud','settings','preferences','--no-open'],'/cloud/admin?panel=preferences']]) {
          const result = cli(args); assert.strictEqual(result.code, 0, JSON.stringify(result.data));
          assert.strictEqual(result.data.url, f.origin + suffix); assert.strictEqual(result.data.payment_taken, false);
        }
        assert.strictEqual(billing.getSubscription(library), null);
      });
      await testAsync('trial feedback is authenticated, belongs to the caller, and works behind the payment wall', async () => {
        const result = cli(['cloud','trial-feedback','--note','Finding prior reports worked well.','--rating','4']);
        assert.strictEqual(result.code, 0, JSON.stringify(result.data));
        const row = billing.db.prepare('SELECT * FROM cloud_trial_feedback WHERE user_id=?').get(users.josh.id);
        assert.strictEqual(row.rating, 4); assert.strictEqual(row.comment, 'Finding prior reports worked well.');
        assert.strictEqual(cli(['cloud','trial-feedback','--note','x','--rating','NaN']).code, 2);
        assert.strictEqual((await fetch(f.origin + '/api/cloud/v1/trial-feedback', { method:'POST',headers:{'Content-Type':'application/json'},body:'{"comment":"x"}' })).status, 401);
      });
      await testAsync('paid coverage immediately removes the paywall and trial notices without signing in again', async () => {
        billing.upsertSubscription({ workspaceId: library, plan:'team', status:'active', provider:'manual' });
        const result = cli(['cloud','read',document.document_id]);
        assert.strictEqual(result.code, 0, JSON.stringify(result.data)); assert.strictEqual(result.data.subscription.phase, 'active');
        assert.deepStrictEqual(result.data.notices, []); assert.ok(result.data.markdown.includes('Retry with backoff.'));
      });
      await testAsync('an authorized agent can invite, list and revoke an invitation with existing role checks', async () => {
        const result = cli(['cloud','invite','alex@example.test','--account',library]);
        assert.strictEqual(result.code, 0, JSON.stringify(result.data)); invitation = result.data.invitation.id;
        assert.ok(cli(['cloud','invitations','--account',library]).data.invitations.some(i=>i.id===invitation));
        assert.strictEqual(cli(['cloud','revoke-invite',invitation,'--account',library]).code, 0);
        const rejected = cli(['cloud','invite','foreign@example.test','--account',f.otherTeam.workspaceId]);
        assert.notStrictEqual(rejected.code, 0); assert.strictEqual(rejected.data.error, 'resource_unavailable');
      });
      await testAsync('agent member removal revokes access and cannot remove the final owner or a foreign member', async () => {
        store.addWorkspaceMember({ actorUserId:users.josh.id,workspaceId:library,userId:users.member.id,role:'member' });
        store.setDocumentPermission({ userId:users.josh.id,documentId:document.document_id,mode:'everyone' });
        assert.strictEqual((await api('member','/api/cloud/v1/documents/' + document.document_id)).status, 200);
        const unprivileged = cli(['cloud','remove-member',users.josh.id,'--account',library], 'member');
        assert.notStrictEqual(unprivileged.code, 0);
        assert.strictEqual(cli(['cloud','remove-member',users.member.id,'--account',library]).code, 0);
        assert.strictEqual((await api('member','/api/cloud/v1/documents/' + document.document_id)).status, 404);
        assert.notStrictEqual(cli(['cloud','remove-member',users.josh.id,'--account',library]).code, 0);
        assert.notStrictEqual(cli(['cloud','remove-member',users.outsider.id,'--account',f.otherTeam.workspaceId]).code, 0);
      });
    } finally { await f.close(); }
    await testAsync('already queued legacy billing deletion cannot purge an unpaid library', async () => {
      const retained = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true, jobs: true });
      const jobs = require('../lib/cloud-jobs').createCloudJobs({ dbPath: path.join(retained.dir, 'jobs.db') });
      try {
        await retained.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
        const id = retained.store.listWorkspaceMemberships(retained.users.josh.id)[0].id;
        const saved = await retained.api('josh', '/api/cloud/v1/account/documents', 'POST', {
          account_id: id, markdown: '# Retain this document', filename: 'retain.md', idempotency_key: 'retain-unpaid' });
        assert.strictEqual(saved.status, 201);
        const expired = Date.now() - 1000;
        retained.billing.upsertSubscription({ workspaceId: id, plan: 'team', status: 'canceled',
          provider: 'manual', retentionEndsAtMs: expired });
        const job = jobs.enqueue({ type: 'billing_retention_expire', idempotencyKey: 'legacy-retention',
          payload: { type: 'retention_expire', workspaceId: id, retentionEndsAtMs: expired, availableAtMs: expired } });
        const deadline = Date.now() + 5000;
        while (jobs.get(job.id).state !== 'complete' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        assert.strictEqual(jobs.get(job.id).state, 'complete');
        const document = await retained.store.getDocument({ userId: retained.users.josh.id, documentId: saved.data.document.id });
        assert.strictEqual(document.markdown, '# Retain this document');
      } finally { jobs.close(); await retained.close(); }
    });
  };
};
