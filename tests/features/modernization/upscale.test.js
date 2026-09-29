import assert from 'node:assert/strict';
import { before, it } from 'node:test';
import { installBrowserGlobals } from '../../helpers/stub-browser-globals.js';
import { fakeProvider, flushJobs } from './fake-provider.js';
import { upscaleGeometry, UPSCALE_MODEL, validateUpscaleInput, validateUpscaleConfig, extendUpscaleRGB, combineUpscaleAlpha, copyUpscaleResult, upscaleThumbnail } from '../../../src/features/modernization/upscale-workload.js';
import { createUpscaleProvider, testUpscaleConnection } from '../../../src/features/modernization/upscale-provider.js';
installBrowserGlobals();
let Document, Rect, SelectionJobs;
const config = { endpoint:'http://127.0.0.1:8188',model:UPSCALE_MODEL };
before(async()=>{
 ({Document}=await import('../../../src/document/model/document.js'));({Rect}=await import('../../../src/core/math/rect.js'));
 const {LayerSystem}=await import('../../../src/engine/layer-system.js');LayerSystem.webglEnabled=false;
 ({SelectionJobs}=await import('../../../src/features/modernization/selection-jobs.js'));
});
function input(width=3,height=5){return {width,height,scale:4,rgba:Uint8Array.from({length:width*height*4},(_,i)=>[170,90,30,255][i%4]),config};}
function fixture(){
 const doc=new Document('source.psd');doc.width=3;doc.height=5;doc.buffer=new Uint8Array(60);
 const layer=doc.newLayer();layer.rect=new Rect(0,0,3,5);layer.setName('Original');layer.buffer=input().rgba;doc.setLayers([layer]);doc.selectedLayerIndices=[0];
 const controller={openDocs:[doc],getCurrentDoc:()=>doc,pointerState:{isDown:false},onDocumentOpened(d){this.openDocs.push(d);}};
 const fake=fakeProvider();Object.assign(fake.provider,{validateInput:validateUpscaleInput,copyResult:copyUpscaleResult});
 const bridge=new SelectionJobs(controller,undefined,false,undefined,undefined,undefined,fake.provider);
 const submit=()=>bridge.submitUpscale(doc,config);
 const result=()=>({width:12,height:20,scale:4,pixelFormat:'rgba8',bytes:Uint8Array.from({length:12*20*4},(_,i)=>[199,80,20,255][i%4])});
 return {doc,layer,controller,bridge,submit,result,...fake};
}
for(const [w,h] of [[1,1],[3,5],[1024,512],[768,682]])it(`native 4x exact geometry ${w}x${h}`,()=>{const g=upscaleGeometry(w,h);assert.equal(g.outputWidth,w*4);assert.equal(g.outputHeight,h*4);assert.equal(g.outputBytes,w*h*64);});
it('rejects scale, overflow, dimensions and memory before transport/allocation',()=>{
 for(const [w,h,s] of [[0,1,4],[-1,2,4],[1.5,2,4],[3,5,2],[1025,1,4],[1024,513,4],[Number.MAX_SAFE_INTEGER,2,4],[Infinity,5,4]])assert.throws(()=>upscaleGeometry(w,h,s));
});
it('exact model and numeric loopback required',()=>{
 for(const endpoint of ['http://localhost:8188','https://127.0.0.1:8188','http://127.0.0.1:8188/path','http://127.0.0.1:0','http://2130706433:8188'])assert.throws(()=>validateUpscaleConfig({...config,endpoint}));
 assert.throws(()=>validateUpscaleConfig({...config,model:'other4x.pth'}));assert.doesNotThrow(()=>validateUpscaleConfig({...config,endpoint:'http://[::1]:8188/'}));
});
it('hidden transparent RGB cannot affect the model input; partial straight colors survive',()=>{
 const a=input(3,1);a.rgba.set([255,0,255,0,80,120,160,127,0,255,0,0]);const b=a.rgba.slice();b.set([0,0,0],0);b.set([255,255,255],8);
 assert.deepEqual(extendUpscaleRGB(a.rgba,3,1),extendUpscaleRGB(b,3,1));
 assert.deepEqual([...extendUpscaleRGB(a.rgba,3,1)],[80,120,160,255,80,120,160,255,80,120,160,255]);assert.deepEqual(a.rgba.slice(0,4),new Uint8Array([255,0,255,0]));
});
for(const alpha of [0,1,127,255])it(`constant alpha ${alpha} survives scaling; transparent RGB is zero`,()=>{
 const a=input();for(let i=3;i<a.rgba.length;i+=4)a.rgba[i]=alpha;
 const out=combineUpscaleAlpha(a,new Uint8Array(12*20*4).fill(71));
 for(let i=0;i<out.length;i+=4){assert.equal(out[i+3],alpha);assert.equal(out[i],alpha?71:0);}
});
it('hard/antialiased alpha uses deterministic bounded cubic interpolation with soft output',()=>{
 const a=input(3,1);a.rgba[3]=0;a.rgba[7]=128;a.rgba[11]=255;
 const out=combineUpscaleAlpha(a,new Uint8Array(12*4*4).fill(91)),second=combineUpscaleAlpha(a,new Uint8Array(12*4*4).fill(91));assert.deepEqual(out,second);
 const row=Array.from({length:12},(_,i)=>out[i*4+3]);assert.equal(row[0],0);assert.equal(row.at(-1),255);assert.ok(row.some(n=>n>0&&n<128));for(let i=1;i<12;i++)assert.ok(row[i]>=row[i-1]);
});
it('M1 success opens exact new ordinary document only on Accept, source bytes/history unchanged',async()=>{
 const f=fixture(),snapshot=f.layer.buffer.slice(),history=f.doc.history.slice(),id=f.submit();await flushJobs();assert.notEqual(f.calls[0].input.rgba,f.layer.buffer);
 f.calls[0].complete(f.result());assert.equal(f.bridge.jobs.get(id).state,'preview');assert.equal(f.controller.openDocs.length,1);assert.equal(f.bridge.upscalePreviews.size,1);
 assert.equal(f.bridge.jobs.accept(id),true);const d=f.controller.openDocs[1];assert.equal(d.width,12);assert.equal(d.height,20);assert.equal(d.layers.length,1);assert.deepEqual(d.layers[0].rect,new Rect(0,0,12,20));assert.deepEqual(d.layers[0].buffer,f.result().bytes);assert.match(d.name,/source — AI Upscale 4x/);assert.ok(!d.nativeFilePath);assert.deepEqual(f.doc.history,history);assert.deepEqual(f.layer.buffer,snapshot);assert.equal(f.bridge.upscalePreviews.size,0);
});
for(const action of ['discard','cancel'])it(`${action} releases full result and thumbnail with no document`,async()=>{
 const f=fixture(),id=f.submit();await flushJobs();f.calls[0].complete(f.result());f.bridge.jobs[action](id);assert.equal(f.controller.openDocs.length,1);assert.equal(f.bridge.upscalePreviews.size,0);assert.equal(f.bridge.jobs.get(id).hasResult,false);
});
it('late and duplicate completion after cancellation cannot open a document',async()=>{
 const f=fixture(),id=f.submit();await flushJobs();f.bridge.jobs.cancel(id);f.calls[0].complete(f.result());f.calls[0].complete(f.result());assert.equal(f.bridge.jobs.get(id).state,'cancelled');assert.equal(f.controller.openDocs.length,1);assert.throws(()=>f.bridge.jobs.accept(id));
});
for(const stage of ['running','preview'])for(const [name,mutate] of Object.entries({pixels:f=>f.layer.buffer[0]--,geometry:f=>f.doc.width++,visibility:f=>f.layer.setVisible(false),history:f=>f.doc.history.push({})}))it(`stale ${name} during ${stage} requires rerun`,async()=>{
 const f=fixture(),id=f.submit();await flushJobs();if(stage==='preview')f.calls[0].complete(f.result());mutate(f);if(stage==='running')f.calls[0].complete(f.result());else assert.equal(f.bridge.jobs.accept(id),false);assert.equal(f.bridge.jobs.get(id).state,'stale');assert.equal(f.controller.openDocs.length,1);
});
it('tab switch cannot redirect output; source close revokes it',async()=>{
 const f=fixture(),other=fixture().doc;f.controller.openDocs.push(other);const id=f.submit();await flushJobs();f.controller.getCurrentDoc=()=>other;f.calls[0].complete(f.result());assert.equal(f.bridge.jobs.accept(id),true);assert.equal(f.controller.openDocs.length,3);assert.equal(other.history.length,1);
 const g=fixture(),j=g.submit();await flushJobs();g.bridge.close(g.doc);g.controller.openDocs=[];g.calls[0].complete(g.result());assert.equal(g.bridge.jobs.get(j).state,'cancelled');assert.equal(g.controller.openDocs.length,0);
});
it('wrong output geometry never exposes Accept',async()=>{const f=fixture(),id=f.submit();await flushJobs();const r=f.result();r.width=8;r.bytes=new Uint8Array(8*20*4);f.calls[0].complete(r);assert.equal(f.bridge.jobs.get(id).state,'failed');assert.equal(f.controller.openDocs.length,1);});
it('single retained upscale bounds full output memory',async()=>{const f=fixture(),id=f.submit();assert.throws(f.submit,/current AI Upscale/);await flushJobs();f.calls[0].complete(f.result());assert.throws(f.submit,/current AI Upscale/);f.bridge.jobs.discard(id);assert.doesNotThrow(f.submit);f.bridge.close(f.doc);});
it('PSD serialization reopens exact full output and alpha without any provider',async()=>{
 const {PSDParser}=await import('../../../src/document/formats/psd/psd-parser.js'),{RenderBuffer}=await import('../../../src/core/render-buffer.js');
 const {TrackerRegistry}=await import('../../../src/features/trackers/tracker-registry.js'),{registerTrackers}=await import('../../../src/features/trackers/register-trackers.js');registerTrackers(TrackerRegistry);
 const f=fixture(),id=f.submit();await flushJobs();const r=f.result();for(let i=0;i<r.bytes.length;i+=4){r.bytes[i+3]=i%256;if(!r.bytes[i+3])r.bytes.fill(0,i,i+3);}f.calls[0].complete(r);f.bridge.jobs.accept(id);const d=f.controller.openDocs[1],b=new RenderBuffer(),n=PSDParser.serialize(d,b,[false,false,false,false]),reopened=new Document('offline.psd');PSDParser.parse(b.data.slice(0,n).buffer,reopened);
 assert.equal(reopened.width,12);assert.equal(reopened.height,20);assert.deepEqual(reopened.layers[0].buffer,r.bytes);assert.equal(f.calls.length,1);
});
it('provider binary transport, real alpha assembly and download cancellation',async()=>{
 let resolve,metadata,cancelCount=0;const invoke=(cmd,args,options)=>{
  if(cmd==='comfy_upscale'){metadata=JSON.parse(decodeURIComponent(options.headers['x-photosuite-upscale']));return new Promise(r=>resolve=r);}
  if(cmd==='comfy_cancel')cancelCount++;return Promise.resolve({stage:'Generating'});
 };
 const provider=createUpscaleProvider(invoke),a=input(1,1);a.rgba[3]=128;let output;const abort=new AbortController();provider.start(a,{signal:abort.signal,progress(){},complete(r){output=r;},fail(e){throw e;}});resolve(new Uint8Array(64).fill(99).buffer);await flushJobs();assert.equal(metadata.scale,4);assert.equal(output.bytes[3],128);
 let complete=false,failure;const ac=new AbortController();provider.start(a,{signal:ac.signal,progress(){},complete(){complete=true;},fail(e){failure=e;}});ac.abort();resolve(new Uint8Array(64));await flushJobs();assert.equal(complete,false);assert.equal(failure.code,'cancellation');assert.ok(cancelCount);
});
it('capability fails closed for missing model, version or workflow',async()=>{
 await assert.rejects(testUpscaleConnection(config,async()=>{throw new Error('missing model');}),/missing model/);
 await assert.rejects(testUpscaleConnection(config,async()=>({ready:true,version:'0.37.0',workflow:'photosuite-upscale-v1',model:UPSCALE_MODEL})),/Incompatible/);
 assert.equal((await testUpscaleConnection(config,async()=>({ready:true,version:'0.37.4',workflow:'photosuite-upscale-v1',model:UPSCALE_MODEL}))).ready,true);
});
it('preview is bounded and never changes actual result',()=>{const result={width:1024,height:2048,bytes:new Uint8Array(1024*2048*4).fill(100)};const t=upscaleThumbnail(result);assert.equal(t.width,128);assert.equal(t.height,256);assert.equal(result.bytes.length,1024*2048*4);assert.ok(t.rgba.every(v=>v===100));});
it('existing standard interpolation has deterministic exact 4x bounds and constant color',async()=>{
 const {rasterizeWithMatrix}=await import('../../../src/document/render/raster-transform.js');
 for(const mode of [0,1,2]){
  const a=input(3,5),make=()=>rasterizeWithMatrix([a.rgba.slice(),new Rect(0,0,3,5)],mode,[4,0,0,0,4,0,0,0,1]);const x=make(),y=make();
  assert.deepEqual(x.rect,new Rect(0,0,12,20));assert.deepEqual(x.buffer,y.buffer);assert.equal(x.buffer.length,960);assert.deepEqual([...x.buffer.slice(400,404)],[170,90,30,255]);
 }
});
it('source is rendered composite including visibility and opacity, not selected layer internals',async()=>{
 const f=fixture(),top=f.doc.newLayer();top.rect=f.layer.rect.clone();top.buffer=new Uint8Array(60).fill(255);top.setVisible(false);f.doc.setLayers([f.layer,top]);f.doc.selectedLayerIndices=[1];
 const id=f.submit();await flushJobs();assert.deepEqual(f.calls[0].input.rgba,f.layer.buffer);assert.notDeepEqual(f.calls[0].input.rgba,top.buffer);f.bridge.jobs.cancel(id);
});
it('alpha assembly yields to cancellation and stays byte-identical to deterministic reference',async()=>{
 const {combineUpscaleAlphaAsync}=await import('../../../src/features/modernization/upscale-workload.js');
 const a=input(31,33);for(let i=3;i<a.rgba.length;i+=4)a.rgba[i]=i%256;const output=new Uint8Array(31*33*64).fill(91),expected=combineUpscaleAlpha(a,output.slice());
 assert.deepEqual(await combineUpscaleAlphaAsync(a,output,new AbortController().signal),expected);
 const ac=new AbortController(),pending=combineUpscaleAlphaAsync(a,output,ac.signal);ac.abort();await assert.rejects(pending,/cancelled/);
});
