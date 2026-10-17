// Opt-in Stripe sandbox rehearsal. Never accepts a live key or live price.
'use strict';
const fs = require('fs');
const assert = require('assert');
const crypto = require('crypto');
const { createStripeClient, encodeForm } = require('../lib/cloud-stripe');
async function run() {
  const secretKey = fs.readFileSync(process.env.STRIPE_SECRET_KEY_FILE, 'utf8').trim();
  assert.ok(/^(sk|rk)_test_/.test(secretKey), 'Use a Stripe sandbox key');
  const priceId = process.env.STRIPE_STANDARD_PRICE_ID;
  assert.ok(priceId, 'Set STRIPE_STANDARD_PRICE_ID');
  const api = async (method, route, body) => {
    const response = await fetch('https://api.stripe.com/v1/' + route, {
      method, headers: { Authorization: 'Bearer ' + secretKey,
        'Stripe-Version': '2026-07-29.dahlia', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'GET' ? undefined : encodeForm(body || {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error && data.error.message || 'Stripe request failed');
    return data;
  };
  const price = await api('GET', 'prices/' + priceId + '?expand[]=currency_options');
  assert.strictEqual(price.livemode, false);
  assert.strictEqual(price.recurring.interval, 'month');
  assert.strictEqual(price.unit_amount, 400);
  assert.strictEqual(price.currency_options.usd.unit_amount, 500);
  assert.strictEqual(price.currency_options.eur.unit_amount, 500);
  const stripe = createStripeClient({ secretKey, apiVersion: '2026-07-29.dahlia' });
  let session, customer, subscription, declinedSubscription;
  try {
    const operation = crypto.randomUUID();
    const input = { workspaceId: operation, priceId, quantity: 1, plan: 'team',
      metadata: { single_plan: 'true', owner_user_id: 'sandbox-rehearsal', single_checkout_operation_id: operation },
      successUrl: 'https://cloud-staging.smalldocs.org/cloud/start', cancelUrl: 'https://cloud-staging.smalldocs.org/cloud/subscribe',
      idempotencyKey: 'single-plan-rehearsal-' + operation };
    session = await stripe.createCheckoutSubscriptionSession(input);
    assert.strictEqual((await stripe.createCheckoutSubscriptionSession(input)).id, session.id);
    assert.strictEqual((await stripe.retrieveCheckoutSession({ sessionId: session.id })).status, 'open');
    customer = await api('POST', 'customers', { name: 'SmallDocs sandbox verification',
      address: { line1: '1 Test Road', city: 'London', postal_code: 'SW1A 1AA', country: 'GB' },
      metadata: { purpose: 'single-plan-rehearsal' }, payment_method: 'pm_card_visa',
      invoice_settings: { default_payment_method: 'pm_card_visa' } });
    subscription = await api('POST', 'subscriptions', { customer: customer.id,
      items: [{ price: priceId, quantity: 1 }], automatic_tax: { enabled: true },
      metadata: { purpose: 'single-plan-rehearsal', workspace_id: operation, plan: 'team', single_plan: 'true' } });
    assert.strictEqual(subscription.status, 'active');
    const item = subscription.items.data[0];
    await stripe.updateSubscriptionItemQuantity({ subscriptionItemId: item.id, quantity: 2,
      prorationBehavior: 'create_prorations', idempotencyKey: operation + '-two' });
    assert.strictEqual((await stripe.retrieveSubscription({ subscriptionId: subscription.id })).items.data[0].quantity, 2);
    await stripe.updateSubscriptionItemQuantity({ subscriptionItemId: item.id, quantity: 1,
      prorationBehavior: 'create_prorations', idempotencyKey: operation + '-one' });
    const scheduled = await api('POST', 'subscriptions/' + subscription.id, { cancel_at_period_end: true });
    assert.strictEqual(scheduled.cancel_at_period_end, true);
    const resumed = await api('POST', 'subscriptions/' + subscription.id, { cancel_at_period_end: false });
    assert.strictEqual(resumed.cancel_at_period_end, false);
    const declined = await api('POST', 'payment_methods/pm_card_chargeCustomerFail/attach', { customer: customer.id });
    declinedSubscription = await api('POST', 'subscriptions', { customer: customer.id,
      items: [{ price: priceId, quantity: 1 }], default_payment_method: declined.id,
      payment_behavior: 'allow_incomplete', metadata: { purpose: 'single-plan-payment-failure-rehearsal' } });
    assert.strictEqual(declinedSubscription.status, 'incomplete');
    await api('POST', 'invoices/' + declinedSubscription.latest_invoice + '/pay', { payment_method: customer.invoice_settings.default_payment_method });
    assert.strictEqual((await stripe.retrieveSubscription({ subscriptionId: declinedSubscription.id })).status, 'active');
    console.log(JSON.stringify({ ok: true, price_id: priceId, checks: ['localised_price', 'checkout_idempotency', 'active_subscription', 'seat_increase', 'seat_decrease', 'scheduled_cancellation', 'cancellation_reversed', 'payment_failure', 'payment_recovery'] }));
  } finally {
    if (session) await stripe.expireCheckoutSession({ sessionId: session.id });
    if (declinedSubscription) await api('DELETE', 'subscriptions/' + declinedSubscription.id);
    if (subscription) await api('DELETE', 'subscriptions/' + subscription.id);
    if (customer) await api('DELETE', 'customers/' + customer.id);
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
