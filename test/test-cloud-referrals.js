module.exports = function(h) {
  const {assert,testAsync} = h;
  return async function() {
    const stripe=await require('./stripe-referral-fixture').startStripe();
    const f=await require('./cloud-onboarding-fixture').startFixture({singlePlan:true,stripeApiBase:stripe.origin,logErrors:true});
    const referrals=new (require('../lib/cloud-referrals').CloudReferrals)({billing:f.billing,auth:f.auth,store:f.store,secret:f.auth.pepper,origin:f.origin});
    const single=new (require('../lib/cloud-single-plan').SinglePlan)({billing:f.billing,store:f.store});
    let serial=0, friend;
    await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{});
    const joshAccount=single.ownAccount(f.users.josh.id);
    f.billing.upsertSubscription({workspaceId:joshAccount.id,plan:'team',provider:'manual',status:'active'});
    async function api(cookie,path,method='GET',body) {
      const response=await fetch(f.origin+path,{method,headers:{Origin:f.origin,Cookie:cookie||'', 'Content-Type':'application/json'},body:body ? JSON.stringify(body):undefined,redirect:'manual'});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
    }
    async function signup(owner='josh',email) {
      const summary=await f.api(owner,'/api/cloud/v1/referrals');
      const code=new URL(summary.data.url).searchParams.get('ref');
      const address=email||'referral-'+(++serial)+'@new-company.test';
      const challenge=f.auth.issueEmailCode({email:address});
      referrals.rememberIntent(challenge.requestId,code);
      const response=await api('','/api/cloud/auth/email/verify','POST',{challenge_id:challenge.requestId,code:challenge.code});
      assert.strictEqual(response.status,200,JSON.stringify(response));
      const signed=f.auth.signInWithVerifiedEmail(address);
      const user=f.auth.updateUserProfile({userId:signed.user.id,firstName:'Taylor',lastName:'Example'});
      f.auth.acceptCurrentTerms({userId:user.id,termsVersion:require('../lib/cloud-terms').CURRENT_TERMS_VERSION});
      const onboard=await api(response.cookie,'/api/cloud/v1/onboarding/complete','POST',{});
      assert.strictEqual(onboard.status,200,JSON.stringify(onboard));
      return {user,cookie:response.cookie,intentKey:challenge.requestId,workspace:onboard.data.workspaces[0].id};
    }
    async function connect(person) {
      const issued=await api('','/api/cloud/v1/cli/device-authorizations','POST',{display_name:'Laptop'});
      assert.strictEqual(issued.status,201);
      assert.strictEqual((await api(person.cookie,'/api/cloud/v1/cli/device-authorizations/approve','POST',{user_code:issued.data.user_code})).status,200);
      const token=await api('','/api/cloud/v1/cli/device-authorizations/token','POST',{device_code:issued.data.device_code});
      assert.strictEqual(token.status,200,JSON.stringify(token)); return token;
    }
    async function pay(person) {
      const checkout=await api(person.cookie,'/api/cloud/billing/subscribe','POST',{});
      assert.strictEqual(checkout.status,200,JSON.stringify(checkout));
      const session=[...stripe.sessions.values()].find(s=>s.url===checkout.data.checkout_url);
      const subscription=stripe.subscription(session);
      assert.strictEqual((await stripe.webhook(f.origin,'customer.subscription.created',subscription)).status,200);
      const invoice=stripe.invoice(subscription,{reason:'subscription_create',coupon:session.coupon});
      invoice.status='paid'; invoice.amount_paid=invoice.amount_due;
      assert.strictEqual((await stripe.webhook(f.origin,'invoice.paid',invoice)).status,200);
      return {subscription,invoice,session};
    }
    async function earn(userId,count) {
      const code=referrals.link(userId).code;
      const account=single.ownAccount(userId);
      const before=account && f.billing.getSubscription(account.id);
      if (account && (!before || before.status==='canceled')) f.billing.upsertSubscription({workspaceId:account.id,plan:'team',provider:'manual',status:'active'});
      for(let i=0;i<count;i++) {
        const signed=f.auth.signInWithVerifiedEmail('earned-'+(++serial)+'@new-company.test');
        const intentKey='fixture-earned-'+serial;
        referrals.rememberIntent(intentKey,code);
        referrals.attribute({...signed,intentKey});
        f.store.db.prepare('INSERT INTO cloud_document_activation_events VALUES(?,?,?)').run(signed.user.id,'fixture-doc-'+serial,Date.now());
        referrals.installed(signed.user.id);
      }
      if (account && (!before || before.status==='canceled')) f.billing.upsertSubscription({workspaceId:account.id,plan:'team',provider:'manual',status:'canceled'});
    }
    async function document(person) {
      const result=await api(person.cookie,'/api/cloud/v1/account/documents','POST',{
        account_id:person.workspace,filename:'first.md',markdown:'---\ntags: [getting-started]\n---\n# First document',idempotency_key:'first-document'});
      assert.strictEqual(result.status,201,JSON.stringify(result));
      return result;
    }
    try {
      await testAsync('referral links use opaque codes and a private escaped homepage notice',async()=>{
        const summary=await f.api('josh','/api/cloud/v1/referrals');
        assert.strictEqual(summary.status,200);
        assert.match(summary.data.url,/\/home\?ref=[A-Za-z0-9_-]{24}$/);
        assert.ok(!summary.data.url.includes(f.users.josh.id));
        const landing=await fetch(summary.data.url), html=await landing.text();
        assert.ok(html.includes('Josh shared SmallDocs with you.'));
        assert.ok(html.includes('start paying for your own subscription'));
        assert.strictEqual(landing.headers.get('cache-control'),'private, no-store');
        assert.strictEqual(landing.headers.get('set-cookie'),null);
      });
      await testAsync('email signup records one pending referral and installation alone grants no billing credit',async()=>{
        friend=await signup();
        assert.strictEqual(referrals.summary(f.users.josh.id).total_referrals,1);
        await connect(friend); await connect(friend);
        const summary=referrals.summary(f.users.josh.id);
        assert.strictEqual(summary.available_person_months,0);
        assert.strictEqual(summary.referrals[0].status,'installed');
        assert.ok(!JSON.stringify(summary).includes('new-company.test'));
      });
      await testAsync('the first paid monthly invoice awards once and repeated webhooks cannot duplicate it',async()=>{
        await document(friend);
        assert.strictEqual(referrals.summary(f.users.josh.id).available_person_months,1);
        const {invoice}=await pay(friend);
        assert.strictEqual(referrals.summary(f.users.josh.id).available_person_months,3);
        for(let i=0;i<3;i++) assert.strictEqual((await stripe.webhook(f.origin,'invoice.paid',invoice)).status,200);
        assert.strictEqual(referrals.summary(f.users.josh.id).available_person_months,3);
      });
      await testAsync('payment before connection waits for the agent and then awards the referral',async()=>{
        const person=await signup(); await pay(person);
        assert.strictEqual(referrals.summary(f.users.josh.id).available_person_months,3);
        await connect(person);
        assert.strictEqual(referrals.summary(f.users.josh.id).available_person_months,3);
        await document(person);
        assert.strictEqual(referrals.summary(f.users.josh.id).available_person_months,6);
      });
      await testAsync('existing accounts, self referrals and forged signup intents cannot earn a new referral',async()=>{
        const count=referrals.summary(f.users.josh.id).total_referrals;
        referrals.rememberIntent('self-referral',referrals.link(f.users.josh.id).code);
        referrals.attribute({user:f.users.josh,created:true,intentKey:'self-referral'});
        const existing=f.auth.signInWithVerifiedEmail(friend.user.identities[0].verifiedEmail);
        referrals.attribute({...existing,intentKey:friend.intentKey});
        const newUser=f.auth.signInWithVerifiedEmail('forged-'+(++serial)+'@new-company.test');
        referrals.attribute({...newUser,intentKey:friend.intentKey+'forged'});
        referrals.installed(newUser.user.id); referrals.paid(newUser.user.id,'in_invalid');
        assert.strictEqual(referrals.summary(f.users.josh.id).total_referrals,count);
      });
      await testAsync('referral summaries and acknowledgement are scoped to the authenticated person',async()=>{
        const other=await f.api('outsider','/api/cloud/v1/referrals?user_id='+f.users.josh.id);
        assert.strictEqual(other.data.total_referrals,0);
        assert.ok(!JSON.stringify(other.data).includes('Taylor'));
        const summary=await f.api('josh','/api/cloud/v1/referrals');
        assert.ok(summary.data.unread_count>0);
        assert.strictEqual((await f.api('josh','/api/cloud/v1/referrals/seen','POST',{seen_through_ms:summary.data.as_of_ms})).status,200);
        assert.strictEqual((await f.api('josh','/api/cloud/v1/referrals')).data.unread_count,0);
      });
      await testAsync('ten seats and one credit reduce the first invoice by one person-month only',async()=>{
        const person=await signup('bob');
        const account=single.ownAccount(person.user.id);
        // Model ten unique sponsored people without touching real accounts.
        const team=await f.store.createTeamWorkspace({userId:person.user.id,name:'Engineering',projectName:'Documents'});
        single.initialize(person.user.id,team.workspaceId,person.user.identities[0].verifiedEmail);
        for(let i=0;i<9;i++) {
          const member=f.auth.signInWithVerifiedEmail('member-'+(++serial)+'@company.test').user;
          f.store.addWorkspaceMember({actorUserId:person.user.id,workspaceId:team.workspaceId,userId:member.id,role:'member'});
          single.claim(member.id,team.workspaceId);
        }
        assert.strictEqual(single.seatCount(account.id),10);
        await earn(person.user.id,1);
        const {session,invoice}=await pay(person);
        assert.strictEqual(session.quantity,10);
        assert.strictEqual(stripe.coupons.get(session.coupon).amount_off,500);
        assert.strictEqual(invoice.amount_due,4500);
        assert.strictEqual(referrals.summary(person.user.id).used_person_months,1);
      });
      await testAsync('five credits cover five seats before tax and excess credits carry forward',async()=>{
        const person=await signup('bob');
        const team=await f.store.createTeamWorkspace({userId:person.user.id,name:'Research',projectName:'Documents'});
        single.initialize(person.user.id,team.workspaceId,person.user.identities[0].verifiedEmail);
        for(let i=0;i<4;i++) {
          const member=f.auth.signInWithVerifiedEmail('five-'+(++serial)+'@company.test').user;
          f.store.addWorkspaceMember({actorUserId:person.user.id,workspaceId:team.workspaceId,userId:member.id,role:'member'});single.claim(member.id,team.workspaceId);
        }
        await earn(person.user.id,7);
        const paid=await pay(person);
        assert.strictEqual(paid.session.quantity,5);
        assert.strictEqual(paid.invoice.amount_due,0);
        assert.strictEqual(referrals.summary(person.user.id).used_person_months,5);
        assert.strictEqual(referrals.summary(person.user.id).available_person_months,2);
        const renewal=stripe.invoice(paid.subscription,{tax:0.2});
        assert.strictEqual((await stripe.webhook(f.origin,'invoice.created',renewal)).status,200);
        assert.strictEqual(renewal.amount_due,1800);
        assert.strictEqual(referrals.summary(person.user.id).reserved_person_months,2);
        renewal.status='paid';renewal.amount_paid=renewal.amount_due;
        assert.strictEqual((await stripe.webhook(f.origin,'invoice.paid',renewal)).status,200);
        assert.strictEqual(referrals.summary(person.user.id).used_person_months,7);
      });
      await testAsync('lost invoice update responses recover without duplicate discounts or reward use',async()=>{
        const person=friend;
        const account=single.ownAccount(person.user.id);
        await earn(person.user.id,2);
        const subscription=[...stripe.subscriptions.values()].find(s=>s.metadata.workspace_id===account.id);
        const invoice=stripe.invoice(subscription);
        stripe.loseNextInvoiceReply();
        assert.notStrictEqual((await stripe.webhook(f.origin,'invoice.created',invoice)).status,200);
        assert.strictEqual((await stripe.webhook(f.origin,'invoice.created',invoice)).status,200);
        assert.strictEqual(invoice.discounts.length,1);
        invoice.status='paid';invoice.amount_paid=invoice.amount_due;
        await stripe.webhook(f.origin,'invoice.paid',invoice);await stripe.webhook(f.origin,'invoice.paid',invoice);
        assert.strictEqual(referrals.summary(person.user.id).used_person_months,1);
        assert.strictEqual(referrals.summary(person.user.id).available_person_months,1);
      });
      await testAsync('void invoices release reserved credits and cross-account invoices cannot use them',async()=>{
        const account=single.ownAccount(friend.user.id);
        const subscription=[...stripe.subscriptions.values()].find(s=>s.metadata.workspace_id===account.id);
        const invoice=stripe.invoice(subscription);
        await stripe.webhook(f.origin,'invoice.created',invoice);
        assert.strictEqual(referrals.summary(friend.user.id).reserved_person_months,1);
        invoice.status='void'; await stripe.webhook(f.origin,'invoice.voided',invoice);
        assert.strictEqual(referrals.summary(friend.user.id).available_person_months,1);
        const wrong=stripe.invoice(subscription);wrong.customer='cus_someone_else';
        await stripe.webhook(f.origin,'invoice.created',wrong);
        assert.strictEqual(wrong.discounts.length,0);
        assert.strictEqual(referrals.summary(friend.user.id).available_person_months,1);
      });
      await testAsync('signup attribution retries from the auth outbox without breaking authentication',async()=>{
        const signed=f.auth.signInWithVerifiedEmail('retry-attribution@example.test');
        referrals.rememberIntent('retry-attribution',referrals.link(f.users.josh.id).code);
        const attribute=referrals.attribute;
        referrals.attribute=()=>{throw new Error('Temporary billing outage');};
        referrals.recordSignup({...signed,intentKey:'retry-attribution'});
        assert.ok(f.auth.createBrowserSession(signed.user.id).token);
        assert.ok(f.auth.db.prepare('SELECT 1 FROM cloud_referral_signup_outbox WHERE user_id=?').get(signed.user.id));
        referrals.attribute=attribute;
        referrals.recoverSignup(signed.user.id);
        assert.ok(referrals.db.prepare('SELECT 1 FROM cloud_referrals WHERE referred_user_id=?').get(signed.user.id));
        assert.ok(!f.auth.db.prepare('SELECT 1 FROM cloud_referral_signup_outbox WHERE user_id=?').get(signed.user.id));
      });
      await testAsync('simultaneous invoices cannot reserve the same person-month credit twice',async()=>{
        const userId=friend.user.id,accountId=single.ownAccount(userId).id;
        await earn(userId,2);
        const before=referrals.available(userId);
        const rows=await Promise.all(['one','two','three'].map(key=>Promise.resolve().then(()=>referrals.reserve({
          userId,accountId,scope:'invoice',key:'concurrent-'+key,quantity:2,unitAmount:500,currency:'usd',productId:'prod_standard'}))));
        assert.strictEqual(rows.filter(Boolean).reduce((sum,row)=>sum+row.seats,0),before);
        assert.strictEqual(referrals.available(userId),0);
        for(const row of rows.filter(Boolean)) referrals.release(row.scope_key);
        assert.strictEqual(referrals.available(userId),before);
      });
      await testAsync('a reduced invoice consumes only the person-months actually discounted',async()=>{
        const account=single.ownAccount(friend.user.id);
        const subscription=[...stripe.subscriptions.values()].find(s=>s.metadata.workspace_id===account.id);
        await earn(friend.user.id,2);
        const before=referrals.available(friend.user.id);
        const invoice=stripe.invoice(subscription,{quantity:5});
        await stripe.webhook(f.origin,'invoice.created',invoice);
        assert.strictEqual(referrals.balances(friend.user.id).reserved_person_months,5);
        invoice.subtotal=500;invoice.lines.data[0].quantity=1;invoice.lines.data[0].amount=500;stripe.calculate(invoice);
        invoice.status='paid';invoice.amount_paid=invoice.amount_due;
        await stripe.webhook(f.origin,'invoice.paid',invoice);
        assert.strictEqual(referrals.available(friend.user.id),before-1);
        assert.strictEqual(referrals.balances(friend.user.id).reserved_person_months,0);
      });
      await testAsync('recreating a referred email cannot generate another reward',async()=>{
        const person=f.auth.signInWithVerifiedEmail('unique-referral@example.test');
        const code=referrals.link(f.users.josh.id).code;
        referrals.rememberIntent('unique-original',code);referrals.attribute({...person,intentKey:'unique-original'});
        const count=referrals.summary(f.users.josh.id).total_referrals;
        f.auth.db.prepare('DELETE FROM cloud_auth_users WHERE id=?').run(person.user.id);
        const recreated=f.auth.signInWithVerifiedEmail('unique-referral@example.test');
        referrals.rememberIntent('unique-recreated',code);referrals.attribute({...recreated,intentKey:'unique-recreated'});
        referrals.installed(recreated.user.id);referrals.paid(recreated.user.id,'in_recreated');
        assert.strictEqual(referrals.summary(f.users.josh.id).total_referrals,count);
      });
      await testAsync('an authenticated person cannot award credit by posting an unsigned paid invoice',async()=>{
        const before=referrals.balances(f.users.josh.id);
        const calls=stripe.calls.length;
        const forged=await api(friend.cookie,'/api/cloud/billing/stripe/webhook','POST',{
          id:'evt_forged',type:'invoice.paid',data:{object:{id:'in_forged',status:'paid',amount_paid:500}}});
        assert.strictEqual(forged.status,400);
        assert.strictEqual(stripe.calls.length,calls);
        assert.deepStrictEqual(referrals.balances(f.users.josh.id),before);
      });
    } finally { await f.close(); await stripe.close(); }
  };
};
