import { validateGenerativeInput } from "../../../src/features/modernization/generative-workload.js";
import { copyInpaintResult } from "../../../src/features/modernization/inpaint-workload.js";
import assert from "node:assert/strict";
import { before, it } from "node:test";
import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
import { installXmlDom } from "../../helpers/xml-dom.js";
import { fakeProvider, flushJobs } from "./fake-provider.js";
import { expansionGeometry, prepareExpandInput, containExpandResult, assertOriginalProjection } from "../../../src/features/modernization/expand-workload.js";
installBrowserGlobals(); installXmlDom();
let Document, Rect, LayerSystem, SelectionJobs, TrackerRegistry, Mask;
before(async () => {
  ({ Document } = await import("../../../src/document/model/document.js"));
  ({ Rect } = await import("../../../src/core/math/rect.js"));
  ({ LayerSystem } = await import("../../../src/engine/layer-system.js")); LayerSystem.webglEnabled = false;
  ({ SelectionJobs } = await import("../../../src/features/modernization/selection-jobs.js"));
  ({ TrackerRegistry } = await import("../../../src/features/trackers/tracker-registry.js"));
  ({ Mask } = await import("../../../src/document/model/layer-masks.js"));
});
const config = { enabled: true, endpoint: "http://127.0.0.1:8188", checkpoint: "sd-v1-5-inpainting.ckpt" };
const sides = { left: 7, top: 9, right: 11, bottom: 13 };
function fixture() {
  const doc = new Document("expand.psd"); doc.width = 31; doc.height = 27;
  const layer = doc.newLayer(); layer.rect = new Rect(-3, -2, 40, 32); layer.setName("Source");
  layer.buffer = Uint8Array.from({ length: 40 * 32 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251);
  doc.setLayers([layer]); doc.selectedLayerIndices = [0]; doc.guides = [[0, 13], [4, 26]];
  doc.markDirty(); doc.getRasterData();
  const controller = { openDocs: [doc], getCurrentDoc: () => doc, pointerState: { isDown: false } };
  const fake = fakeProvider(); fake.provider.validateInput = validateGenerativeInput; fake.provider.copyResult = copyInpaintResult;
  // Test production mapping/containment with an intentionally hostile editor-sized result.
  const bridge = new SelectionJobs(controller, undefined, false, undefined, undefined, undefined, undefined, undefined, fake.provider);
  const submit = (edge = sides, options = {}) => bridge.submitExpand(doc, config, edge, { prompt: "", seed: 42, count: 1, ...options });
  return { doc, layer, controller, bridge, fake, submit, history: new TrackerRegistry.History() };
}
function state(f) {
  f.doc.markDirty();
  return { width: f.doc.width, height: f.doc.height, layers: f.doc.layers.map(l => ({ rect: { ...l.rect }, pixels: [...l.buffer], mask: l.getMask() && { rect: { ...l.getMask().rect }, bytes: [...l.getMask().channel] } })), guides: structuredClone(f.doc.guides), composite: [...f.doc.getRasterData()], history: f.doc.history.slice(), index: f.doc.historyIndex };
}
async function preview(f, edge = sides) {
  const id = f.submit(edge); await flushJobs();
  const g = expansionGeometry(f.doc.width, f.doc.height, edge);
  f.fake.calls.at(-1).complete({ pixelFormat: "rgba8", rect: { x: 0, y: 0, width: g.newWidth, height: g.newHeight }, bytes: new Uint8Array(g.byteLength).fill(197), byteLength: g.byteLength });
  await flushJobs(); assert.equal(f.bridge.jobs.get(id).state, "preview", JSON.stringify(f.bridge.jobs.get(id))); return id;
}
for (const edge of [{left:0,top:0,right:8,bottom:0},{left:8,top:0,right:0,bottom:0},{left:0,top:8,right:0,bottom:0},{left:0,top:0,right:0,bottom:8},sides]) it("exact geometry, containment, one undo and backend-free replay " + JSON.stringify(edge), async () => {
  const f = fixture(), before = state(f), original = f.layer.buffer.slice();
  const id = await preview(f, edge); assert.deepEqual(state(f), before);
  const g = expansionGeometry(before.width, before.height, edge);
  assert.equal(f.bridge.jobs.accept(id), true, JSON.stringify(f.bridge.jobs.get(id)));
  const after = state(f); assert.equal(after.history.length, before.history.length + 1);
  assert.deepEqual(f.layer.buffer, original); assert.equal(f.layer.rect.x, -3 + edge.left); assert.equal(f.layer.rect.y, -2 + edge.top);
  assert.deepEqual(f.doc.guides, [before.guides[0].map(x => x + edge.left), before.guides[1].map(y => y + edge.top)]);
  assertOriginalProjection(Uint8Array.from(before.composite), f.doc.buffer, g);
  const output = f.doc.layers.at(-1).buffer;
  for (let y=0;y<g.height;y++) for(let x=0;x<g.width;x++) assert.deepEqual([...output.subarray(((y+g.top)*g.newWidth+x+g.left)*4,((y+g.top)*g.newWidth+x+g.left)*4+4)],[0,0,0,0]);
  f.history.stepHistoryBackward(f.doc); const undone=state(f); assert.deepEqual({...undone,history:before.history},before);
  f.history.stepHistoryForward(f.doc); assert.deepEqual(state(f),after); assert.equal(f.fake.calls.length,1);
});
it("invalid geometry and requests fail without inference or document changes", async () => {
  const f=fixture(), before=state(f);
  for(const value of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,513,"1",undefined]) assert.throws(()=>f.submit({...sides,left:value}));
  assert.throws(()=>f.submit({left:0,top:0,right:0,bottom:0})); assert.throws(()=>expansionGeometry(1024,1024,sides));
  assert.throws(()=>f.submit(sides,{count:3})); assert.throws(()=>f.submit(sides,{prompt:"\0"}));
  await flushJobs(); assert.equal(f.fake.calls.length,0); assert.deepEqual(state(f),before);
});
it("padded model, expanded coordinates and bounded overlap stay distinct", () => {
  const g=expansionGeometry(31,27,sides), source=new Uint8Array(31*27*4).fill(91), {input}=prepareExpandInput(source,g,config,{prompt:"  sky\n",count:1,seed:42});
  assert.equal(input.modelWidth,512);assert.equal(input.modelHeight,512);assert.deepEqual(input.modelOffset,{x:0,y:0});assert.equal(input.prompt,"  sky\n");
  for(let y=0;y<27;y++)assert.deepEqual(input.rgba.subarray(((y+9)*512+7)*4,((y+9)*512+38)*4),source.subarray(y*31*4,(y+1)*31*4));
  assert.equal(input.mask.at(-1),0);assert.equal(input.mask[0],255);
  assert.throws(()=>containExpandResult({rect:{x:1}},g));
});
for(const kind of ["artboard","vector","text","smart","selection","channel","slice","path","effect"])it("explicit unsupported rejection: "+kind,async()=>{
 const f=fixture();if(kind==="artboard")f.layer.add.artb={};if(kind==="vector")f.layer.add.vmsk={};if(kind==="text")f.layer.add.TySh={};if(kind==="smart")f.layer.add.placedData={};if(kind==="selection")f.doc.selectionMask={};if(kind==="channel")f.doc.extraChannels.push({});if(kind==="slice")f.doc.slices.push({});if(kind==="path")f.doc.paths.push({});if(kind==="effect")f.layer.add.lfx2={};
 assert.throws(()=>f.submit(),/Generative Expand v1/);await flushJobs();assert.equal(f.fake.calls.length,0);assert.equal(f.doc.width,31);assert.equal(f.doc.history.length,1);
});
for(const action of ["cancel","discard","close","pixels","geometry","history","guides","mask"])it("lifecycle revokes authority: "+action,async()=>{
 const f=fixture();if(action==="mask"){const m=new Mask();m.rect=new Rect(0,0,2,2);m.channel=new Uint8Array(4).fill(255);f.layer.d=m;}
 const id=await preview(f);
 if(action==="cancel")f.bridge.jobs.cancel(id);if(action==="discard")f.bridge.jobs.discard(id);if(action==="close"){f.controller.openDocs=[];f.bridge.close(f.doc);}if(action==="pixels")f.layer.buffer[0]^=1;if(action==="geometry")f.layer.rect.x++;if(action==="history")f.doc.historyIndex++;if(action==="guides")f.doc.guides[0][0]++;if(action==="mask")f.layer.d.channel[0]^=1;
 if(!["cancel","discard","close"].includes(action))assert.equal(f.bridge.jobs.revalidate(id),false);
 assert.equal(f.bridge.expandPreviews.size,0);assert.equal(f.doc.width,31);assert.equal(f.doc.layers.length,1);assert.throws(()=>f.bridge.jobs.accept(id));
});
it("raster masks translate exactly with their layer and replay exact bytes",async()=>{
 const f=fixture(), m=new Mask();m.rect=new Rect(-1,1,4,3);m.channel=Uint8Array.from([0,10,128,255,255,190,90,20,1,2,3,4]);m.color=0;f.layer.d=m;
 const before=state(f),id=await preview(f);assert.equal(f.bridge.jobs.accept(id),true,JSON.stringify(f.bridge.jobs.get(id)));
 assert.equal(f.layer.d.rect.x,6);assert.equal(f.layer.d.rect.y,10);assert.deepEqual(f.layer.d.channel,m.channel);
 f.history.stepHistoryBackward(f.doc);assert.deepEqual({...state(f),history:before.history},before);
});
it("history failure rolls back geometry, layers, masks, composite and redo branch",async()=>{
 const f=fixture();const id=await preview(f),before=state(f),push=f.doc.pushHistory;
 f.doc.pushHistory=function(entry){push.call(this,entry);throw new Error("injected history failure");};
 assert.equal(f.bridge.jobs.accept(id),false);delete f.doc.pushHistory;assert.deepEqual(state(f),before);
});
it("tab switch cannot redirect expansion",async()=>{
 const f=fixture(),id=await preview(f),other=new Document("other");f.controller.openDocs.push(other);f.controller.getCurrentDoc=()=>other;
 assert.equal(f.bridge.jobs.accept(id),true);assert.equal(other.width,0);assert.equal(f.doc.width,49);
});
it("groups and multiple off-canvas masked layers preserve original composition", async()=>{
 const f=fixture();const end=f.doc.createGroupEndLayer(true),group=f.doc.newLayer(true);group.add.lsct=1;group.blendMode="pass";group.setName("Group");
 const second=f.doc.newLayer();second.rect=new Rect(14,17,23,21);second.buffer=new Uint8Array(23*21*4).fill(90);second.setName("Second");
 f.doc.setLayers([end,f.layer,second,group]);f.doc.selectedLayerIndices=[1];
 const before=state(f),id=await preview(f);assert.equal(f.bridge.jobs.accept(id),true,JSON.stringify(f.bridge.jobs.get(id)));const after=state(f);
 assertOriginalProjection(Uint8Array.from(before.composite),f.doc.buffer,expansionGeometry(31,27,sides));
 f.history.stepHistoryBackward(f.doc);assert.deepEqual({...state(f),history:before.history},before);f.history.stepHistoryForward(f.doc);assert.deepEqual(state(f),after);
});
for(const large of [false,true])it("real PSD/PSB offline serialization preserves expansion, masks and guides: "+large,async()=>{
 const {PSDParser}=await import("../../../src/document/formats/psd/psd-parser.js");const {RenderBuffer}=await import("../../../src/core/render-buffer.js");const {registerTrackers}=await import("../../../src/features/trackers/register-trackers.js");registerTrackers(TrackerRegistry);
 const f=fixture(),m=new Mask();m.rect=new Rect(-1,1,4,3);m.channel=new Uint8Array(12).fill(128);m.color=0;f.layer.d=m;
 f.doc.resources.r9999=Uint8Array.of(0,128,255,7);
 const id=await preview(f);assert.equal(f.bridge.jobs.accept(id),true);const accepted=state(f),buffer=new RenderBuffer();
 const length=PSDParser.serialize(f.doc,buffer,[false,false,false,large]);const reopened=new Document("offline"+(large?".psb":".psd"));PSDParser.parse(buffer.data.slice(0,length).buffer,reopened);
 assert.equal(reopened.width,49);assert.equal(reopened.height,49);assert.deepEqual(reopened.guides,f.doc.guides);
 reopened.setLayers(reopened.layers); reopened.invalidateAllLayers(); reopened.markDirty(); reopened.getRasterData(); assert.deepEqual([...reopened.buffer],accepted.composite);assert.equal(reopened.layers.length,2);
 for(let i=0;i<2;i++){assert.deepEqual(reopened.layers[i].rect,f.doc.layers[i].rect);assert.deepEqual(reopened.layers[i].buffer,f.doc.layers[i].buffer);}
 assert.deepEqual(reopened.layers[0].d.rect,f.layer.d.rect);assert.deepEqual(reopened.layers[0].d.channel,f.layer.d.channel);
 assert.deepEqual(reopened.resources.r9999,f.doc.resources.r9999);
});
for(const large of [false,true])it("reopened empty group markers remain eligible for expansion: "+large,async()=>{
 const {PSDParser}=await import("../../../src/document/formats/psd/psd-parser.js"),{RenderBuffer}=await import("../../../src/core/render-buffer.js"),{requireExpandDocument}=await import("../../../src/features/modernization/expand-source.js");
 const f=fixture(),group=f.doc.newLayer();group.setName("Group");group.add.lsct=1;group.blendMode="pass";f.doc.setLayers([f.doc.createGroupEndLayer(),f.layer,group]);f.doc.selectedLayerIndices=[1];
 const id=await preview(f);assert.equal(f.bridge.jobs.accept(id),true);const accepted=state(f),buffer=new RenderBuffer(),length=PSDParser.serialize(f.doc,buffer,[false,false,false,large]),reopened=new Document("group.psd");PSDParser.parse(buffer.data.slice(0,length).buffer,reopened);reopened.setLayers(reopened.layers);reopened.invalidateAllLayers();reopened.markDirty();
 assert.deepEqual([...reopened.getRasterData()],accepted.composite);assert.deepEqual(reopened.layers[1].buffer,f.layer.buffer);assert.deepEqual(reopened.layers[1].rect,f.layer.rect);assert.deepEqual(reopened.guides,f.doc.guides);assert.equal(reopened.layers[0].buffer.length,0);assert.doesNotThrow(()=>requireExpandDocument(reopened));
 const fake=fakeProvider();fake.provider.validateInput=validateGenerativeInput;fake.provider.copyResult=copyInpaintResult;const controller={openDocs:[reopened],getCurrentDoc:()=>reopened,pointerState:{isDown:false}},bridge=new SelectionJobs(controller,undefined,false,undefined,undefined,undefined,undefined,undefined,fake.provider),before=reopened.getRasterData().slice(),g=expansionGeometry(reopened.width,reopened.height,sides),next=bridge.submitExpand(reopened,config,sides,{prompt:"",count:1,seed:42});await flushJobs();fake.calls[0].complete({pixelFormat:"rgba8",rect:{x:0,y:0,width:g.newWidth,height:g.newHeight},bytes:new Uint8Array(g.byteLength).fill(197),byteLength:g.byteLength});await flushJobs();assert.equal(bridge.jobs.accept(next),true,JSON.stringify(bridge.jobs.get(next)));assertOriginalProjection(before,reopened.getRasterData(),g);
});
it("undo then a different edit abandons expand redo through normal history",async()=>{
 const {HistoryEntry}=await import("../../../src/document/model/document.js");const f=fixture(),id=await preview(f);f.bridge.jobs.accept(id);f.history.stepHistoryBackward(f.doc);
 f.doc.pushHistory(new HistoryEntry("other",{id:0,undo(){},redo(){}}));assert.equal(f.doc.history.length,2);assert.equal(f.doc.history[1].name,"other");f.history.stepHistoryForward(f.doc);assert.equal(f.doc.width,31);
});
for(const point of ["snapshot","resize","translation","insertion","live-tree","history"])it("fault rollback at "+point,async()=>{
 const f=fixture(),mask=new Mask();mask.rect=new Rect(-1,1,4,3);mask.channel=new Uint8Array(12).fill(127);mask.color=0;f.layer.d=mask;
 const id=await preview(f),before=state(f);let restore;
 const {Layer}=await import("../../../src/document/model/layer.js");
 const intercept=(object,key,fn)=>{const original=object[key];object[key]=fn(original);restore=()=>{object[key]=original;};};
 if(point==="snapshot")intercept(Layer.prototype,"clone",()=>()=>{throw Error("snapshot");});
 if(point==="resize")intercept(Document.prototype,"invalidateAllLayers",original=>function(...args){if(this!==f.doc)throw Error("resize");return original.apply(this,args);});
 if(point==="translation")intercept(Layer.prototype,"invalidate",original=>function(doc){const value=original.call(this,doc);if(doc!==f.doc&&doc.width===49)throw Error("translation");return value;});
 if(point==="insertion")intercept(Document.prototype,"setLayers",original=>function(layers){const value=original.call(this,layers);if(this!==f.doc&&layers.length===2)throw Error("insertion");return value;});
 if(point==="live-tree")intercept(Document.prototype,"rebuildLayerTree",original=>function(){const value=original.call(this);if(this===f.doc&&this.width===49)throw Error("live-tree");return value;});
 if(point==="history")intercept(Document.prototype,"pushHistory",original=>function(entry){original.call(this,entry);throw Error("history");});
 try{assert.equal(f.bridge.jobs.accept(id),false);}finally{restore();}
 assert.deepEqual(state(f),before);assert.equal(f.doc.layers[0],f.layer);assert.equal(f.bridge.expandPreviews.size,0);
});
for(const enabled of [false,true])it("raster mask density/outside coverage survive translation; enabled="+enabled,async()=>{
 const f=fixture(),m=new Mask();m.rect=new Rect(-1,2,4,3);m.channel=new Uint8Array(12).fill(128);m.color=255;m.density=193;m.enabled=false;m.isEnabled=enabled;m.overlayTintRgb={h:12,l:43,O:91};f.layer.d=m;
 const before=state(f),id=await preview(f);assert.equal(f.bridge.jobs.accept(id),true);assert.equal(f.layer.d.density,193);assert.equal(f.layer.d.enabled,false);assert.equal(f.layer.d.isEnabled,enabled);assert.equal(f.layer.d.color,255);
 f.layer.d.overlayTintRgb.h=44;f.history.stepHistoryBackward(f.doc);assert.deepEqual({...state(f),history:before.history},before);assert.equal(f.layer.d.overlayTintRgb.h,12);
});
it("late output after cancellation cannot recreate preview or mutate geometry",async()=>{
 const f=fixture(),before=state(f),id=f.submit();await flushJobs();const call=f.fake.calls[0];f.bridge.jobs.cancel(id);const g=expansionGeometry(31,27,sides);call.complete({pixelFormat:"rgba8",rect:{x:0,y:0,width:g.newWidth,height:g.newHeight},byteLength:g.byteLength,bytes:new Uint8Array(g.byteLength)});await flushJobs();assert.deepEqual(state(f),before);assert.equal(f.bridge.expandPreviews.size,0);assert.equal(f.bridge.jobs.get(id).state,"cancelled");
});
it("wrong-sized provider output is rejected without mutation",async()=>{
 const f=fixture(),before=state(f),id=f.submit();await flushJobs();f.fake.calls[0].complete({pixelFormat:"rgba8",rect:{x:0,y:0,width:1,height:1},byteLength:4,bytes:new Uint8Array(4)});await flushJobs();assert.deepEqual(state(f),before);assert.equal(f.bridge.expandPreviews.size,0);assert.equal(f.bridge.jobs.get(id).state,"failed");
});
it("failed Accept preserves an existing redo branch and saved history index",async()=>{
 const {HistoryEntry}=await import("../../../src/document/model/document.js");const f=fixture();f.doc.pushHistory(new HistoryEntry("prior redo",{id:0,undo(){},redo(){}}));f.doc.savedHistoryIndex=1;f.history.stepHistoryBackward(f.doc);
 const id=await preview(f),before=state(f),saved=f.doc.savedHistoryIndex,push=f.doc.pushHistory;f.doc.pushHistory=function(entry){push.call(this,entry);throw Error("after redo truncation")};try{assert.equal(f.bridge.jobs.accept(id),false);}finally{delete f.doc.pushHistory;}
 assert.deepEqual(state(f),before);assert.equal(f.doc.savedHistoryIndex,saved);assert.equal(f.doc.history[1].name,"prior redo");
});
it("exact upper bound and dimension/area/source-byte caps reject before work",async()=>{
 assert.equal(expansionGeometry(512,512,{left:256,top:256,right:256,bottom:256}).byteLength,4194304);
 assert.throws(()=>expansionGeometry(1,1,{left:511,top:511,right:512,bottom:512}));
 const f=fixture();f.layer.rect=new Rect(0,0,2049,2048);f.layer.buffer=new Uint8Array(2049*2048*4);assert.throws(()=>f.submit(),/16 MiB/);await flushJobs();assert.equal(f.fake.calls.length,0);
});

