module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const stripe = await require('./stripe-referral-fixture').startStripe({ annual: true });
    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true, stripeApiBase: stripe.origin });
    const single = new (require('../lib/cloud-single-plan').SinglePlan)({ billing: f.billing, store: f.store });
    const referrals = new (require('../lib/cloud-referrals').CloudReferrals)({ billing: f.billing, auth: f.auth, store: f.store, secret: f.auth.pepper, origin: f.origin });
    let serial = 0;
    async function person() {
      const actor = 'annual' + (++serial);
      let user = f.auth.signInWithVerifiedEmail(actor + '@example.test').user;
      user = f.auth.updateUserProfile({ userId: user.id, firstName: 'Annual', lastName: 'Member' });
      f.auth.acceptCurrentTerms({ userId: user.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
      const session = f.auth.createBrowserSession(user.id);
      f.users[actor] = { ...user, cookie: 'sdocs_cloud=' + session.token, sessionToken: session.token };
      const setup = await f.api(actor, '/api/cloud/v1/onboarding/complete', 'POST', {});
      assert.strictEqual(setup.status, 200);
      return { actor, user, workspace: setup.data.workspaces[0].id, account: single.ownAccount(user.id) };
    }
    async function credits(owner, count) {
      f.billing.upsertSubscription({ workspaceId: owner.account.id, plan: 'team', provider: 'manual', status: 'active' });
      const code = referrals.link(owner.user.id).code;
      for (let n = 0; n < count; n++) {
        const signed = f.auth.signInWithVerifiedEmail('earned-annual-' + (++serial) + '@example.test');
        const intentKey = 'annual-intent-' + serial;
        referrals.rememberIntent(intentKey, code); referrals.attribute({ ...signed, intentKey });
        f.store.db.prepare('INSERT INTO cloud_document_activation_events VALUES(?,?,?)').run(signed.user.id, 'annual-doc-' + serial, Date.now());
        referrals.installed(signed.user.id);
      }
      f.billing.upsertSubscription({ workspaceId: owner.account.id, plan: 'team', provider: 'manual', status: 'canceled' });
    }
    async function checkout(p) {
      const r = await f.api(p.actor, '/api/cloud/billing/subscribe', 'POST', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      return [...stripe.sessions.values()].find(s => s.url === r.data.checkout_url);
    }
    async function pay(session) {
      const sub = stripe.subscription(session);
      assert.strictEqual((await stripe.webhook(f.origin, 'customer.subscription.created', sub)).status, 200);
      const invoice = stripe.invoice(sub, { reason: 'subscription_create', coupon: session.coupon });
      invoice.status = 'paid'; invoice.amount_paid = invoice.amount_due;
      assert.strictEqual((await stripe.webhook(f.origin, 'invoice.paid', invoice)).status, 200);
      return { sub, invoice };
    }
    try {
      await testAsync('checkout price tracking preserves the old table shape for rollback', async () => {
        assert.strictEqual(single.db.prepare('PRAGMA table_info(cloud_single_checkouts)').all().length, 5);
        single.db.prepare('INSERT INTO cloud_single_checkouts VALUES(?,?,?,NULL,NULL)').run('rollback-probe', 'old-operation', 1);
        single.db.prepare('DELETE FROM cloud_single_checkouts WHERE account_id=?').run('rollback-probe');
      });
      await testAsync('annual referrals value each credit as one $2.99 month, not a $35.88 year', async () => {
        const { unitPrice, periodMonths } = require('../lib/cloud-referral-billing');
        assert.strictEqual(unitPrice(stripe.price, 'usd'), 299);
        assert.strictEqual(periodMonths(stripe.price), 12);
        assert.strictEqual(unitPrice({ ...stripe.price, unit_amount: 500, recurring: { interval: 'month' } }, 'usd'), 500);
      });
      await testAsync('one personal annual subscription spends at most twelve month credits and carries the rest forward', async () => {
        const p = await person(); await credits(p, 13);
        const session = await checkout(p);
        assert.strictEqual(session.quantity, 1);
        assert.strictEqual(stripe.coupons.get(session.coupon).amount_off, 3588);
        const { sub, invoice } = await pay(session);
        assert.strictEqual(invoice.amount_due, 0);
        assert.strictEqual(referrals.balances(p.user.id).used_person_months, 12);
        assert.strictEqual(referrals.balances(p.user.id).available_person_months, 1);
        const renewal = stripe.invoice(sub);
        assert.strictEqual((await stripe.webhook(f.origin, 'invoice.created', renewal)).status, 200);
        assert.strictEqual(renewal.amount_due, 3289);
        renewal.status = 'paid'; renewal.amount_paid = renewal.amount_due;
        for (let i = 0; i < 2; i++) assert.strictEqual((await stripe.webhook(f.origin, 'invoice.paid', renewal)).status, 200);
        assert.strictEqual(referrals.balances(p.user.id).used_person_months, 13);
      });
      await testAsync('a ten-person annual bill discounts only $2.99 for one earned person-month', async () => {
        const p = await person();
        const team = await f.store.createTeamWorkspace({ userId: p.user.id, name: 'Annual team', projectName: 'Documents' });
        single.initialize(p.user.id, team.workspaceId, p.actor + '@example.test');
        for (let n = 0; n < 9; n++) {
          const member = f.auth.signInWithVerifiedEmail('annual-seat-' + (++serial) + '@example.test').user;
          f.store.addWorkspaceMember({ actorUserId: p.user.id, workspaceId: team.workspaceId, userId: member.id, role: 'member' }); single.claim(member.id, team.workspaceId);
        }
        await credits(p, 1);
        const session = await checkout(p);
        assert.strictEqual(session.quantity, 10);
        assert.strictEqual(stripe.coupons.get(session.coupon).amount_off, 299);
        const { invoice } = await pay(session);
        assert.strictEqual(invoice.amount_due, 35581);
      });
      await testAsync('changing the configured price expires an old open checkout and retries reuse the replacement', async () => {
        const p = await person();
        const client = require('../lib/cloud-stripe').createStripeClient({ secretKey: 'sk_test_fixture', apiBase: stripe.origin });
        const old = await single.checkout({ userId: p.user.id, stripe: client, priceId: 'price_old_monthly', origin: f.origin, email: p.actor + '@example.test' });
        const fresh = await single.checkout({ userId: p.user.id, stripe: client, priceId: 'price_standard', origin: f.origin, email: p.actor + '@example.test' });
        assert.notStrictEqual(old.id, fresh.id); assert.strictEqual(stripe.sessions.get(old.id).status, 'expired');
        const retry = await single.checkout({ userId: p.user.id, stripe: client, priceId: 'price_standard', origin: f.origin, email: p.actor + '@example.test' });
        assert.strictEqual(retry.id, fresh.id);
      });
    } finally { await f.close(); await stripe.close(); }
  };
};
