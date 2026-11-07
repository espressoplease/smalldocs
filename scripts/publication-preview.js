// Loopback-only interaction fixture using the real Cloud backend and fictional accounts.
const http=require('http');
const {startFixture}=require('../test/cloud-onboarding-fixture');
(async()=>{
 const f=await startFixture({singlePlan:true,compilePublications:true});
 await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{});
 const spaces=await f.store.listWorkspaces(f.users.josh.id),space=spaces.find(w=>w.kind==='personal');
 const text='---\ntitle: A small clearing\ndescription: A place to gather a thought before sharing it.\ntags:\n  - writing\n  - notes\n---\n# A small clearing\n\nA place to gather a thought before sharing it.\n\n## What belongs here\n\nKeep a working draft in your library, then publish it when you are ready. The public page has its own link.\n\n| Stage | Who can read it |\n| --- | --- |\n| Cloud draft | People with access |\n| Private link | Anyone with the complete link |\n| Public page | Anyone, including search engines |\n\n## Make room for changes\n\nA good document can change its mind. Edit a sentence, then update the public page when you want readers to see the change.\n\nThe same public link continues to work.';
 const result=await f.api('josh','/api/cloud/v1/account/documents','POST',{account_id:space.id,filename:'a-small-clearing.md',markdown:text,idempotency_key:'primary-document'});
 if(result.status!==201)throw new Error('Could not create document');
 await f.api('josh','/api/cloud/v1/account/documents','POST',{account_id:space.id,filename:'working-notes.md',markdown:'---\ntags:\n  - writing\n  - notes\n---\n# Working notes\n\nA few ideas to return to tomorrow.',idempotency_key:'second-document'});
 const port=Number(process.env.SDOCS_PUBLICATION_PORT || 3110),origin='http://localhost:'+port;
 const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.writeHead(303,{Location:'/docs?cloud-document='+result.data.document.id});res.end();return;}
  const headers={...req.headers,host:new URL(f.origin).host,origin:f.origin,cookie:req.url.startsWith('/p/')?'':f.users.josh.cookie};
  const upstream=http.request(f.origin+req.url,{method:req.method,headers},response=>{
   const parts=[];response.on('data',c=>parts.push(c));response.on('end',()=>{
    const h={...response.headers};delete h['content-length'];delete h['transfer-encoding'];delete h['set-cookie'];
    if(h.location)h.location=h.location.split(f.origin).join(origin);
    let body=Buffer.concat(parts);if(/json|html|xml|text\/plain/.test(h['content-type']||''))body=Buffer.from(body.toString().split(f.origin).join(origin));
    res.writeHead(response.statusCode,h);res.end(body);
   });
  });upstream.on('error',()=>{res.writeHead(502);res.end('Service unavailable.');});req.pipe(upstream);
 });
 server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:origin+'/docs?cloud-document='+result.data.document.id,fixture:f.origin})));
 async function close(){server.close();await f.close();process.exit(0);}
 process.on('SIGTERM',close);process.on('SIGINT',close);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
