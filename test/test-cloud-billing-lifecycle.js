module.exports = function (harness) {
  const { assert, test } = harness;
  const lifecycle = require('../lib/cloud-billing-lifecycle');

  return function () {
    console.log('\n-- Cloud Billing Lifecycle Tests ----------------------\n');
    const now = 1700000000000;
    const day = lifecycle.DAY_MS;
    const base = {
      id: 'sub_1', customer: 'cus_1', created: 1600000000,
      metadata: { workspace_id: 'wrk_1', plan: 'team' },
      items: { data: [{ quantity: 3 }] },
      current_period_end: Math.floor((now + 20 * day) / 1000),
    };

    test('launch plans have storage limits without document-count limits', () => {
      assert.strictEqual(lifecycle.DEFAULT_PLAN_LIMITS.personal.maxStoredBytes,
        1024 * 1024 * 1024);
      assert.strictEqual(lifecycle.DEFAULT_PLAN_LIMITS.team.maxStoredBytes,
        5 * 1024 * 1024 * 1024);
      assert.strictEqual(lifecycle.DEFAULT_PLAN_LIMITS.personal.maxFileBytes, 10 * 1024 * 1024);
      assert.strictEqual(Object.hasOwn(lifecycle.DEFAULT_PLAN_LIMITS.personal,
        'documentCount'), false);
    });

    function update(subscription, existing, receivedAt) {
      return lifecycle.buildStripeSubscriptionUpdate({
        subscription: Object.assign({}, base, subscription),
        existing: existing || null,
        eventCreatedMs: receivedAt || now,
        now: receivedAt || now,
      });
    }

    test('first failed payment creates fixed grace and deletion clocks', () => {
      const failed = update({ status: 'past_due' });
      assert.strictEqual(failed.graceEndsAtMs, now + 7 * day);
      assert.strictEqual(failed.retentionEndsAtMs, now + 60 * day);
      assert.deepStrictEqual(lifecycle.transitionTypes(null, failed), ['payment_failed']);

      const repeated = update({ status: 'past_due' }, failed, now + 3 * day);
      assert.strictEqual(repeated.graceEndsAtMs, failed.graceEndsAtMs);
      assert.strictEqual(repeated.retentionEndsAtMs, failed.retentionEndsAtMs);
      assert.deepStrictEqual(lifecycle.transitionTypes(failed, repeated), []);
    });

    test('payment recovery clears retention and invalidates old deletion work', () => {
      const failed = update({ status: 'past_due' });
      const recovered = update({ status: 'active' }, failed, now + day);
      assert.strictEqual(recovered.graceEndsAtMs, null);
      assert.strictEqual(recovered.retentionEndsAtMs, null);
      assert.deepStrictEqual(lifecycle.transitionTypes(failed, recovered), ['payment_recovered']);
      const oldJob = { type: 'retention_expire', providerSubscriptionId: 'sub_1',
        retentionEndsAtMs: failed.retentionEndsAtMs, availableAtMs: failed.retentionEndsAtMs };
      assert.strictEqual(lifecycle.billingEventApplies(recovered, oldJob,
        failed.retentionEndsAtMs), false);
    });

    test('scheduled cancellation keeps paid access and deletes 30 days after period end', () => {
      const active = update({ status: 'active' });
      const scheduled = update({ status: 'active', cancel_at_period_end: true }, active);
      assert.strictEqual(scheduled.cancelAtPeriodEnd, true);
      assert.strictEqual(scheduled.retentionEndsAtMs, scheduled.currentPeriodEndMs + 30 * day);
      assert.deepStrictEqual(lifecycle.transitionTypes(active, scheduled),
        ['cancellation_scheduled']);
      const events = lifecycle.scheduledBillingEvents(scheduled);
      assert.ok(events.some((event) => event.type === 'cancellation_effective' &&
        event.availableAtMs === scheduled.currentPeriodEndMs));
      assert.ok(events.some((event) => event.type === 'deletion_warning' &&
        event.availableAtMs === scheduled.retentionEndsAtMs - 7 * day));
    });

    test('current Stripe subscription items supply the billing period end', () => {
      const periodEnd = Math.floor((now + 24 * day) / 1000);
      const scheduled = update({
        status: 'active',
        current_period_end: undefined,
        cancel_at_period_end: true,
        items: { data: [{ quantity: 3, current_period_end: periodEnd }] },
      });
      assert.strictEqual(scheduled.currentPeriodEndMs, periodEnd * 1000);
      assert.strictEqual(scheduled.retentionEndsAtMs, periodEnd * 1000 + 30 * day);
      assert.deepStrictEqual(lifecycle.scheduledBillingEvents(scheduled).map(
        (event) => event.type), [
        'cancellation_effective', 'deletion_warning', 'retention_expire',
      ]);
    });

    test('reversing cancellation clears its deletion clock', () => {
      const scheduled = update({ status: 'active', cancel_at_period_end: true });
      const continued = update({ status: 'active', cancel_at_period_end: false }, scheduled,
        now + day);
      assert.strictEqual(continued.retentionEndsAtMs, null);
      assert.deepStrictEqual(lifecycle.transitionTypes(scheduled, continued),
        ['cancellation_reversed']);
    });

    test('canceled subscriptions retain the existing scheduled deletion date', () => {
      const scheduled = update({ status: 'active', cancel_at_period_end: true });
      const canceled = update({ status: 'canceled', canceled_at: Math.floor(
        scheduled.currentPeriodEndMs / 1000) }, scheduled, scheduled.currentPeriodEndMs);
      assert.strictEqual(canceled.retentionEndsAtMs, scheduled.retentionEndsAtMs);
      assert.deepStrictEqual(lifecycle.transitionTypes(scheduled, canceled),
        ['cancellation_effective']);
    });

    test('past due jobs become applicable only at their stated times', () => {
      const failed = update({ status: 'past_due' });
      const readOnly = { type: 'payment_read_only', providerSubscriptionId: 'sub_1',
        graceEndsAtMs: failed.graceEndsAtMs, retentionEndsAtMs: failed.retentionEndsAtMs,
        availableAtMs: failed.graceEndsAtMs };
      assert.strictEqual(lifecycle.billingEventApplies(failed, readOnly,
        failed.graceEndsAtMs - 1), false);
      assert.strictEqual(lifecycle.billingEventApplies(failed, readOnly,
        failed.graceEndsAtMs), true);
    });

    test('a paused subscription is read only without a failed-payment deletion clock', () => {
      const paused = update({ status: 'paused' });
      assert.strictEqual(paused.status, 'read_only');
      assert.strictEqual(paused.retentionEndsAtMs, null);
      assert.deepStrictEqual(lifecycle.transitionTypes(null, paused), []);
      assert.deepStrictEqual(lifecycle.scheduledBillingEvents(paused), []);
    });

    test('an unpaid event keeps the original deadline and one read-only notice', () => {
      const failed = update({ status: 'past_due' });
      const unpaid = update({ status: 'unpaid' }, failed, now + 2 * day);
      assert.strictEqual(unpaid.status, 'read_only');
      assert.strictEqual(unpaid.graceEndsAtMs, failed.graceEndsAtMs);
      assert.strictEqual(unpaid.retentionEndsAtMs, failed.retentionEndsAtMs);
      assert.deepStrictEqual(lifecycle.transitionTypes(failed, unpaid), []);
      const readOnlyEvents = lifecycle.scheduledBillingEvents(unpaid)
        .filter((event) => event.type === 'payment_read_only');
      assert.deepStrictEqual(readOnlyEvents, [{ type: 'payment_read_only',
        availableAtMs: failed.graceEndsAtMs }]);
    });
  };
};
