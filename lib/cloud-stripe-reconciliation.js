'use strict';

function retryable(cause) {
  return Object.assign(new Error('Stripe subscription reconciliation is unavailable'),
    { code: 'temporary_service_failure', cause });
}

function createSubscriptionReconciler({ stripe, billing, now = Date.now }) {
  const queues = new Map();

  async function currentSubscription(event) {
    const snapshot = event.data && event.data.object;
    if (!snapshot || typeof snapshot.id !== 'string' || !/^sub_[A-Za-z0-9_]+$/.test(snapshot.id)) {
      throw Object.assign(new Error('Invalid subscription notification'), { code: 'invalid_webhook_payload' });
    }
    let subscription;
    try {
      subscription = await stripe.retrieveSubscription({ subscriptionId: snapshot.id });
    } catch (error) {
      const missing = error && error.status === 404 && error.response &&
        error.response.error && error.response.error.code === 'resource_missing';
      const bound = missing && event.type === 'customer.subscription.deleted' &&
        billing.db.prepare(`SELECT workspace_id FROM cloud_billing_subscriptions
          WHERE provider='stripe' AND provider_subscription_id=?`).get(snapshot.id);
      if (!bound) throw retryable(error);
      const existing = billing.getSubscription(bound.workspace_id);
      // A signed deletion can revoke an already-bound subscription if Stripe
      // no longer returns it. Never use a missing resource to grant access.
      subscription = { ...snapshot, status: 'canceled', customer: existing.providerCustomerId,
        metadata: { ...snapshot.metadata, workspace_id: existing.workspaceId, plan: existing.plan } };
    }
    if (!subscription || subscription.id !== snapshot.id || typeof subscription.status !== 'string') {
      throw retryable();
    }
    const observedAtMs = now();
    // Event creation is a lifecycle fact, not an ordering sequence. A stale
    // snapshot with a different status cannot date the current payment state.
    const lifecycleAtMs = snapshot.status === subscription.status && Number.isSafeInteger(event.created)
      ? event.created * 1000 : observedAtMs;
    return { ...event, data: { ...event.data, object: subscription },
      reconciledAtMs: observedAtMs, lifecycleAtMs };
  }

  return {
    async run(event, apply) {
      if (!event || typeof event.type !== 'string') {
        throw Object.assign(new Error('Invalid notification'), { code: 'invalid_webhook_payload' });
      }
      if (!event.type.startsWith('customer.subscription.')) return apply(event);
      const subscriptionId = event.data && event.data.object && event.data.object.id;
      const prior = queues.get(subscriptionId) || Promise.resolve();
      // Fetch inside the same queue as application. Otherwise a slower older
      // read can overwrite a newer Stripe state after its response arrives.
      const next = prior.catch(() => {}).then(async () => apply(await currentSubscription(event)));
      queues.set(subscriptionId, next);
      try { return await next; }
      finally { if (queues.get(subscriptionId) === next) queues.delete(subscriptionId); }
    },
  };
}

module.exports = { createSubscriptionReconciler };