it("resource backing bytes join raster and mask bytes at the exact source limit", async () => {
  const { EXPAND_LIMITS } = await import("../../../src/features/modernization/expand-workload.js");
  const { requireExpandDocument, captureExpandSource } = await import("../../../src/features/modernization/expand-source.js");
  const f = fixture(), mask = new Mask();
  mask.rect = new Rect(0, 0, 2, 2); mask.channel = new Uint8Array(4); f.layer.d = mask;
  const remaining = EXPAND_LIMITS.sourceBytes - requireExpandDocument(f.doc);
  f.doc.resources.r9999 = new Uint8Array(remaining);
  assert.equal(requireExpandDocument(f.doc), EXPAND_LIMITS.sourceBytes);
  const context = captureExpandSource(f.controller, f.doc, expansionGeometry(31, 27, sides));
  assert.ok(context.metadata.length < 1048576);
  assert.notEqual(context.resourceState.find(([key]) => key === "r9999")[1].buffer, f.doc.resources.r9999.buffer);
  const id = f.submit(); await flushJobs(); assert.equal(f.fake.calls.length, 1); f.bridge.jobs.cancel(id);
  f.doc.resources.r9999 = new Uint8Array(remaining + 1);
  const before = state(f), resources = structuredClone(f.doc.resources);
  f.doc.getRasterData = () => { throw Error("must reject before compositing"); };
  assert.throws(() => f.submit(), /resource buffers exceed 16 MiB/);
  await flushJobs(); assert.equal(f.fake.calls.length, 1); delete f.doc.getRasterData;
  assert.deepEqual(state(f), before); assert.deepEqual(f.doc.resources, resources);
});

