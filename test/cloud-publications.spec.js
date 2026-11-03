const {test,expect}=require('@playwright/test');
const {startFixture}=require('./cloud-onboarding-fixture');
test.use({serviceWorkers:'block'});
let f,doc;
const original='---\ntitle: A small clearing\ntags:\n  - writing\n---\n# A small clearing\n\nA place to gather a thought before sharing it.\n\n## What belongs here\n\nPrivate drafts can become public pages when they are ready.\n\n| Stage | Audience |\n| --- | --- |\n| Draft | Your library |\n| Published | Anyone |\n\n## Next steps\n\nKeep writing, then update the public page.';
test.beforeEach(async()=>{
  f=await startFixture({singlePlan:true,compilePublications:true});
  const onboard=await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{});
  const workspace=onboard.data.workspaces.find(w=>w.kind==='personal');
  const saved=await f.api('josh','/api/cloud/v1/account/documents','POST',{
    account_id:workspace.id,filename:'a-small-clearing.md',markdown:original,idempotency_key:'first-document'});
  expect(saved.status).toBe(201);doc=saved.data.document;
});
test.afterEach(async()=>{await f.close();});
async function open(page,width=1440,expand=true){
  await page.setViewportSize({width,height:1000});
  await page.context().addCookies([{name:'sdocs_cloud',value:f.users.josh.sessionToken,url:f.origin}]);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto(f.origin+'/docs?cloud-document='+doc.id);
  await page.getByRole('button',{name:'Share document',exact:true}).click();
  if(expand){
    await expandShare(page,'Private link');await expandShare(page,'Public page');
    await expect(page.getByRole('button',{name:'Publish publicly',exact:true})).toBeEnabled();
  }
}
async function expandShare(page,label){
  const toggle=page.getByRole('button',{name:label,exact:true});
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
}
async function publish(page){
  await page.getByRole('button',{name:'Publish publicly',exact:true}).click();
  const row=page.getByRole('textbox',{name:'Public URL',exact:true});await expect(row).toBeVisible();
  await expect(page.getByRole('button',{name:'Public page up to date'})).toBeDisabled();
  return row.inputValue();
}
async function update(markdown,key='edit-document'){
  const head=(await f.api('josh','/api/cloud/v1/documents/'+doc.id+'/head')).data.document.current_revision_id;
  const saved=await f.api('josh','/api/cloud/v1/documents/'+doc.id+'/revisions','POST',{
    markdown,filename:'a-small-clearing.md',expected_head_revision_id:head,idempotency_key:key});
  expect(saved.status).toBe(201);return saved.data.document;
}
for(const width of [1440,390]) test('sharing choices expand without acting and place their action first at '+width,async({page})=>{
  await open(page,width,false);
  const privateToggle=page.getByRole('button',{name:'Private link',exact:true});
  const publicToggle=page.getByRole('button',{name:'Public page',exact:true});
  await expect(privateToggle).toHaveAttribute('aria-expanded','false');
  await expect(publicToggle).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('button',{name:'Create private link',exact:true})).toHaveCount(0);
  let writes=0;
  page.on('request',request=>{if(request.method()==='POST'&&(/\/api\/short$|\/publication$/.test(new URL(request.url()).pathname)))writes++;});
  await privateToggle.focus();await page.keyboard.press('Enter');
  await expect(privateToggle).toHaveAttribute('aria-expanded','true');
  expect(await page.locator('#_sd_share-private .sdoc-share-section').evaluate(el=>el.firstElementChild.matches('[data-share-private]'))).toBe(true);
  await publicToggle.click();
  await expect(publicToggle).toHaveAttribute('aria-expanded','true');
  expect(await page.locator('#_sd_share-public .sdoc-share-section').evaluate(el=>el.firstElementChild.matches('[data-share-publish]'))).toBe(true);
  await page.evaluate(()=>SDocs.publications.refresh());
  await expect(privateToggle).toHaveAttribute('aria-expanded','true');
  await expect(publicToggle).toHaveAttribute('aria-expanded','true');
  await privateToggle.focus();await page.keyboard.press('Space');
  await expect(privateToggle).toHaveAttribute('aria-expanded','false');
  await expect(privateToggle).toBeFocused();
  await expect(page.locator('#_sd_share-private')).toHaveAttribute('inert','');
  await expect(page.getByRole('button',{name:'Create private link',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Publish publicly',exact:true})).toBeEnabled();
  expect(writes).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const width of [1440,390]) test('Share panel provides both link types and a public status dot at '+width,async({page,browser},testInfo)=>{
  await open(page,width);
  await expect(page.locator('#_sd_btn-share')).toHaveAttribute('data-tip','Share outside of your cloud');
  await expect(page.locator('.fic-row-share,[data-key="shortUrl"],[data-key="publicUrl"]')).toHaveCount(0);
  expect(await page.locator('#_sd_btn-copy-file').evaluate(el=>el.nextElementSibling.id)).toBe('_sd_btn-share');
  await expect(page.getByRole('link',{name:'Learn about private links',exact:true})).toHaveAttribute('href','/docs#sec=short-links');
  await expect(page.getByRole('link',{name:'Learn about public pages',exact:true})).toHaveAttribute('href','/docs#sec=public-pages');
  await page.getByRole('button',{name:'Create private link',exact:true}).click();
  const privateRow=page.getByRole('textbox',{name:'Private URL',exact:true});await expect(privateRow).toBeVisible();
  const privateUrl=await privateRow.inputValue();expect(privateUrl).toContain('#k=');
  const privateCopy=page.getByRole('button',{name:'Copy private URL',exact:true});
  await expect(privateCopy.locator('svg rect')).toHaveCount(1);
  await privateCopy.click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(privateUrl);
  await expect(privateCopy.locator('svg polyline')).toHaveAttribute('points','20 6 9 17 4 12');
  await expect(privateCopy.locator('svg rect')).toHaveCount(1);
  await expect(page.locator('#_sd_btn-share')).not.toHaveClass(/has-unseen/);
  const publicUrl=await publish(page);expect(publicUrl).toContain('/p/a-small-clearing-');
  const publicCopy=page.getByRole('button',{name:'Copy public URL',exact:true});
  await publicCopy.click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(publicUrl);
  await expect(publicCopy.locator('svg polyline')).toHaveAttribute('points','20 6 9 17 4 12');
  await expect(page.locator('#_sd_btn-share')).toHaveAttribute('data-publication-status','current');
  await expect(page.locator('#_sd_btn-share')).toHaveAttribute('data-tip','Already shared: public page up to date');
  await expect(page.locator('#_sd_btn-share .info-dot')).toHaveCSS('background-color','rgb(22, 163, 74)');
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
  await expect(page.locator('#_sd_btn-share')).toHaveAttribute('data-publication-status','outdated');
  await expect(page.locator('#_sd_btn-share')).toHaveAttribute('data-tip','Already shared: public page needs updating');
  await expect(page.locator('#_sd_btn-share .info-dot')).toHaveCSS('background-color','rgb(245, 158, 11)');
  expect(await (await request.get(url)).text()).toContain('Keep writing');
  await page.getByRole('button',{name:'Update public page',exact:true}).click();
  await expect(page.getByRole('button',{name:'Public page up to date'})).toBeDisabled();
  await expect(page.getByRole('textbox',{name:'Public URL',exact:true})).toHaveValue(url);
  expect(await (await request.get(url)).text()).toContain('Keep exploring');
  await page.reload();await page.getByRole('button',{name:'Share document',exact:true}).click();await expandShare(page,'Public page');await expect(page.getByRole('textbox',{name:'Public URL',exact:true})).toHaveValue(url);
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
  await page.getByRole('button',{name:'Unpublish',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Public URL',exact:true})).toHaveCount(0);
  const gone=await request.get(url);expect([404,410]).toContain(gone.status());expect(await gone.text()).not.toContain('A place to gather');
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
  await expect(page.locator('.sdoc-share-error')).toContainText('Publishing could not be confirmed');
  await page.getByRole('button',{name:'Retry publishing details'}).click();
  await expect(page.getByRole('textbox',{name:'Public URL',exact:true})).toBeVisible();
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
  await expect(page.locator('.sdoc-share-error')).toContainText('Save your latest edits to Cloud');
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
  await expect(page.getByRole('button',{name:'Create private link',exact:true})).toBeEnabled();
  await expect(page.getByRole('textbox',{name:'Private URL',exact:true})).toHaveCount(0);
});

const fs=require('fs'),path=require('path');
const slideMarkdown=fs.readFileSync(path.join(__dirname,'fixtures/publication-slide.md'),'utf8');
async function publishedRich(markdown) {
  doc=await update(markdown,'rich-'+Date.now());
  const result=await f.api('josh','/api/cloud/v1/documents/'+doc.id+'/publication','POST',{
    expected_revision_id:doc.current_revision_id,idempotency_key:'publish-rich'});
  expect(result.status).toBe(200);return result.data.publication.url;
}
for(const width of [1440,390]) test('anonymous public slides match the document reader at '+width,async({page,browser},testInfo)=>{
  const url=await publishedRich(slideMarkdown);
  await page.setViewportSize({width,height:1000});
  await page.context().addCookies([{name:'sdocs_cloud',value:f.users.josh.sessionToken,url:f.origin}]);
  await page.goto(f.origin+'/docs?cloud-document='+doc.id);
  await expect(page.locator('.sdoc-slide')).toHaveCount(1);
  await expect(page.locator('.sdoc-slide .sd-shape-stage')).toContainText('Email encryption protects different parts of a message');
  await page.evaluate(()=>document.fonts.ready);
  const baseline=await page.locator('.sdoc-slide').evaluate(el=>({width:el.clientWidth,
    text:el.querySelector('.sd-shape-stage').textContent,
    cards:Array.from(el.querySelectorAll('.shape-rect')).map(card=>({width:card.getBoundingClientRect().width,height:card.getBoundingClientRect().height,background:getComputedStyle(card).backgroundColor}))}));
  const guest=await browser.newContext({viewport:{width,height:1000}});
  try {
    const reader=await guest.newPage(),errors=[];reader.on('pageerror',e=>errors.push(e.message));
    const requests=[];reader.on('request',r=>requests.push(r.url()));
    await reader.goto(url);
    await expect(reader.locator('html')).toHaveAttribute('data-publication-ready','true');
    await expect(reader.locator('.sdoc-slide')).toHaveCount(1);
    await expect(reader.locator('.sdoc-slide .sd-shape-stage')).toContainText('Email encryption protects different parts of a message');
    await expect(reader.locator('pre code.language-slide')).toHaveCount(0);
    await expect(reader.getByRole('heading',{name:'Untitled document',exact:true})).toHaveCount(0);
    await reader.evaluate(()=>document.fonts.ready);
    const actual=await reader.locator('.sdoc-slide').evaluate(el=>({width:el.clientWidth,
      text:el.querySelector('.sd-shape-stage').textContent,
      cards:Array.from(el.querySelectorAll('.shape-rect')).map(card=>({width:card.getBoundingClientRect().width,height:card.getBoundingClientRect().height,background:getComputedStyle(card).backgroundColor}))}));
    expect(actual.text).toBe(baseline.text);
    expect(Math.abs(actual.width-baseline.width)).toBeLessThanOrEqual(1);
    expect(actual.cards.length).toBe(baseline.cards.length);
    actual.cards.forEach((card,i)=>{expect(Math.abs(card.width-baseline.cards[i].width)).toBeLessThanOrEqual(1);expect(Math.abs(card.height-baseline.cards[i].height)).toBeLessThanOrEqual(1);expect(card.background).toBe(baseline.cards[i].background);});
    expect(errors).toEqual([]);expect(requests.filter(url=>url.includes('/api/cloud/v1/documents/'))).toEqual([]);
    expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await reader.screenshot({path:testInfo.outputPath('public-slide-'+width+'.png')});
    await reader.locator('.sdoc-slide-present').click();
    await expect(reader.locator('.sdoc-present')).toBeVisible();
    await reader.keyboard.press('Escape');
  } finally {await guest.close();}
});
test('existing published snapshots gain rich rendering without reading a later private draft',async({browser})=>{
  const url=await publishedRich(slideMarkdown);
  const code=slideMarkdown.split('```slide\n')[1].split('```')[0].replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const legacy='<html><head><title>Untitled document | SmallDocs</title><style>html #_sd_rendered{--md-base-size:22px;--md-color:#123456}</style></head><body><article id="_sd_rendered"><h1>Untitled document</h1><div class="publication-meta">Old byline</div><pre><code class="language-slide">'+code+'</code></pre></article></body></html>';
  f.store.db.prepare("UPDATE cloud_publications SET rendered_html=?,public_source=NULL,renderer_version='legacy',rendered_styles=NULL WHERE document_id=?").run(legacy,doc.id);
  await update('# New private draft\n\nThis has never been published.','unpublished-draft');
  const guest=await browser.newContext();
  try {
    const reader=await guest.newPage();await reader.goto(url);
    await expect(reader.locator('html')).toHaveAttribute('data-publication-ready','true');
    await expect(reader.locator('.sdoc-slide')).toHaveCount(1);
    await expect(reader.locator('.sdoc-slide')).toContainText('Email encryption protects different parts of a message');
    await expect(reader.locator('body')).not.toContainText('This has never been published.');
    await expect(reader.getByRole('heading',{name:'Untitled document',exact:true})).toHaveCount(0);
    expect(await reader.locator('#_sd_rendered').evaluate(el=>getComputedStyle(el).getPropertyValue('--md-base-size').trim())).toBe('22px');
    expect(await reader.locator('#_sd_rendered').evaluate(el=>getComputedStyle(el).getPropertyValue('--md-color').trim())).toBe('#123456');
  } finally{await guest.close();}
});
test('anonymous rich pages render cells, math, charts and diagrams with inert raw HTML',async({browser})=>{
  const markdown='---\nstyles:\n  baseFontSize: 22\n  color: "#123456"\n---\n# Rich public guide\n\n<script>window.publicationAttack=true</script>\n\n$$x^2 + y^2$$\n\n```cells Budget/Plan\nItem,Cost\nBooks,12\n```\n\n```chart\n{"type":"bar","labels":["Books"],"values":[12]}\n```\n\n```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```\n\n```html\n</script><script>window.publicationAttack=true</script>\n```';
  const url=await publishedRich(markdown);
  const guest=await browser.newContext({serviceWorkers:'allow'});
  try {
    const reader=await guest.newPage(),errors=[];reader.on('pageerror',e=>errors.push(e.message));
    await reader.goto(url);
    await expect(reader.locator('html')).toHaveAttribute('data-publication-ready','true',{timeout:30000});
    await expect(reader.locator('.katex')).toBeVisible();
    await expect(reader.locator('.sdoc-cells')).toBeVisible();
    await expect(reader.locator('canvas')).toBeVisible();
    await expect(reader.locator('.sdoc-mermaid-stage > svg')).toBeVisible();
    await expect(reader.locator('#_sd_rendered')).toHaveCSS('font-size','22px');
    await expect(reader.locator('#_sd_rendered')).toHaveCSS('color','rgb(18, 52, 86)');
    expect(await reader.evaluate(()=>window.publicationAttack)).toBeUndefined();
    expect(errors).toEqual([]);
  } finally{await guest.close();}
});

test('public copies retain the private-link app shell and actions, with readable initial HTML',async({page,browser})=>{
  await open(page);
  await page.getByRole('button',{name:'Create private link',exact:true}).click();
  const privateUrl=await page.getByRole('textbox',{name:'Private URL',exact:true}).inputValue();
  const publicUrl=await publish(page);
  const guest=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  try {
    const reader=await guest.newPage();await reader.goto(privateUrl);
    await expect(reader.locator('[role="toolbar"][aria-label="Document actions"]')).toBeVisible();
    await expect(reader.locator('.fic-row-share')).toHaveCount(0);
    const controls=await reader.locator('[role="toolbar"][aria-label="Document actions"] button').evaluateAll(nodes=>nodes.map(node=>node.id));
    await reader.goto(publicUrl);
    await expect(reader.locator('html')).toHaveAttribute('data-publication-ready','true');
    await expect(reader.locator('#_sd_sdocs-file-info')).toBeHidden();
    await expect(reader.locator('.fic-row-cloud,[data-key="publicUrl"]')).toHaveCount(0);
    await expect(reader.locator('[data-sidebar-section="about"]')).toBeVisible();
    await expect(reader.locator('a.sdocs-short-link-only',{hasText:'Install'})).toBeVisible();
    expect(await reader.locator('[role="toolbar"][aria-label="Document actions"] button').evaluateAll(nodes=>nodes.map(node=>node.id))).toEqual(controls);
    await reader.locator('#_sd_btn-copy-file').click();
    expect(await reader.evaluate(()=>navigator.clipboard.readText())).toContain('A place to gather a thought');
    await reader.locator('#_sd_btn-fold').click();
    await reader.locator('#_sd_btn-theme').click();
    await reader.waitForTimeout(500);
    expect(new URL(reader.url()).pathname).toBe(new URL(publicUrl).pathname);
    expect(new URL(reader.url()).hash).not.toContain('md=');
    await expect(reader.locator('#_sd_sdocs-file-info')).toBeHidden();
    expect(await reader.evaluate(()=>SDocs.cloudDocument)).toBeFalsy();
    await reader.evaluate(()=>{SDocs.currentBody+='\n\nLocal reader copy.';SDocs.syncAll('write');});
    await expect.poll(()=>new URL(reader.url()).pathname).toBe('/docs');
    expect(await (await reader.request.get(publicUrl)).text()).not.toContain('Local reader copy.');
    expect(await (await reader.request.get(publicUrl)).text()).not.toContain(doc.id);
  }finally{await guest.close();}
  const noJs=await browser.newContext({javaScriptEnabled:false});
  try{
    const reader=await noJs.newPage();await reader.goto(publicUrl);
    await expect(reader.getByRole('heading',{name:'Next steps',exact:true})).toBeVisible();
    await expect(reader.getByRole('table')).toContainText('Published');
  }finally{await noJs.close();}
});

test('sign-in returns to the published source with its document and mode intact',async({browser})=>{
  const url=await publishedRich(original);
  const guest=await browser.newContext();
  try {
    const reader=await guest.newPage();await reader.goto(url);
    await expect(reader.locator('html')).toHaveAttribute('data-publication-ready','true');
    await reader.evaluate(()=>sessionStorage.setItem('sdocs-cloud-sign-in-return-v1',location.pathname+'#mode=style'));
    await reader.goto(url+'?sdocs_resume=1');
    await expect(reader.locator('html')).toHaveAttribute('data-publication-ready','true');
    expect(new URL(reader.url()).pathname).toBe(new URL(url).pathname);
    expect(new URL(reader.url()).search).toBe('');
    expect(await reader.evaluate(()=>SDocs.currentMode)).toBe('style');
    expect(await reader.evaluate(()=>SDocs.currentBody)).toContain('A place to gather a thought');
  } finally{await guest.close();}
});

test('a public reader can copy its published URL without claiming the private source is current',async({browser})=>{
  const url=await publishedRich(original);
  await update(original+'\nAn unpublished change.','new-private-copy');
  const guest=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  try{
    const page=await guest.newPage();await page.goto(url);
    await page.getByRole('button',{name:'Share document',exact:true}).click();
    await expandShare(page,'Public page');
    await expect(page.getByRole('textbox',{name:'Public URL',exact:true})).toHaveValue(url);
    await expect(page.getByText('This is the published copy.',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Publish publicly',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Unpublish',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Copy public URL',exact:true}).click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(url);
    await page.keyboard.press('Escape');
    await expect(page.locator('#_sd_share-panel')).toBeHidden();
    expect(new URL(page.url()).pathname).toBe(new URL(url).pathname);
  }finally{await guest.close();}
});

test('a library member can share a private copy but cannot publish another person\'s document',async({page})=>{
  await f.api('bob','/api/cloud/v1/onboarding/complete','POST',{});
  await f.api('member','/api/cloud/v1/onboarding/complete','POST',{});
  const created=await f.api('bob','/api/cloud/v1/account/documents','POST',{
    account_id:f.team.workspaceId,filename:'team-note.md',markdown:'# Team note\n\nA shared working note.',idempotency_key:'team-note'});
  expect(created.status).toBe(201);
  f.store.setDocumentPermission({userId:f.users.bob.id,documentId:created.data.document.id,mode:'everyone'});
  await page.context().addCookies([{name:'sdocs_cloud',value:f.users.member.sessionToken,url:f.origin}]);
  await page.goto(f.origin+'/docs?cloud-document='+created.data.document.id);
  await page.getByRole('button',{name:'Share document',exact:true}).click();
  await expandShare(page,'Private link');await expandShare(page,'Public page');
  await expect(page.getByRole('button',{name:'Publish publicly',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Unpublish',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Create private link',exact:true})).toBeEnabled();
});
