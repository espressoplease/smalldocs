const { test, expect } = require('@playwright/test');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { startFixture } = require('./cloud-onboarding-fixture');
const { startCaptureServer, decodeMimeParts } = require('./test-email');
const { startStripe } = require('./stripe-referral-fixture');
test.use({ serviceWorkers: 'block' });
let f, mail, stripe, directory;
test.beforeEach(async () => {
  mail=await startCaptureServer(); stripe=await startStripe();
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'sdocs-referral-browser-'));
  const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...keys.publicKey.export({format:'jwk'}),kid:'signup-test',alg:'RS256',use:'sig'};
  const filename=path.join(directory,'keys.json');
  fs.writeFileSync(filename,JSON.stringify({jwk,privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'})}));
  f=await startFixture({singlePlan:true,smtpPort:mail.port,stripeApiBase:stripe.origin,env:{
    GOOGLE_OAUTH_CLIENT_ID:'signup-test-client',GOOGLE_OAUTH_CLIENT_SECRET:'signup-test-secret',
    SDOCS_TEST_GOOGLE_KEYS:filename,NODE_OPTIONS:'--require='+path.join(__dirname,'google-oauth-preload.js'),
  }});
});
test.afterEach(async () => {
  await f.close(); await stripe.close(); await new Promise(resolve=>mail.server.close(resolve));
  fs.rmSync(directory,{recursive:true,force:true});
});

async function openMenu(page,width) {
  if(width<=768) await page.getByRole('button',{name:'Open menu',exact:true}).click();
}

for(const width of [1440,390]) for(const method of ['email','google']) {
  test(method+' referral reaches a usable library, earns activation and payment rewards at '+width,async({page,browser},testInfo)=>{
    await page.setViewportSize({width,height:900});
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.context().addCookies([{name:'sdocs_cloud',value:f.users.josh.sessionToken,url:f.origin}]);
    await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{});
    const account=f.billing.db.prepare('SELECT id FROM cloud_single_accounts WHERE owner_user_id=?').get(f.users.josh.id);
    f.billing.upsertSubscription({workspaceId:account.id,plan:'team',provider:'manual',status:'active'});
    await page.goto(f.origin+'/library?scope=cloud');
    await openMenu(page,width);
    await page.getByRole('button',{name:'Refer',exact:true}).click();
    const link=page.getByRole('textbox',{name:'Your referral link'});
    await expect(link).toHaveValue(/\/home\?ref=[A-Za-z0-9_-]{24}$/);
    const referralUrl=await link.inputValue();
    await page.getByRole('button',{name:'Copy link',exact:true}).click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(referralUrl);
    await expect(page.locator('[data-referral-status]')).toHaveText('Link copied.');
    const guest=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    try {
      const signup=await guest.newPage();
      if(method==='google') await signup.route('**/api/cloud/auth/oauth/google?*',async route=>{
        const begun=await route.fetch({maxRedirects:0});
        const request=new URL(begun.headers().location);
        const callback=new URL(request.searchParams.get('redirect_uri'));
        callback.searchParams.set('state',request.searchParams.get('state'));
        callback.searchParams.set('code',Buffer.from(JSON.stringify({email:'referred-google@gmail.com',first:'Robin',last:'Walker',nonce:request.searchParams.get('nonce')})).toString('base64url'));
        await route.fulfill({response:begun,headers:{...begun.headers(),location:callback.href},body:''});
      });
      await signup.goto(referralUrl);
      await expect(signup.locator('.homepage-referral')).toContainText('Josh shared SmallDocs with you.');
      await expect(signup.locator('.homepage-referral')).toContainText('start paying for your own subscription');
      expect((await guest.cookies()).some(cookie=>cookie.name.includes('referral'))).toBe(false);
      if(method==='email') {
        const form=signup.locator('[data-install-form]').first();
        await form.locator('input').fill('referred-email@example.test');
        await form.getByRole('button',{name:'Get install prompt'}).click();
        await expect(signup.locator('#code-view')).toBeVisible();
        await expect.poll(()=>mail.messages.length).toBe(1);
        const text=decodeMimeParts(mail.messages[0]).map(part=>part.body).join('\n');
        await signup.locator('#code').fill(text.match(/\b\d{6}\b/)[0]);
        await signup.locator('#code-form').getByRole('button').click();
      } else await signup.locator('.homepage-google').first().click();
      await expect(signup).toHaveURL(/cloud\/terms/);
      await signup.getByRole('checkbox').check();
      await signup.getByRole('button',{name:/accept|continue/i}).click();
      if(method==='email') {
        await expect(signup).toHaveURL(/cloud\/profile/);
        await signup.getByLabel('First name').fill('Robin');await signup.getByLabel('Last name').fill('Walker');
        await signup.getByRole('button',{name:'Continue',exact:true}).click();
      }
      await expect(signup).toHaveURL(/cloud\/admin\?panel=install/);
      await expect(signup.locator('#install-prompt')).toContainText('Create one short getting-started document');
      const headers={Origin:f.origin};
      const issued=await signup.request.post(f.origin+'/api/cloud/v1/cli/device-authorizations',{data:{display_name:'Laptop'}});
      const issuedData=await issued.json();expect(issued.status()).toBe(201);
      const approved=await signup.request.post(f.origin+'/api/cloud/v1/cli/device-authorizations/approve',{headers,data:{user_code:issuedData.user_code}});
      expect(approved.status()).toBe(200);
      const token=await signup.request.post(f.origin+'/api/cloud/v1/cli/device-authorizations/token',{data:{device_code:issuedData.device_code}});
      const credentials=await token.json();expect(token.status()).toBe(200);
      const created=await signup.request.post(f.origin+'/api/cloud/v1/account/documents',{headers:{Authorization:'Bearer '+credentials.access_token},data:{
        filename:'first-document.md',markdown:'---\ntags:\n  - getting-started\n---\n# First document\n\nSaved from my connected agent.',idempotency_key:'first-referred-document'}});
      expect(created.status()).toBe(201);
      const saved=await created.json();expect(saved.document.tags).toContain('getting-started');
      expect((await f.api('josh','/api/cloud/v1/documents/'+saved.document.id)).status).toBe(404);
      const ownerSummary=await f.api('josh','/api/cloud/v1/referrals');
      expect(ownerSummary.data.available_person_months).toBe(1);
      expect(ownerSummary.data.referrals[0].status).toBe('activated');
      expect(JSON.stringify(ownerSummary.data)).not.toContain('getting-started');
      const checkout=await signup.request.post(f.origin+'/api/cloud/billing/subscribe',{headers,data:{}});
      expect(checkout.status()).toBe(200);
      const checkoutData=await checkout.json();
      const session=[...stripe.sessions.values()].find(s=>s.url===checkoutData.checkout_url);
      const subscription=stripe.subscription(session);
      expect((await stripe.webhook(f.origin,'customer.subscription.created',subscription)).status).toBe(200);
      const invoice=stripe.invoice(subscription,{reason:'subscription_create'});invoice.status='paid';invoice.amount_paid=invoice.amount_due;
      expect((await stripe.webhook(f.origin,'invoice.paid',invoice)).status).toBe(200);
      expect((await stripe.webhook(f.origin,'invoice.paid',invoice)).status).toBe(200);
      await page.reload();await openMenu(page,width);
      expect(await page.locator('[data-sidebar-section]').evaluateAll(sections =>
        sections.map(section => section.dataset.sidebarSection))).toEqual(['learn', 'security', 'feedback', 'refer']);
      await page.getByRole('button',{name:/^Refer(?:\s|$)/}).click();
      await expect(page.locator('[data-referral-balance]')).toHaveText('3 person-months available.');
      await page.getByRole('button',{name:/^Referrals(?:\s|$)/}).click();
      await page.locator('.sdocs-sidebar-referral-history').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
      await expect(page.getByRole('list',{name:'People you referred'})).toContainText('Robin Walker');
      await expect(page.getByRole('list',{name:'People you referred'})).toBeVisible();
      expect((await page.locator('.sdocs-referral-history-toggle').boundingBox()).height).toBe(32);
      expect((await page.locator('.sdocs-referral-history-toggle svg').boundingBox()).width).toBe(13);
      await expect(page.getByRole('list',{name:'People you referred'})).toContainText('3 person-months earned');
      await expect(page.locator('[data-sidebar-section="refer"] > .sdocs-sidebar-top-row .sdocs-sidebar-count')).toBeHidden();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath('refer.png')});
      await page.getByRole('button',{name:'Learn',exact:true}).click();
      const beforeLearn = page.url();
      await page.getByRole('button',{name:'Getting started',exact:true}).click();
      await expect(page.locator('[data-learn-status]')).toContainText('prompt copied. Paste it into your agent');
      expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('Make a getting-started document');
      await expect(page).toHaveURL(beforeLearn);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    } finally { await guest.close(); }
  });
}

