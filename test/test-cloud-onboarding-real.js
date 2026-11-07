module.exports = function (harness) {
  const { assert, testAsync } = harness;
  return async function () {
    const fixture = await require('./cloud-onboarding-fixture').startFixture();
    const { api, team, users, billing, store } = fixture;
    let personalId, request, invitation;
    try {
      await testAsync('new personal onboarding provisions one usable library and a stable trial under concurrent retries', async () => {
        const results = await Promise.all([api('josh', '/api/cloud/v1/onboarding/personal', 'POST', {}), api('josh', '/api/cloud/v1/onboarding/personal', 'POST', {})]);
        assert.deepStrictEqual(results.map(r => r.status), [200, 200]);
        personalId = results[0].data.workspace_id;
        assert.strictEqual(results[1].data.workspace_id, personalId);
        assert.strictEqual(results[1].data.trial_ends_at_ms, results[0].data.trial_ends_at_ms);
        assert.strictEqual((await store.listWorkspaces(users.josh.id)).length, 1);
        const saved = await api('josh', '/api/cloud/v1/account/documents', 'POST', { account_id: personalId, filename: 'first.md', markdown: '# First SmallDoc', idempotency_key: 'onboarding-first-doc' });
        assert.strictEqual(saved.status, 201, JSON.stringify(saved.data));
        assert.ok(saved.data.document.id);
      });
      await testAsync('expired trial preserves reading and denies document writes at the HTTP boundary', async () => {
        billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms = ? WHERE workspace_id = ?').run(Date.now() - 1, personalId);
        const result = await api('josh', '/api/cloud/v1/account/documents', 'POST', { account_id: personalId, filename: 'blocked.md', markdown: '# Blocked', idempotency_key: 'blocked-doc' });
        assert.strictEqual(result.status, 402);
        const listed = await api('josh', '/api/cloud/v1/documents?workspace_id=' + personalId);
        assert.strictEqual(listed.status, 200);
      });
      await testAsync('a second sign-in identity cannot reset a verified email trial', async () => {
        let alternate = fixture.auth.signInWithExternalIdentity({ provider: 'google', subject: 'alternate-josh', verifiedEmail: 'josh@joes.com' }).user;
        alternate = fixture.auth.updateUserProfile({ userId: alternate.id, firstName: 'Josh', lastName: 'Example' });
        fixture.auth.acceptCurrentTerms({ userId: alternate.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
        users.alternate = { ...alternate, cookie: 'sdocs_cloud=' + fixture.auth.createBrowserSession(alternate.id).token };
        const result = await api('alternate', '/api/cloud/v1/onboarding/personal', 'POST', {});
        assert.strictEqual(result.status, 409);
        assert.strictEqual(result.data.error, 'trial_already_used');
      });
      await testAsync('existing paid personal library is reused without assigning a trial', async () => {
        const result = await api('returning', '/api/cloud/v1/onboarding/personal', 'POST', {});
        assert.strictEqual(result.status, 200);
        assert.strictEqual(result.data.workspace_id, fixture.personal.workspaceId);
        assert.strictEqual(result.data.trial_ends_at_ms, null);
        assert.strictEqual(billing.getSubscription(fixture.personal.workspaceId).provider, 'manual');
      });
      await testAsync('private request creation does not disclose teams or members and rejects unconsented requests', async () => {
        const denied = await api('josh', '/api/cloud/v1/join-requests', 'POST', { consented: false });
        assert.strictEqual(denied.status, 400);
        const created = await api('josh', '/api/cloud/v1/join-requests', 'POST', { consented: true, note: 'Engineering' });
        assert.strictEqual(created.status, 200);
        request = created.data.request;
        assert.strictEqual(request.status, 'pending');
        assert.ok(!JSON.stringify(created.data).includes("Joe's engineering"));
        assert.ok(!JSON.stringify(created.data).includes('bob@'));
        const duplicate = await api('josh', '/api/cloud/v1/join-requests', 'POST', { consented: true });
        assert.strictEqual(duplicate.data.request.handoff_url, request.handoff_url);
      });
      await testAsync('private request review rejects other-domain owners and same-domain ordinary members', async () => {
        const token = new URL(request.handoff_url).searchParams.get('token');
        for (const actor of ['outsider', 'member', 'josh']) {
          const result = await api(actor, '/api/cloud/v1/join-requests/review?token=' + encodeURIComponent(token));
          assert.strictEqual(result.status, 404, JSON.stringify(result.data));
          assert.ok(!JSON.stringify(result.data).includes('josh@'));
        }
        const review = await api('bob', '/api/cloud/v1/join-requests/review?token=' + encodeURIComponent(token));
        assert.strictEqual(review.status, 200);
        assert.strictEqual(review.data.request.email, 'josh@joes.com');
        assert.deepStrictEqual(review.data.workspaces.map(w => w.id), [team.workspaceId]);
      });
      await testAsync('request invitation retries reuse a single invitation without adding membership', async () => {
        const token = new URL(request.handoff_url).searchParams.get('token');
        const results = await Promise.all([api('bob', '/api/cloud/v1/join-requests/invite', 'POST', { token, workspace_id: team.workspaceId }), api('bob', '/api/cloud/v1/join-requests/invite', 'POST', { token, workspace_id: team.workspaceId })]);
        assert.deepStrictEqual(results.map(r => r.status), [200, 200]);
        invitation = results[0].data.invitation;
        assert.strictEqual(invitation.id, results[1].data.invitation.id);
        assert.strictEqual(store.listWorkspaceMemberships(users.josh.id).some(w => w.id === team.workspaceId), false);
        assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS n FROM cloud_invitations WHERE workspace_id = ?').get(team.workspaceId).n, 1);
      });
      await testAsync('invitation details and acceptance require the invited email; repeated acceptance is idempotent', async () => {
        const token = new URL(invitation.accept_url).searchParams.get('token');
        const endpoint = '/api/cloud/v1/invitations/' + encodeURIComponent(token);
        assert.strictEqual((await api('member', endpoint)).status, 403);
        const details = await api('josh', endpoint);
        assert.strictEqual(details.data.invitation.workspace_name, "Joe's engineering");
        const accepted = await Promise.all([api('josh', endpoint + '/accept', 'POST', {}), api('josh', endpoint + '/accept', 'POST', {})]);
        assert.deepStrictEqual(accepted.map(result => result.status), [200, 200]);
        assert.strictEqual((await api('josh', endpoint + '/accept', 'POST', {})).status, 200);
        assert.strictEqual(store.listWorkspaceMemberships(users.josh.id).filter(w => w.id === team.workspaceId).length, 1);
        assert.ok(store.listWorkspaceMemberships(users.josh.id).some(w => w.id === personalId));
        const onboarding = await api('josh', '/api/cloud/v1/onboarding');
        assert.strictEqual(onboarding.data.request.status, 'joined');
        assert.strictEqual(onboarding.data.request.handoff_url, undefined);
      });
      await testAsync('profile and invitation continuations remain inside the application', async () => {
        const token = new URL(invitation.accept_url).searchParams.get('token');
        const target = '/cloud/invite?token=' + encodeURIComponent(token);
        const route = await api('josh', '/cloud/profile?return=' + encodeURIComponent(target));
        assert.strictEqual(route.status, 303);
        assert.strictEqual(route.headers.get('location'), target);
        const malicious = await api('josh', '/cloud/profile?return=https://example.com');
        assert.strictEqual(malicious.headers.get('location'), '/cloud/start');
      });
      await testAsync('cancelled request cannot be reviewed or used to create another invitation', async () => {
        await api('josh', '/api/cloud/v1/join-requests/' + request.id, 'DELETE');
        const token = new URL(request.handoff_url).searchParams.get('token');
        assert.strictEqual((await api('bob', '/api/cloud/v1/join-requests/review?token=' + encodeURIComponent(token))).status, 404);
      });
    } finally { await fixture.close(); }
  };
};
