const {parentPort,workerData}=require('worker_threads');
const {startCompilerWorker}=require('../lib/publication-compiler');
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
(async()=>{
 const worker=await startCompilerWorker({socketPath:workerData.socketPath,origin:workerData.origin,rendererVersion:'fixture-renderer',
  ...(!workerData.real?{compiler:{async compile(snapshot){
   const payload=JSON.parse(/<script id="sdocs-publication-data" type="application\/json">([\s\S]*?)<\/script>/.exec(snapshot.html)[1]);
   const body=require('../cli/shared/sdocs-yaml').parseFrontMatter(payload.markdown||'').body;
   return {html:'<div id="_sd_rendered" class="sdoc-reader">'+escape(body).replace(/^# (.+)$/gm,'<h1>$1</h1>')+'</div>',rendererVersion:'fixture-renderer'};
  },async close(){}}}:{})});
 parentPort.postMessage('ready');
 parentPort.on('message',async message=>{if(message==='close'){await worker.close();parentPort.close();}});
})().catch(error=>{throw error;});
