module.exports = function (harness) {
  const { assert, testAsync } = harness;
  return async function () {
    const fixture = await require('./cloud-onboarding-fixture').startFixture();
    const { api, users, store, billing } = fixture;
    const upgrade = require('../lib/cloud-library-upgrade');
    let id, document, preview, expiry;
    try {
      await testAsync('automatic onboarding creates one library and trial across concurrent retries', async () => {
        const results = await Promise.all([api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {}), api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})]);
        assert.deepStrictEqual(results.map(r => r.status), [200, 200]);
        id = results[0].data.workspaces[0].id;
        assert.strictEqual(results[1].data.workspaces[0].id, id);
        assert.strictEqual(billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id = ?').get(users.josh.id).n, 1);
        expiry = billing.computeEntitlements(id).trialEndsAtMs;
        const result = await api('josh', '/api/cloud/v1/account/documents', 'POST', { account_id: id, filename: 'private.md', markdown: '# Private', idempotency_key: 'private' });
        assert.strictEqual(result.status, 201);
        document = result.data.document;
      });
      await testAsync('existing team-only members get no unused personal library or trial', async () => {
        const result = await api('member', '/api/cloud/v1/onboarding/complete', 'POST', {});
        assert.strictEqual(result.status, 200);
        assert.deepStrictEqual(result.data.workspaces.map(w => w.id), [fixture.team.workspaceId]);
        assert.strictEqual(billing.db.prepare('SELECT COUNT(*) AS n FROM cloud_billing_personal_trials WHERE user_id = ?').get(users.member.id).n, 0);
      });
      await testAsync('team conversion requires ownership and previews actual Everyone access', async () => {
        assert.strictEqual((await api('member', '/api/cloud/v1/team-upgrade/preview', 'POST', { workspace_id: id, name: 'Team' })).status, 403);
        const shared = await api('josh', '/api/cloud/v1/account/documents', 'POST', { account_id: id, filename: 'shared.md', markdown: '# Shared', idempotency_key: 'shared' });
        store.setDocumentPermission({ userId: users.josh.id, documentId: shared.data.document.id, mode: 'everyone' });
        const result = await api('josh', '/api/cloud/v1/team-upgrade/preview', 'POST', { workspace_id: id, name: 'Joshs team' });
        assert.strictEqual(result.status, 200, JSON.stringify(result.data));
        preview = result.data.preview;
        assert.strictEqual(preview.document_count, 2);
        assert.strictEqual(preview.everyone_count, 1);
        assert.strictEqual(preview.trial_ends_at_ms, expiry);
      });
      await testAsync('conversion preserves IDs, original trial deadline and private documents under retries', async () => {
        const results = await Promise.all([api('josh', '/api/cloud/v1/team-upgrade/confirm', 'POST', { workspace_id: id, operation_id: preview.operation_id }), api('josh', '/api/cloud/v1/team-upgrade/confirm', 'POST', { workspace_id: id, operation_id: preview.operation_id })]);
        assert.ok(results.some(r => r.status === 200), JSON.stringify(results));
        assert.strictEqual((await api('josh', '/api/cloud/v1/team-upgrade/confirm', 'POST', { workspace_id: id, operation_id: preview.operation_id })).status, 200);
        assert.strictEqual((await store.listWorkspaces(users.josh.id))[0].kind, 'team');
        const entitlement = billing.computeEntitlements(id);
        assert.strictEqual(entitlement.plan, 'team');
        assert.strictEqual(entitlement.trialEndsAtMs, expiry);
        assert.strictEqual(entitlement.access.manageMembers, true);
        assert.strictEqual(store.getDocumentPermission({ userId: users.josh.id, documentId: document.id }).mode, 'custom');
        store.addWorkspaceMember({ actorUserId: users.josh.id, workspaceId: id, userId: users.member.id, role: 'member' });
        assert.throws(() => store.getDocumentPermission({ userId: users.member.id, documentId: document.id }), /resource_unavailable/);
        const rows = store.db.prepare('SELECT document_id FROM cloud_permission_groups WHERE workspace_id = ? AND mode = ?').all(id, 'everyone');
        assert.strictEqual(store.getDocumentPermission({ userId: users.member.id, documentId: rows[0].document_id }).mode, 'everyone');
        assert.strictEqual((await api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})).data.workspaces.length, 1);
      });
      await testAsync('ordinary invitations still work after conversion', async () => {
        const invitation = await api('josh', '/api/cloud/v1/account/invitations', 'POST', { account_id: id, email: 'another@joes.com' });
        assert.strictEqual(invitation.status, 201, JSON.stringify(invitation.data));
      });
      await testAsync('changed access settings invalidate an upgrade review before conversion', async () => {
        const personal = fixture.personal.workspaceId;
        const base = { billing, store, userId: users.returning.id, workspaceId: personal, name: 'Paid team' };
        const result = await upgrade.preview(base);
        await store.createDocument({ userId: users.returning.id, projectId: fixture.personal.projectId, filename: 'later.md', markdown: '# Later', idempotencyKey: 'later' });
        await assert.rejects(upgrade.confirm({ ...base, operationId: result.preview.operation_id }), error => error.code === 'upgrade_preview_changed');
        assert.strictEqual((await store.listWorkspaces(users.returning.id))[0].kind, 'personal');
      });
      await testAsync('interrupted trial conversion recovers locally without extending its deadline', async () => {
        const base = { billing, store, userId: users.gmail.id, name: 'Recovered team' };
        const workspace = await store.ensurePersonalWorkspace(users.gmail.id, 'Trial');
        billing.ensurePersonalTrial({ userId: users.gmail.id, workspaceId: workspace.workspaceId, verifiedEmail: users.gmail.email });
        base.workspaceId = workspace.workspaceId;
        const result = await upgrade.preview(base);
        billing.db.prepare("UPDATE cloud_library_upgrades SET state = 'processing' WHERE id = ?").run(result.preview.operation_id);
        await store.convertPersonalToTeam({ ...base });
        await upgrade.recoverLocal(base);
        assert.strictEqual(billing.computeEntitlements(base.workspaceId).plan, 'team');
        assert.strictEqual(billing.computeEntitlements(base.workspaceId).trialEndsAtMs, result.preview.trial_ends_at_ms);
      });
      await testAsync('a replacement personal library cannot reuse a converted library trial', async () => {
        const replacement = await store.ensurePersonalWorkspace(users.josh.id, 'New personal');
        assert.notStrictEqual(replacement.workspaceId, id);
        assert.throws(() => billing.ensurePersonalTrial({ userId: users.josh.id, workspaceId: replacement.workspaceId, verifiedEmail: users.josh.email }), error => error.code === 'trial_already_used');
      });
      for (const outcome of ['success', 'decline', 'lost-response']) {
        await testAsync('paid team upgrade replaces one subscription: ' + outcome, async () => {
          const user = fixture.auth.signInWithVerifiedEmail(outcome + '@test.com').user;
          const personal = await store.ensurePersonalWorkspace(user.id, outcome);
          const baseSubscription = { workspaceId: personal.workspaceId, plan: 'personal', status: 'active', provider: 'stripe', providerSubscriptionId: 'sub_' + outcome, providerCustomerId: 'cus_test' };
          billing.upsertSubscription(baseSubscription);
          let remote = { id: baseSubscription.providerSubscriptionId, status: 'active', currency: 'gbp', customer: 'cus_test', created: 100,
            metadata: { workspace_id: personal.workspaceId, plan: 'personal' },
            items: { data: [{ id: 'si_test', quantity: 1, price: { id: 'price_personal', currency: 'gbp' }, current_period_end: 2000000000 }] } };
          let updates = 0;
          const stripe = { retrieveSubscription: async () => remote,
            retrievePrice: async () => ({ active: true, currency: 'gbp', unit_amount: 700, recurring: { interval: 'month', interval_count: 1 } }),
            previewTeamUpgrade: async () => ({ currency: 'gbp', amount_due: 123 }),
            upgradeSubscription: async args => {
              updates++;
              assert.strictEqual(args.subscriptionId, baseSubscription.providerSubscriptionId);
              assert.strictEqual(args.quantity, 1);
              if (outcome === 'decline') throw Object.assign(new Error('declined'), { code: 'stripe_api_error', status: 402 });
              remote = { ...remote, metadata: { ...remote.metadata, plan: 'team', upgrade_operation_id: args.operationId },
                items: { data: [{ ...remote.items.data[0], price: { id: 'price_team' } }] } };
              if (outcome === 'lost-response') throw new Error('connection lost');
              return remote;
            } };
          const base = { billing, store, stripe, userId: user.id, workspaceId: personal.workspaceId, name: 'Team', teamPriceId: 'price_team' };
          const result = await upgrade.preview(base);
          const args = { ...base, operationId: result.preview.operation_id };
          if (outcome === 'success') {
            const originalPreview = stripe.previewTeamUpgrade;
            stripe.previewTeamUpgrade = async () => {
              billing.db.prepare("UPDATE cloud_library_upgrades SET state = 'processing' WHERE id = ?").run(result.preview.operation_id);
              return { currency: 'gbp', amount_due: 123 };
            };
            await assert.rejects(upgrade.preview(base), error => error.code === 'upgrade_in_progress');
            assert.strictEqual(billing.db.prepare('SELECT id FROM cloud_library_upgrades WHERE workspace_id = ?').get(base.workspaceId).id, result.preview.operation_id);
            billing.db.prepare("UPDATE cloud_library_upgrades SET state = 'preview' WHERE id = ?").run(result.preview.operation_id);
            stripe.previewTeamUpgrade = originalPreview;
          }
          if (outcome === 'decline') {
            await assert.rejects(upgrade.confirm(args));
            assert.strictEqual(billing.getSubscription(personal.workspaceId).plan, 'personal');
            assert.strictEqual((await store.listWorkspaces(user.id))[0].kind, 'personal');
            assert.notStrictEqual((await upgrade.preview(base)).preview.operation_id, args.operationId);
          } else {
            if (outcome === 'lost-response') await assert.rejects(upgrade.confirm(args));
            await upgrade.confirm(args); await upgrade.confirm(args);
            assert.strictEqual(updates, 1);
            assert.strictEqual(billing.getSubscription(personal.workspaceId).providerSubscriptionId, baseSubscription.providerSubscriptionId);
            assert.strictEqual(billing.getSubscription(personal.workspaceId).plan, 'team');
            assert.strictEqual((await store.listWorkspaces(user.id)).length, 1);
          }
        });
      }
    } finally { await fixture.close(); }
  };
};
