import assert from "node:assert/strict";
import { before, it } from "node:test";
import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
import { flushJobs, fakeProvider } from "./fake-provider.js";
import { validatePrompt } from "../../../src/features/modernization/generative-workload.js";
import { createGenerativeProvider } from "../../../src/features/modernization/comfy-provider.js";
installBrowserGlobals();
let Document, Rect, TrackerRegistry, SelectionJobs, LayerSystem;
before(async () => {
  ({ Document } = await import("../../../src/document/model/document.js"));
  ({ Rect } = await import("../../../src/core/math/rect.js"));
  ({ TrackerRegistry } = await import("../../../src/features/trackers/tracker-registry.js"));
  ({ SelectionJobs } = await import("../../../src/features/modernization/selection-jobs.js"));
  ({ LayerSystem } = await import("../../../src/engine/layer-system.js")); LayerSystem.webglEnabled = false;
});
const config = { enabled: true, endpoint: "http://127.0.0.1:8188", checkpoint: "sd-v1-5-inpainting.ckpt" };
function coverage(rect, values) {
  const channel = new Uint8Array(Math.ceil(rect.width * rect.height / 4) * 4);
  channel.set(values ?? new Uint8Array(rect.width * rect.height).fill(255));
  return { rect, channel };
}
function transport() {
  const calls = [], commands = [];
  const invoke = (command, args, options) => {
    commands.push({ command, args });
    if (command === "comfy_generative") return new Promise((resolve, reject) => {
      calls.push({ bytes: args, meta: JSON.parse(decodeURIComponent(options.headers["x-photosuite-inpaint"])), resolve, reject });
    });
    if (command === "comfy_status") return Promise.resolve({ stage: "Generating" });
    if (command === "comfy_cancel") return Promise.resolve();
    throw new Error("Unexpected invoke: " + command);
  };
  return { calls, commands, provider: createGenerativeProvider(invoke) };
}
function fixture() {
  const doc = new Document("inpaint.psd"); doc.width = 320; doc.height = 256;
  const layer = doc.newLayer(); layer.rect = new Rect(0, 0, 320, 256); layer.setName("Source");
  layer.buffer = Uint8Array.from({ length: 320 * 256 * 4 }, (_, i) => i % 4 === 3 ? 255 : (i % 127) + 20);
  doc.buffer = layer.buffer.slice(); doc.setLayers([layer]); doc.selectedLayerIndices = [0];
  doc.selectionMask = coverage(new Rect(151, 141, 3, 5), [0,1,127,128,254,255,0,255,255,12,180,0,255,255,255]);
  const controller = { openDocs: [doc], getCurrentDoc: () => doc, pointerState: { isDown: false } };
  const fake = transport(), bridge = new SelectionJobs(controller, fakeProvider().provider, false, undefined, undefined, undefined, undefined, fake.provider);
  const submit = (options = {}) => bridge.submitGenerative(doc, config, { prompt: "ceramic cup", count: 1, seed: 42, ...options });
  return { doc, layer, controller, ...fake, bridge, submit, history: new TrackerRegistry.History() };
}
function generated(call) { return Uint8Array.from({ length: call.meta.input.width * call.meta.input.height * 4 }, (_, i) => [201,74,32,255][i % 4]); }
async function preview(f) {
  const id = f.submit(); await flushJobs(); f.calls.at(-1).resolve(generated(f.calls.at(-1)).buffer); await flushJobs();
  assert.equal(f.bridge.jobs.get(id).state, "preview"); return id;
}

