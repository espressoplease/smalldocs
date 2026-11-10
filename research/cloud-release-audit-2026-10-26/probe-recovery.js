// Headless browser recovery and linked-email probes on disposable data.
'use strict';
const assert=require('assert'),{chromium}=require('playwright');
const {startFixture}=require('../../test/cloud-onboarding-fixture');
(async()=>{
 const f=await startFixture({singlePlan:true});const browser=await chromium.launch({headless:true});
 try{
  await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{});
  f.auth.db.prepare('UPDATE cloud_auth_sessions SET created_at_ms=? WHERE user_id=?').run(Date.now()-31*60000,f.users.josh.id);
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.addCookies([{name:'sdocs_cloud',value:f.users.josh.sessionToken,url:f.origin}]);
  const page=await context.newPage();await page.goto(f.origin+'/cloud/subscribe');
  await page.getByRole('button',{name:'Subscribe',exact:true}).waitFor();
  await page.getByRole('button',{name:'Subscribe',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('subscribe-status').textContent.includes('Sign in again'));
  const recovery=await page.evaluate(()=>({message:document.getElementById('subscribe-status').textContent,
   sign_in_links:[...document.querySelectorAll('a')].filter(a=>new URL(a.href).pathname==='/cloud/sign-in').length}));
  console.log(JSON.stringify({case:'checkout_after_31_minutes',...recovery}));assert.equal(recovery.sign_in_links,0);
  f.auth._insertIdentity(f.users.gmail.id,{provider:'email',subject:'linked-worker@joes.com',verifiedEmail:'linked-worker@joes.com'},Date.now());
  const onboarding=await f.api('gmail','/api/cloud/v1/onboarding');
  const join=await f.api('gmail','/api/cloud/v1/join-requests','POST',{consented:true,note:'Join using verified work email'});
  console.log(JSON.stringify({case:'gmail_plus_verified_work_email',verified_email_count:f.auth.getUser(f.users.gmail.id).identities.length,
   company_domain:onboarding.data.company_domain,join_status:join.status,error:join.data.error}));assert.equal(onboarding.data.company_domain,null);assert.equal(join.status,400);
 }finally{await browser.close();await f.close()}
})().catch(error=>{console.error(error);process.exit(1)});
