module.exports = function (harness) {
  const { assert, testAsync } = harness;

  return async function () {
    console.log('\n-- Cloud Seat Sync Tests ------------------------------\n');

    const { syncTeamSeatQuantity } = require('../lib/cloud-seat-sync');

    await testAsync('updates a Stripe team subscription to the active member count', async () => {
      const calls = [];
      const result = await syncTeamSeatQuantity({
        workspaceId: 'workspace-123',
        billing: { getSubscription: () => ({ plan: 'team', provider: 'stripe',
          providerSubscriptionId: 'sub_123' }) },
        store: { getWorkspaceUsage: (input) => {
          calls.push({ type: 'usage', input });
          return { memberCount: 4 };
        } },
        stripe: {
          retrieveSubscription: async (input) => {
            calls.push({ type: 'retrieve', input });
            return { items: { data: [{ id: 'si_123', quantity: 3 }] } };
          },
          updateSubscriptionItemQuantity: async (input) => {
            calls.push({ type: 'update', input });
          },
        },
      });
      assert.deepStrictEqual(result, { updated: true, quantity: 4 });
      assert.deepStrictEqual(calls, [
        { type: 'usage', input: { workspaceId: 'workspace-123', skipAccess: true } },
        { type: 'retrieve', input: { subscriptionId: 'sub_123' } },
        { type: 'update', input: { subscriptionItemId: 'si_123', quantity: 4,
          prorationBehavior: 'create_prorations',
          idempotencyKey: 'workspace-seats-workspace-123-4' } },
      ]);
    });

    await testAsync('does not update Stripe when its seat quantity is current', async () => {
      let updates = 0;
      const result = await syncTeamSeatQuantity({
        workspaceId: 'workspace-123',
        billing: { getSubscription: () => ({ plan: 'team', provider: 'stripe',
          providerSubscriptionId: 'sub_123' }) },
        store: { getWorkspaceUsage: () => ({ memberCount: 2 }) },
        stripe: {
          retrieveSubscription: async () => ({ items: { data: [{ id: 'si_123', quantity: 2 }] } }),
          updateSubscriptionItemQuantity: async () => { updates += 1; },
        },
      });
      assert.deepStrictEqual(result, { updated: false, reason: 'already_current', quantity: 2 });
      assert.strictEqual(updates, 0);
    });

    await testAsync('skips subscriptions that are not Stripe team plans', async () => {
      let usageReads = 0;
      const result = await syncTeamSeatQuantity({
        workspaceId: 'workspace-123',
        billing: { getSubscription: () => ({ plan: 'personal', provider: 'stripe',
          providerSubscriptionId: 'sub_123' }) },
        store: { getWorkspaceUsage: () => { usageReads += 1; } },
        stripe: {},
      });
      assert.deepStrictEqual(result, { updated: false, reason: 'not_stripe_team' });
      assert.strictEqual(usageReads, 0);
    });

    await testAsync('surfaces Stripe failures so the caller can queue a retry', async () => {
      await assert.rejects(() => syncTeamSeatQuantity({
        workspaceId: 'workspace-123',
        billing: { getSubscription: () => ({ plan: 'team', provider: 'stripe',
          providerSubscriptionId: 'sub_123' }) },
        store: { getWorkspaceUsage: () => ({ memberCount: 3 }) },
        stripe: {
          retrieveSubscription: async () => ({ items: { data: [{ id: 'si_123', quantity: 2 }] } }),
          updateSubscriptionItemQuantity: async () => { throw new Error('stripe unavailable'); },
        },
      }), /stripe unavailable/);
    });
  };
};
