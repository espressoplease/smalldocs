'use strict';

async function syncTeamSeatQuantity(input) {
  input = input || {};
  const billing = input.billing;
  const stripe = input.stripe;
  const store = input.store;
  const workspaceId = input.workspaceId;
  if (!billing || !stripe || !store) return { updated: false, reason: 'not_configured' };

  const subscription = billing.getSubscription(workspaceId);
  const singlePlanPersonal = input.quantityOverride != null && subscription && subscription.plan === 'personal';
  if (!subscription || (subscription.plan !== 'team' && !singlePlanPersonal) || subscription.provider !== 'stripe' ||
      !subscription.providerSubscriptionId) {
    return { updated: false, reason: 'not_stripe_team' };
  }

  const usage = input.quantityOverride == null ? store.getWorkspaceUsage({ workspaceId, skipAccess: true }) : {};
  const quantity = input.quantityOverride == null ? Math.max(1, usage.memberCount) : input.quantityOverride;
  const remote = await stripe.retrieveSubscription({
    subscriptionId: subscription.providerSubscriptionId,
  });
  const item = remote.items && remote.items.data && remote.items.data[0];
  if (!item) return { updated: false, reason: 'subscription_item_missing' };
  if (Number(item.quantity) === quantity) {
    return { updated: false, reason: 'already_current', quantity };
  }
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey) throw new Error('seat synchronization idempotency key is required');

  await stripe.updateSubscriptionItemQuantity({ subscriptionItemId: item.id,
    quantity, prorationBehavior: 'create_prorations',
    idempotencyKey });
  return { updated: true, quantity };
}

module.exports = { syncTeamSeatQuantity };
