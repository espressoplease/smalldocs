'use strict';
module.exports = h => async function () {
{
const assert=require('assert'),crypto=require('crypto');
const {startFixture}=require('../test/cloud-onboarding-fixture');
await h.testAsync('an incomplete first payment preserves the original trial paywall', async()=>{
 const f=await startFixture({singlePlan:true,stripeApiBase:'http://127.0.0.1:1'});
 try{
  const home = await (await fetch(f.origin + '/')).text();
  assert.ok(home.includes('homepage-signup-divider'));
  assert.ok(home.includes('/cloud/sign-in?return='));
  const id=(await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{})).data.workspaces[0].id;
  const saved=await f.api('josh','/api/cloud/v1/account/documents','POST',{account_id:id,filename:'unpaid.md',markdown:'# Private saved content',tags:['audit'],idempotency_key:'unpaid-doc'});assert.equal(saved.status,201);
  f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now()-8*86400000,f.users.josh.id);
  const path='/api/cloud/v1/documents/'+saved.data.document.id;
  const before=await f.api('josh',path);assert.equal(before.status,402);
  const now=Math.floor(Date.now()/1000),sub={id:'sub_unpaid_audit',created:now,status:'incomplete',customer:'cus_unpaid_audit',
   metadata:{workspace_id:id,plan:'team',single_plan:'true',owner_user_id:f.users.josh.id},
   items:{data:[{id:'si_unpaid',price:{id:'price_standard'},quantity:1,current_period_end:now+2592000}]}};
  const raw=JSON.stringify({id:'evt_unpaid_audit',type:'customer.subscription.created',created:now,data:{object:sub}});
  const sig=crypto.createHmac('sha256','whsec_fixture').update(now+'.'+raw).digest('hex');
  const event=await fetch(f.origin+'/api/cloud/billing/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'t='+now+',v1='+sig},body:raw});assert.equal(event.status,200);
  const after=await f.api('josh',path),state=await f.api('josh','/api/cloud/billing/subscription');
  console.log(JSON.stringify({case:'unpaid_incomplete_subscription_after_trial',before_status:before.status,after_status:after.status,
   markdown_returned:Boolean(after.data.document&&after.data.document.markdown),subscription_status:state.data.subscription_status,phase:state.data.phase}));
  assert.equal(after.status,402);assert.equal(state.data.phase,'payment_required');assert.equal(Boolean(after.data.document),false);
  f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now()+86400000,f.users.josh.id);
  assert.equal((await f.api('josh',path)).status,200,'An incomplete checkout does not shorten an active free trial');
  assert.equal((await f.api('josh','/api/cloud/billing/subscription')).data.phase,'trial');
  f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now()-8*86400000,f.users.josh.id);
  for (const [index,status] of ['incomplete_expired','active','canceled'].entries()) {
   const body=JSON.stringify({id:'evt_unpaid_transition_'+index,type:'customer.subscription.updated',created:now+index+1,data:{object:{...sub,status}}});
   const signature=crypto.createHmac('sha256','whsec_fixture').update(now+'.'+body).digest('hex');
   assert.equal((await fetch(f.origin+'/api/cloud/billing/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'t='+now+',v1='+signature},body})).status,200);
   assert.equal((await f.api('josh',path)).status,index===0?402:200);
   if (index===0) {
    const single = new (require('../lib/cloud-single-plan').SinglePlan)({billing:f.billing,store:f.store});
    const retry = await single.checkout({userId:f.users.josh.id,priceId:'price_standard',origin:f.origin,email:f.users.josh.email,
      stripe:{createCheckoutSubscriptionSession:async()=>({id:'cs_retry',url:'https://checkout.test/retry'})}});
    assert.equal(retry.id,'cs_retry');
   }
  }
  assert.equal(f.billing.computeEntitlements(id).access.write,false);
  f.billing.upsertSubscription({workspaceId:'no-trial',plan:'team',status:'read_only',provider:'stripe',initialPaymentPending:true});
  assert.equal(f.billing.computeEntitlements('no-trial').effectiveStatus,'payment_required');

 }finally{await f.close()}
});
}
{
const assert = require('assert'), http = require('http'), crypto = require('crypto');
const { startFixture } = require('../test/cloud-onboarding-fixture');
await h.testAsync('checkout reconciles intervening members and publishes payment notices without deletion jobs', async () => {
 const sessions = [], subscriptions = new Map(), updates = [];
 const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const params = new URLSearchParams(body);
  const send = data => { res.writeHead(200, {'Content-Type':'application/json'});res.end(JSON.stringify(data)); };
  if (req.url === '/v1/checkout/sessions') {
   const session = {id:'cs_audit_'+sessions.length,status:'open',url:'https://checkout.test/'+sessions.length,params:Object.fromEntries(params)};
   sessions.push(session);return send(session);
  }
  if (req.url.startsWith('/v1/subscriptions/')) return send(subscriptions.get(req.url.split('/')[3]));
  if (req.url.startsWith('/v1/subscription_items/')) {
   updates.push(Number(params.get('quantity')));
   for (const sub of subscriptions.values()) if(sub.items.data[0].id===req.url.split('/')[3])sub.items.data[0].quantity=Number(params.get('quantity'));
   return send({id:req.url.split('/')[3],quantity:Number(params.get('quantity'))});
  }
  res.writeHead(404);res.end('{}');
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const mail = await require('./test-email').startCaptureServer();
 const f = await startFixture({singlePlan:true,jobs:true,smtpPort:mail.port,stripeApiBase:'http://127.0.0.1:'+mock.address().port});
 const single = new (require('../lib/cloud-single-plan').SinglePlan)({billing:f.billing,store:f.store});
 try {
  const library=(await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{})).data.workspaces[0].id;
  const checkout=await f.api('josh','/api/cloud/billing/subscribe','POST',{});assert.equal(checkout.status,200);
  const session=sessions[0];assert.equal(session.params['line_items[0][quantity]'],'1');
  const invite=await f.store.createInvitation({userId:f.users.josh.id,workspaceId:library,email:f.users.gmail.email,role:'member'});
  const accept=await f.api('gmail','/api/cloud/v1/invitations/'+invite.token+'/accept','POST',{});assert.equal(accept.status,200,JSON.stringify(accept.data));
  // A seat-sync job can run before payment and finish without a Stripe subscription.
  const jobs=require('../lib/cloud-jobs').createCloudJobs({dbPath:require('path').join(f.dir,'jobs.db')});
  try {
   for(let n=0;n<100;n++) {
    const rows=jobs.db.prepare("SELECT state FROM cloud_jobs WHERE type='team_seat_sync'").all();
    if(rows.length&&rows.every(row=>row.state==='complete'))break;
    await new Promise(resolve=>setTimeout(resolve,25));
   }
   const metadata={};for(const [key,value]of Object.entries(session.params)){
    const m=key.match(/^subscription_data\[metadata\]\[([^\]]+)\]$/);if(m)metadata[m[1]]=value;
   }
   const sub={id:'sub_audit',status:'active',created:Math.floor(Date.now()/1000),customer:'cus_audit',metadata,
    items:{data:[{id:'si_audit',price:{id:'price_standard'},quantity:1,current_period_end:Math.floor(Date.now()/1000)+2592000}]}};
   subscriptions.set(sub.id,sub);
   const now=Math.floor(Date.now()/1000),raw=JSON.stringify({id:'evt_audit_paid',type:'customer.subscription.created',created:now,data:{object:sub}});
   const sig=crypto.createHmac('sha256','whsec_fixture').update(now+'.'+raw).digest('hex');
   const webhook=await fetch(f.origin+'/api/cloud/billing/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'t='+now+',v1='+sig},body:raw});assert.equal(webhook.status,200);
   await new Promise(resolve=>setTimeout(resolve,600));
   const memberStatus=await f.api('gmail','/api/cloud/billing/subscription');
   const row=jobs.db.prepare("SELECT COUNT(*) AS n FROM cloud_jobs WHERE type='team_seat_sync' AND state='queued'").get();
   const result={case:'member_joins_while_checkout_open',expected_seats:single.seatCount(library),provider_quantity:sub.items.data[0].quantity,
    local_quantity:f.billing.getSubscription(library).seatQuantity,member_covered:memberStatus.data.covered_elsewhere,seat_update_requests:updates.length,pending_seat_sync_jobs:row.n};
   console.log(JSON.stringify(result));assert.equal(result.expected_seats,2);assert.equal(result.provider_quantity,2);assert.equal(result.local_quantity,2);
   const failedRaw=JSON.stringify({id:'evt_audit_failed',type:'customer.subscription.updated',created:now+2,data:{object:{...sub,status:'past_due'}}});
   const failedSig=crypto.createHmac('sha256','whsec_fixture').update(now+'.'+failedRaw).digest('hex');
   const failedWebhook=await fetch(f.origin+'/api/cloud/billing/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'t='+now+',v1='+failedSig},body:failedRaw});assert.equal(failedWebhook.status,200);
   const failedSummary=await f.api('josh','/api/cloud/billing/subscription');
   const billingEmails=jobs.db.prepare("SELECT COUNT(*) AS n FROM cloud_jobs WHERE type='billing_state_email'").get().n;
   console.log(JSON.stringify({case:'failed_payment_notice',subscription_status:failedSummary.data.subscription_status,phase:failedSummary.data.phase,
    notices:failedSummary.data.notices,grace_deadline_in_summary:failedSummary.data.grace_ends_at_ms||null,smallDocs_billing_email_jobs:billingEmails}));
   assert.equal(failedSummary.data.subscription_status,'past_due');assert.equal(failedSummary.data.phase,'past_due_grace');assert.equal(failedSummary.data.notices[0].code,'payment_failed');assert.ok(failedSummary.data.grace_ends_at_ms > Date.now());assert.ok(billingEmails >= 2);assert.equal(jobs.db.prepare("SELECT COUNT(*) n FROM cloud_jobs WHERE type='billing_retention_expire'").get().n,0);assert.equal(f.billing.getSubscription(library).retentionEndsAtMs,null);
   for (let n=0;n<100 && !mail.messages.some(message=>require('./test-email').decodeMimeParts(message).some(part=>part.body.includes('We could not collect payment')));n++) await new Promise(resolve=>setTimeout(resolve,25));
   assert.ok(mail.messages.some(message=>require('./test-email').decodeMimeParts(message).some(part=>part.body.includes('We could not collect payment'))), 'Payment failure email reaches the local capture inbox');
   const text = mail.messages.flatMap(message=>require('./test-email').decodeMimeParts(message)).map(part=>part.body).join('\n');
   assert.ok(text.includes('Your Cloud documents are retained.'));
   assert.ok(!text.includes('permanently deleted') && !text.includes('scheduled deletion'));

  }finally{jobs.close()}
 }finally{await f.close();await new Promise(resolve=>mock.close(resolve));await new Promise(resolve=>mail.server.close(resolve))}
});
}
};
