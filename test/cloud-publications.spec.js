const {test,expect}=require('@playwright/test');
const {startFixture}=require('./cloud-onboarding-fixture');
test.use({serviceWorkers:'block'});
let f,doc;
const original='---\ntitle: A small clearing\ntags:\n  - writing\n---\n# A small clearing\n\nA place to gather a thought before sharing it.\n\n## What belongs here\n\nPrivate drafts can become public pages when they are ready.\n\n| Stage | Audience |\n| --- | --- |\n| Draft | Your library |\n| Published | Anyone |\n\n## Next steps\n\nKeep writing, then update the public page.';
test.beforeEach(async()=>{
  f=await startFixture({singlePlan:true});
  const onboard=await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{});
  const workspace=onboard.data.workspaces.find(w=>w.kind==='personal');
  const saved=await f.api('josh','/api/cloud/v1/account/documents','POST',{
    account_id:workspace.id,filename:'a-small-clearing.md',markdown:original,idempotency_key:'first-document'});
  expect(saved.status).toBe(201);doc=saved.data.document;
});
test.afterEach(async()=>{await f.close();});
async function open(page,width=1440){
  await page.setViewportSize({width,height:1000});
  await page.context().addCookies([{name:'sdocs_cloud',value:f.users.josh.sessionToken,url:f.origin}]);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto(f.origin+'/docs?cloud-document='+doc.id);
  await expect(page.getByRole('button',{name:'Publish publicly',exact:true})).toBeEnabled();
}
async function publish(page){
  await page.getByRole('button',{name:'Publish publicly',exact:true}).click();
  const row=page.locator('[data-key="publicUrl"]');await expect(row).toBeVisible();
  await expect(page.getByRole('button',{name:'Public page up to date'})).toBeDisabled();
  return row.locator('.fic-value').innerText();
}
async function update(markdown,key='edit-document'){
  const head=(await f.api('josh','/api/cloud/v1/documents/'+doc.id+'/head')).data.document.current_revision_id;
  const saved=await f.api('josh','/api/cloud/v1/documents/'+doc.id+'/revisions','POST',{
    markdown,filename:'a-small-clearing.md',expected_head_revision_id:head,idempotency_key:key});
  expect(saved.status).toBe(201);return saved.data.document;
}
for(const width of [1440,390]) test('Share reveals private and public URL rows with aligned copy icons at '+width,async({page,browser},testInfo)=>{
  await open(page,width);
  await expect(page.locator('[data-key="shortUrl"],[data-key="publicUrl"]')).toHaveCount(0);
  await expect(page.locator('.fic-row-share .fic-label')).toHaveText('Share');
  await expect(page.getByRole('link',{name:'Learn about private links'})).toHaveAttribute('href','/docs#sec=short-links');
  await expect(page.getByRole('link',{name:'Learn about public pages'})).toHaveAttribute('href','/docs#sec=public-pages');
  await page.getByRole('button',{name:'Create private link',exact:true}).click();
  const privateRow=page.locator('[data-key="shortUrl"]');await expect(privateRow).toBeVisible();
  await expect(privateRow.locator('.fic-label')).toHaveText('Private URL');
  const privateUrl=await privateRow.locator('.fic-value').innerText();expect(privateUrl).toContain('#k=');
  await privateRow.locator('.fic-copy').click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(privateUrl);
  const publicUrl=await publish(page);expect(publicUrl).toContain('/p/a-small-clearing-');
  const publicRow=page.locator('[data-key="publicUrl"]');
  await publicRow.locator('.fic-copy').click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(publicUrl);
  await page.locator('#_sd_sdocs-file-info').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
  await expect(publicRow.locator('.fic-copy svg rect')).toBeVisible();
  const a=await privateRow.locator('.fic-copy').boundingBox(),b=await publicRow.locator('.fic-copy').boundingBox();
  expect(Math.abs(a.x+a.width-b.x-b.width)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const guest=await browser.newContext({javaScriptEnabled:false});
  try {
    const reader=await guest.newPage();const response=await reader.goto(publicUrl);
    expect(response.status()).toBe(200);await expect(reader.getByRole('heading',{name:'A small clearing',exact:true})).toBeVisible();
    await expect(reader.getByRole('table')).toContainText('Published');
    expect((await response.text())).not.toContain(doc.id);
  } finally{await guest.close();}
  await page.screenshot({path:testInfo.outputPath('share-'+width+'.png'),fullPage:false});
});
test('Cloud edits update the action while the published page and URL stay unchanged until Update',async({page,request})=>{
  await open(page);const url=await publish(page);
  await update(original.replace('Keep writing','Keep exploring'));
  await page.evaluate(()=>SDocs.checkCloudNow());
  await expect(page.getByRole('button',{name:'Update public page',exact:true})).toBeEnabled();
  expect(await (await request.get(url)).text()).toContain('Keep writing');
  await page.getByRole('button',{name:'Update public page',exact:true}).click();
  await expect(page.getByRole('button',{name:'Public page up to date'})).toBeDisabled();
  await expect(page.locator('[data-key="publicUrl"] .fic-value')).toHaveText(url);
  expect(await (await request.get(url)).text()).toContain('Keep exploring');
  await page.reload();await expect(page.locator('[data-key="publicUrl"] .fic-value')).toHaveText(url);
  await expect(page.getByRole('button',{name:'Public page up to date'})).toBeDisabled();
});
test('private comment changes and a viewer theme do not require updating the public page',async({page})=>{
  await open(page);await publish(page);
  const comments=require('../lib/cloud-comments');
  const withComment=comments.write(comments.snapshot(original),[{id:'c1',kind:'inline',quote:'A place to gather',text:'Private feedback',author:'Josh'}]);
  expect(comments.snapshot(withComment).comments).toHaveLength(1);
  await update(withComment);
  await page.evaluate(()=>SDocs.checkCloudNow());
  await expect(page.getByRole('button',{name:'Public page up to date'})).toBeDisabled();
  await page.evaluate(()=>SDocs.syncAll('theme'));
  await expect(page.getByRole('button',{name:'Public page up to date'})).toBeDisabled();
});
test('Unpublish removes the URL row and public body, republishing reuses the same URL',async({page,request})=>{
  await open(page);const url=await publish(page);
  await page.getByRole('button',{name:'Manage public page'}).click();
  await expect(page.locator('[data-cloud-panel-title]')).toHaveText('Public page');
  await page.getByRole('button',{name:'Unpublish',exact:true}).click();
  await expect(page.locator('[data-key="publicUrl"]')).toHaveCount(0);
  const gone=await request.get(url);expect([404,410]).toContain(gone.status());expect(await gone.text()).not.toContain('A place to gather');
  await page.getByRole('button',{name:'Close Cloud panel'}).click();
  await expect(page.getByRole('button',{name:'Publish publicly',exact:true})).toBeEnabled();
  expect(await publish(page)).toBe(url);
});
test('a lost publication response reports uncertainty and recovers the published link on refresh',async({page})=>{
  await open(page);
  await page.route('**/api/cloud/v1/documents/*/publication',async route=>{
    if(route.request().method()==='POST'){await route.fetch();await route.abort('failed');}
    else await route.continue();
  });
  await page.getByRole('button',{name:'Publish publicly',exact:true}).click();
  await expect(page.locator('.fic-shorten-error')).toContainText('Publishing could not be confirmed');
  await page.getByRole('button',{name:'Retry publishing details'}).click();
  await expect(page.locator('[data-key="publicUrl"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Public page up to date'})).toBeDisabled();
});
test('a blocked Cloud save cannot publish the older saved version',async({page,request})=>{
  await open(page);const url=await publish(page);
  let posts=0;
  await page.route('**/api/cloud/v1/documents/*/publication',async route=>{if(route.request().method()==='POST')posts++;await route.continue();});
  await page.evaluate(()=>{
    SDocs.currentBody+='\n\nAn unsaved addition.';SDocs.syncAll('write');
    SDocs.saveCloudNow=async()=>null;
  });
  await page.getByRole('button',{name:'Update public page',exact:true}).click();
  await expect(page.locator('.fic-shorten-error')).toContainText('Save your latest edits to Cloud');
  expect(posts).toBe(0);expect(await (await request.get(url)).text()).not.toContain('An unsaved addition');
});

test('refreshing publication details does not hide unsaved changes',async({page})=>{
  await open(page);await publish(page);
  await page.evaluate(async()=>{
    SDocs.currentBody+='\n\nA new thought.';
    SDocs.renderFileInfoCard();
    await SDocs.publications.refresh();
  });
  await expect(page.getByRole('button',{name:'Update public page',exact:true})).toBeEnabled();
});

test('a delayed private-link upload does not advertise an old copy as the changed document',async({page})=>{
  await open(page);
  let release,intercepted;
  const gate=new Promise(resolve=>{release=resolve;}),arrival=new Promise(resolve=>{intercepted=resolve;});
  await page.route('**/api/short',async route=>{intercepted();await gate;await route.continue();});
  await page.getByRole('button',{name:'Create private link',exact:true}).click();await arrival;
  await page.evaluate(()=>{SDocs.currentBody+='\n\nA later sentence.';SDocs.renderFileInfoCard();});
  release();
  await expect(page.getByRole('button',{name:'Create new private link',exact:true})).toBeEnabled();
  await expect(page.locator('[data-key="shortUrl"]')).toHaveCount(0);
});
