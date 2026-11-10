// Disposable Stripe transport and real application routes. No real payments.
'use strict';
const assert = require('assert'), http = require('http'), crypto = require('crypto');
const { startFixture } = require('../../test/cloud-onboarding-fixture');
(async () => {
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
 const f = await startFixture({singlePlan:true,jobs:true,stripeApiBase:'http://127.0.0.1:'+mock.address().port});
 const single = new (require('../../lib/cloud-single-plan').SinglePlan)({billing:f.billing,store:f.store});
 try {
  const library=(await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{})).data.workspaces[0].id;
  const checkout=await f.api('josh','/api/cloud/billing/subscribe','POST',{});assert.equal(checkout.status,200);
  const session=sessions[0];assert.equal(session.params['line_items[0][quantity]'],'1');
  const invite=await f.store.createInvitation({userId:f.users.josh.id,workspaceId:library,email:f.users.gmail.email,role:'member'});
  const accept=await f.api('gmail','/api/cloud/v1/invitations/'+invite.token+'/accept','POST',{});assert.equal(accept.status,200,JSON.stringify(accept.data));
  // A seat-sync job can run before payment and finish without a Stripe subscription.
  const jobs=require('../../lib/cloud-jobs').createCloudJobs({dbPath:require('path').join(f.dir,'jobs.db')});
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
   console.log(JSON.stringify(result));assert.equal(result.expected_seats,2);assert.equal(result.provider_quantity,1);
   const failedRaw=JSON.stringify({id:'evt_audit_failed',type:'customer.subscription.updated',created:now+2,data:{object:{...sub,status:'past_due'}}});
   const failedSig=crypto.createHmac('sha256','whsec_fixture').update(now+'.'+failedRaw).digest('hex');
   const failedWebhook=await fetch(f.origin+'/api/cloud/billing/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'t='+now+',v1='+failedSig},body:failedRaw});assert.equal(failedWebhook.status,200);
   const failedSummary=await f.api('josh','/api/cloud/billing/subscription');
   const billingEmails=jobs.db.prepare("SELECT COUNT(*) AS n FROM cloud_jobs WHERE type='billing_state_email'").get().n;
   console.log(JSON.stringify({case:'failed_payment_notice',subscription_status:failedSummary.data.subscription_status,phase:failedSummary.data.phase,
    notices:failedSummary.data.notices,grace_deadline_in_summary:failedSummary.data.grace_ends_at_ms||null,smallDocs_billing_email_jobs:billingEmails}));
   assert.equal(failedSummary.data.subscription_status,'past_due');assert.deepEqual(failedSummary.data.notices,[]);assert.equal(billingEmails,0);

  }finally{jobs.close()}
 }finally{await f.close();await new Promise(resolve=>mock.close(resolve))}
})().catch(error=>{console.error(error);process.exit(1)});
