'use strict';

const crypto = require('crypto');
const http = require('http');

module.exports = function ({ assert, testAsync }) {
  return async function () {
    const subscriptions = new Map(), failures = new Set(), reads = new Map();
    let blockedRead = null, releaseBlocked = null;
    const stripe = http.createServer(async (req, res) => {
      const id = req.url.slice('/v1/subscriptions/'.length);
      reads.set(id, (reads.get(id) || 0) + 1);
      const snapshot = subscriptions.has(id) ? JSON.parse(JSON.stringify(subscriptions.get(id))) : null;
      if (blockedRead && blockedRead.id === id) {
        const gate = blockedRead;
        blockedRead = null;
        gate.started();
        await gate.release;
      }
      res.writeHead(failures.has(id) ? 503 : snapshot ? 200 : 404,
        { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(failures.has(id) ? { error: { code: 'api_error' } }
        : snapshot || { error: { code: 'resource_missing' } }));
    });
    await new Promise(resolve => stripe.listen(0, '127.0.0.1', resolve));
    const fixture = await require('./cloud-onboarding-fixture').startFixture({
      stripeApiBase: 'http://127.0.0.1:' + stripe.address().port,
    });
    let serial = 0;
    const timestamp = Math.floor(Date.now() / 1000);
    const base = { id: 'sub_reconciliation', customer: 'cus_reconciliation', created: timestamp - 1000,
      status: 'active', cancel_at_period_end: false,
      metadata: { workspace_id: fixture.team.workspaceId, plan: 'team' },
      items: { data: [{ id: 'si_reconciliation', quantity: 2, current_period_end: timestamp + 2592000 }] } };
    const copy = value => JSON.parse(JSON.stringify(value));
    const event = (object, type = 'customer.subscription.updated', created = timestamp) => ({
      id: 'evt_reconciliation_' + (++serial), type, created, data: { object: copy(object) },
    });
    async function deliver(notification, signed = true) {
      const raw = JSON.stringify(notification);
      const time = Math.floor(Date.now() / 1000);
      const digest = crypto.createHmac('sha256', signed ? 'whsec_fixture' : 'wrong_fixture_secret')
        .update(time + '.' + raw).digest('hex');
      const response = await fetch(fixture.origin + '/api/cloud/billing/stripe/webhook', {
        method: 'POST', headers: { 'Content-Type': 'application/json',
          'Stripe-Signature': 't=' + time + ',v1=' + digest }, body: raw,
      });
      return { status: response.status, data: await response.json() };
    }
    const subscription = () => fixture.billing.getSubscription(fixture.team.workspaceId);
    const recorded = notification => Boolean(fixture.billing.db.prepare(
      "SELECT 1 FROM cloud_billing_webhook_events WHERE provider='stripe' AND event_id=?").get(notification.id));
    try {
      await testAsync('subscription webhooks verify the signature before retrieving or applying provider state', async () => {
        subscriptions.set(base.id, copy(base));
        assert.strictEqual((await deliver(event(base), false)).status, 400);
        assert.strictEqual(reads.get(base.id), undefined);
        assert.strictEqual(subscription().provider, 'manual');
      });
      await testAsync('same-second reversed subscription events preserve current cancellation and payer metadata', async () => {
        const stale = event({ ...base, metadata: { workspace_id: fixture.otherTeam.workspaceId, plan: 'personal' } });
        const canceled = { ...copy(base), status: 'canceled', canceled_at: timestamp };
        subscriptions.set(base.id, canceled);
        assert.strictEqual((await deliver(event(canceled, 'customer.subscription.deleted'))).status, 200);
        assert.strictEqual((await deliver(stale)).status, 200);
        assert.strictEqual(subscription().status, 'canceled');
        assert.strictEqual(fixture.billing.computeEntitlements(fixture.team.workspaceId).access.write, false);
        assert.strictEqual(fixture.billing.getSubscription(fixture.otherTeam.workspaceId).provider, 'manual');
      });
      await testAsync('equal-second cancellation reversal and payment recovery apply current Stripe state', async () => {
        subscriptions.set(base.id, { ...copy(base), status: 'past_due' });
        assert.strictEqual((await deliver(event(base))).status, 200);
        assert.strictEqual(subscription().status, 'past_due');
        subscriptions.set(base.id, { ...copy(base), cancel_at_period_end: true });
        assert.strictEqual((await deliver(event(base))).status, 200);
        assert.strictEqual(subscription().cancelAtPeriodEnd, true);
        subscriptions.set(base.id, copy(base));
        assert.strictEqual((await deliver(event({ ...base, cancel_at_period_end: true }))).status, 200);
        assert.strictEqual(subscription().cancelAtPeriodEnd, false);
        assert.strictEqual(subscription().graceEndsAtMs, null);
        assert.strictEqual(subscription().retentionEndsAtMs, null);
      });
      await testAsync('duplicate signed events keep one receipt and cannot reapply changed provider state', async () => {
        const notification = event(base);
        assert.strictEqual((await deliver(notification)).status, 200);
        const stored = subscription();
        subscriptions.set(base.id, { ...copy(base), status: 'canceled', canceled_at: timestamp });
        assert.strictEqual((await deliver(notification)).status, 200);
        assert.deepStrictEqual(subscription(), stored);
        const receipt = fixture.billing.db.prepare('SELECT payload_digest FROM cloud_billing_webhook_events WHERE event_id=?').get(notification.id);
        assert.strictEqual(receipt.payload_digest, crypto.createHash('sha256').update(JSON.stringify(notification)).digest('hex'));
      });
      await testAsync('concurrent notifications fetch and apply in one subscription queue', async () => {
        subscriptions.set(base.id, copy(base));
        let release, started;
        const waiting = new Promise(resolve => { started = resolve; });
        blockedRead = { id: base.id, started, release: new Promise(resolve => { release = resolve; }) };
        releaseBlocked = release;
        const before = reads.get(base.id);
        const first = deliver(event(base));
        await waiting;
        subscriptions.set(base.id, { ...copy(base), status: 'canceled', canceled_at: timestamp });
        const second = deliver(event(base, 'customer.subscription.deleted'));
        // The first provider response is deliberately still in flight.
        try {
          await new Promise(resolve => setTimeout(resolve, 30));
          assert.strictEqual(reads.get(base.id), before + 1);
        } finally { release(); releaseBlocked = null; }
        assert.deepStrictEqual((await Promise.all([first, second])).map(result => result.status), [200, 200]);
        assert.strictEqual(subscription().status, 'canceled');
      });
      await testAsync('provider failures return retryable 503 without a receipt and release the subscription queue', async () => {
        subscriptions.set(base.id, copy(base));
        failures.add(base.id);
        const notification = event(base);
        const before = subscription();
        const result = await deliver(notification);
        assert.strictEqual(result.status, 503);
        assert.strictEqual(result.data.error, 'temporary_service_failure');
        assert.strictEqual(recorded(notification), false);
        assert.deepStrictEqual(subscription(), before);
        failures.delete(base.id);
        assert.strictEqual((await deliver(notification)).status, 200);
        assert.strictEqual(recorded(notification), true);
        assert.strictEqual(subscription().status, 'active');
      });
      await testAsync('signed deletion of a missing bound subscription revokes only its stored billing account', async () => {
        subscriptions.delete(base.id);
        const forgedMetadata = { ...copy(base), status: 'canceled', canceled_at: timestamp,
          metadata: { workspace_id: fixture.otherTeam.workspaceId, plan: 'personal' } };
        assert.strictEqual((await deliver(event(forgedMetadata, 'customer.subscription.deleted'))).status, 200);
        assert.strictEqual(subscription().status, 'canceled');
        assert.strictEqual(subscription().providerCustomerId, base.customer);
        assert.strictEqual(fixture.billing.getSubscription(fixture.otherTeam.workspaceId).provider, 'manual');
        const unknown = event({ ...copy(base), id: 'sub_missing_unknown' }, 'customer.subscription.deleted');
        assert.strictEqual((await deliver(unknown)).status, 503);
        assert.strictEqual(recorded(unknown), false);
      });
      await testAsync('stale personal-plan webhooks finish an interrupted provider upgrade and retain the team plan', async () => {
        const workspaceId = fixture.personal.workspaceId;
        const operationId = 'reconciliation-upgrade';
        const personal = { ...copy(base), id: 'sub_reconciliation_upgrade',
          metadata: { workspace_id: workspaceId, plan: 'personal' },
          items: { data: [{ id: 'si_upgrade', quantity: 1, price: { id: 'price_personal' },
            current_period_end: timestamp + 2592000 }] } };
        fixture.billing.upsertSubscription({ workspaceId, provider: 'stripe',
          providerSubscriptionId: personal.id, providerCustomerId: base.customer,
          plan: 'personal', status: 'active' });
        fixture.billing.db.exec(`CREATE TABLE IF NOT EXISTS cloud_library_upgrades (
          workspace_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
          state TEXT NOT NULL, data TEXT NOT NULL)`);
        fixture.billing.db.prepare('INSERT INTO cloud_library_upgrades VALUES (?,?,?,?,?)')
          .run(workspaceId, operationId, fixture.users.returning.id, 'processing', JSON.stringify({
            billing_kind: 'stripe', subscription_id: personal.id, price_id: 'price_team', name: 'Team library',
          }));
        subscriptions.set(personal.id, { ...copy(personal),
          metadata: { workspace_id: workspaceId, plan: 'team', upgrade_operation_id: operationId },
          items: { data: [{ ...personal.items.data[0], price: { id: 'price_team' } }] } });
        assert.strictEqual((await deliver(event(personal))).status, 200);
        assert.strictEqual(fixture.billing.getSubscription(workspaceId).plan, 'team');
        assert.strictEqual(fixture.billing.db.prepare('SELECT state FROM cloud_library_upgrades WHERE id=?').get(operationId).state, 'completed');
        assert.strictEqual((await fixture.store.listWorkspaces(fixture.users.returning.id))[0].kind, 'team');
        assert.strictEqual((await deliver(event(personal))).status, 200);
        assert.strictEqual(fixture.billing.getSubscription(workspaceId).plan, 'team');
      });
    } finally {
      if (releaseBlocked) releaseBlocked();
      if (blockedRead) blockedRead = null;
      await fixture.close();
      await new Promise(resolve => stripe.close(resolve));
    }
  };
};
