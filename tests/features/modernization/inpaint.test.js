import assert from "node:assert/strict";
import { before, it } from "node:test";
import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
import { flushJobs, fakeProvider } from "./fake-provider.js";
import { prepareInpaintInput, removalROI, validateInpaintInput, cropInpaintResult } from "../../../src/features/modernization/inpaint-workload.js";
import { validateInpaintConfig } from "../../../src/features/modernization/inpaint-config.js";
import { createComfyProvider, testInpaintConnection } from "../../../src/features/modernization/comfy-provider.js";
installBrowserGlobals();
let Document, Rect, TrackerRegistry, SelectionJobs, LayerSystem;
before(async () => {
  ({ Document } = await import("../../../src/document/model/document.js"));
  ({ Rect } = await import("../../../src/core/math/rect.js"));
  ({ TrackerRegistry } = await import("../../../src/features/trackers/tracker-registry.js"));
  ({ SelectionJobs } = await import("../../../src/features/modernization/selection-jobs.js"));
  ({ LayerSystem } = await import("../../../src/engine/layer-system.js")); LayerSystem.webglEnabled = false;
});
const config = { enabled: true, endpoint: "http://127.0.0.1:8188", checkpoint: "acceptance.safetensors" };
function coverage(rect, values) {
  const channel = new Uint8Array(Math.ceil(rect.width * rect.height / 4) * 4);
  channel.set(values ?? new Uint8Array(rect.width * rect.height).fill(255));
  return { rect, channel };
}
function transport() {
  const calls = [], commands = [];
  const invoke = (command, args, options) => {
    commands.push({ command, args });
    if (command === "comfy_inpaint") return new Promise((resolve, reject) => {
      calls.push({ bytes: args, meta: JSON.parse(decodeURIComponent(options.headers["x-photosuite-inpaint"])), resolve, reject });
    });
    if (command === "comfy_status") return Promise.resolve({ stage: "Generating" });
    if (command === "comfy_cancel") return Promise.resolve();
    throw new Error("Unexpected invoke: " + command);
  };
  return { calls, commands, provider: createComfyProvider(invoke) };
}
function fixture() {
  const doc = new Document("inpaint.psd"); doc.width = 320; doc.height = 256;
  const layer = doc.newLayer(); layer.rect = new Rect(0, 0, 320, 256); layer.setName("Source");
  layer.buffer = Uint8Array.from({ length: 320 * 256 * 4 }, (_, i) => i % 4 === 3 ? 255 : (i % 127) + 20);
  doc.buffer = layer.buffer.slice(); doc.setLayers([layer]); doc.selectedLayerIndices = [0];
  doc.selectionMask = coverage(new Rect(151, 141, 3, 5), [0,1,127,128,254,255,0,255,255,12,180,0,255,255,255]);
  const controller = { openDocs: [doc], getCurrentDoc: () => doc, pointerState: { isDown: false } };
  const fake = transport(), bridge = new SelectionJobs(controller, fakeProvider().provider, false, fake.provider);
  const submit = () => bridge.submitAI(doc, config);
  return { doc, layer, controller, ...fake, bridge, submit, history: new TrackerRegistry.History() };
}
function generated(call) { return Uint8Array.from({ length: call.meta.width * call.meta.height * 4 }, (_, i) => [201,74,32,255][i % 4]); }
async function preview(f) {
  const id = f.submit(); await flushJobs(); f.calls.at(-1).resolve(generated(f.calls.at(-1)).buffer); await flushJobs();
  assert.equal(f.bridge.jobs.get(id).state, "preview"); return id;
}
for (const [label, x, y] of [["left",0,350],["right",798,350],["top",350,0],["bottom",350,602],["top-left",0,0],["top-right",798,0],["bottom-left",0,602],["bottom-right",798,602],["interior",321,222]]) {
  it("ROI/padding preserves exact " + label + " document mapping", () => {
    const selection = coverage(new Rect(x,y,3,3));
    const layer = { rect: new Rect(0,0,801,605), buffer: new Uint8Array(801*605*4).fill(128) };
    const {input,coverage: retained} = prepareInpaintInput(layer, selection,801,605,config,42);
    assert.deepEqual(input.rect, { x:Math.max(0,x-64), y:Math.max(0,y-64), width:Math.min(801,x+3+64)-Math.max(0,x-64), height:Math.min(605,y+3+64)-Math.max(0,y-64) });
    assert.equal(input.modelWidth,512); assert.equal(input.modelHeight,512);
    assert.equal(input.mask.reduce((sum,n)=>sum+Number(n>0),0),9);
    assert.equal(retained.reduce((sum,n)=>sum+Number(n>0),0),9);
    const raw = Uint8Array.from({length:512*512*4},(_,i)=>Math.floor(i/4/512)%256);
    const result = cropInpaintResult(input,raw);
    assert.deepEqual(result.rect,input.rect); assert.equal(result.bytes.length,input.rect.width*input.rect.height*4);
    assert.equal(result.bytes[result.bytes.length-1],input.rect.height-1);
    assert.equal(input.mask[511*512+511],0);
    assert.equal(input.rgba[511*512*4+511*4],128);
  });
}
it("ROI uses nonzero coverage, rejects empty/outside/oversize before model allocation", () => {
  assert.throws(()=>removalROI(null,100,100),/Select/);
  assert.throws(()=>removalROI(coverage(new Rect(0,0,1,1),[0]),100,100),/nonempty/);
  assert.throws(()=>removalROI(coverage(new Rect(-5,-5,1,1)),100,100),/nonempty/);
  assert.throws(()=>removalROI(coverage(new Rect(0,0,1100,1)),1200,100),/size/);
  const c=coverage(new Rect(0,0,100,100),new Uint8Array(10000)); c.channel[5050]=1;
  assert.deepEqual(removalROI(c,200,200),{x:0,y:0,width:115,height:115});
});
it("configuration rejects remote and ambiguous endpoints without calling transport", async () => {
  for(const endpoint of ["https://127.0.0.1:8188","http://localhost:8188","http://127.0.0.1.evil:8188","http://2130706433:8188","http://127.0.0.1:0","http://127.0.0.1:8188/path","http://user@127.0.0.1:8188","http://127.0.0.1:8188?x"]) assert.throws(()=>validateInpaintConfig({...config,endpoint}));
  assert.doesNotThrow(()=>validateInpaintConfig({...config,endpoint:"http://[::1]:8188/"}));
  let calls=0;
  await assert.rejects(testInpaintConnection({...config,enabled:false},()=>{calls++;}),/Enable/);
  assert.equal(calls,0);
  await assert.rejects(testInpaintConnection(config,async()=>({ready:true,version:"0.36.0"})),/incompatible/);
});
it("provider transfers bounded binary source/mask with an owned UUID, no document metadata", async () => {
  const f=fixture(), id=f.submit(); await flushJobs();
  const {bytes,meta}=f.calls[0];
  assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.length,512*512*5);
  assert.match(meta.requestId,/^[0-9a-f-]{36}$/); assert.notEqual(meta.requestId,id);
  assert.deepEqual(Object.keys(meta).sort(),["config","height","requestId","seed","width"]);
  assert.equal(bytes.slice(512*512*4).filter(v=>v===255).length,12);
  assert.ok(bytes.slice(512*512*4).every(v=>v===0||v===255));
  f.bridge.jobs.cancel(id); f.calls[0].resolve(generated(f.calls[0])); await flushJobs();
  assert.equal(f.bridge.jobs.get(id).state,"cancelled");
});
it("real M1 preview -> M0 Accept contains context, preserves source, one exact offline Undo/Redo", async () => {
  const f=fixture(), source=f.layer.buffer.slice(), selection=f.doc.selectionMask.channel.slice();
  const id=await preview(f);
  assert.equal(f.doc.layers.length,1); assert.equal(f.doc.history.length,1);
  const overlay=f.doc.toolOverlayState.jobRasterPreview;
  for(let y=0;y<overlay.rect.height;y++)for(let x=0;x<overlay.rect.width;x++){
    const dx=x+overlay.rect.x,dy=y+overlay.rect.y,r=f.doc.selectionMask.rect;
    const alpha=dx>=r.x&&dx<r.x+r.width&&dy>=r.y&&dy<r.y+r.height?selection[(dy-r.y)*r.width+dx-r.x]:0;
    assert.equal(overlay.bytes[(y*overlay.rect.width+x)*4+3],alpha);
  }
  const accepted=overlay.bytes.slice(), rect={...overlay.rect};
  assert.equal(f.bridge.jobs.accept(id),true); assert.equal(f.doc.history.length,2); assert.equal(f.doc.layers.length,2);
  const patch=f.doc.layers[1]; assert.deepEqual({...patch.rect},rect); assert.deepEqual(patch.buffer,accepted);
  assert.deepEqual(f.layer.buffer,source); assert.deepEqual(f.doc.selectionMask.channel,selection);
  f.doc.composite();
  for(let y=0;y<f.doc.height;y++)for(let x=0;x<f.doc.width;x++){
    const r=f.doc.selectionMask.rect;
    const alpha=x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height?selection[(y-r.y)*r.width+x-r.x]:0;
    if(!alpha) assert.deepEqual(f.doc.buffer.subarray((y*f.doc.width+x)*4,(y*f.doc.width+x)*4+4),source.subarray((y*f.doc.width+x)*4,(y*f.doc.width+x)*4+4));
  }
  f.history.stepHistoryBackward(f.doc); assert.equal(f.doc.layers.length,1); assert.deepEqual(f.layer.buffer,source);
  f.history.stepHistoryForward(f.doc); assert.equal(f.calls.length,1); assert.deepEqual(f.doc.layers[1].buffer,accepted);
  assert.equal(f.doc.toolOverlayState.jobRasterPreview,null);
});
it("odd selection alignment bytes do not falsely invalidate real M1 preview or Accept", async () => {
  const f=fixture(), selection=f.doc.selectionMask;
  const count=selection.rect.area();
  assert.ok(selection.channel.length>count);
  selection.channel.fill(255,count); // Select All and other editor tools may fill storage padding.
  const id=f.submit(); await flushJobs();
  selection.channel.fill(73,count); // No coverage inside the rectangle changed.
  f.calls[0].resolve(generated(f.calls[0])); await flushJobs();
  assert.equal(f.bridge.jobs.get(id).state,"preview");
  assert.equal(f.bridge.jobs.accept(id),true);
  assert.equal(f.doc.layers.length,2);
  assert.equal(f.doc.history.length,2);
});
for(const action of ["discard","cancel"])it(action+" releases the preview with no document or history mutation",async()=>{
  const f=fixture(), source=f.layer.buffer.slice(), id=await preview(f);
  const overlay=f.doc.toolOverlayState.jobRasterPreview; overlay.canvas={width:131,height:133};
  f.bridge.jobs[action](id);
  assert.equal(overlay.canvas,null); assert.equal(f.doc.layers.length,1); assert.equal(f.doc.history.length,1);
  assert.deepEqual(f.layer.buffer,source); assert.equal(f.doc.toolOverlayState.jobRasterPreview,null);
  assert.equal(f.bridge.jobs.get(id).hasResult,false);
});
for(const [label,mutate] of Object.entries({
  pixels:f=>f.layer.buffer[400]++,
  selection:f=>f.doc.selectionMask.channel[1]++,
  bounds:f=>f.layer.rect.x++,
  target:f=>f.doc.selectedLayerIndices=[],
  opacity:f=>f.layer.Opct=128,
  fill:f=>f.layer.add.iOpa=128,
  blending:f=>f.layer.blendIfData[0]=1,
  history:f=>f.doc.history[0]={...f.doc.history[0]},
  replaced:f=>f.doc.setLayers([f.layer.clone()]),
}))it("stale "+label+" revokes before result publication",async()=>{
  const f=fixture(), id=f.submit(); await flushJobs(); mutate(f);
  f.calls[0].resolve(generated(f.calls[0])); await flushJobs();
  assert.equal(f.bridge.jobs.get(id).state,"stale"); assert.equal(f.doc.history.length,1);
  assert.equal(f.doc.toolOverlayState.jobRasterPreview??null,null);
});
it("cancel before dispatch makes no transport call",async()=>{
  const f=fixture(),id=f.submit(); f.bridge.jobs.cancel(id); await flushJobs();
  assert.equal(f.calls.length,0); assert.equal(f.bridge.jobs.get(id).state,"cancelled");
});
it("cancel during execution retains stopping state then discards late output",async()=>{
  const f=fixture(),id=f.submit();await flushJobs();
  f.bridge.jobs.cancel(id); assert.equal(f.bridge.jobs.get(id).state,"cancelled");assert.equal(f.bridge.jobs.get(id).stopping,true);
  assert.ok(f.commands.some(c=>c.command==="comfy_cancel"&&c.args.requestId===f.calls[0].meta.requestId));
  f.calls[0].resolve(generated(f.calls[0]));await flushJobs();
  assert.equal(f.bridge.jobs.get(id).stopping,false);assert.equal(f.doc.history.length,1);assert.equal(f.doc.layers.length,1);
  assert.throws(()=>f.bridge.jobs.accept(id));assert.equal(f.doc.toolOverlayState.jobRasterPreview??null,null);
});
it("close cancels and tab switch never changes document authority",async()=>{
  const f=fixture(),g=fixture(),id=f.submit();await flushJobs();
  f.controller.openDocs.push(g.doc);f.controller.getCurrentDoc=()=>g.doc;
  f.calls[0].resolve(generated(f.calls[0]));await flushJobs();assert.equal(f.bridge.jobs.accept(id),true);
  assert.equal(f.doc.layers.length,2);assert.equal(g.doc.layers.length,1);
  const h=fixture(),closed=h.submit();await flushJobs();h.bridge.close(h.doc);h.controller.openDocs=[];
  h.calls[0].resolve(generated(h.calls[0]));await flushJobs();
  assert.equal(h.bridge.jobs.get(closed).state,"cancelled");assert.equal(h.doc.layers.length,1);
});
it("provider failure and invalid bytes are terminal and allow retry",async()=>{
  for(const invalid of [new Uint8Array(3),new Uint8Array(512*512*4+1),null]){
    const f=fixture(),id=f.submit();await flushJobs();f.calls[0].resolve(invalid);await flushJobs();
    assert.equal(f.bridge.jobs.get(id).state,"failed");assert.equal(f.doc.history.length,1);
    const retry=f.submit();await flushJobs();f.calls[1].reject("Local service restarted.");await flushJobs();
    assert.equal(f.bridge.jobs.get(retry).state,"failed");assert.match(f.bridge.jobs.get(retry).error.message,/restarted/);
  }
});
it("one retained AI preview; invalid model mapping rejected",async()=>{
  const f=fixture(),id=await preview(f);assert.throws(()=>f.submit(),/current AI Remove/);f.bridge.jobs.discard(id);
  const {input}=prepareInpaintInput(f.layer,f.doc.selectionMask,320,256,config);
  assert.throws(()=>validateInpaintInput({...input,modelWidth:1024}));
  assert.throws(()=>validateInpaintInput({...input,modelOffset:{x:1,y:0}}));
});
it("accepted raster survives real PSD serialization/reopen without backend",async()=>{
  const {PSDParser}=await import("../../../src/document/formats/psd/psd-parser.js");
  const {RenderBuffer}=await import("../../../src/core/render-buffer.js");
  const {registerTrackers}=await import("../../../src/features/trackers/register-trackers.js");registerTrackers(TrackerRegistry);
  const f=fixture(),id=await preview(f);f.bridge.jobs.accept(id);f.doc.composite();
  const pixels=f.doc.layers[1].buffer.slice(),source=f.layer.buffer.slice(),composite=f.doc.buffer.slice();
  const buffer=new RenderBuffer(),length=PSDParser.serialize(f.doc,buffer,[false,false,false,false]);
  const reopened=new Document("offline.psd");PSDParser.parse(buffer.data.slice(0,length).buffer,reopened);
  assert.equal(reopened.layers.length,2);assert.deepEqual(reopened.layers[0].buffer,source);
  assert.deepEqual(reopened.layers[1].buffer,pixels);assert.deepEqual(reopened.layers[1].rect,f.doc.layers[1].rect);
  assert.deepEqual(reopened.buffer,composite);assert.equal(f.calls.length,1);
});
it("native text shortcuts in inference fields cannot select or edit document pixels", async () => {
  const {routeInpaintTextMenu}=await import("../../../src/ui/menu/tauri-menu-bridge.js");
  const {buildSelectAllAction}=await import("../../../src/document/tools/selection-actions.js");
  let selected=0;const commands=[];
  const element={getAttribute:()=> "true",select:()=>selected++};
  assert.equal(routeInpaintTextMenu({payload:buildSelectAllAction(true)},element,()=>{}),true);assert.equal(selected,1);
  for(const [key,value,expected] of [["dispatchKind","clipboardPasteLayers","paste"],["dispatchKind","clipboardCopyLayers","copy"],["dispatchKind","cutPathsOrClearSelection","cut"],["actionKind","h_stepbck","undo"]]){
    assert.equal(routeInpaintTextMenu({payload:{[key]:value}},element,c=>commands.push(c)),true);
    assert.equal(commands.at(-1),expected);
  }
  assert.equal(routeInpaintTextMenu({payload:buildSelectAllAction(true)},{getAttribute:()=>null}),false);
  assert.equal(routeInpaintTextMenu({payload:{dispatchKind:"aiRemove"}},element),false);
});
