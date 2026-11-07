module.exports = function(h) {
  const { assert, testAsync } = h;
  return async function() {
    const { CloudReferrals } = require('../lib/cloud-referrals');
    const { SinglePlan } = require('../lib/cloud-single-plan');
    const { createBillingStore } = require('../lib/cloud-billing');
    const stripe = await require('./stripe-referral-fixture').startStripe();
    const f = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true, stripeApiBase: stripe.origin });
    const single = new SinglePlan({ billing: f.billing, store: f.store });
    const referrals = new CloudReferrals({ billing: f.billing, auth: f.auth, store: f.store, single, secret: f.auth.pepper, origin: f.origin });
    let serial = 0;
    async function api(person, endpoint, method = 'GET', body) {
      const response = await fetch(f.origin + endpoint, { method, redirect: 'manual', headers: {
        Cookie: person.cookie, Origin: f.origin, 'Content-Type': 'application/json',
      }, body: body == null ? undefined : JSON.stringify(body) });
      let data; const text = await response.text(); try { data = JSON.parse(text); } catch (_) { data = text; }
      return { status: response.status, data };
    }
    async function person({ referrer, onboard = true } = {}) {
      const signed = f.auth.signInWithVerifiedEmail('milestone-' + (++serial) + '@example.test');
      const user = f.auth.updateUserProfile({ userId: signed.user.id, firstName: 'Robin', lastName: 'Walker' });
      f.auth.acceptCurrentTerms({ userId: user.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
      if (referrer) {
        const intentKey = 'milestone-signup-' + serial;
        referrals.rememberIntent(intentKey,referrals.link(referrer.user.id).code);
        referrals.recordSignup({ ...signed, user, intentKey });
      }
      const result = { user, cookie: 'sdocs_cloud=' + f.auth.createBrowserSession(user.id).token };
      if (onboard) await initialize(result);
      return result;
    }
    async function initialize(p) {
      const result = await api(p,'/api/cloud/v1/onboarding/complete','POST',{});
      assert.strictEqual(result.status,200,JSON.stringify(result));
      p.workspace = result.data.workspaces.find(w => w.kind === 'personal').id;
      p.account = single.ownAccount(p.user.id);
      p.trial = f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(p.user.id);
    }
    async function connect(p) {
      f.auth.db.prepare("DELETE FROM cloud_auth_rate_events WHERE action='cli_device_issue'").run();
      const issued = await api(p,'/api/cloud/v1/cli/device-authorizations','POST',{ display_name: 'Laptop' });
      assert.strictEqual(issued.status,201,JSON.stringify(issued));
      assert.strictEqual((await api(p,'/api/cloud/v1/cli/device-authorizations/approve','POST',{user_code:issued.data.user_code})).status,200);
      const token = await api(p,'/api/cloud/v1/cli/device-authorizations/token','POST',{device_code:issued.data.device_code});
      assert.strictEqual(token.status,200,JSON.stringify(token));
      return token.data;
    }
    async function save(p, { tagged = true, legacy = false, key, markdown } = {}) {
      const projects = await f.store.listProjects(p.user.id,p.workspace);
      const result = await api(p,legacy ? '/api/cloud/v1/documents' : '/api/cloud/v1/account/documents','POST',{
        account_id: p.workspace, project_id: projects[0].id,
        filename: 'first-document.md', markdown: markdown || (tagged ? '---\ntags: [onboarding]\n---\n' : '') + '# First document\n\nSample text.',
        idempotency_key: key || 'milestone-document-' + (++serial),
      });
      assert.strictEqual(result.status,201,JSON.stringify(result));
      return result;
    }
    async function pay(p, { zero = false, proration = false, wrongPrice = false, incomplete = false } = {}) {
      const checkout = await api(p,'/api/cloud/billing/subscribe','POST',{});
      assert.strictEqual(checkout.status,200,JSON.stringify(checkout));
      const session = [...stripe.sessions.values()].find(s => s.url === checkout.data.checkout_url);
      const subscription = stripe.subscription(session);
      assert.strictEqual((await stripe.webhook(f.origin,'customer.subscription.created',subscription)).status,200);
      const invoice = stripe.invoice(subscription,{ reason:'subscription_create',coupon:session.coupon });
      if (zero) invoice.amount_due = 0;
      if (proration) invoice.lines.data[0].parent.subscription_item_details.proration = true;
      if (wrongPrice) invoice.lines.data[0].pricing.price_details.price = 'price_unrelated';
      if (incomplete) invoice.lines.has_more = true;
      invoice.status = 'paid'; invoice.amount_paid = invoice.amount_due;
      assert.strictEqual((await stripe.webhook(f.origin,'invoice.paid',invoice)).status,incomplete ? 400 : 200);
      return { subscription, invoice, session };
    }
    async function activate(p) { await connect(p); return save(p); }
    function paid(p) { f.billing.upsertSubscription({workspaceId:p.account.id,plan:'team',status:'active',provider:'manual'}); }
    function earned(p) { return referrals.db.prepare('SELECT COUNT(*) AS n FROM cloud_referral_rewards WHERE user_id=?').get(p.user.id).n; }
    try {
      await testAsync('referred signup gets one extra personal calendar month, even when onboarding is delayed',async() => {
        const owner = await person(), friend = await person({referrer:owner,onboard:false});
        assert.strictEqual(f.billing.personalTrialAccess(friend.user.id),null);
        await initialize(friend);
        const status = await api(friend,'/api/cloud/billing/subscription');
        assert.strictEqual(status.data.phase,'trial');
        assert.strictEqual(status.data.original_trial_ends_at_ms,friend.trial.ends_at_ms);
        assert.ok(status.data.trial_ends_at_ms > friend.trial.ends_at_ms + 27 * 86400000);
        const before = status.data.trial_ends_at_ms;
        for (let i=0;i<3;i++) referrals.recordActivity(friend.user.id);
        assert.strictEqual((await api(friend,'/api/cloud/billing/subscription')).data.trial_ends_at_ms,before);
        assert.strictEqual(earned(owner),0);
      });
      await testAsync('agent connection and untagged or failed saves do not earn activation',async() => {
        const owner = await person(), friend = await person({referrer:owner});
        await connect(friend); await save(friend,{tagged:false});
        const invalid = await api(friend,'/api/cloud/v1/account/documents','POST',{
          account_id:f.otherTeam.workspaceId,filename:'forbidden.md',markdown:'---\ntags: [test]\n---\n# Nope',idempotency_key:'forbidden-save'});
        assert.strictEqual(invalid.status,404);
        assert.strictEqual(earned(owner),0);
        assert.strictEqual(f.store.db.prepare('SELECT * FROM cloud_document_activation_events WHERE user_id=?').get(friend.user.id),undefined);
      });
      await testAsync('tagging an existing own document activates once and preserves private document access',async() => {
        const owner = await person(), friend = await person({referrer:owner});
        await connect(friend);
        const doc = (await save(friend,{tagged:false})).data.document;
        const update = await api(friend,'/api/cloud/v1/documents/' + doc.id + '/tags','PATCH',{
          expected_head_revision_id:doc.current_revision_id,tags:['onboarding'],idempotency_key:'tag-own-document'});
        assert.strictEqual(update.status,200,JSON.stringify(update));
        assert.strictEqual(earned(owner),1);
        assert.strictEqual((await api(owner,'/api/cloud/v1/documents/' + doc.id)).status,404);
        const summary = (await api(owner,'/api/cloud/v1/referrals')).data;
        assert.strictEqual(summary.referrals[0].status,'activated');
        assert.ok(!JSON.stringify(summary).includes(doc.id));
        assert.ok(!JSON.stringify(summary).includes('onboarding'));
      });
      for (const legacy of [false,true]) await testAsync('document before connection activates on connect through ' + (legacy ? 'project' : 'account') + ' create API',async() => {
        const owner = await person(), friend = await person({referrer:owner});
        await save(friend,{legacy,key:'same-save'});
        assert.strictEqual(earned(owner),0);
        await connect(friend); await connect(friend);
        await save(friend,{legacy,key:'same-save'});
        assert.strictEqual(earned(owner),1);
        assert.strictEqual(referrals.balances(owner.user.id).access_person_months,1);
        assert.strictEqual(referrals.available(owner.user.id),0);
      });
      for (const phase of ['trial','warning','paywall']) await testAsync('unpaid ' + phase + ' referrer gets personal access and cannot also spend it on billing',async() => {
        const owner = await person();
        if (phase !== 'trial') f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?')
          .run(Date.now() - (phase === 'warning' ? 2 : 12) * 86400000,owner.user.id);
        const before = (await api(owner,'/api/cloud/billing/subscription')).data;
        const friend = await person({referrer:owner}); await activate(friend);
        const after = (await api(owner,'/api/cloud/billing/subscription')).data;
        assert.strictEqual(after.phase,'trial');
        assert.strictEqual(after.original_trial_ends_at_ms,before.original_trial_ends_at_ms);
        assert.ok(after.trial_ends_at_ms > Math.max(before.trial_ends_at_ms,Date.now()-60000));
        const balance = referrals.balances(owner.user.id);
        assert.strictEqual(balance.access_person_months,1);
        assert.strictEqual(balance.available_person_months,0);
        assert.strictEqual(referrals.reserve({userId:owner.user.id,accountId:owner.account.id,scope:'checkout',key:'no-double-'+serial,
          quantity:1,unitAmount:500,currency:'usd',productId:'prod_standard'}),null);
        assert.strictEqual((await save(owner)).status,201);
        await pay(friend);
        assert.strictEqual(referrals.balances(owner.user.id).access_person_months,3);
      });
      await testAsync('a free team owner earns only personal access and does not extend teammates',async() => {
        const owner = await person(), member = await person();
        const team = await f.store.createTeamWorkspace({userId:owner.user.id,name:'Product',projectName:'Documents'});
        single.initialize(owner.user.id,team.workspaceId,owner.user.identities[0].verifiedEmail);
        f.store.addWorkspaceMember({actorUserId:owner.user.id,workspaceId:team.workspaceId,userId:member.user.id,role:'member'});
        single.claim(member.user.id,team.workspaceId);
        const deadline = Date.now() - 9 * 86400000;
        f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id IN (?,?)').run(deadline,owner.user.id,member.user.id);
        assert.strictEqual(single.entitlements(member.user.id,team.workspaceId).effectiveStatus,'payment_required');
        const friend = await person({referrer:owner}); await activate(friend);
        assert.strictEqual(single.entitlements(owner.user.id,team.workspaceId).effectiveStatus,'trial');
        assert.strictEqual(single.entitlements(member.user.id,team.workspaceId).effectiveStatus,'payment_required');
        assert.strictEqual(f.billing.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(owner.user.id).ends_at_ms,deadline);
        assert.strictEqual(single.subscriptionAccess(owner.account.id).effectiveStatus,'payment_required');
      });
      await testAsync('paid solo referrer earns three billing credits without changing trial or subscription dates',async() => {
        const owner = await person(); paid(owner);
        const friend = await person({referrer:owner}); await activate(friend); await pay(friend);
        assert.strictEqual(referrals.available(owner.user.id),3);
        assert.strictEqual(referrals.balances(owner.user.id).access_person_months,0);
        assert.strictEqual(f.billing.personalTrialAccess(owner.user.id).endsAtMs,owner.trial.ends_at_ms);
        const billing = await api(owner,'/api/cloud/billing/subscription');
        assert.strictEqual(billing.data.phase,'active');
        assert.strictEqual(billing.data.referral_credits.available_person_months,3);
      });
      await testAsync('someone sponsored by a paid team keeps rewards for their own bill and does not credit the employer',async() => {
        const employer = await person(), member = await person(); paid(employer);
        const team = await f.store.createTeamWorkspace({userId:employer.user.id,name:'Engineering',projectName:'Documents'});
        single.initialize(employer.user.id,team.workspaceId,employer.user.identities[0].verifiedEmail);
        f.store.addWorkspaceMember({actorUserId:employer.user.id,workspaceId:team.workspaceId,userId:member.user.id,role:'member'});
        single.claim(member.user.id,team.workspaceId);
        const friend = await person({referrer:member}); await activate(friend); await pay(friend);
        assert.strictEqual(referrals.available(member.user.id),3);
        assert.strictEqual(referrals.available(employer.user.id),0);
        assert.strictEqual(referrals.balances(member.user.id).access_person_months,0);
        assert.strictEqual((await api(member,'/api/cloud/billing/subscription')).data.covered_elsewhere,true);
      });
      await testAsync('payment before document and connection earns exactly three credits after activation',async() => {
        const owner = await person(); paid(owner);
        const friend = await person({referrer:owner}); const receipt = await pay(friend);
        assert.strictEqual(earned(owner),0);
        await save(friend); assert.strictEqual(earned(owner),0);
        await connect(friend); assert.strictEqual(earned(owner),3);
        for (let i=0;i<4;i++) await stripe.webhook(f.origin,'invoice.paid',receipt.invoice);
        const renewal = stripe.invoice(receipt.subscription); renewal.status='paid';renewal.amount_paid=renewal.amount_due;
        await stripe.webhook(f.origin,'invoice.paid',renewal);
        await Promise.all([connect(friend),save(friend),api(friend,'/api/cloud/v1/referrals')]);
        assert.strictEqual(earned(owner),3);
      });
      for (const invalid of ['zero','proration','wrongPrice','incomplete']) await testAsync(invalid + ' invoice cannot earn the payment bonus, but a later valid monthly payment can',async() => {
        const owner = await person(); paid(owner);
        const friend = await person({referrer:owner}); await activate(friend);
        const receipt = await pay(friend,{[invalid]:true});
        assert.strictEqual(earned(owner),1);
        const monthly = stripe.invoice(receipt.subscription); monthly.status='paid';monthly.amount_paid=monthly.amount_due;
        assert.strictEqual((await stripe.webhook(f.origin,'invoice.paid',monthly)).status,200);
        assert.strictEqual(earned(owner),3);
      });
      await testAsync('subscribing between milestones keeps the early access month and gives two billing credits',async() => {
        const owner = await person(), friend = await person({referrer:owner}); await activate(friend);
        const deadline = f.billing.personalTrialAccess(owner.user.id).endsAtMs;
        paid(owner); await pay(friend);
        const balance = referrals.balances(owner.user.id);
        assert.strictEqual(balance.access_person_months,1);
        assert.strictEqual(balance.available_person_months,2);
        assert.strictEqual(f.billing.personalTrialAccess(owner.user.id).endsAtMs,deadline);
      });
      await testAsync('the warning week follows personal referral access and ends in a paywall',async() => {
        const owner = await person(), friend = await person({referrer:owner}); await activate(friend);
        const deadline = f.billing.personalTrialAccess(owner.user.id).endsAtMs, clock = f.billing.now;
        try {
          f.billing.now = () => deadline + 86400000;
          assert.strictEqual(single.entitlements(owner.user.id,owner.workspace).effectiveStatus,'trial_warning');
          assert.strictEqual(single.check(owner.user.id,owner.workspace,{operation:'store_revision',fileBytes:100}).allowed,true);
          f.billing.now = () => deadline + 7 * 86400000;
          assert.strictEqual(single.check(owner.user.id,owner.workspace,{operation:'read'}).reason,'trial_payment_required');
        } finally { f.billing.now = clock; }
      });
      await testAsync('a disabled referrer cannot receive activation or payment units',async() => {
        const owner = await person(), friend = await person({referrer:owner});
        f.auth.db.prepare('UPDATE cloud_auth_users SET disabled_at_ms=? WHERE id=?').run(Date.now(),owner.user.id);
        await activate(friend); await pay(friend);
        assert.strictEqual(earned(owner),0);
      });
      await testAsync('a referred team owner pays once for several people and earns one payment milestone',async() => {
        const owner = await person(); paid(owner);
        const friend = await person({referrer:owner}); await activate(friend);
        const team = await f.store.createTeamWorkspace({userId:friend.user.id,name:'Research',projectName:'Documents'});
        single.initialize(friend.user.id,team.workspaceId,friend.user.identities[0].verifiedEmail);
        for (let i=0;i<4;i++) {
          const member = await person();
          f.store.addWorkspaceMember({actorUserId:friend.user.id,workspaceId:team.workspaceId,userId:member.user.id,role:'member'});
          single.claim(member.user.id,team.workspaceId);
        }
        const receipt = await pay(friend);
        assert.strictEqual(receipt.session.quantity,5);
        assert.strictEqual(referrals.available(owner.user.id),3);
        assert.strictEqual(earned(owner),3);
      });
      await testAsync('a referred sponsored member activates but a sponsor payment does not count as their own payment',async() => {
        const owner = await person(); paid(owner);
        const employer = await person(), friend = await person({referrer:owner});
        const team = await f.store.createTeamWorkspace({userId:employer.user.id,name:'Design',projectName:'Documents'});
        single.initialize(employer.user.id,team.workspaceId,employer.user.identities[0].verifiedEmail);
        f.store.addWorkspaceMember({actorUserId:employer.user.id,workspaceId:team.workspaceId,userId:friend.user.id,role:'member'});
        single.claim(friend.user.id,team.workspaceId);
        await activate(friend); await pay(employer);
        assert.strictEqual(earned(owner),1);
      });
      await testAsync('saved activation evidence recovers after a billing exception without duplicating the document',async() => {
        const owner = await person(), friend = await person({referrer:owner}); await connect(friend);
        const grant = f.billing.grantPersonalMonths;
        f.billing.grantPersonalMonths = () => { throw new Error('Temporary billing failure'); };
        const projects = await f.store.listProjects(friend.user.id,friend.workspace);
        const saved = await f.store.createDocument({userId:friend.user.id,projectId:projects[0].id,filename:'retry.md',
          markdown:'---\ntags: [recovery]\n---\n# Saved',idempotencyKey:'recovered-create'});
        referrals.recordActivity(friend.user.id);
        assert.strictEqual(earned(owner),0);
        f.billing.grantPersonalMonths = grant;
        referrals.recordActivity(friend.user.id); referrals.recordActivity(friend.user.id);
        assert.strictEqual(earned(owner),1);
        const replay = await f.store.createDocument({userId:friend.user.id,projectId:projects[0].id,filename:'retry.md',
          markdown:'---\ntags: [recovery]\n---\n# Saved',idempotencyKey:'recovered-create'});
        assert.strictEqual(replay.id,saved.id);
      });
      await testAsync('an editor saving someone else\'s shared tagged document cannot activate their own referral',async() => {
        const owner = await person(), friend = await person({referrer:owner}), author = await person();
        const team = await f.store.createTeamWorkspace({userId:author.user.id,name:'Shared',projectName:'Documents'});
        single.initialize(author.user.id,team.workspaceId,author.user.identities[0].verifiedEmail);
        f.store.addWorkspaceMember({actorUserId:author.user.id,workspaceId:team.workspaceId,userId:friend.user.id,role:'member'});
        const doc = await f.store.createDocument({userId:author.user.id,projectId:team.projectId,filename:'shared.md',
          markdown:'---\ntags: [shared]\n---\n# Shared',idempotencyKey:'authors-document'});
        f.store.setDocumentPermission({userId:author.user.id,documentId:doc.id,mode:'everyone'});
        await connect(friend);
        const response = await api(friend,'/api/cloud/v1/documents/' + doc.id + '/tags','PATCH',{
          expected_head_revision_id:doc.current_revision_id,tags:['changed'],idempotency_key:'editor-tags'});
        assert.strictEqual(response.status,200,JSON.stringify(response));
        assert.strictEqual(earned(owner),0);
      });
      await testAsync('legacy rewarded and reserved units survive migration and activation tops up to three only',async() => {
        const owner = await person(); paid(owner);
        const friend = await person({referrer:owner});
        const row = referrals.db.prepare('SELECT * FROM cloud_referrals WHERE referred_user_id=?').get(friend.user.id);
        // Recreate the exact original reward schema with a reserved legacy unit.
        const old = createBillingStore({dbPath:':memory:'});
        old.db.exec(`CREATE TABLE cloud_referrals AS SELECT '${row.id}' AS id, '${friend.user.id}' AS referred_user_id,
          '${owner.user.id}' AS referrer_user_id, 'unique' AS identity_hash, 1 AS created_at_ms,
          2 AS installed_at_ms, 3 AS paid_at_ms, 'in_old' AS paid_invoice_id, 4 AS rewarded_at_ms;
          CREATE TABLE cloud_referral_rewards(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,referral_id TEXT NOT NULL UNIQUE,
            earned_at_ms INTEGER NOT NULL,redemption_id TEXT,consumed_at_ms INTEGER);
          INSERT INTO cloud_referral_rewards VALUES('old-unit','${owner.user.id}','${row.id}',4,'old-reservation',NULL);`);
        const upgraded = new CloudReferrals({billing:old,auth:f.auth,store:f.store,secret:f.auth.pepper,origin:f.origin});
        await save(friend);
        upgraded.recordActivity(friend.user.id);
        const rewards = old.db.prepare('SELECT * FROM cloud_referral_rewards WHERE referral_id=? ORDER BY id').all(row.id);
        assert.strictEqual(rewards.length,3);
        assert.strictEqual(rewards.find(r => r.id === 'old-unit').redemption_id,'old-reservation');
        upgraded.recordActivity(friend.user.id);
        assert.strictEqual(old.db.prepare('SELECT COUNT(*) AS n FROM cloud_referral_rewards').get().n,3);
        old.close();
      });
      await testAsync('calendar month grants clamp dates, remain idempotent and start from now after expiry',async() => {
        let now = Date.UTC(2027,0,31,12);
        const billing = createBillingStore({dbPath:':memory:',now:() => now});
        billing.ensurePersonalTrial({userId:'calendar',workspaceId:'calendar'});
        billing.grantPersonalMonths({userId:'calendar',key:'signup',months:1});
        assert.strictEqual(billing.personalTrialAccess('calendar').originalEndsAtMs,Date.UTC(2027,1,28,12));
        assert.strictEqual(billing.personalTrialAccess('calendar').endsAtMs,Date.UTC(2027,2,28,12));
        now=Date.UTC(2028,0,31,12);
        billing.grantPersonalMonths({userId:'calendar',key:'late',months:1});
        assert.strictEqual(billing.personalTrialAccess('calendar').endsAtMs,Date.UTC(2028,1,29,12));
        billing.grantPersonalMonths({userId:'calendar',key:'late',months:1});
        assert.strictEqual(billing.personalTrialAccess('calendar').endsAtMs,Date.UTC(2028,1,29,12));
        billing.close();
      });
    } finally { await f.close(); await stripe.close(); }
  };
};
