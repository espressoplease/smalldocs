const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function (h) {
  const { assert, testAsync } = h;
  const binary = path.join(__dirname, '../cli/bin/sdocs-dev.js');
  return async function () {
    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
    const { api, auth, store, billing, users } = f;
    function actor(key, profile = true) {
      let user = auth.signInWithVerifiedEmail(key + '@example.test').user;
      if (profile) user = auth.updateUserProfile({ userId: user.id, firstName: 'Fresh', lastName: key });
      auth.acceptCurrentTerms({ userId: user.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
      users[key] = { ...user, email: key + '@example.test', cookie: 'sdocs_cloud=' + auth.createBrowserSession(user.id).token };
      return users[key];
    }
    async function authorize(key) {
      const issued = await api(key, '/api/cloud/v1/cli/device-authorizations', 'POST', { display_name: key });
      assert.strictEqual(issued.status, 201);
      const approved = await api(key, '/api/cloud/v1/cli/device-authorizations/approve', 'POST', { user_code: issued.data.user_code });
      assert.strictEqual(approved.status, 200, JSON.stringify(approved.data));
      const polled = await api(key, '/api/cloud/v1/cli/device-authorizations/token', 'POST', { device_code: issued.data.device_code });
      assert.strictEqual(polled.status, 200);
      return polled.data;
    }
    async function bearer(credential, endpoint, method = 'GET', body) {
      const response = await fetch(f.origin + endpoint, { method, headers: {
        Authorization: 'Bearer ' + credential.access_token, 'Content-Type': 'application/json',
      }, body: body == null ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    function cli(args, env, onStderr) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [binary, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('CLI timed out')); }, 12000);
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; if (onStderr) onStderr(stderr); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      });
    }
    function trial(userId) { return billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(userId); }
    try {
      await testAsync('fresh CLI login creates a library and trial before its first unscoped save', async () => {
        const user = actor('cli-first');
        const home = path.join(f.dir, 'cli-home'); fs.mkdirSync(home);
        const env = { ...process.env, HOME: home, SDOCS_HOME: path.join(home, '.sdocs'),
          SDOCS_CLOUD_URL: f.origin, SDOCS_CLOUD_FILE_CREDENTIALS: '1', NO_UPDATE_NOTIFIER: '1', CI: '1' };
        let approval;
        const result = await cli(['cloud', 'login', '--no-open', '--json'], env, stderr => {
          const code = /Code: ([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(stderr);
          if (code && !approval) approval = api('cli-first', '/api/cloud/v1/cli/device-authorizations/approve', 'POST', { user_code: code[1] });
        });
        assert.strictEqual(result.code, 0, result.stderr);
        assert.strictEqual((await approval).status, 200);
        const login = JSON.parse(result.stdout);
        assert.strictEqual(login.origin, f.origin);
        assert.strictEqual(login.next_action, 'sdoc cloud status --json');
        const status = JSON.parse((await cli(['cloud', 'status', '--json'], env)).stdout);
        assert.strictEqual(status.ok, true);
        assert.strictEqual(status.account.can_create_document, true);
        assert.strictEqual(store.listWorkspaceMemberships(user.id).length, 1);
        const deadline = trial(user.id).ends_at_ms;
        assert.ok(deadline > Date.now());
        assert.strictEqual((await cli(['setup', '--cloud', '--yes'], env)).code, 0);
        const file = path.join(home, 'poem.md'); fs.writeFileSync(file, '# A poem\nMorning finds the window.\n');
        const saved = await cli([file, '--cloud', '--no-open', '--json'], env);
        assert.strictEqual(saved.code, 0, saved.stderr);
        const document = JSON.parse(saved.stdout);
        assert.strictEqual(document.ok, true);
        assert.ok(document.url.startsWith(f.origin + '/docs?cloud-document='));
        const read = JSON.parse((await cli(['cloud', 'read', document.document_id, '--json'], env)).stdout);
        assert.ok(read.markdown.includes('Morning finds the window.'));
        assert.strictEqual(trial(user.id).ends_at_ms, deadline);
      });

      await testAsync('concurrent first-machine approvals create one library and one trial deadline', async () => {
        const user = actor('cli-concurrent');
        const credentials = await Promise.all([authorize('cli-concurrent'), authorize('cli-concurrent')]);
        assert.strictEqual(store.listWorkspaceMemberships(user.id).length, 1);
        const deadline = trial(user.id).ends_at_ms;
        for (const credential of credentials) assert.strictEqual((await bearer(credential, '/api/cloud/v1/account')).status, 200);
        await authorize('cli-concurrent');
        assert.strictEqual(trial(user.id).ends_at_ms, deadline);
        assert.strictEqual(store.listWorkspaceMemberships(user.id).length, 1);
      });

      await testAsync('several libraries require a choice and remember the connected machine default', async () => {
        const user = actor('cli-choice');
        const credential = await authorize('cli-choice');
        const second = await api('cli-choice', '/api/cloud/v1/workspaces', 'POST', { name: 'Engineering' });
        assert.strictEqual(second.status, 201);
        const choice = await bearer(credential, '/api/cloud/v1/account');
        assert.strictEqual(choice.status, 409);
        assert.strictEqual(choice.data.error, 'account_selection_required');
        assert.strictEqual(choice.data.accounts.length, 2);
        const selected = second.data.workspace.workspaceId;
        const changed = await bearer(credential, '/api/cloud/v1/cli/credentials/' + credential.credential_id + '/library-default', 'PATCH', { workspace_id: selected });
        assert.strictEqual(changed.status, 200);
        assert.strictEqual((await bearer(credential, '/api/cloud/v1/account')).data.account.id, selected);
        const otherMachine = await authorize('cli-choice');
        assert.strictEqual((await bearer(otherMachine, '/api/cloud/v1/account')).status, 409);
        assert.strictEqual(store.listWorkspaceMemberships(user.id).length, 2);
      });

      await testAsync('joining through an existing membership does not create another private library', async () => {
        const before = store.listWorkspaceMemberships(users.member.id);
        const credential = await authorize('member');
        assert.deepStrictEqual(store.listWorkspaceMemberships(users.member.id), before);
        assert.strictEqual((await bearer(credential, '/api/cloud/v1/account')).data.account.id, f.team.workspaceId);
      });

      await testAsync('logging in again preserves the trial payment wall without extending the deadline', async () => {
        const user = actor('cli-expired');
        const first = await authorize('cli-expired');
        const saved = await bearer(first, '/api/cloud/v1/account/documents', 'POST', { filename: 'existing.md', markdown: '# Existing', idempotency_key: 'cli-expired-existing' });
        assert.strictEqual(saved.status, 201);
        const deadline = Date.now() - 8 * 86400000;
        billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(deadline, user.id);
        const credential = await authorize('cli-expired');
        assert.strictEqual(trial(user.id).ends_at_ms, deadline);
        assert.strictEqual((await bearer(credential, '/api/cloud/v1/documents/' + saved.data.document.id)).status, 402);
        assert.strictEqual((await bearer(credential, '/api/cloud/v1/account/documents', 'POST', { filename: 'blocked.md', markdown: '# Blocked', idempotency_key: 'cli-expired-blocked' })).status, 402);
      });

      await testAsync('first CLI connection captures a missing profile and returns to the same authorization code', async () => {
        const user = actor('cli-profile', false);
        const issued = auth.issueDeviceAuthorization({ displayName: 'Profile machine' });
        const target = '/cloud/authorize?user_code=' + issued.userCode;
        const page = await api('cli-profile', target);
        assert.strictEqual(page.status, 303);
        assert.strictEqual(page.headers.get('location'), '/cloud/profile?return=' + encodeURIComponent(target));
        const rejected = await api('cli-profile', '/api/cloud/v1/cli/device-authorizations/approve', 'POST', { user_code: issued.userCode });
        assert.strictEqual(rejected.status, 409);
        assert.strictEqual(rejected.data.error, 'profile_required');
        assert.strictEqual(store.listWorkspaceMemberships(user.id).length, 0);
        assert.strictEqual(auth.getDeviceAuthorization(issued.userCode).approved, false);
        assert.strictEqual((await api('cli-profile', '/api/cloud/v1/me', 'PATCH', { first_name: 'First', last_name: 'Connection' })).status, 200);
        assert.strictEqual((await api('cli-profile', '/api/cloud/v1/cli/device-authorizations/approve', 'POST', { user_code: issued.userCode })).status, 200);
        assert.strictEqual(store.listWorkspaceMemberships(user.id).length, 1);
      });

      for (const state of ['invalid', 'expired', 'denied', 'consumed']) {
        await testAsync(state + ' CLI codes cannot create a library or trial for another user', async () => {
          const key = 'cli-code-' + state; const user = actor(key);
          const issued = auth.issueDeviceAuthorization({ displayName: state });
          if (state === 'expired') auth.db.prepare('UPDATE cloud_cli_device_authorizations SET expires_at_ms=? WHERE id=?').run(Date.now() - 1, issued.id);
          if (state === 'denied') auth.denyDeviceAuthorization({ userCode: issued.userCode });
          if (state === 'consumed') { auth.approveDeviceAuthorization({ userId: users.bob.id, userCode: issued.userCode }); auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode }); }
          const result = await api(key, '/api/cloud/v1/cli/device-authorizations/approve', 'POST', { user_code: state === 'invalid' ? 'BBBB-BBBB' : issued.userCode });
          assert.strictEqual(result.status, 404);
          assert.strictEqual(store.listWorkspaceMemberships(user.id).length, 0);
          assert.strictEqual(trial(user.id), undefined);
        });
      }
    } finally { await f.close(); }
  };
};