it("prompt bounds preserve empty, ordinary, Unicode and whitespace without rewriting", () => {
  for (const value of ["", "  red leather jacket\n", "猫 🐈", "a".repeat(1024), "é".repeat(1024)]) assert.equal(validatePrompt(value), value);
  for (const value of [null, undefined, 12, {}, [], "a".repeat(1025), "猫".repeat(700), "\0", "\ud800", "\udc00"]) assert.throws(() => validatePrompt(value));
});
it("options reject invalid counts/seeds before snapshot or provider; no implicit full canvas", async () => {
  const f = fixture();
  for (const count of [0, 4, -1, 1.5, "2", Infinity]) assert.throws(() => f.submit({count}));
  for (const seed of [-1, 4294967296, 0.1, "42", undefined]) assert.throws(() => f.submit({seed}));
  f.doc.selectionMask = null; assert.throws(() => f.submit()); await flushJobs(); assert.equal(f.calls.length, 0);
});
it("generation uses shared binary transport with exact prompt and isolated operation", async () => {
  const f=fixture(); const id=f.submit({prompt:"猫 \n wooden cup"}); await flushJobs();
  const call=f.calls[0]; assert.equal(call.meta.prompt,"猫 \n wooden cup"); assert.equal(call.meta.input.seed,42);
  assert.equal(call.bytes.length,512*512*5); assert.match(call.meta.input.requestId,/^[0-9a-f-]{36}$/);
  assert.equal(f.bridge.jobs.get(id).operation,"generate.fill"); f.bridge.generative.release(); call.resolve(generated(call)); await flushJobs();
});
it("three variations are sequential; switching is transient; Accept commits exactly the chosen bytes", async () => {
  const f=fixture(), source=f.layer.buffer.slice(); const id=f.submit({count:3}); await flushJobs();
  const session=f.bridge.generative.current;
  assert.equal(f.calls.length,1); assert.throws(()=>f.bridge.generative.accept());
  for(let i=0;i<3;i++) {
    assert.equal(f.calls.length,i+1); assert.equal(f.calls[i].meta.input.seed,42+i);
    const raw=generated(f.calls[i]); raw[0]=i; // Context changes are immaterial; selected pixels differ below.
    for(let k=0;k<raw.length;k+=4) raw[k]=80+i*30;
    f.calls[i].resolve(raw); await flushJobs();
  }
  assert.equal(f.calls.length,3); assert.equal(f.doc.history.length,1); assert.equal(f.doc.layers.length,1);
  assert.equal(f.bridge.generative.ready(),true); f.bridge.generative.select(0); const a=f.doc.toolOverlayState.jobRasterPreview.bytes.slice();
  f.bridge.generative.select(1); const b=f.doc.toolOverlayState.jobRasterPreview.bytes.slice(); assert.notDeepEqual(a,b);
  assert.equal(f.bridge.generative.accept(),true); assert.equal(f.doc.history.length,2); assert.equal(f.doc.layers.length,2);
  assert.deepEqual(f.doc.layers[1].buffer,b); assert.deepEqual(f.layer.buffer,source); assert.equal(f.doc.layers[1].name,"Generative Fill");
  assert.equal(f.bridge.jobs.get(id).state,"discarded"); assert.equal(f.bridge.generative.current,null);
  assert.equal(session.input,null); assert.equal(session.settings,null); assert.equal(session.coverage,null);
  assert.ok(f.bridge.jobs.list().every(j=>!j.hasResult&&!j.hasInput));
  f.history.stepHistoryBackward(f.doc); assert.equal(f.doc.layers.length,1); assert.deepEqual(f.layer.buffer,source);
  f.history.stepHistoryForward(f.doc); assert.deepEqual(f.doc.layers[1].buffer,b); assert.equal(f.calls.length,3);
});
for(const transparent of [false,true]) it("malicious context is contained byte-exactly, soft coverage authoritative; transparent="+transparent, async()=>{
  const f=fixture(); if(transparent) for(let i=3;i<f.layer.buffer.length;i+=4) f.layer.buffer[i]=i%3===0?0:100;
  f.doc.markDirty(); f.doc.composite(); const before=f.doc.buffer.slice(); const id=await preview(f); const overlay=f.doc.toolOverlayState.jobRasterPreview;
  for(let y=0;y<overlay.rect.height;y++) for(let x=0;x<overlay.rect.width;x++) {
    const dx=x+overlay.rect.x,dy=y+overlay.rect.y,r=f.doc.selectionMask.rect;
    const c=dx>=r.x&&dx<r.x+r.width&&dy>=r.y&&dy<r.y+r.height?f.doc.selectionMask.channel[(dy-r.y)*r.width+dx-r.x]:0;
    assert.equal(overlay.bytes[(y*overlay.rect.width+x)*4+3],c);
    if(!c) assert.deepEqual([...overlay.bytes.subarray((y*overlay.rect.width+x)*4,(y*overlay.rect.width+x)*4+4)],[0,0,0,0]);
  }
  assert.equal(f.bridge.generative.accept(),true); f.doc.composite(); let changed=0;
  for(let y=0;y<f.doc.height;y++)for(let x=0;x<f.doc.width;x++){
    const r=f.doc.selectionMask.rect,c=x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height?f.doc.selectionMask.channel[(y-r.y)*r.width+x-r.x]:0;
    if(!c)for(let k=0;k<4;k++)changed+=Number(before[(y*f.doc.width+x)*4+k]!==f.doc.buffer[(y*f.doc.width+x)*4+k]);
  }
  assert.equal(changed,0); assert.equal(f.bridge.jobs.get(id).state,"committed");
});
for(const action of ["cancel","discard","close","source","selection","failure","malformed"])it("session releases all candidates and rejects late output after "+action,async()=>{
  const f=fixture(),id=f.submit({count:3}); await flushJobs(); const session=f.bridge.generative.current;
  f.calls[0].resolve(generated(f.calls[0])); await flushJobs(); assert.equal(f.calls.length,2);
  if(action==="cancel"||action==="discard")f.bridge.generative.release();
  if(action==="close") {f.controller.openDocs=[];f.bridge.close(f.doc);}
  if(action==="source") {f.layer.buffer[0]^=1;f.bridge.tick(1000);}
  if(action==="selection") {f.doc.selectionMask.channel[1]^=1;f.bridge.tick(1000);}
  if(action==="failure")f.calls[1].reject(new Error("Service failed"));
  else f.calls[1].resolve(action==="malformed"?new Uint8Array(2):generated(f.calls[1]));
  await flushJobs(); assert.equal(f.calls.length,2); assert.equal(f.bridge.generative.current,null); assert.equal(session.input,null);
  assert.ok(f.bridge.jobs.list().every(j=>!j.hasResult&&!j.hasInput)); assert.equal(f.doc.layers.length,1);assert.equal(f.doc.history.length,1);assert.equal(f.doc.toolOverlayState.jobRasterPreview,null);
  assert.throws(()=>f.bridge.jobs.accept(id)); assert.throws(()=>f.bridge.generative.regenerate());
});
it("Regenerate releases old candidates and reuses exact recipe only on a valid source",async()=>{
 const f=fixture();const old=await preview(f);const session=f.bridge.generative.current;
 const next=f.bridge.generative.regenerate(true);await flushJobs();assert.notEqual(next,old);assert.equal(f.calls[1].meta.input.seed,42);assert.equal(f.calls[1].meta.prompt,"ceramic cup");assert.equal(session.input,null);
 f.calls[1].resolve(generated(f.calls[1]));await flushJobs();f.doc.selectionMask.channel[0]=255;
 assert.throws(()=>f.bridge.generative.regenerate(),/changed/);assert.equal(f.calls.length,2);assert.equal(f.bridge.generative.current,null);
});
it("tab switching never redirects accept",async()=>{
 const f=fixture();await preview(f);const other=new Document("other");f.controller.openDocs.push(other);f.controller.getCurrentDoc=()=>other;
 assert.equal(f.bridge.generative.accept(),true);assert.equal(f.doc.layers.length,2);assert.equal(other.layers.length,0);
});

