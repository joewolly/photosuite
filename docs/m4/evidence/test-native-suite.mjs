const c=m4App,b=c.getSelectionJobs();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(x,msg)=>{if(!x)throw Error(msg)};
const send=async(label,data={})=>fetch('http://127.0.0.1:8767/events',{method:'POST',body:JSON.stringify({label,...data})});
const open=async path=>{let n=c.openDocs.length;c.fileLoader.openFilesByPaths([path],null);for(let i=0;i<200;i++){await pause(50);if(c.openDocs.length>n)return c.getCurrentDoc()}throw Error('open failed '+path)};
const close=d=>c.splashScreen.panels.find(p=>p.pluginDocument===d).dispatchCloseTab();
window.m4Native={open,close,assert,send,pause};
window.m4Suite=(async()=>{
 const manifest=await (await fetch('http://127.0.0.1:8767/corpus-raw/manifest.json')).json();
 for(const item of manifest.cases){
  const d=await open('/Users/joe/Documents/CodexProjects/PhotoSuite/tests/fixtures/prompted-corpus/v1/'+item.file),l=d.layers[d.selectedLayerIndices[0]],source=await m4Hash(l.buffer),history=d.history.length;
  const prompts=[item.sequences[0].points[0],item.sequences[1].points[1],{kind:'box',...item.sequences[2].box},item.sequences[3].points[0]];
  let id;
  for(let i=0;i<prompts.length;i++){
   id=b.submitPrompt(d,prompts[i]);await m4Wait(id);
   assert(d.history.length===history,'preview history changed');assert(await m4Hash(l.buffer)===source,'source mutated');assert(!d.selectionMask,'premature selection');
   await m4Record('native-corpus',{case:item.id,step:i,job:id});
   await fetch('http://127.0.0.1:8767/mask/'+item.id+'-'+i,{method:'POST',body:d.toolOverlayState.jobSelectionPreview.channel});
   if(i>0)assert(b.lastPromptedMetrics.embeddingReused,'warm cache not reused');
  }
  if(item.id==='isolated'){
   const {TrackerRegistry}=await import('tauri://localhost/features/trackers/tracker-registry.js'),h=new TrackerRegistry.History();
   assert(b.jobs.accept(id),'accept failed');const sel=await m4Hash(d.selectionMask.channel);assert(d.history.length===history+1,'accept not exactly one entry');
   h.stepHistoryBackward(d);assert(!d.selectionMask,'undo selection failed');h.stepHistoryForward(d);assert(await m4Hash(d.selectionMask.channel)===sel,'redo bytes differed');
   const {removeBackgroundFromSelection}=await import('tauri://localhost/features/trackers/exact-result-tracker.js');removeBackgroundFromSelection(c);const mask=await m4Hash(l.getMask().channel);assert(d.history.length===history+2,'manual mask history');assert(await m4Hash(l.buffer)===source,'mask destructive');
   h.stepHistoryBackward(d);assert(!l.getMask(),'mask undo');h.stepHistoryForward(d);assert(await m4Hash(l.getMask().channel)===mask,'mask redo');
   const composite=await m4Hash(d.getRasterData());await m4Record('native-accept-undo-redo-mask',{source,sel,mask,composite});
   const {PSDParser}=await import('tauri://localhost/document/formats/psd/psd-parser.js'),{RenderBuffer}=await import('tauri://localhost/core/render-buffer.js'),{nativeWriteFile}=await import('tauri://localhost/core/tauri-host.js');
   const buf=new RenderBuffer(),n=PSDParser.serialize(d,buf,[false,false,false,false]),path='/Users/joe/Documents/Codex/2026-09-28/photosuite-m4-acceptance/prompted-mask.psd';await nativeWriteFile(path,buf.data.slice(0,n));close(d);const reopened=await open(path),rl=reopened.layers[0];assert(await m4Hash(rl.buffer)===source,'PSD source mismatch');assert(await m4Hash(rl.getMask().channel)===mask,'PSD mask mismatch');assert(await m4Hash(reopened.getRasterData())===composite,'PSD composite mismatch');await m4Record('native-PSD-reopened',{source,mask,composite,bytes:n});close(reopened);
  }else{b.jobs.discard(id);assert(d.history.length===history,'discard history');assert(!d.selectionMask,'discard selection');close(d)}
 }
 await send('native-corpus-complete',{cases:11,realPreviews:44});
})().catch(async e=>{await send('native-suite-failed',{error:String(e),stack:e.stack});console.error(e)});
