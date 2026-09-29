(async()=>{
const send=async data=>fetch('http://127.0.0.1:8767/events',{method:'POST',body:JSON.stringify(data)});
let externalAvailable=false;try{await fetch('https://example.com/?m4-offline-probe',{mode:'no-cors',cache:'no-store'});externalAvailable=true}catch(e){await send({label:'offline-page-probe',externalAvailable:false,error:String(e)})}if(externalAvailable)throw Error('Offline page denial failed');
const RealWorker=window.Worker;
window.m4FailNext=false;
window.Worker=class extends RealWorker{
 constructor(url,options){
  if(String(url).includes('/modernization/')){
   const source=window.m4FailNext?"throw Error('M4 deliberate worker crash')":`import ${JSON.stringify(String(url))}; fetch('https://example.com/?m4-worker-probe',{mode:'no-cors',cache:'no-store'}).then(()=>self.postMessage({m4probe:true,externalAvailable:true})).catch(e=>self.postMessage({m4probe:true,externalAvailable:false,error:String(e)}));`;
   window.m4FailNext=false;const blob=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));super(blob,options);URL.revokeObjectURL(blob);this.addEventListener('message',e=>{if(e.data?.m4probe)send({label:'offline-actual-worker-probe',worker:String(url),...e.data})});
  }else super(url,options);
 }
};
await new Function('return (async()=>{'+await(await fetch('http://127.0.0.1:8767/native-observer.mjs')).text()+'})()')();
await send({label:'offline-bootstrap-ready',url:location.href,workerProbe:'inherited-CSP module Blob statically imports unchanged production worker'});
})().catch(console.error);
