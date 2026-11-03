'use strict';

// Isolated application databases, real sandbox Stripe, and the staging app key.
module.exports = async function ({ applicationKeyFile, price, client, coupons, receipt }) {
  const assert = require('assert'), crypto = require('crypto');
  const f = await require('../test/cloud-onboarding-fixture').startFixture({ singlePlan: true,
    stripeApiBase: 'https://api.stripe.com', env: { STRIPE_SECRET_KEY: '',
      STRIPE_SECRET_KEY_FILE: applicationKeyFile, STRIPE_STANDARD_PRICE_ID: price.id } });
  const single = new (require('../lib/cloud-single-plan').SinglePlan)({ billing: f.billing, store: f.store });
  const referrals = new (require('../lib/cloud-referrals').CloudReferrals)({ billing: f.billing, auth: f.auth,
    store: f.store, single, secret: f.auth.pepper, origin: f.origin });
  const sessions = [];
  async function webhook(type, object, eventId) {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: eventId, type, created: now, data: { object } });
    const signature = crypto.createHmac('sha256', 'whsec_fixture').update(now + '.' + body).digest('hex');
    const response = await fetch(f.origin + '/api/cloud/billing/stripe/webhook', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=' + now + ',v1=' + signature }, body });
    assert.strictEqual(response.status, 200);
  }
  try {
    assert.strictEqual(price.livemode, false);
    assert.strictEqual((await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})).status, 200);
    const payer = single.ownAccount(f.users.josh.id);
    f.billing.upsertSubscription({ workspaceId: payer.id, plan: 'team', status: 'active', provider: 'manual' });
    const signed = f.auth.signInWithVerifiedEmail('friend@release-check.example.test');
    const friend = f.auth.updateUserProfile({ userId: signed.user.id, firstName: 'Robin', lastName: 'Walker' });
    f.auth.acceptCurrentTerms({ userId: friend.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
    referrals.rememberIntent('application-signup', referrals.link(f.users.josh.id).code);
    referrals.recordSignup({ ...signed, user: friend, intentKey: 'application-signup' });
    f.users.friend = { ...friend, cookie: 'sdocs_cloud=' + f.auth.createBrowserSession(friend.id).token };
    const onboard = await f.api('friend', '/api/cloud/v1/onboarding/complete', 'POST', {});
    assert.strictEqual(onboard.status, 200);
    const workspace = onboard.data.workspaces.find(library => library.kind === 'personal');
    const issued = await f.api('friend', '/api/cloud/v1/cli/device-authorizations', 'POST', { display_name: 'Laptop' });
    assert.strictEqual(issued.status, 201);
    assert.strictEqual((await f.api('friend', '/api/cloud/v1/cli/device-authorizations/approve', 'POST', { user_code: issued.data.user_code })).status, 200);
    assert.strictEqual((await f.api('friend', '/api/cloud/v1/cli/device-authorizations/token', 'POST', { device_code: issued.data.device_code })).status, 200);
    const saved = await f.api('friend', '/api/cloud/v1/account/documents', 'POST', {
      account_id: workspace.id, filename: 'notes.md', markdown: '---\ntags: [research]\n---\n# Field notes\n\nFirst findings.', idempotency_key: 'first-document' });
    assert.strictEqual(saved.status, 201);
    assert.strictEqual(referrals.available(f.users.josh.id), 1);
    // A previous subscriber keeps an earned credit when they resubscribe.
    f.billing.upsertSubscription({ workspaceId: payer.id, plan: 'team', status: 'canceled', provider: 'manual' });
    const first = await f.api('josh', '/api/cloud/billing/subscribe', 'POST', {});
    assert.strictEqual(first.status, 200, JSON.stringify(first.data));
    const operation = f.billing.db.prepare('SELECT * FROM cloud_single_checkouts WHERE account_id=?').get(payer.id);
    sessions.push(operation.session_id);
    const session = await client.retrieveCheckoutSession({ sessionId: operation.session_id });
    assert.strictEqual(session.livemode, false);
    const reward = referrals.redemption('checkout:' + operation.operation_id);
    assert.ok(reward); coupons.push(reward.coupon_id);
    assert.strictEqual(reward.seats, 1);
    assert.strictEqual(reward.amount_minor, price.unit_amount);
    assert.ok((session.discounts || []).some(discount => (typeof discount.coupon === 'string' ? discount.coupon : discount.coupon?.id) === reward.coupon_id));
    const retry = await f.api('josh', '/api/cloud/billing/subscribe', 'POST', {});
    assert.strictEqual(retry.status, 200);
    assert.strictEqual(retry.data.checkout_url, first.data.checkout_url);
    const expired = await client.expireCheckoutSession({ sessionId: operation.session_id });
    const eventId = 'evt_rehearsal_' + crypto.randomBytes(12).toString('hex');
    await webhook('checkout.session.expired', expired, eventId);
    await webhook('checkout.session.expired', expired, eventId);
    assert.strictEqual(referrals.available(f.users.josh.id), 1);
    assert.strictEqual(referrals.redemption('checkout:' + operation.operation_id).state, 'released');
    const fresh = await f.api('josh', '/api/cloud/billing/subscribe', 'POST', {});
    assert.strictEqual(fresh.status, 200);
    const next = f.billing.db.prepare('SELECT * FROM cloud_single_checkouts WHERE account_id=?').get(payer.id);
    sessions.push(next.session_id);
    assert.notStrictEqual(next.session_id, operation.session_id);
    coupons.push(referrals.redemption('checkout:' + next.operation_id).coupon_id);
    receipt.application = { isolated_databases: true, application_credential: true,
      verified_signup_attribution: true, agent_connection: true, tagged_save_activation: true,
      checkout_discount: true, checkout_retry_reuses_session: true,
      signed_expiry_webhook: true, duplicate_webhook: true, unused_credit_released: true,
      expired_checkout_replaced: true, actual_customer_charges: false };
  } finally {
    for (const row of f.billing.db.prepare('SELECT coupon_id FROM cloud_referral_redemptions').all()) {
      if (!coupons.includes(row.coupon_id)) coupons.push(row.coupon_id);
    }
    try {
      for (const sessionId of sessions) {
        const session = await client.retrieveCheckoutSession({ sessionId });
        if (session.status === 'open') await client.expireCheckoutSession({ sessionId });
      }
    } finally { await f.close(); }
  }
};
