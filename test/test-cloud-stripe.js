const crypto = require('crypto');

module.exports = function(harness) {
  const { assert, test, testAsync } = harness;

  return async function() {
    console.log('\n-- Cloud Stripe Tests ---------------------------------\n');

    const { StripeError, createStripeClient, verifyStripeWebhook } = require('../lib/cloud-stripe');
    const requests = [];
    const responses = [];
    const transport = async function(input) {
      requests.push(input);
      return responses.shift() || { status: 200, headers: {}, body: '{}' };
    };
    const stripe = createStripeClient({
      secretKey: 'sk_test_example',
      webhookSecret: 'whsec_example',
      apiVersion: '2025-06-30.basil',
      transport,
    });

    await testAsync('creates a subscription Checkout Session with workspace metadata', async () => {
      responses.push({ status: 200, headers: { 'request-id': 'req_checkout' },
        body: JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/example' }) });
      const result = await stripe.createCheckoutSubscriptionSession({
        priceId: 'price_team_monthly', quantity: 4,
        successUrl: 'https://smalldocs.org/cloud/admin?checkout=success',
        cancelUrl: 'https://smalldocs.org/cloud/admin?checkout=cancelled',
        workspaceId: 'workspace-123', plan: 'team', customerEmail: 'owner@example.com',
        idempotencyKey: 'checkout-workspace-123', metadata: { owner_user_id: 'user-123' },
      });
      assert.strictEqual(result.id, 'cs_test_123');
      const request = requests.shift();
      assert.strictEqual(request.method, 'POST');
      assert.strictEqual(request.url, 'https://api.stripe.com/v1/checkout/sessions');
      assert.strictEqual(request.headers.Authorization,
        'Basic ' + Buffer.from('sk_test_example:').toString('base64'));
      assert.strictEqual(request.headers['Stripe-Version'], '2025-06-30.basil');
      assert.strictEqual(request.headers['Idempotency-Key'], 'checkout-workspace-123');
      const params = new URLSearchParams(request.body);
      assert.strictEqual(params.get('mode'), 'subscription');
      assert.strictEqual(params.get('line_items[0][price]'), 'price_team_monthly');
      assert.strictEqual(params.get('line_items[0][quantity]'), '4');
      assert.strictEqual(params.get('client_reference_id'), 'workspace-123');
      assert.strictEqual(params.get('metadata[workspace_id]'), 'workspace-123');
      assert.strictEqual(params.get('metadata[plan]'), 'team');
      assert.strictEqual(params.get('metadata[owner_user_id]'), 'user-123');
      assert.strictEqual(params.get('subscription_data[metadata][workspace_id]'), 'workspace-123');
      assert.strictEqual(params.get('subscription_data[metadata][plan]'), 'team');
      assert.strictEqual(params.get('customer_email'), 'owner@example.com');
      assert.strictEqual(params.get('payment_method_collection'), 'always');
    });

    await testAsync('creates a customer billing portal session', async () => {
      responses.push({ statusCode: 200, headers: {}, body: Buffer.from('{"id":"bps_123","url":"https://billing.stripe.com/session"}') });
      const result = await stripe.createBillingPortalSession({
        customerId: 'cus_123', returnUrl: 'https://smalldocs.org/cloud/admin', configurationId: 'bpc_123',
      });
      assert.strictEqual(result.id, 'bps_123');
      const request = requests.shift();
      assert.strictEqual(request.url, 'https://api.stripe.com/v1/billing_portal/sessions');
      const params = new URLSearchParams(request.body);
      assert.strictEqual(params.get('customer'), 'cus_123');
      assert.strictEqual(params.get('return_url'), 'https://smalldocs.org/cloud/admin');
      assert.strictEqual(params.get('configuration'), 'bpc_123');
    });

    await testAsync('updates a subscription item quantity with explicit billing behavior', async () => {
      responses.push({ status: 200, headers: {}, body: '{"id":"si_123","quantity":7}' });
      const result = await stripe.updateSubscriptionItemQuantity({
        subscriptionItemId: 'si_123', quantity: 7,
        prorationBehavior: 'always_invoice', paymentBehavior: 'error_if_incomplete',
        idempotencyKey: 'seats-workspace-123-7',
      });
      assert.strictEqual(result.quantity, 7);
      const request = requests.shift();
      assert.strictEqual(request.url, 'https://api.stripe.com/v1/subscription_items/si_123');
      const params = new URLSearchParams(request.body);
      assert.strictEqual(params.get('quantity'), '7');
      assert.strictEqual(params.get('proration_behavior'), 'always_invoice');
      assert.strictEqual(params.get('payment_behavior'), 'error_if_incomplete');
    });

    await testAsync('retrieves a subscription with an authenticated GET', async () => {
      responses.push({ status: 200, headers: {}, body: '{"id":"sub_123","status":"active"}' });
      const result = await stripe.retrieveSubscription({ subscriptionId: 'sub_123' });
      assert.strictEqual(result.status, 'active');
      const request = requests.shift();
      assert.strictEqual(request.method, 'GET');
      assert.strictEqual(request.url, 'https://api.stripe.com/v1/subscriptions/sub_123');
      assert.strictEqual(request.body, null);
      assert.strictEqual(request.headers['Content-Type'], undefined);
    });

    await testAsync('surfaces Stripe API error details without exposing the secret', async () => {
      responses.push({ status: 402, headers: { 'Request-Id': 'req_failed' }, body: JSON.stringify({
        error: { type: 'card_error', message: 'Payment failed', decline_code: 'do_not_honor', param: 'payment_method' },
      }) });
      await assert.rejects(() => stripe.updateSubscriptionItemQuantity({
        subscriptionItemId: 'si_failed', quantity: 8,
      }), (error) => error instanceof StripeError && error.code === 'stripe_api_error' &&
        error.status === 402 && error.requestId === 'req_failed' && error.declineCode === 'do_not_honor' &&
        !JSON.stringify(error).includes('sk_test_example'));
      requests.shift();
    });

    await testAsync('validates IDs, quantity, URLs, and behavior before transport', async () => {
      await assert.rejects(() => stripe.createBillingPortalSession({ customerId: 'bad', returnUrl: 'https://example.com' }),
        (error) => error.code === 'invalid_request');
      await assert.rejects(() => stripe.updateSubscriptionItemQuantity({ subscriptionItemId: 'si_123', quantity: 0 }),
        (error) => error.code === 'invalid_request');
      await assert.rejects(() => stripe.updateSubscriptionItemQuantity({
        subscriptionItemId: 'si_123', quantity: 2, prorationBehavior: 'surprise_customer',
      }), (error) => error.code === 'invalid_request');
    });

    test('verifies and parses a Stripe webhook against the untouched body', () => {
      const timestamp = 1700000000;
      const rawBody = Buffer.from('{"id":"evt_123","type":"checkout.session.completed"}');
      const signature = crypto.createHmac('sha256', 'whsec_example')
        .update(Buffer.concat([Buffer.from(timestamp + '.'), rawBody])).digest('hex');
      const event = stripe.verifyWebhook(rawBody, 't=' + timestamp + ',v1=bad,v1=' + signature, {
        now: timestamp * 1000,
      });
      assert.strictEqual(event.id, 'evt_123');
    });

    test('rejects mutated webhook bodies, stale timestamps, and invalid JSON', () => {
      const timestamp = 1700000000;
      const validBody = Buffer.from('{"id":"evt_123"}');
      const signature = crypto.createHmac('sha256', 'whsec_example')
        .update(Buffer.concat([Buffer.from(timestamp + '.'), validBody])).digest('hex');
      assert.throws(() => verifyStripeWebhook({
        rawBody: Buffer.from('{ "id": "evt_123" }'), signature: 't=' + timestamp + ',v1=' + signature,
        secret: 'whsec_example', now: timestamp * 1000,
      }), (error) => error.code === 'invalid_webhook_signature');
      assert.throws(() => verifyStripeWebhook({
        rawBody: validBody, signature: 't=' + timestamp + ',v1=' + signature,
        secret: 'whsec_example', now: (timestamp + 301) * 1000,
      }), (error) => error.code === 'webhook_timestamp_outside_tolerance');
      const invalidJson = Buffer.from('not json');
      const invalidJsonSignature = crypto.createHmac('sha256', 'whsec_example')
        .update(Buffer.concat([Buffer.from(timestamp + '.'), invalidJson])).digest('hex');
      assert.throws(() => verifyStripeWebhook({
        rawBody: invalidJson, signature: 't=' + timestamp + ',v1=' + invalidJsonSignature,
        secret: 'whsec_example', now: timestamp * 1000,
      }), (error) => error.code === 'invalid_webhook_payload');
    });
  };
};
