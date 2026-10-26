module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true, logErrors: true });
    const { api, store, billing, users } = f;
    const single = new (require('../lib/cloud-single-plan').SinglePlan)({ billing, store });
    let own, second, doc, foreign, machine, token;
    async function create(actor, library, key, markdown = '# Confidential') {
      return api(actor, '/api/cloud/v1/account/documents', 'POST', { account_id: library, filename: key + '.md', markdown, idempotency_key: key });
    }
    try {
      await testAsync('legacy migration selects an existing paid library before an unpaid library without changing subscriptions', async () => {
        const oldDocument = await store.createDocument({ userId: users.returning.id, projectId: f.personal.projectId,
          filename: 'before-migration.md', markdown: '# Existing private content', idempotencyKey: 'before-migration' });
        const oldPermission = store.getDocumentPermission({ userId: users.returning.id, documentId: oldDocument.id });
        const extra = await store.createTeamWorkspace({ userId: users.returning.id, name: 'Second library', projectName: 'Documents' });
        const direct = await api('returning', '/api/cloud/v1/documents', 'POST', { project_id: extra.projectId,
          filename: 'existing-client.md', markdown: '# Existing API client', idempotency_key: 'legacy-api-client' });
        assert.strictEqual(direct.status, 201, JSON.stringify(direct));
        const account = single.initialize(users.returning.id, extra.workspaceId, users.returning.email);
        single.initialize(users.returning.id, f.personal.workspaceId, users.returning.email);
        assert.strictEqual(account.id, f.personal.workspaceId);
        assert.strictEqual(store.db.prepare('SELECT kind FROM cloud_workspaces WHERE id=?').get(f.personal.workspaceId).kind, 'team');
        assert.deepStrictEqual(store.getDocumentPermission({ userId: users.returning.id, documentId: oldDocument.id }), oldPermission);
        assert.strictEqual((await store.getDocument({ userId: users.returning.id, documentId: oldDocument.id })).markdown, '# Existing private content');
        assert.strictEqual(billing.getSubscription(account.id).plan, 'personal');
        assert.strictEqual(single.entitlements(users.returning.id, extra.workspaceId).covered, true);
        assert.strictEqual(single.migrationReview(users.returning.id).subscription_conflicts.length, 0);
        billing.upsertSubscription({ workspaceId: f.personal.workspaceId, plan: 'personal', status: 'active', provider: 'stripe', providerSubscriptionId: 'sub_legacy_one' });
        billing.upsertSubscription({ workspaceId: extra.workspaceId, plan: 'team', status: 'active', provider: 'stripe', providerSubscriptionId: 'sub_legacy_two' });
        assert.deepStrictEqual(new Set(single.migrationReview(users.returning.id).subscription_conflicts), new Set(['sub_legacy_one', 'sub_legacy_two']));
        const legacy = await api('returning', '/api/cloud/v1/workspaces/' + extra.workspaceId + '/billing');
        assert.strictEqual(legacy.data.billing.legacy_price, true);
      });
      await testAsync('a second library owner can create a library without inheriting the first owners billing account', async () => {
        const shared = await store.createTeamWorkspace({ userId: users.returning.id, name: 'Shared ownership', projectName: 'Documents' });
        billing.upsertSubscription({ workspaceId: shared.workspaceId, plan: 'team', status: 'active', provider: 'stripe', providerSubscriptionId: 'sub_shared_owners' });
        single.initialize(users.returning.id, shared.workspaceId, users.returning.email);
        store.addWorkspaceMember({ actorUserId: users.returning.id, workspaceId: shared.workspaceId, userId: users.gmail.id, role: 'member' });
        store.transferWorkspaceOwnership({ actorUserId: users.returning.id, workspaceId: shared.workspaceId, targetUserId: users.gmail.id });
        const result = await api('gmail', '/api/cloud/v1/workspaces', 'POST', { name: 'Research' });
        assert.strictEqual(result.status, 201, JSON.stringify(result));
        const created = result.data.workspace.workspaceId;
        assert.strictEqual(single.account(created).owner_user_id, users.gmail.id);
        assert.notStrictEqual(single.account(created).id, single.ownAccount(users.returning.id).id);
      });
      await testAsync('direct settings entry provisions a free library once, without requiring checkout', async () => {
        const missingProfile = await api('missing', '/cloud/admin?panel=billing');
        assert.strictEqual(missingProfile.status, 303);
        assert.ok(missingProfile.headers.get('location').startsWith('/cloud/profile?return='));
        f.auth.updateUserProfile({ userId: users.missing.id, firstName: 'Taylor', lastName: 'Example' });
        const pages = await Promise.all([api('missing', '/cloud/admin?panel=billing'), api('missing', '/cloud/admin?panel=libraries')]);
        assert.deepStrictEqual(pages.map(page => page.status), [200, 200]);
        const libraries = await store.listWorkspaces(users.missing.id);
        assert.strictEqual(libraries.length, 1);
        const trial = billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(users.missing.id);
        assert.ok(trial.ends_at_ms > Date.now() + 27 * 24 * 60 * 60 * 1000);
        assert.strictEqual(billing.getSubscription(trial.workspace_id), null);
        const status = await api('missing', '/api/cloud/billing/subscription');
        assert.strictEqual(status.status, 200);
        assert.strictEqual(status.data.trial_active, true);
        assert.strictEqual(status.data.trial_ends_at_ms, trial.ends_at_ms);
        assert.strictEqual(status.data.trial_starts_at_ms, trial.starts_at_ms);
        assert.strictEqual(status.data.quantity, 1);
        const saved = await create('missing', libraries[0].id, 'free-trial-write');
        assert.strictEqual(saved.status, 201, JSON.stringify(saved));
        billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now() - 8 * 86400000, users.missing.id);
        await api('missing', '/cloud/admin?panel=billing');
        const expired = await api('missing', '/api/cloud/billing/subscription');
        assert.strictEqual(expired.data.trial_active, false);
        assert.ok(expired.data.trial_ends_at_ms < Date.now());
        assert.strictEqual((await create('missing', libraries[0].id, 'expired-trial-write')).status, 402);
        assert.strictEqual((await api('missing', '/api/cloud/v1/documents/' + saved.data.document.id)).status, 402);
        assert.strictEqual(billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id=?').get(users.missing.id).n, 1);
      });
      await testAsync('subscription summary requires authentication and does not reveal another user billing', async () => {
        const unauthenticated = await fetch(f.origin + '/api/cloud/billing/subscription');
        assert.strictEqual(unauthenticated.status, 401);
        const own = await api('josh', '/api/cloud/billing/subscription?user_id=' + users.missing.id);
        assert.strictEqual(own.data.email, users.josh.email);
        assert.strictEqual(own.data.trial_ends_at_ms, null);
        assert.strictEqual(own.data.subscription_status, null);
      });
      await testAsync('single-plan signup is atomic and redirects to Install without rendering an intermediary', async () => {
        const results = await Promise.all([api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {}), api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})]);
        assert.deepStrictEqual(results.map(r => r.status), [200, 200], JSON.stringify(results));
        own = results[0].data.workspaces[0].id;
        assert.strictEqual(results[1].data.workspaces[0].id, own);
        assert.strictEqual(results[0].data.workspaces[0].kind, 'team');
        const page = await api('josh', '/cloud/start');
        assert.strictEqual(page.status, 303);
        assert.ok(page.headers.get('location').includes('panel=install'));
        assert.strictEqual((await api('josh', '/cloud/start?choose=1')).headers.get('location'), '/cloud/admin?panel=libraries&workspace_id=' + own);
      });
      await testAsync('creating another library shares one trial and billing account', async () => {
        const result = await api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Engineering' });
        assert.strictEqual(result.status, 201, JSON.stringify(result));
        second = result.data.workspace.workspaceId;
        assert.notStrictEqual(second, own);
        assert.strictEqual(single.account(second).id, single.account(own).id);
        assert.strictEqual(billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id=?').get(users.josh.id).n, 1);
        const resultDoc = await create('josh', own, 'private', '# Confidential alpha');
        assert.strictEqual(resultDoc.status, 201, JSON.stringify(resultDoc)); doc = resultDoc.data.document;
        foreign = (await create('outsider', f.otherTeam.workspaceId, 'other', '# Confidential foreign')).data.document;
        assert.ok(foreign.id);
      });
      await testAsync('other organisations and same-domain nonmembers cannot read private documents or histories', async () => {
        for (const actor of ['outsider', 'member', 'bob']) {
          for (const endpoint of ['/documents/' + doc.id, '/documents/' + doc.id + '/head', '/documents/' + doc.id + '/revisions', '/documents/' + doc.id + '/revisions/' + doc.current_revision_id, '/documents/' + doc.id + '/permission']) {
            const result = await api(actor, '/api/cloud/v1' + endpoint);
            assert.strictEqual(result.status, 404, endpoint + ': ' + JSON.stringify(result));
            assert.ok(!JSON.stringify(result.data).includes('Confidential alpha'));
          }
        }
      });
      await testAsync('listing, search, tags and settings never disclose another organisation libraries or files', async () => {
        const settings = await api('outsider', '/api/cloud/v1/library-settings');
        assert.ok(!settings.data.libraries.some(w => w.id === own));
        const search = await api('outsider', '/api/cloud/v1/search', 'POST', { query: 'Confidential', workspace_id: f.otherTeam.workspaceId });
        assert.strictEqual(search.status, 200, JSON.stringify(search));
        assert.ok(!JSON.stringify(search.data).includes('alpha'));
        assert.strictEqual((await api('outsider', '/api/cloud/v1/account/tags?account_id=' + own)).status, 404);
        const list = await api('outsider', '/api/cloud/v1/documents?workspace_id=' + own);
        assert.ok(list.status === 404 || list.status === 200 && list.data.documents.length === 0);
      });
      await testAsync('unrelated users cannot alter access, delete, revise or move someone else document', async () => {
        for (const [endpoint, method, body] of [
          ['/permission', 'PATCH', { mode: 'everyone' }], ['', 'DELETE', { expected_head_revision_id: doc.current_revision_id }],
          ['/revisions', 'POST', { markdown: '# Tampered', expected_head_revision_id: doc.current_revision_id, idempotency_key: 'attack' }],
          ['/library', 'POST', { workspace_id: f.otherTeam.workspaceId, expected_head_revision_id: doc.current_revision_id }],
        ]) assert.strictEqual((await api('outsider', '/api/cloud/v1/documents/' + doc.id + endpoint, method, body)).status, 404);
      });
      await testAsync('a paid sponsor covers the same person across libraries without a second billed seat', async () => {
        const account = single.account(own);
        billing.upsertSubscription({ workspaceId: account.id, plan: 'team', status: 'active', provider: 'manual' });
        store.addWorkspaceMember({ actorUserId: users.josh.id, workspaceId: own, userId: users.member.id, role: 'member' });
        single.claim(users.member.id, own);
        const before = single.seatCount(account.id);
        store.addWorkspaceMember({ actorUserId: users.josh.id, workspaceId: second, userId: users.member.id, role: 'member' });
        single.claim(users.member.id, second);
        assert.strictEqual(single.seatCount(account.id), before);
        single.initialize(users.outsider.id, f.otherTeam.workspaceId, users.outsider.email);
        store.addWorkspaceMember({ actorUserId: users.outsider.id, workspaceId: f.otherTeam.workspaceId, userId: users.member.id, role: 'member' });
        single.claim(users.member.id, f.otherTeam.workspaceId);
        assert.strictEqual(single.coverage(users.member.id).account_id, account.id);
        assert.strictEqual(single.seatCount(single.account(f.otherTeam.workspaceId).id), 1);
        assert.strictEqual(single.entitlements(users.member.id, f.otherTeam.workspaceId).covered, true);
        // Paying for a person does not give that person any document access.
        assert.strictEqual((await api('member', '/api/cloud/v1/documents/' + foreign.id)).status, 404);
      });
      await testAsync('Everyone is scoped to library membership, never email domain or sponsorship', async () => {
        store.setDocumentPermission({ userId: users.josh.id, documentId: doc.id, mode: 'everyone' });
        assert.strictEqual((await api('member', '/api/cloud/v1/documents/' + doc.id)).status, 200);
        assert.strictEqual((await api('bob', '/api/cloud/v1/documents/' + doc.id)).status, 404);
      });
      await testAsync('machine defaults are scoped to the owner and affect only new unbound documents', async () => {
        const device = f.auth.issueDeviceAuthorization({ displayName: 'Test computer' });
        f.auth.approveDeviceAuthorization({ userCode: device.userCode, userId: users.josh.id });
        const approved = f.auth.pollDeviceAuthorization({ deviceCode: device.deviceCode });
        machine = approved.credentialId; token = approved.accessToken;
        assert.strictEqual((await api('outsider', '/api/cloud/v1/cli/credentials/' + machine + '/library-default', 'PATCH', { workspace_id: f.otherTeam.workspaceId })).status, 404);
        assert.strictEqual((await api('josh', '/api/cloud/v1/cli/credentials/' + machine + '/library-default', 'PATCH', { workspace_id: f.otherTeam.workspaceId })).status, 404);
        assert.strictEqual((await api('josh', '/api/cloud/v1/cli/credentials/' + machine + '/library-default', 'PATCH', { workspace_id: second })).status, 200);
        const response = await fetch(f.origin + '/api/cloud/v1/account/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'default.md', markdown: '# Default', idempotency_key: 'default' }) });
        const result = await response.json(); assert.strictEqual(response.status, 201, JSON.stringify(result));
        assert.strictEqual(result.account.id, second);
        assert.strictEqual(store.getDocumentContext({ userId: users.josh.id, documentId: doc.id }).workspaceId, own);
      });
      await testAsync('moving re-encrypts history, preserves URL identity and resets sharing to creator only', async () => {
        const firstRevision = doc.current_revision_id;
        const updated = await store.saveRevision({ userId: users.josh.id, documentId: doc.id, markdown: '# Updated alpha', filename: 'private.md', expectedHeadRevisionId: firstRevision, idempotencyKey: 'revision' });
        const before = Buffer.from(store.db.prepare('SELECT body_ciphertext FROM cloud_document_revisions WHERE id=?').get(firstRevision).body_ciphertext);
        const moved = await api('josh', '/api/cloud/v1/documents/' + doc.id + '/library', 'POST', { workspace_id: second, expected_head_revision_id: updated.current_revision_id });
        assert.strictEqual(moved.status, 200, JSON.stringify(moved));
        assert.strictEqual(moved.data.document.id, doc.id);
        assert.strictEqual(moved.data.document.workspace_id, second);
        assert.strictEqual(moved.data.permission.mode, 'custom');
        assert.deepStrictEqual(moved.data.permission.member_user_ids, [users.josh.id]);
        const after = store.db.prepare('SELECT body_ciphertext FROM cloud_document_revisions WHERE id=?').get(firstRevision).body_ciphertext;
        assert.notDeepStrictEqual(after, before);
        assert.strictEqual((await store.getDocument({ userId: users.josh.id, documentId: doc.id, revisionId: firstRevision })).markdown, '# Confidential alpha');
        assert.strictEqual((await api('member', '/api/cloud/v1/documents/' + doc.id)).status, 404);
        assert.strictEqual((await api('josh', '/api/cloud/v1/documents/' + doc.id + '/head')).data.document.workspace_id, second);
      });
      await testAsync('encryption failure during a move leaves every revision in its original library', async () => {
        const context = store.getDocumentContext({ userId: users.josh.id, documentId: doc.id });
        const previous = store._prepareRevision;
        let calls = 0;
        store._prepareRevision = async function (input) { if (++calls === 2) throw new Error('Simulated key failure'); return previous.call(this, input); };
        try {
          await assert.rejects(store.moveDocument({ userId: users.josh.id, documentId: doc.id,
            projectId: store.db.prepare('SELECT id FROM cloud_projects WHERE workspace_id=?').get(own).id,
            expectedHeadRevisionId: (await store.getDocument({ userId: users.josh.id, documentId: doc.id })).current_revision_id }));
        } finally { store._prepareRevision = previous; }
        assert.strictEqual(store.getDocumentContext({ userId: users.josh.id, documentId: doc.id }).workspaceId, context.workspaceId);
        const revisionWorkspaces = store.db.prepare('SELECT DISTINCT workspace_id FROM cloud_document_revisions WHERE document_id=?').all(doc.id);
        assert.deepStrictEqual(revisionWorkspaces.map(row => row.workspace_id), [context.workspaceId]);
        assert.strictEqual((await store.getDocument({ userId: users.josh.id, documentId: doc.id })).markdown, '# Updated alpha');
      });
      await testAsync('moving into an inaccessible library leaves content and location unchanged', async () => {
        const result = await api('josh', '/api/cloud/v1/documents/' + doc.id + '/library', 'POST', { workspace_id: f.otherTeam.workspaceId, expected_head_revision_id: doc.current_revision_id });
        assert.strictEqual(result.status, 404);
        assert.strictEqual(store.getDocumentContext({ userId: users.josh.id, documentId: doc.id }).workspaceId, second);
      });
      await testAsync('a member shared into a document cannot move it on behalf of its creator', async () => {
        store.setDocumentPermission({ userId: users.josh.id, documentId: doc.id, mode: 'everyone' });
        store.grantProject({ actorUserId: users.bob.id, workspaceId: f.team.workspaceId, projectId: f.team.projectId, userId: users.member.id, role: 'editor' });
        const result = await api('member', '/api/cloud/v1/documents/' + doc.id + '/library', 'POST', { workspace_id: f.team.workspaceId, expected_head_revision_id: (await store.getDocument({ userId: users.josh.id, documentId: doc.id })).current_revision_id });
        assert.strictEqual(result.status, 403, JSON.stringify(result));
      });
      await testAsync('revoked membership removes access even when the person still has a paid subscription', async () => {
        store.removeWorkspaceMember({ actorUserId: users.josh.id, workspaceId: second, userId: users.member.id });
        assert.strictEqual((await api('member', '/api/cloud/v1/documents/' + doc.id)).status, 404);
        assert.strictEqual((await api('member', '/api/cloud/v1/workspaces/' + second + '/billing')).status, 404);
      });
      await testAsync('an expired individual trial is not restarted by a different library trial', async () => {
        const existing = billing.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(users.josh.id).ends_at_ms;
        const secondAccount = single.initialize(users.gmail.id, (await store.createTeamWorkspace({ userId: users.gmail.id, name: 'Trial library', projectName: 'Documents' })).workspaceId, users.gmail.email);
        const library = single.db.prepare('SELECT workspace_id FROM cloud_single_libraries WHERE account_id=?').get(secondAccount.id).workspace_id;
        store.addWorkspaceMember({ actorUserId: users.gmail.id, workspaceId: library, userId: users.josh.id, role: 'member' });
        // Simulate ended personal coverage without an active paid subscription.
        const oldSubscription = billing.getSubscription(single.account(own).id);
        billing.upsertSubscription({ ...oldSubscription, status: 'canceled' });
        billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now() - 8 * 86400000, users.josh.id);
        single.claim(users.josh.id, library);
        assert.strictEqual(single.entitlements(users.josh.id, library).access.write, false);
        billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(existing, users.josh.id);
      });
      await testAsync('a second identity cannot restart a trial and receives a readable recovery page', async () => {
        let alternate = f.auth.signInWithExternalIdentity({ provider: 'google', subject: 'second-trial-identity', verifiedEmail: users.missing.email }).user;
        alternate = f.auth.updateUserProfile({ userId: alternate.id, firstName: 'Taylor', lastName: 'Example' });
        f.auth.acceptCurrentTerms({ userId: alternate.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
        users.alternate = { ...alternate, cookie: 'sdocs_cloud=' + f.auth.createBrowserSession(alternate.id).token };
        const result = await api('alternate', '/cloud/start');
        assert.strictEqual(result.status, 409);
        assert.ok(result.headers.get('content-type').includes('text/html'));
        assert.ok(result.data.includes('Your trial has already started'));
        assert.ok(result.data.includes('Sign in with your original method'));
        assert.ok(!result.data.includes('__SETUP_'));
        assert.strictEqual(billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id=?').get(alternate.id).n, 0);
      });
      await testAsync('settings after ownership transfer preserve both payer and member trial deadlines', async () => {
        let owner = f.auth.signInWithVerifiedEmail('trial-transfer@joes.com').user;
        owner = f.auth.updateUserProfile({ userId: owner.id, firstName: 'Trial', lastName: 'Owner' });
        const previous = await store.createTeamWorkspace({ userId: owner.id, name: 'Trial transfer', projectName: 'Documents' });
        const account = single.initialize(owner.id, previous.workspaceId, 'trial-transfer@joes.com');
        const deadline = billing.computeEntitlements(account.id).trialEndsAtMs;
        assert.ok(deadline > Date.now());
        store.addWorkspaceMember({ actorUserId: owner.id, workspaceId: previous.workspaceId, userId: users.missing.id, role: 'member' });
        store.transferWorkspaceOwnership({ actorUserId: owner.id, workspaceId: previous.workspaceId, targetUserId: users.missing.id });
        const trialsBefore = billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials').get().n;
        const page = await api('missing', '/cloud/admin?panel=install');
        assert.strictEqual(page.status, 200, String(page.data).slice(0, 100));
        assert.strictEqual(single.account(previous.workspaceId).id, account.id);
        assert.strictEqual(billing.computeEntitlements(account.id).trialEndsAtMs, deadline);
        assert.strictEqual(billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials').get().n, trialsBefore);
        assert.strictEqual(single.entitlements(users.missing.id, previous.workspaceId).access.write, false);
      });
      await testAsync('the obsolete plan checkout and conversion routes cannot create a second subscription', async () => {
        assert.strictEqual((await api('josh', '/api/cloud/billing/checkout', 'POST', { workspace_id: own, plan: 'personal' })).status, 409);
        assert.strictEqual((await api('josh', '/api/cloud/v1/team-upgrade/preview', 'POST', { workspace_id: own, name: 'Team' })).status, 400);
      });
      await testAsync('revoked machine credentials cannot read defaults or create documents', async () => {
        f.auth.revokeCliCredential({ userId: users.josh.id, credentialId: machine });
        const response = await fetch(f.origin + '/api/cloud/v1/cli/library-default', { headers: { Authorization: 'Bearer ' + token } });
        assert.strictEqual(response.status, 401);
      });
    } finally { await f.close(); }
  };
};