it("a tiny resource view cannot hide an oversized backing-buffer clone", async () => {
  const f = fixture(), backing = new ArrayBuffer(16 * 1048576 + 1);
  f.doc.resources.r9999 = new Uint8Array(backing, 7, 1);
  const before = state(f);
  f.doc.getRasterData = () => { throw Error("must reject before compositing"); };
  assert.throws(() => f.submit(), /resource buffers exceed 16 MiB/);
  await flushJobs(); assert.equal(f.fake.calls.length, 0); delete f.doc.getRasterData;
  assert.deepEqual(state(f), before); assert.equal(f.doc.resources.r9999.buffer, backing);
});

it("aggregate resource overflow rejects synchronously with zero provider calls", async () => {
  const { requireExpandDocument } = await import("../../../src/features/modernization/expand-source.js");
  const f = fixture(), mask = new Mask();
  mask.rect = new Rect(0, 0, 2, 2); mask.channel = new Uint8Array(4); f.layer.d = mask;
  f.doc.resources.r9999 = new Uint8Array(16 * 1048576 - requireExpandDocument(f.doc) + 1);
  const before = state(f), resources = structuredClone(f.doc.resources);
  f.doc.getRasterData = () => { throw Error("must reject before compositing"); };
  assert.throws(() => f.submit(), /resource buffers exceed 16 MiB/);
  await flushJobs(); assert.equal(f.fake.calls.length, 0); delete f.doc.getRasterData;
  assert.deepEqual(state(f), before); assert.deepEqual(f.doc.resources, resources);
});