test('unknown and hostile referral parameters do not disclose identities, track visitors or break signup',async({page})=>{
  await page.goto(f.origin+'/home?ref='+encodeURIComponent('<img src=x onerror=alert(1)>'));
  await expect(page.locator('.homepage-referral')).toHaveCount(0);
  expect((await page.context().cookies()).some(cookie=>cookie.name.includes('referral'))).toBe(false);
  await expect(page.locator('[data-install-form]').first()).toBeVisible();
  await f.auth.updateUserProfile({userId:f.users.josh.id,firstName:'<script>alert(1)</script>',lastName:'Example'});
  const summary=await f.api('josh','/api/cloud/v1/referrals');
  await page.goto(summary.data.url);
  await expect(page.locator('.homepage-referral script')).toHaveCount(0);
  await expect(page.locator('.homepage-referral')).toContainText('<script>alert(1)</script>');
});

for (const width of [1440,390]) test('unpaid referrer sees extended access in Refer and subscription at '+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.context().addCookies([{name:'sdocs_cloud',value:f.users.josh.sessionToken,url:f.origin}]);
  await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{});
  const {CloudReferrals}=require('../lib/cloud-referrals');
  const referrals=new CloudReferrals({billing:f.billing,auth:f.auth,store:f.store,secret:f.auth.pepper,origin:f.origin});
  const signed=f.auth.signInWithVerifiedEmail('new-friend@example.test');
  f.auth.updateUserProfile({userId:signed.user.id,firstName:'Robin',lastName:'Walker'});
  const key='browser-free-access';
  referrals.rememberIntent(key,referrals.link(f.users.josh.id).code);
  referrals.attribute({...signed,intentKey:key});
  f.auth.acceptCurrentTerms({userId:signed.user.id,termsVersion:require('../lib/cloud-terms').CURRENT_TERMS_VERSION});
  const personal=await f.store.ensurePersonalWorkspace(signed.user.id);
  const single=new (require('../lib/cloud-single-plan').SinglePlan)({billing:f.billing,store:f.store});
  single.initialize(signed.user.id,personal.workspaceId,'new-friend@example.test');
  const projects=await f.store.listProjects(signed.user.id,personal.workspaceId);
  await f.store.createDocument({userId:signed.user.id,projectId:projects[0].id,filename:'first.md',
    markdown:'---\ntags: [getting-started]\n---\n# First document',idempotencyKey:'browser-free-first-document'});
  referrals.installed(signed.user.id);
  await page.goto(f.origin+'/library?scope=cloud');
  await openMenu(page,width);
  await page.getByRole('button',{name:/^Refer(?:\s|$)/}).click();
  await expect(page.locator('[data-referral-balance]')).toContainText('1 earned month added to your free access.');
  await expect(page.locator('[data-referral-balance]')).toContainText('Personal free-access deadline:');
  await page.getByRole('button',{name:/^Referrals(?:\s|$)/}).click();
  await expect(page.getByRole('list',{name:'People you referred'})).toContainText('1 month earned, 2 more when they start paying for their own subscription');
  await page.goto(f.origin+'/cloud/subscribe');
  await expect(page.locator('#subscription-state')).toContainText('Your free trial ends on');
  await expect(page.locator('#subscription-referral-access')).toContainText('Referral benefits added personal free access through');
  await expect(page.locator('#subscription-referral-credit')).toBeHidden();
  await expect(page.getByRole('button',{name:'Subscribe',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
