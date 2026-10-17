module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const http = require('http'), crypto = require('crypto');
    const sessions = new Map(), subscriptions = new Map(), idempotency = new Map();
    const calls = [];
    const mock = http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body); calls.push({ path: req.url, params });
      const send = data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.url === '/v1/checkout/sessions') {
        const key = req.headers['idempotency-key'];
        if (idempotency.has(key)) return send(idempotency.get(key));
        const id = 'cs_fixture_' + (sessions.size + 1);
        const session = { id, url: 'https://checkout.example/' + id, status: 'open', params: Object.fromEntries(params) };
        sessions.set(id, session); idempotency.set(key, session); return send(session);
      }
      const session = sessions.get(req.url.split('/')[4]);
      if (session) { if (req.url.endsWith('/expire')) session.status = 'expired'; return send(session); }
      if (req.url.startsWith('/v1/subscriptions/')) return send(subscriptions.get(req.url.split('/')[3]));
      if (req.url.startsWith('/v1/subscription_items/')) {
        const id = req.url.split('/')[3];
        for (const subscription of subscriptions.values()) if (subscription.items.data[0].id === id) subscription.items.data[0].quantity = Number(params.get('quantity'));
        return send({ id, quantity: Number(params.get('quantity')) });
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true, stripeApiBase: 'http://127.0.0.1:' + mock.address().port, logErrors: true });
    const single = new (require('../lib/cloud-single-plan').SinglePlan)({ billing: f.billing, store: f.store });
    let library, currentSession, subscription, serial = 0;
    async function webhook(object, signed = true) {
      const now = Math.floor(Date.now() / 1000);
      const raw = JSON.stringify({ id: 'evt_fixture_' + (++serial), type: 'customer.subscription.updated', created: now + serial, data: { object } });
      const digest = crypto.createHmac('sha256', signed ? 'whsec_fixture' : 'invalid').update(now + '.' + raw).digest('hex');
      return fetch(f.origin + '/api/cloud/billing/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': 't=' + now + ',v1=' + digest, 'Content-Type': 'application/json' }, body: raw });
    }
    function subscriptionFor(session) {
      const metadata = {}; for (const [key, value] of Object.entries(session.params)) {
        const match = key.match(/^subscription_data\[metadata\]\[([^\]]+)\]$/); if (match) metadata[match[1]] = value;
      }
      const result = { id: 'sub_' + session.id, created: Math.floor(Date.now()/1000), status: 'active', customer: 'cus_fixture', metadata,
        items: { data: [{ id: 'si_' + session.id, price: { id: 'price_standard' }, quantity: Number(session.params['line_items[0][quantity]']), current_period_end: Math.floor(Date.now()/1000) + 2592000 }] } };
      subscriptions.set(result.id, result); return result;
    }
    try {
      await testAsync('single checkout retries reuse one open provider session and the configured single price', async () => {
        library = (await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})).data.workspaces[0].id;
        const results = await Promise.all([f.api('josh', '/api/cloud/billing/subscribe', 'POST', {}), f.api('josh', '/api/cloud/billing/subscribe', 'POST', {})]);
        assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
        const operations = calls.filter(call => call.path === '/v1/checkout/sessions');
        // The real provider deduplicates concurrent retries using this key; repeat sequentially here.
        const latest = await f.api('josh', '/api/cloud/billing/subscribe', 'POST', {});
        assert.strictEqual(latest.status, 200);
        currentSession = [...sessions.values()].at(-1);
        assert.strictEqual(currentSession.params['line_items[0][price]'], 'price_standard');
        assert.strictEqual(currentSession.params['subscription_data[metadata][owner_user_id]'], f.users.josh.id);
        assert.strictEqual(currentSession.params['subscription_data[metadata][single_plan]'], 'true');
        assert.ok(operations.length >= 1);
        assert.strictEqual(sessions.size, 1);
      });
      await testAsync('a changed seat count expires the old checkout before opening its replacement', async () => {
        f.store.addWorkspaceMember({ actorUserId: f.users.josh.id, workspaceId: library, userId: f.users.member.id, role: 'member' });
        single.claim(f.users.member.id, library);
        const old = currentSession;
        const response = await f.api('josh', '/api/cloud/billing/subscribe', 'POST', {});
        assert.strictEqual(response.status, 200, JSON.stringify(response));
        assert.strictEqual(old.status, 'expired');
        currentSession = [...sessions.values()].at(-1);
        assert.strictEqual(currentSession.params['line_items[0][quantity]'], '2');
      });
      await testAsync('completed checkout waits for an authenticated webhook rather than creating another subscription', async () => {
        currentSession.status = 'complete';
        assert.strictEqual((await f.api('josh', '/api/cloud/billing/subscribe', 'POST', {})).data.error, 'subscription_pending');
        subscription = subscriptionFor(currentSession);
        assert.strictEqual((await webhook(subscription, false)).status, 400);
        assert.strictEqual(f.billing.getSubscription(library), null);
        assert.strictEqual((await webhook(subscription)).status, 200);
        assert.strictEqual(f.billing.getSubscription(library).providerSubscriptionId, subscription.id);
        assert.strictEqual((await f.api('josh', '/api/cloud/billing/subscribe', 'POST', {})).data.error, 'subscription_exists');
      });
      await testAsync('a person already paid for elsewhere cannot start another paid checkout', async () => {
        const count = sessions.size;
        const response = await f.api('member', '/api/cloud/billing/subscribe', 'POST', { owner_user_id: f.users.josh.id });
        assert.strictEqual(response.data.error, 'already_covered', JSON.stringify(response));
        assert.strictEqual(sessions.size, count);
      });
      await testAsync('removing a sponsored person updates billed quantity without transferring access', async () => {
        const response = await f.api('josh', '/api/cloud/v1/workspaces/' + library + '/members/' + f.users.member.id, 'DELETE');
        assert.strictEqual(response.status, 200, JSON.stringify(response));
        assert.strictEqual(subscriptions.get(subscription.id).items.data[0].quantity, 1);
        assert.strictEqual(single.hasSponsoredMembership(f.users.member.id, library), false);
      });
      await testAsync('a person losing sponsorship can pay for themselves without creating another library', async () => {
        const count = (await f.store.listWorkspaces(f.users.member.id)).length;
        const response = await f.api('member', '/api/cloud/billing/subscribe', 'POST', {});
        assert.strictEqual(response.status, 200, JSON.stringify(response));
        const session = [...sessions.values()].at(-1); session.status = 'complete';
        assert.strictEqual((await webhook(subscriptionFor(session))).status, 200);
        assert.strictEqual((await f.store.listWorkspaces(f.users.member.id)).length, count);
        const account = single.ownAccount(f.users.member.id);
        assert.strictEqual(single.coverage(f.users.member.id).account_id, account.id);
        assert.strictEqual(single.hasSponsoredMembership(f.users.member.id, library), false);
      });
    } finally { await f.close(); await new Promise(resolve => mock.close(resolve)); }
  };
};