it("shared resource objects and overlapping views count their backing storage once", async () => {
  const { requireExpandDocument, captureExpandSource } = await import("../../../src/features/modernization/expand-source.js");
  const f = fixture(), baseline = requireExpandDocument(f.doc), backing = new ArrayBuffer(9 * 1048576);
  f.doc.resources.r9997 = new Uint8Array(backing);
  f.doc.resources.r9998 = f.doc.resources.r9997;
  f.doc.resources.r9999 = new Uint8Array(backing, 1, 8);
  assert.equal(requireExpandDocument(f.doc), baseline + backing.byteLength);
  const context = captureExpandSource(f.controller, f.doc, expansionGeometry(31, 27, sides));
  const captured = new Map(context.resourceState);
  assert.equal(captured.get("r9997"), captured.get("r9998"));
  assert.equal(captured.get("r9997").buffer, captured.get("r9999").buffer);
  assert.notEqual(captured.get("r9997").buffer, backing);
});

for (const change of ["byte", "replacement", "add", "remove", "rename"]) {
  it("resource freshness revokes preview and Accept after " + change, async () => {
    const f = fixture(); f.doc.resources.r9999 = Uint8Array.of(1, 2, 3);
    const id = await preview(f), before = state(f);
    if (change === "byte") f.doc.resources.r9999[1] = 9;
    if (change === "replacement") f.doc.resources.r9999 = Uint8Array.of(1, 9, 3);
    if (change === "add") f.doc.resources.r9998 = Uint8Array.of(4);
    if (change === "remove") delete f.doc.resources.r9999;
    if (change === "rename") { f.doc.resources.r9998 = f.doc.resources.r9999; delete f.doc.resources.r9999; }
    const resources = structuredClone(f.doc.resources);
    assert.equal(f.bridge.jobs.revalidate(id), false);
    assert.equal(f.bridge.jobs.get(id).state, "stale");
    assert.throws(() => f.bridge.jobs.accept(id));
    assert.deepEqual(state(f), before); assert.deepEqual(f.doc.resources, resources);
    assert.equal(f.bridge.expandPreviews.size, 0); assert.equal(f.fake.calls.length, 1);
  });
}

