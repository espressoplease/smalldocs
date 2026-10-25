const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
    const single = new (require('../lib/cloud-single-plan').SinglePlan)({ billing: f.billing, store: f.store });
    const terms = require('../lib/cloud-terms').CURRENT_TERMS_VERSION;
    function actor(key, profile = true, accepted = true) {
      let user = f.auth.signInWithVerifiedEmail(key + '@example.test').user;
      if (profile) user = f.auth.updateUserProfile({ userId: user.id, firstName: 'New', lastName: key });
      if (accepted) f.auth.acceptCurrentTerms({ userId: user.id, termsVersion: terms });
      f.users[key] = { ...user, email: key + '@example.test', cookie: 'sdocs_cloud=' + f.auth.createBrowserSession(user.id).token };
      return f.users[key];
    }
    function trial(id) { return f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(id); }
    async function ready(key) {
      const libraries = f.store.listWorkspaceMemberships(f.users[key].id);
      assert.strictEqual(libraries.length, 1);
      const account = await f.api(key, '/api/cloud/v1/account');
      assert.strictEqual(account.status, 200, JSON.stringify(account.data));
      assert.strictEqual(account.data.account.can_create_document, true);
      return libraries[0].id;
    }
    async function verify(key, target) {
      const code = f.auth.issueEmailCode({ email: f.users[key].email });
      return f.api(key, '/api/cloud/auth/email/verify', 'POST', { challenge_id: code.requestId, code: code.code, return_to: target });
    }
    try {
      await testAsync('profile completion prepares a usable library before returning to a document', async () => {
        const user = actor('profile-ready', false);
        const target = '/docs?cloud-document=existing#section';
        const result = await f.api('profile-ready', '/api/cloud/v1/me', 'PATCH', {
          first_name: 'Robin', last_name: 'Walker', return_to: target });
        assert.strictEqual(result.status, 200);
        assert.strictEqual(result.data.onboarding_complete, true);
        assert.strictEqual(result.data.return_to, target);
        await ready('profile-ready');
        const deadline = trial(user.id).ends_at_ms;
        const saved = await f.api('profile-ready', '/api/cloud/v1/account/documents', 'POST', {
          filename: 'first.md', markdown: '# First document', idempotency_key: 'profile-first' });
        assert.strictEqual(saved.status, 201, JSON.stringify(saved.data));
        assert.strictEqual((await f.api('profile-ready', '/api/cloud/v1/documents/' + saved.data.document.id)).status, 200);
        await verify('profile-ready', '/library?scope=cloud');
        assert.strictEqual(trial(user.id).ends_at_ms, deadline);
        assert.strictEqual(f.store.listWorkspaceMemberships(user.id).length, 1);
      });

      await testAsync('email sign-in repairs a previous complete profile with no library before returning', async () => {
        actor('email-ready');
        const result = await verify('email-ready', '/library?scope=cloud');
        assert.strictEqual(result.status, 200, JSON.stringify(result.data));
        assert.strictEqual(result.data.onboarding_complete, true);
        assert.strictEqual(result.data.return_to, '/library?scope=cloud');
        assert.ok(result.headers.get('set-cookie').includes('HttpOnly'));
        await ready('email-ready');
      });

      await testAsync('accepting Terms completes an existing Google profile and preserves its destination', async () => {
        actor('terms-ready', true, false);
        const target = '/cloud/authorize?user_code=ABCD-EFGH';
        const result = await f.api('terms-ready', '/api/cloud/auth/terms/accept', 'POST', { accepted: true, terms_version: terms, return_to: target });
        assert.strictEqual(result.status, 200, JSON.stringify(result.data));
        assert.strictEqual(result.data.onboarding_complete, true);
        assert.strictEqual(result.data.return_to, target);
        await ready('terms-ready');
      });

      await testAsync('missing profile stays in setup and cannot receive a successful empty library inventory', async () => {
        const user = actor('pending-profile', false);
        const result = await verify('pending-profile', '/library?scope=cloud');
        assert.strictEqual(result.data.onboarding_complete, false);
        assert.strictEqual(result.data.return_to, '/cloud/profile?return=' + encodeURIComponent('/library?scope=cloud'));
        for (const endpoint of ['/api/cloud/v1/workspaces', '/api/cloud/v1/library-settings', '/api/cloud/v1/account']) {
          const pending = await f.api('pending-profile', endpoint);
          assert.strictEqual(pending.status, 409, endpoint + ': ' + JSON.stringify(pending.data));
          assert.strictEqual(pending.data.error, 'profile_required');
        }
        for (const endpoint of ['/library?scope=cloud', '/docs?cloud-document=some-document']) {
          const page = await f.api('pending-profile', endpoint);
          assert.strictEqual(page.status, 303);
          assert.strictEqual(page.headers.get('location'), '/cloud/start?return=' + encodeURIComponent(endpoint));
        }
        assert.strictEqual(f.store.listWorkspaceMemberships(user.id).length, 0);
        assert.strictEqual(trial(user.id), undefined);
      });

      for (const endpoint of ['/api/cloud/v1/workspaces', '/api/cloud/v1/library-settings', '/api/cloud/v1/account']) {
        await testAsync(endpoint + ' repairs an older libraryless signup before responding', async () => {
          const key = 'recover-' + endpoint.split('/').pop(); actor(key);
          const result = await f.api(key, endpoint);
          assert.strictEqual(result.status, 200, JSON.stringify(result.data));
          await ready(key);
        });
      }

      await testAsync('setup resume retains a deep link and concurrent attempts create one library', async () => {
        const user = actor('resume-concurrent');
        const target = '/library?scope=cloud&tag=decisions#results';
        const results = await Promise.all([1, 2, 3].map(() => f.api('resume-concurrent', '/cloud/start?return=' + encodeURIComponent(target))));
        assert.ok(results.every(result => result.status === 303 && result.headers.get('location') === target));
        await ready('resume-concurrent');
        assert.strictEqual(f.billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id=?').get(user.id).n, 1);
      });

      await testAsync('invited signup joins the intended library without an extra trial or private library', async () => {
        const user = actor('invited-ready', false);
        const invite = await f.store.createInvitation({ userId: f.users.bob.id, workspaceId: f.team.workspaceId,
          email: user.email, role: 'member' });
        const target = '/cloud/invite?token=' + invite.token;
        const profile = await f.api('invited-ready', '/api/cloud/v1/me', 'PATCH', { first_name: 'Invited', last_name: 'Person', return_to: target });
        assert.strictEqual(profile.data.return_to, target);
        assert.strictEqual(profile.data.onboarding_complete, false);
        assert.strictEqual(f.store.listWorkspaceMemberships(user.id).length, 0);
        const accepted = await f.api('invited-ready', '/api/cloud/v1/invitations/' + invite.token + '/accept', 'POST', {});
        assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.data));
        const result = await verify('invited-ready', '/library?scope=cloud');
        assert.strictEqual(result.data.onboarding_complete, true);
        assert.deepStrictEqual(f.store.listWorkspaceMemberships(user.id).map(library => library.id), [f.team.workspaceId]);
        assert.strictEqual(trial(user.id), undefined);
        assert.strictEqual((await f.api('outsider', '/api/cloud/v1/account?account_id=' + f.team.workspaceId)).status, 404);
      });

      await testAsync('expired profile session retains an invitation through nested setup return paths', async () => {
        const user = actor('invite-resume', false);
        const invite = await f.store.createInvitation({ userId: f.users.bob.id, workspaceId: f.team.workspaceId,
          email: user.email, role: 'member' });
        const target = '/cloud/invite?token=' + invite.token;
        const nested = '/cloud/terms?return=' + encodeURIComponent('/cloud/profile?return=' + encodeURIComponent(target));
        const signedIn = await verify('invite-resume', nested);
        assert.strictEqual(signedIn.data.return_to, '/cloud/profile?return=' + encodeURIComponent(target));
        const profile = await f.api('invite-resume', '/api/cloud/v1/me', 'PATCH', {
          first_name: 'Invited', last_name: 'Again', return_to: nested });
        assert.strictEqual(profile.data.return_to, target);
        assert.strictEqual(profile.data.onboarding_complete, false);
        assert.strictEqual(f.store.listWorkspaceMemberships(user.id).length, 0);
        assert.strictEqual(trial(user.id), undefined);
      });

      // Run the production OAuth callback with a verified provider adapter. The
      // provider signature, nonce and PKCE checks have their own adapter tests.
      const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
      const context = { URL, Date, Number, Boolean, String, require: require('module').createRequire(path.join(__dirname, '../server.js')),
        cloudAuth: f.auth, cloudIdentityLinking: new (require('../lib/cloud-auth-linking').IdentityLinking)(f.auth), cloudStore: f.store, cloudBilling: f.billing, cloudSinglePlan: single, SINGLE_PLAN_ENABLED: true,
        CLOUD_AUTH_PUBLIC_ORIGIN: f.origin, CURRENT_TERMS_VERSION: terms, cloudAuthHttp: require('../cloud/auth/http'),
        verifiedCloudEmail: id => f.auth.getUser(id).identities.find(identity => identity.verifiedEmail).verifiedEmail,
        cloudAuthReady: () => true, getClientIp: () => 'oauth-readiness-test',
        cloudOAuthBindingCookie: (provider, token) => 'sdocs_oauth_' + provider + '=' + token + '; Path=/; HttpOnly; SameSite=Lax',
        cloudGitHubOAuth: null };
      vm.createContext(context);
      vm.runInContext(source.slice(source.indexOf('function cloudTermsAccepted('), source.indexOf('const HOMEPAGE_NAV_ICONS')) +
        source.slice(source.indexOf('function cloudOnboardingDestination('), source.indexOf('function requireInvitationEntitlement(')) +
        source.slice(source.indexOf('function cloudLinkTokens('), source.indexOf('async function handleCloudTermsAcceptance(')), context);
      async function google(key, target) {
        context.cloudGoogleOAuth = { callback: async () => ({ identity: { provider: 'google', subject: key,
          verifiedEmail: key + '@example.test', emailAuthoritative: true, firstName: 'Google', lastName: 'Person' }, returnTo: target }) };
        const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end() {} };
        await context.finishCloudOAuth({ headers: { cookie: 'sdocs_oauth_google=bound-state' } }, response,
          new URL(f.origin + '/api/cloud/auth/oauth/google/callback?state=bound-state&code=provider-code'), 'google');
        return response;
      }
      function googleUser(key) {
        const user = f.auth.signInWithExternalIdentity({ provider: 'google', subject: key, verifiedEmail: key + '@example.test' }).user;
        f.auth.acceptCurrentTerms({ userId: user.id, termsVersion: terms });
        return user;
      }
      await testAsync('Google callback provisions a usable library before returning a browser session to Cloud', async () => {
        const user = googleUser('google-ready');
        const result = await google('google-ready', '/library?scope=cloud');
        assert.strictEqual(result.status, 303);
        assert.strictEqual(result.headers.Location, '/library?scope=cloud');
        assert.strictEqual(f.store.listWorkspaceMemberships(user.id).length, 1);
        assert.ok(trial(user.id).ends_at_ms > Date.now());
        const cookie = result.headers['Set-Cookie'][0].split(';')[0];
        const status = await fetch(f.origin + '/api/cloud/v1/account', { headers: { Cookie: cookie } });
        assert.strictEqual((await status.json()).account.can_create_document, true);
      });

      await testAsync('billing failure preserves verified sign-in, then retry finishes the same library and trial', async () => {
        const user = googleUser('google-retry');
        const original = f.billing.ensurePersonalTrial;
        f.billing.ensurePersonalTrial = () => { throw new Error('billing unavailable'); };
        let failed;
        try { failed = await google('google-retry', '/library?scope=cloud'); }
        finally { f.billing.ensurePersonalTrial = original; }
        assert.strictEqual(failed.headers.Location, '/cloud/start?return=' + encodeURIComponent('/library?scope=cloud'));
        const library = f.store.listWorkspaceMemberships(user.id)[0].id;
        assert.strictEqual(trial(user.id), undefined);
        const cookie = failed.headers['Set-Cookie'][0].split(';')[0];
        const session = f.auth.authenticateSession(decodeURIComponent(cookie.split('=')[1]));
        assert.strictEqual(session.ok, true);
        const retry = await fetch(f.origin + failed.headers.Location, { redirect: 'manual', headers: { Cookie: cookie } });
        assert.strictEqual(retry.status, 303);
        assert.strictEqual(retry.headers.get('location'), '/library?scope=cloud');
        assert.deepStrictEqual(f.store.listWorkspaceMemberships(user.id).map(row => row.id), [library]);
        const deadline = trial(user.id).ends_at_ms;
        await google('google-retry', '/library?scope=cloud');
        assert.strictEqual(trial(user.id).ends_at_ms, deadline);
      });

      await testAsync('Google signup still requires Terms and external return targets stay on this Cloud origin', async () => {
        const initial = await google('google-new-terms', '/library?scope=cloud');
        assert.strictEqual(initial.headers.Location, '/cloud/terms?return=' + encodeURIComponent('/library?scope=cloud'));
        const user = googleUser('google-new-terms');
        assert.strictEqual(f.store.listWorkspaceMemberships(user.id).length, 0);
        const result = await google('google-new-terms', '//other-company.example/library');
        assert.strictEqual(result.headers.Location, '/cloud/admin');
        assert.strictEqual(f.store.listWorkspaceMemberships(user.id).length, 1);
      });
    } finally { await f.close(); }
  };
};
