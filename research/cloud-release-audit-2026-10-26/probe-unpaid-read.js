'use strict';
const assert=require('assert'),crypto=require('crypto');
const {startFixture}=require('../../test/cloud-onboarding-fixture');
(async()=>{
 const f=await startFixture({singlePlan:true,stripeApiBase:'http://127.0.0.1:1'});
 try{
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
  assert.equal(after.status,200,'Probe expected current unpaid read bypass');
 }finally{await f.close()}
})().catch(error=>{console.error(error);process.exit(1)});