it("Accept itself rejects changed resource bytes without prior revalidation", async () => {
  const f = fixture(); f.doc.resources.r9999 = Uint8Array.of(1, 2, 3);
  const id = await preview(f), before = state(f); f.doc.resources.r9999[0]++;
  assert.equal(f.bridge.jobs.accept(id), false);
  assert.equal(f.bridge.jobs.get(id).state, "stale"); assert.deepEqual(state(f), before);
});

it("identical resource bytes and reordered keys remain fresh", async () => {
  const f = fixture(); f.doc.resources.r9998 = Uint8Array.of(1); f.doc.resources.r9999 = Uint8Array.of(2);
  const id = await preview(f), entries = Object.entries(f.doc.resources).reverse();
  f.doc.resources = Object.fromEntries(entries.map(([key, bytes]) => [key, bytes.slice()]));
  assert.equal(f.bridge.jobs.revalidate(id), true); assert.equal(f.bridge.jobs.accept(id), true);
});

it("Accept, Undo and Redo preserve exact resource keys and bytes without inference", async () => {
  const { BinaryUtils } = await import("../../../src/core/binary/binary-utils.js");
  const f = fixture(), backing = Uint8Array.of(99, 1, 2, 3, 98);
  f.doc.resources.r0 = new Uint8Array(0);
  f.doc.resources.r1005 = new Uint8Array(16);
  f.doc.resources.r1044 = Uint8Array.of(0, 0, 0, 42);
  f.doc.resources.r9998 = backing.subarray(1, 4);
  f.doc.resources.r9999 = f.doc.resources.r9998;
  f.doc.resources.r65535 = Uint8Array.of(0, 128, 255);
  const original = structuredClone(f.doc.resources), id = await preview(f);
  assert.equal(f.bridge.jobs.accept(id), true);
  const accepted = structuredClone(f.doc.resources);
  assert.deepEqual(Object.keys(accepted).sort(), Object.keys(original).sort());
  for (const key of Object.keys(original)) if (key !== "r1044") assert.deepEqual(accepted[key], original[key]);
  assert.equal(BinaryUtils.readUint32BE(accepted.r1044, 0), 43);
  f.doc.resources.r9998[0] = 77;
  f.history.stepHistoryBackward(f.doc); assert.deepEqual(f.doc.resources, original);
  f.doc.resources.r65535[0] = 66;
  f.history.stepHistoryForward(f.doc); assert.deepEqual(f.doc.resources, accepted);
  assert.equal(f.fake.calls.length, 1);
});

