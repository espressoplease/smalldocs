const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;

  return function () {
    console.log('\n-- Cloud Billing Tests --------------------------------\n');

    const { BillingError, createBillingStore } = require('../lib/cloud-billing');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-billing-'));
    let clock = 1700000000000;
    const billing = createBillingStore({
      dbPath: path.join(dir, 'billing.db'),
      now: () => clock,
      planLimits: {
        personal: {
          maxStoredBytes: 1000,
          maxFileBytes: 400,
          revisionRetentionDays: 30,
          maxProjects: 3,
          maxMembers: 1,
          search: { maxRequests: 10, windowMs: 60000 },
        },
        team: {
          maxStoredBytes: 10000,
          maxFileBytes: 1000,
          revisionRetentionDays: 90,
          maxProjects: 20,
          maxMembers: 50,
          search: { maxRequests: 100, windowMs: 60000 },
        },
      },
    });

    test('active personal subscription stores provider-neutral billing identity', () => {
      const subscription = billing.upsertSubscription({
        workspaceId: 'wrk_personal',
        plan: 'personal',
        status: 'active',
        seatQuantity: 1,
        provider: 'testpay',
        providerCustomerId: 'customer_1',
        providerSubscriptionId: 'subscription_1',
        currentPeriodEndMs: clock + 100000,
      });
      assert.strictEqual(subscription.workspaceId, 'wrk_personal');
      assert.strictEqual(subscription.provider, 'testpay');
      assert.strictEqual(subscription.providerSubscriptionId, 'subscription_1');
      assert.strictEqual(subscription.createdAtMs, clock);
    });

    test('personal plan cannot be assigned multiple seats', () => {
      assert.throws(() => billing.upsertSubscription({
        workspaceId: 'wrk_bad_personal', plan: 'personal', status: 'active', seatQuantity: 2,
      }), error => error instanceof BillingError && error.code === 'invalid_seat_quantity');
    });

    test('team membership can grow to the plan cap while seat billing follows usage', () => {
      billing.upsertSubscription({
        workspaceId: 'wrk_team', plan: 'team', status: 'active', seatQuantity: 4,
      });
      const entitlements = billing.computeEntitlements('wrk_team', { memberCount: 3 });
      assert.strictEqual(entitlements.limits.maxMembers, 50);
      assert.strictEqual(entitlements.limits.billedSeats, 4);
      assert.strictEqual(entitlements.access.manageMembers, true);
      assert.strictEqual(billing.checkOperation('wrk_team', {
        operation: 'add_member', usage: { memberCount: 4 },
      }).allowed, true);
      assert.strictEqual(billing.checkOperation('wrk_team', {
        operation: 'add_member', usage: { memberCount: 50 },
      }).reason, 'member_limit_reached');
    });

    test('configured plan member cap bounds a larger team seat quantity', () => {
      billing.upsertSubscription({
        workspaceId: 'wrk_large_team', plan: 'team', status: 'active', seatQuantity: 75,
      });
      const entitlements = billing.computeEntitlements('wrk_large_team');
      assert.strictEqual(entitlements.limits.maxMembers, 50);
      assert.strictEqual(entitlements.limits.billedSeats, 75);
    });

    test('active subscription can read, write, and search within limits', () => {
      const entitlements = billing.computeEntitlements('wrk_personal', {
        storedBytes: 500, projectCount: 1, memberCount: 1, searchRequestsInWindow: 2,
      });
      assert.deepStrictEqual(entitlements.access, {
        read: true, write: true, search: true, manageMembers: false,
      });
      assert.strictEqual(entitlements.limits.documentCount, null);
      assert.deepStrictEqual(entitlements.blockedBy, ['member_limit_reached']);
    });

    test('past due subscription writes during grace and becomes read only afterward', () => {
      billing.upsertSubscription({
        workspaceId: 'wrk_grace', plan: 'team', status: 'past_due', seatQuantity: 2,
        graceEndsAtMs: clock + 1000,
      });
      assert.strictEqual(billing.computeEntitlements('wrk_grace').effectiveStatus, 'past_due_grace');
      assert.strictEqual(billing.computeEntitlements('wrk_grace').access.write, true);
      clock += 1000;
      const expired = billing.computeEntitlements('wrk_grace');
      assert.strictEqual(expired.access.read, true);
      assert.strictEqual(expired.access.write, false);
      assert.ok(expired.blockedBy.includes('payment_grace_expired'));
    });

    test('canceled and explicit read only subscriptions retain read access only', () => {
      for (const status of ['canceled', 'read_only']) {
        const workspaceId = 'wrk_' + status;
        billing.upsertSubscription({ workspaceId, plan: 'personal', status, seatQuantity: 1 });
        const access = billing.computeEntitlements(workspaceId).access;
        assert.strictEqual(access.read, true);
        assert.strictEqual(access.write, false);
        assert.strictEqual(access.search, true);
      }
    });

    test('workspace without a subscription has no Cloud access', () => {
      const result = billing.computeEntitlements('wrk_none');
      assert.deepStrictEqual(result.access, {
        read: false, write: false, search: false, manageMembers: false,
      });
      assert.deepStrictEqual(result.blockedBy, ['subscription_required']);
    });

    test('storage and file limits check the proposed revision without a document count limit', () => {
      assert.strictEqual(billing.checkOperation('wrk_personal', {
        operation: 'store_revision', fileBytes: 401, usage: { storedBytes: 100 },
      }).reason, 'file_too_large');
      assert.strictEqual(billing.checkOperation('wrk_personal', {
        operation: 'store_revision', fileBytes: 300, storedBytesDelta: 300,
        usage: { storedBytes: 800 },
      }).reason, 'storage_limit_exceeded');
      assert.strictEqual(billing.checkOperation('wrk_personal', {
        operation: 'store_revision', fileBytes: 300, storedBytesDelta: 100,
        usage: { storedBytes: 800 },
      }).allowed, true);
    });

    test('project and search workload limits are computed independently', () => {
      assert.strictEqual(billing.checkOperation('wrk_personal', {
        operation: 'create_project', usage: { projectCount: 3 },
      }).reason, 'project_limit_reached');
      const search = billing.checkOperation('wrk_personal', {
        operation: 'search', usage: { searchRequestsInWindow: 10 },
      });
      assert.strictEqual(search.allowed, false);
      assert.ok(search.entitlements.blockedBy.includes('search_limit_reached'));
    });

    test('subscription updates retain creation time and change plan and seats', () => {
      clock += 5000;
      const updated = billing.upsertSubscription({
        workspaceId: 'wrk_personal', plan: 'team', status: 'active', seatQuantity: 3,
        provider: 'testpay', providerCustomerId: 'customer_1',
        providerSubscriptionId: 'subscription_1',
      });
      assert.strictEqual(updated.createdAtMs, 1700000000000);
      assert.strictEqual(updated.updatedAtMs, clock);
      assert.strictEqual(updated.plan, 'team');
      assert.strictEqual(updated.seatQuantity, 3);
    });

    test('provider identifiers cannot belong to two workspaces', () => {
      assert.throws(() => billing.upsertSubscription({
        workspaceId: 'wrk_collision', plan: 'team', status: 'active', seatQuantity: 2,
        provider: 'testpay', providerSubscriptionId: 'subscription_1',
      }), error => error instanceof BillingError && error.code === 'provider_identity_in_use');
    });

    test('one provider customer can pay for multiple workspace subscriptions', () => {
      const result = billing.upsertSubscription({
        workspaceId: 'wrk_second_customer_workspace',
        plan: 'personal',
        status: 'active',
        provider: 'TESTPAY',
        providerCustomerId: 'customer_1',
        providerSubscriptionId: 'subscription_2',
      });
      assert.strictEqual(result.provider, 'testpay');
      assert.strictEqual(result.providerCustomerId, 'customer_1');
    });

    test('search reports its own exhausted quota when another quota is also full', () => {
      const result = billing.checkOperation('wrk_personal', {
        operation: 'search',
        usage: { memberCount: 50, searchRequestsInWindow: 100 },
      });
      assert.strictEqual(result.reason, 'search_limit_reached');
    });

    test('webhook event recording is idempotent and stores only a digest', () => {
      const input = {
        provider: 'testpay', eventId: 'event_1', eventType: 'subscription.updated',
        payload: '{"customer_email":"private@example.com"}',
      };
      assert.deepStrictEqual(billing.recordWebhookEvent(input), { recorded: true, duplicate: false });
      assert.deepStrictEqual(billing.recordWebhookEvent(input), { recorded: false, duplicate: true });
      const row = billing.db.prepare('SELECT * FROM cloud_billing_webhook_events WHERE event_id = ?').get('event_1');
      assert.strictEqual(row.payload_digest.length, 64);
      assert.strictEqual(JSON.stringify(row).includes('private@example.com'), false);
    });

    test('webhook processing applies a billing update once in one transaction', () => {
      let applications = 0;
      const input = { provider: 'testpay', eventId: 'event_2', eventType: 'subscription.updated' };
      const apply = store => {
        applications += 1;
        return store.upsertSubscription({
          workspaceId: 'wrk_webhook', plan: 'team', status: 'active', seatQuantity: 5,
        });
      };
      assert.strictEqual(billing.processWebhookEvent(input, apply).processed, true);
      assert.strictEqual(billing.processWebhookEvent(input, apply).duplicate, true);
      assert.strictEqual(applications, 1);
      assert.strictEqual(billing.getSubscription('wrk_webhook').seatQuantity, 5);
    });

    test('failed webhook processing rolls back the event marker and update', () => {
      const input = { provider: 'testpay', eventId: 'event_retry', eventType: 'subscription.updated' };
      assert.throws(() => billing.processWebhookEvent(input, store => {
        store.upsertSubscription({
          workspaceId: 'wrk_retry', plan: 'team', status: 'active', seatQuantity: 2,
        });
        throw new Error('temporary failure');
      }), /temporary failure/);
      assert.strictEqual(billing.getSubscription('wrk_retry'), null);
      assert.strictEqual(billing.processWebhookEvent(input, () => 'retried').processed, true);
    });

    billing.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
};

if (require.main === module) {
  const harness = require('./runner');
  module.exports(harness)();
  harness.report();
}
