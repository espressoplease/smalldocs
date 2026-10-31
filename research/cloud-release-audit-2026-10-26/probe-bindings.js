// Forces a normal read/modify/write overlap in separate CLI processes.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{fork}=require('child_process'),assert=require('assert');
if(process.argv[2]==='worker'){
 const binding=require('../../cli/lib/cloud-bindings');
 const read=fs.readFileSync;
 fs.readFileSync=function(file,...args){
  const value=read.call(this,file,...args);
  if(String(file)===binding.bindingsFile()){
   process.send({read:true});
   const gate=path.join(process.env.SDOCS_HOME,'release');
   while(!fs.existsSync(gate))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
  }
  return value;
 };
 binding.set('user-audit',path.join(process.env.SDOCS_HOME,process.argv[3]+'.md'),{document_id:process.argv[3],revision_id:'revision'});
 process.send({done:true});process.disconnect();
}else{
 (async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sdocs-binding-race-'));
  fs.mkdirSync(path.join(dir,'cloud'));fs.writeFileSync(path.join(dir,'cloud','bindings.json'),'{}');
  try{
   let reads=0;
   const workers=['doc-a','doc-b'].map(id=>fork(__filename,['worker',id],{env:{...process.env,SDOCS_HOME:dir},stdio:['ignore','ignore','inherit','ipc']}));
   const done=workers.map(worker=>new Promise((resolve,reject)=>{
    worker.on('message',message=>{if(message.read&&++reads===2)fs.writeFileSync(path.join(dir,'release'),'go');});
    worker.on('exit',code=>code===0?resolve():reject(new Error('Worker failed: '+code)));
   }));
   await Promise.all(done);
   const rows=Object.values(JSON.parse(fs.readFileSync(path.join(dir,'cloud','bindings.json'),'utf8')));
   console.log(JSON.stringify({case:'parallel_binding_updates',writers:2,retained_bindings:rows.length,document_ids:rows.map(row=>row.document_id)}));
   assert.equal(rows.length,1,'Probe expected current lost binding update');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
 })().catch(error=>{console.error(error);process.exit(1)});
}
