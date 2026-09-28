import assert from 'node:assert/strict';
import { before,it } from 'node:test';
import { installBrowserGlobals } from '../../helpers/stub-browser-globals.js';
import { fakeProvider,flushJobs } from './fake-provider.js';
import { validateSubjectInput,copySubjectResult,reconstructSubjectMask,subjectMapping } from '../../../src/features/modernization/subject-workload.js';
installBrowserGlobals();
let Document,Rect,SelectionJobs,History,VectorMask,Mask;
before(async()=>{
 ({Document}=await import('../../../src/document/model/document.js'));
 ({Rect}=await import('../../../src/core/math/rect.js'));
 const {LayerSystem}=await import('../../../src/engine/layer-system.js');LayerSystem.webglEnabled=false;
 ({SelectionJobs}=await import('../../../src/features/modernization/selection-jobs.js'));
 const {TrackerRegistry}=await import('../../../src/features/trackers/tracker-registry.js');History=TrackerRegistry.History;
 ({VectorMask,Mask}=await import('../../../src/document/model/layer-masks.js'));
});
function fixture(){
 const doc=new Document('subject.psd');doc.width=40;doc.height=30;doc.buffer=new Uint8Array(40*30*4);
 const layer=doc.newLayer();layer.rect=new Rect(3,4,5,3);layer.setName('Original');layer.buffer=new Uint8Array(60).fill(255);doc.setLayers([layer]);doc.selectedLayerIndices=[0];
 const controller={openDocs:[doc],getCurrentDoc:()=>doc,pointerState:{isDown:false}};
 const fake=fakeProvider();Object.assign(fake.provider,{validateInput:validateSubjectInput,copyResult:copySubjectResult});
 const bridge=new SelectionJobs(controller,undefined,false,undefined,fake.provider),history=new History();
 const result=(call=fake.calls.at(-1))=>reconstructSubjectMask(call.input,subjectMapping(call.input.rect),new Float32Array(512*512),[1,1,512,512]);
 return {doc,layer,controller,bridge,history,result,...fake};
}
for(const remove of [false,true])it(`${remove?'background mask':'selection'} commits only on Accept, one entry, exact Undo/Redo, immutable source`,async()=>{
 const f=fixture(),before=f.layer.buffer.slice(),id=f.bridge.submitSubject(f.doc,remove);const states=[];f.bridge.jobs.subscribe(j=>states.push(j.state));await flushJobs();
 assert.notEqual(f.calls[0].input.rgba,f.layer.buffer);f.calls[0].complete(f.result());assert.equal(f.doc.history.length,1);assert.equal(f.doc.selectionMask,null);assert.equal(f.layer.getMask(),null);
 assert.equal(f.bridge.jobs.get(id).state,'preview');assert.ok(f.doc.toolOverlayState.jobSelectionPreview);
 assert.equal(f.bridge.jobs.accept(id),true);assert.equal(f.doc.history.length,2);const accepted=remove?f.layer.getMask().clone():{...f.doc.selectionMask,channel:f.doc.selectionMask.channel.slice()};
 assert.deepEqual(f.layer.buffer,before);f.history.stepHistoryBackward(f.doc);assert.equal(remove?f.layer.getMask():f.doc.selectionMask,null);
 f.history.stepHistoryForward(f.doc);assert.deepEqual((remove?f.layer.getMask():f.doc.selectionMask).channel,accepted.channel);assert.deepEqual(f.layer.buffer,before);assert.equal(f.calls.length,1);
 assert.ok(states.includes('preparing')&&states.includes('running')&&states.includes('preview')&&states.includes('committed'));
});
for(const action of ['discard','cancel'])it(action+' releases preview without history',async()=>{
 const f=fixture(),id=f.bridge.submitSubject(f.doc);await flushJobs();f.calls[0].complete(f.result());f.bridge.jobs[action](id);
 assert.equal(f.doc.history.length,1);assert.equal(f.doc.selectionMask,null);assert.equal(f.doc.toolOverlayState.jobSelectionPreview,null);assert.equal(f.bridge.jobs.get(id).hasResult,false);
});
it('cancel in inference revokes Accept and late/duplicate result cannot mutate',async()=>{
 const f=fixture(),id=f.bridge.submitSubject(f.doc);await flushJobs();const r=f.result();f.bridge.jobs.cancel(id);f.calls[0].complete(r);f.calls[0].complete(r);
 assert.equal(f.calls[0].cancellations,1);assert.equal(f.bridge.jobs.get(id).state,'cancelled');assert.equal(f.doc.history.length,1);assert.throws(()=>f.bridge.jobs.accept(id));
});
it('new invocation is authoritative over running and previewed requests',async()=>{
 const f=fixture(),a=f.bridge.submitSubject(f.doc);await flushJobs();const old=f.result();const b=f.bridge.submitSubject(f.doc,true);await flushJobs();
 f.calls[1].complete(f.result());f.calls[0].complete(old);assert.equal(f.doc.toolOverlayState.jobSelectionPreview.jobId,b);assert.equal(f.bridge.jobs.get(a).state,'cancelled');
 const c=f.bridge.submitSubject(f.doc);await flushJobs();assert.equal(f.bridge.jobs.get(b).state,'cancelled');f.calls[2].complete(f.result());assert.equal(f.doc.toolOverlayState.jobSelectionPreview.jobId,c);
});
const mutations={pixels:f=>f.layer.buffer[51]--,origin:f=>f.layer.rect.x++,channels:f=>f.doc.activeChannels=[0],source:f=>f.layer.pixelContent=1,selection:f=>f.doc.selectionMask={rect:new Rect(0,0,1,1),channel:new Uint8Array(4)},target:f=>f.doc.selectedLayerIndices=[],history:f=>f.doc.history[0]={},geometry:f=>f.doc.width++};
for(const [label,mutate] of Object.entries(mutations))for(const remove of [false,true])it(`stale ${label}, ${remove?'mask':'selection'}, blocks completion and Accept`,async()=>{
 const f=fixture(),id=f.bridge.submitSubject(f.doc,remove);await flushJobs();const r=f.result();mutate(f);f.calls[0].complete(r);assert.equal(f.bridge.jobs.get(id).state,'stale');assert.equal(f.doc.history.length,1);assert.equal(f.layer.getMask(),null);
});
it('freshness is checked again at Accept before periodic tick',async()=>{
 const f=fixture(),id=f.bridge.submitSubject(f.doc);await flushJobs();f.calls[0].complete(f.result());f.layer.buffer[51]--;assert.equal(f.bridge.jobs.accept(id),false);assert.equal(f.doc.history.length,1);
});
it('tab switch retains original document; document close cancels late completion',async()=>{
 const f=fixture(),g=fixture();f.controller.openDocs.push(g.doc);const id=f.bridge.submitSubject(f.doc,true);await flushJobs();f.controller.getCurrentDoc=()=>g.doc;f.calls[0].complete(f.result());assert.equal(f.bridge.jobs.accept(id),true);assert.equal(g.layer.getMask(),null);assert.ok(f.layer.getMask());
 const h=fixture(),j=h.bridge.submitSubject(h.doc);await flushJobs();const r=h.result();h.bridge.close(h.doc);h.controller.openDocs=[];h.calls[0].complete(r);assert.equal(h.bridge.jobs.get(j).state,'cancelled');assert.equal(h.doc.history.length,1);
});
it('malformed output/failure never alters original layer or history',async()=>{
 const f=fixture(),id=f.bridge.submitSubject(f.doc,true);await flushJobs();const r=f.result();r.rect.x++;f.calls[0].complete(r);assert.equal(f.bridge.jobs.get(id).state,'failed');assert.equal(f.layer.getMask(),null);assert.equal(f.doc.history.length,1);
});
it('existing raster mask intersection and vector coexistence use M0 and survive PSD',async()=>{
 const {PSDParser}=await import('../../../src/document/formats/psd/psd-parser.js');const {RenderBuffer}=await import('../../../src/core/render-buffer.js');
 const {TrackerRegistry}=await import('../../../src/features/trackers/tracker-registry.js');const {registerTrackers}=await import('../../../src/features/trackers/register-trackers.js');registerTrackers(TrackerRegistry);
 for(const enabled of [true,false]){
  const f=fixture();f.layer.add.vmsk=new VectorMask();f.layer.add.vmsk.isEnabled=enabled;
  f.layer.d=Object.assign(new Mask(),{rect:f.layer.rect.clone(),channel:new Uint8Array(16).fill(128),color:0});
  if(enabled)f.layer.warpData=f.layer.d.clone();
  const before=f.layer.buffer.slice(),old=f.layer.getMask().clone(),id=f.bridge.submitSubject(f.doc,true);await flushJobs();f.calls[0].complete(f.result());assert.equal(f.bridge.jobs.accept(id),true);
  const mask=f.layer.getMask().clone();assert.ok(mask.channel.subarray(0,15).every(x=>x===64));assert.deepEqual(f.layer.buffer,before);
  f.history.stepHistoryBackward(f.doc);assert.deepEqual(f.layer.getMask().channel,old.channel);f.history.stepHistoryForward(f.doc);assert.deepEqual(f.layer.getMask().channel,mask.channel);
  const b=new RenderBuffer(),n=PSDParser.serialize(f.doc,b,[false,false,false,false]),reopened=new Document('reopened.psd');PSDParser.parse(b.data.slice(0,n).buffer,reopened);
  assert.deepEqual(reopened.layers[0].buffer,before);assert.deepEqual(reopened.layers[0].getMask().channel,mask.channel);assert.equal(reopened.layers[0].add.vmsk.isEnabled,enabled);
 }
});
it('manual Remove Background remains available after accepted selection/refinement',async()=>{
 const {removeBackgroundFromSelection}=await import('../../../src/features/trackers/exact-result-tracker.js');const f=fixture(),id=f.bridge.submitSubject(f.doc);await flushJobs();f.calls[0].complete(f.result());f.bridge.jobs.accept(id);removeBackgroundFromSelection(f.controller);assert.ok(f.layer.getMask());assert.equal(f.doc.history.length,3);
});