for (const [kind, value] of [
  ["object", {}], ["string", "bytes"], ["function", () => {}], ["array", [1, 2]],
  ["ArrayBuffer", new ArrayBuffer(4)], ["DataView", new DataView(new ArrayBuffer(4))],
  ["Uint16Array", new Uint16Array(2)], ["Uint8ClampedArray", new Uint8ClampedArray(4)],
  ["shared", new Uint8Array(new SharedArrayBuffer(4))],
]) it("unsupported resource rejects before provider work: " + kind, async () => {
  const f = fixture(); f.doc.resources.r9999 = value; const before = state(f);
  assert.throws(() => f.submit(), /Generative Expand v1: unsupported document resources/);
  await flushJobs(); assert.equal(f.fake.calls.length, 0);
  assert.deepEqual(state(f), before); assert.equal(f.doc.resources.r9999, value);
});

for (const key of ["r01", "r-1", "r65536", "r1x", "other", Symbol("r1005")]) {
  it("unsupported resource key rejects before provider work: " + String(key), async () => {
    const f = fixture(); f.doc.resources[key] = Uint8Array.of(1); const before = state(f);
    assert.throws(() => f.submit(), /unsupported document resources/);
    await flushJobs(); assert.equal(f.fake.calls.length, 0); assert.deepEqual(state(f), before);
    assert.deepEqual(f.doc.resources[key], Uint8Array.of(1));
  });
}

it("resource accessors and detached buffers fail without invoking getters or inference", async () => {
  const f = fixture();
  Object.defineProperty(f.doc.resources, "r9999", { enumerable: true, configurable: true, get() { throw Error("must not invoke resource getter"); } });
  assert.throws(() => f.submit(), /unsupported document resources/);
  delete f.doc.resources.r9999;
  const bytes = new Uint8Array(4); structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
  f.doc.resources.r9999 = bytes;
  assert.throws(() => f.submit(), /unsupported document resources/);
  await flushJobs(); assert.equal(f.fake.calls.length, 0);
});

it("oversized PSD additional binary metadata rejects before compositor work", async () => {
  const f = fixture(); f.doc.add.FMsk = new Uint8Array(16 * 1048576);
  const before = state(f);
  f.doc.getRasterData = () => { throw Error("must reject before compositing"); };
  assert.throws(() => f.submit(), /metadata exceeds/);
  await flushJobs(); assert.equal(f.fake.calls.length, 0); delete f.doc.getRasterData;
  assert.deepEqual(state(f), before);
});