it("accepted raster survives real PSD serialization/reopen without backend",async()=>{
  const {PSDParser}=await import("../../../src/document/formats/psd/psd-parser.js");
  const {RenderBuffer}=await import("../../../src/core/render-buffer.js");
  const {registerTrackers}=await import("../../../src/features/trackers/register-trackers.js");registerTrackers(TrackerRegistry);
  const f=fixture(),id=await preview(f);f.bridge.generative.accept();f.doc.composite();
  const pixels=f.doc.layers[1].buffer.slice(),source=f.layer.buffer.slice(),composite=f.doc.buffer.slice();
  const buffer=new RenderBuffer(),length=PSDParser.serialize(f.doc,buffer,[false,false,false,false]);
  const reopened=new Document("offline.psd");PSDParser.parse(buffer.data.slice(0,length).buffer,reopened);
  assert.equal(reopened.layers.length,2);assert.deepEqual(reopened.layers[0].buffer,source);
  assert.deepEqual(reopened.layers[1].buffer,pixels);assert.deepEqual(reopened.layers[1].rect,f.doc.layers[1].rect);
  assert.deepEqual(reopened.buffer,composite);assert.equal(f.calls.length,1);
  assert.equal(new TextDecoder().decode(buffer.data.slice(0,length)).includes("ceramic cup"),false);
  assert.equal(f.bridge.jobs.get(id).state,"committed");
});

it("ROI keeps context and model padding separate; no inference growth; exact boundary mapping",async()=>{
 const {prepareGenerativeInput}=await import("../../../src/features/modernization/generative-workload.js");
 for(const [x,y] of [[0,0],[798,0],[0,602],[798,602],[321,222]]) {
  const sel=coverage(new Rect(x,y,3,3),[0,1,128,255,255,0,255,128,255]);
  const source={rect:new Rect(0,0,801,605),buffer:new Uint8Array(801*605*4).fill(127)};
  const {input,coverage:cov}=prepareGenerativeInput(source,sel,801,605,config,{prompt:"",count:1,seed:4294967295});
  assert.equal(input.modelWidth,512);assert.equal(input.modelHeight,512);assert.deepEqual(input.modelOffset,{x:0,y:0});
  assert.equal(input.mask.filter(v=>v===255).length,7);assert.equal(cov.filter(v=>v>0).length,7);assert.ok(cov.includes(128));
  assert.equal(input.mask.at(-1),0);assert.equal(input.rect.x,Math.max(0,x-64));assert.equal(input.rect.y,Math.max(0,y-64));
 }
});
it("new random regenerate gets a fresh recipe seed; expired session refuses",async()=>{
 const f=fixture();await preview(f);f.bridge.generative.regenerate();await flushJobs();assert.equal(f.calls.length,2);
 assert.ok(Number.isInteger(f.calls[1].meta.input.seed));f.bridge.generative.release();f.calls[1].resolve(generated(f.calls[1]));await flushJobs();
 assert.throws(()=>f.bridge.generative.regenerate(),/still-valid/);
});
