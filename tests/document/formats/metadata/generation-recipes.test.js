import assert from "node:assert/strict";
import { before, beforeEach, it } from "node:test";
import { createHash } from "node:crypto";
import { installBrowserGlobals } from "../../../helpers/stub-browser-globals.js";
import { installXmlDom } from "../../../helpers/xml-dom.js";
import { XMPData } from "../../../../src/document/formats/metadata/xmp-metadata.js";
import { RECIPE_FIELD, RECIPE_NAMESPACE, RECIPE_LIMITS, normalizeRecipe, normalizeRecipes, setRecipePrivacy, getRecipePrivacy, setLayerRecipe, getLayerRecipe, collectDocumentRecipes, bindDocumentRecipes, captureRecipeSource, recipeAvailability } from "../../../../src/document/formats/metadata/generation-recipes.js";
installBrowserGlobals(); installXmlDom();
let Document, Rect, PSDParser, RenderBuffer, TrackerRegistry;
before(async () => {
  ({ Document } = await import("../../../../src/document/model/document.js"));
  ({ Rect } = await import("../../../../src/core/math/rect.js"));
  ({ PSDParser } = await import("../../../../src/document/formats/psd/psd-parser.js"));
  ({ RenderBuffer } = await import("../../../../src/core/render-buffer.js"));
  ({ TrackerRegistry } = await import("../../../../src/features/trackers/tracker-registry.js"));
  const { registerTrackers } = await import("../../../../src/features/trackers/register-trackers.js"); registerTrackers(TrackerRegistry);
  const { LayerSystem } = await import("../../../../src/engine/layer-system.js"); LayerSystem.webglEnabled = false;
});
beforeEach(() => setRecipePrivacy());
const prompt = `PRIVATE_M7 <cup> > & "quotes" 'apostrophe' 猫 🐈\nline two\r\nline three`;
function recipe(id = 2) {
  return { recipeVersion: 1, layerId: id, operation: "generate.fill", workflow: "photosuite-generative-fill-v1", backend: "comfyui", checkpoint: "sd-v1-5-inpainting.ckpt", seed: 4294967295, createdAt: "2026-09-28T10:11:12.123Z", prompt,
    settings: { steps: 20, cfg: 7, sampler: "euler", scheduler: "normal", denoise: 1, maskGrowth: 0, roi: { x: 0, y: 0, width: 8, height: 6 }, modelWidth: 512, modelHeight: 512 },
    source: { layerId: 1, sha256: "a".repeat(64), rect: { x: 0, y: 0, width: 8, height: 6 }, documentWidth: 8, documentHeight: 6 },
    selection: { sha256: "b".repeat(64), rect: { x: 1, y: 1, width: 3, height: 2 } }, selectionPersistence: "none" };
}
const data = (...records) => ({ schemaVersion: 1, records: records.length ? records : [recipe()] });
const xml = value => XMPData.writeXmpXml({ [RECIPE_FIELD]: value });
const decode = value => XMPData.readXmpXml(value)[RECIPE_FIELD];
function fixture() {
  const doc = new Document("M7.psd"); doc.width = 8; doc.height = 6;
  const source = doc.newLayer(), result = doc.newLayer();
  for (const [i, layer] of [source, result].entries()) {
    layer.rect = new Rect(0, 0, 8, 6); layer.setName("Same name"); layer.buffer = Uint8Array.from({ length: 192 }, (_, p) => p % 4 === 3 ? 255 : (p * 3 + i * 12) % 256);
  }
  doc.setLayers([source, result]); doc.selectedLayerIndices = [1]; doc.buffer = result.buffer.slice();
  doc.selectionMask = { rect: new Rect(1, 1, 3, 2), channel: new Uint8Array([1,128,255,0,0,255,0,0]) };
  assert.equal(setLayerRecipe(result, recipe(result.add.lyid)), true);
  return { doc, source, result };
}
function save(doc, psb = false) { const buffer = new RenderBuffer(), size = PSDParser.serialize(doc, buffer, [false,false,false,psb]); return buffer.data.slice(0,size); }
function open(bytes) { const doc = new Document("reopened.psd"); PSDParser.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), doc); return doc; }
function replaceXmp(bytes, packet) {
  // Parse only standard resource framing, leaving all layer and pixel bytes unchanged.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), start = 30 + view.getUint32(26), end = start + 4 + view.getUint32(start), parts = [];
  for (let pos = start + 4; pos < end;) {
    const block = pos, id = view.getUint16(pos + 4); pos += 6;
    const nameLength = bytes[pos] + 1; pos += nameLength + nameLength % 2;
    const lengthPos = pos, length = view.getUint32(pos); pos += 4;
    if (id !== 1060) parts.push(bytes.slice(block, pos + length + length % 2));
    else if (packet !== null) {
      const text = new TextEncoder().encode(packet), head = bytes.slice(block, pos); new DataView(head.buffer).setUint32(lengthPos - block, text.length);
      parts.push(head, text, new Uint8Array(text.length % 2));
    }
    pos += length + length % 2;
  }
  const size = parts.reduce((sum, part) => sum + part.length,0), output = new Uint8Array(start + 4 + size + bytes.length - end);
  output.set(bytes.subarray(0,start + 4)); new DataView(output.buffer).setUint32(start,size);
  let pos = start + 4; for (const part of parts) { output.set(part,pos); pos += part.length; } output.set(bytes.subarray(end),pos); return output;
}
it("namespace/schema/Unicode/XML escaping round-trip through a real XML parser", () => {
  const encoded = xml(data()); assert.ok(encoded.includes(RECIPE_NAMESPACE)); assert.match(encoded,/&lt;cup&gt;/); assert.match(encoded,/&amp;/);
  assert.deepEqual(decode(encoded), data());
  assert.deepEqual(decode(encoded.replaceAll('photosuite:', 'psg:').replace('xmlns:photosuite=', 'xmlns:psg=')),data());
  assert.equal(decode(encoded.replaceAll(RECIPE_NAMESPACE, "https://attacker.invalid/")),undefined);
  const ordinary = XMPData.readXmpXml(XMPData.writeXmpXml({ "dc:Title": '<&"\'猫>' })); assert.equal(ordinary["dc:Title"],'<&"\'猫>');
});
it("unsupported/missing versions, invalid XML, DTD and nested/duplicate records fail closed", () => {
  const encoded = xml(data());
  for (const modified of [encoded.replace('>1</photosuite:schemaVersion>', '>999</photosuite:schemaVersion>'),encoded.replace('<photosuite:schemaVersion>1</photosuite:schemaVersion>', ''), encoded.slice(0,-120), '<!DOCTYPE x [<!ENTITY s SYSTEM "http://localhost:8188/">]>'+encoded, encoded.replace('>1</photosuite:schemaVersion>', '><b>1</b></photosuite:schemaVersion>'),encoded.replace('<rdf:li>', '<rdf:li rdf:resource="http://localhost:8188/">')]) assert.equal(decode(modified),undefined);
  assert.equal(normalizeRecipes({schemaVersion:999,records:[recipe()]}),null);
  assert.equal(normalizeRecipes(data(recipe(),recipe())),null);
  assert.equal(decode(encoded.replace('</rdf:Seq>',encoded.match(/<rdf:li>.*<\/rdf:li>/s)[0]+'</rdf:Seq>')),undefined);
});
for (const [field, value] of [["seed",-1],["seed",4294967296],["seed","42"],["seed",1.5],["layerId",0],["layerId","2"],["layerId",null],["recipeVersion",999],["workflow","file:///script.js"],["backend","cloud"],["createdAt","bad"],["prompt",{script:"alert(1)"}],["prompt","猫".repeat(700)],["prompt","\u0000"],["prompt","\uffff"]]) it(`rejects malformed ${field} ${JSON.stringify(value).slice(0,45)}`, () => {
  assert.equal(normalizeRecipe({...recipe(),[field]:value}),null);
});
it("hash/geometry/settings validation and unknown fields are declarative only", () => {
  for (const key of ["source","selection"]) assert.equal(normalizeRecipe({...recipe(),[key]:{...recipe()[key],sha256:"bad"}}),null);
  assert.equal(normalizeRecipe({...recipe(),source:{...recipe().source,rect:{x:0,y:0,width:8193,height:1}}}),null);
  assert.equal(normalizeRecipe({...recipe(),settings:{...recipe().settings,cfg:8}}),null);
  assert.deepEqual(normalizeRecipe({...recipe(),graph:{nodes:"evil"},url:"http://localhost:8188/",__proto__:{bad:true}}),recipe());
});
it("explicit prompt, count, JSON and escaped XMP bounds", () => {
  assert.ok(normalizeRecipe({...recipe(),prompt:"é".repeat(1024)}));
  assert.equal(normalizeRecipe({...recipe(),prompt:"a".repeat(1025)}),null);
  assert.equal(normalizeRecipes(data(...Array.from({length:64},(_,i)=>recipe(i+1)))).records.length,64);
  assert.equal(normalizeRecipes(data(...Array.from({length:65},(_,i)=>recipe(i+1)))),null);
  assert.equal(decode(' '.repeat(RECIPE_LIMITS.xmpBytes+1)),undefined);
  // 64 escaped worst-case prompts exceed total metadata bound: omit, never emit an oversized resource.
  const large = data(...Array.from({length:64},(_,i)=>({...recipe(i+1),prompt:'"'.repeat(1024)})));
  assert.equal(decode(xml(large)),undefined); assert.ok(new TextEncoder().encode(xml(large)).length < RECIPE_LIMITS.metadataBytes);
});
it("ID association survives duplicate names, rename, reorder, groups; duplicates omit recipe", () => {
  const {doc,source,result}=fixture(); result.setName("Renamed"); doc.setLayers([result,source]); assert.equal(getLayerRecipe(doc,result).seed,4294967295);
  const group=doc.newLayer(); group.add.lsct=1; group.setName("Group"); const divider=doc.createGroupEndLayer();
  doc.setLayers([divider,result,group,source]); assert.ok(getLayerRecipe(doc,result));
  const copy=doc.duplicateLayers(doc.layers.indexOf(result))[0]; doc.setLayers([...doc.layers,copy]); assert.equal(getLayerRecipe(doc,copy),null); assert.equal(collectDocumentRecipes(doc).records.length,1);
  doc.setLayers(doc.layers.filter(l=>l!==result)); assert.equal(collectDocumentRecipes(doc),null);
});
it("missing/wrong/duplicate IDs and duplicate recipe references never guess", () => {
  for (const kind of ['missing','wrong','duplicate','duplicate-record','group']) {
    const {doc,source,result}=fixture(); const pristine=result.clone();doc.setLayers([source,pristine]);
    if(kind==='missing')delete pristine.add.lyid;
    if(kind==='wrong')pristine.add.lyid=999;
    if(kind==='duplicate')source.add.lyid=pristine.add.lyid;
    if(kind==='group')pristine.add.lsct=1;
    bindDocumentRecipes(doc,kind==='duplicate-record'?data(recipe(),recipe()):data());assert.equal(getLayerRecipe(doc,pristine),null);
  }
});
it("privacy defaults, stored recipe isolation and clone policy", () => {
  assert.deepEqual(getRecipePrivacy(),{saveRecipes:true,savePrompts:false});const {doc,result}=fixture();
  assert.equal(collectDocumentRecipes(doc).records[0].prompt,undefined);assert.equal(getLayerRecipe(doc,result).prompt,prompt);
  const copy=getLayerRecipe(doc,result);copy.source.sha256='x';assert.equal(getLayerRecipe(doc,result).source.sha256,'a'.repeat(64));
  setRecipePrivacy({saveRecipes:false,savePrompts:true});assert.equal(collectDocumentRecipes(doc),null);
  assert.ok(!JSON.stringify(doc.xmpMetadata).includes('PRIVATE_M7'));assert.ok(!JSON.stringify(result.add).includes('PRIVATE_M7'));
});
for (const psb of [false,true]) it(`${psb?'PSB':'PSD'} exact pixels/recipe offline reopen; privacy bytes and deliberate resource stripping`, async () => {
  const {doc,result}=fixture();setRecipePrivacy({savePrompts:true});const original=getLayerRecipe(doc,result), bytes=save(doc,psb);
  assert.equal(new DataView(bytes.buffer).getUint16(4),psb?2:1);
  const oldFetch=globalThis.fetch,oldXHR=globalThis.XMLHttpRequest;let requests=0;
  globalThis.fetch=()=>{requests++;throw Error('Network forbidden');};globalThis.XMLHttpRequest=class{constructor(){requests++;throw Error('Network forbidden');}};
  globalThis.window.__TAURI__={core:{invoke(){requests++;throw Error('Native backend forbidden');}}};
  try {
    const reopened=open(bytes);assert.deepEqual(reopened.layers[1].buffer,result.buffer);assert.deepEqual(reopened.buffer,doc.buffer);assert.deepEqual(getLayerRecipe(reopened,reopened.layers[1]),original);
    assert.ok(!reopened.resources.r1060);assert.equal(reopened.xmpMetadata[RECIPE_FIELD],undefined);assert.ok(!doc.resources.r1060);
    for (const packet of [null,xml({...data(),schemaVersion:999}),xml(data()).replace('>1</photosuite:schemaVersion>','>999</photosuite:schemaVersion>'),'<invalid',xml(data()).replace('4294967295','-1')]) {
      const degraded=open(replaceXmp(bytes,packet));assert.deepEqual(degraded.layers[1].buffer,result.buffer);assert.equal(getLayerRecipe(degraded,degraded.layers[1]),null);
    }
    setRecipePrivacy({savePrompts:false});const privateBytes=save(reopened,psb);assert.ok(!new TextDecoder().decode(privateBytes).includes('PRIVATE_M7'));
    const privateDoc=open(privateBytes);assert.equal(getLayerRecipe(privateDoc,privateDoc.layers[1]).prompt,undefined);assert.deepEqual(privateDoc.layers[1].buffer,result.buffer);
    setRecipePrivacy({saveRecipes:false});const stripped=save(reopened,psb);assert.ok(!new TextDecoder().decode(stripped).includes(RECIPE_NAMESPACE));assert.ok(!new TextDecoder().decode(stripped).includes('PRIVATE_M7'));
    assert.equal(getLayerRecipe(open(stripped),open(stripped).layers[1]),null);assert.equal(requests,0);
  } finally { globalThis.fetch=oldFetch;globalThis.XMLHttpRequest=oldXHR;delete globalThis.window.__TAURI__; }
});
it("source and exact selection hashes; valid/missing/changed sources always disable saved Regenerate", async () => {
  const {doc,source,result}=fixture();const identity=await captureRecipeSource(doc,source);
  assert.equal(identity.source.sha256,createHash('sha256').update(source.buffer).digest('hex'));
  assert.equal(identity.selection.sha256,createHash('sha256').update(doc.selectionMask.channel.subarray(0,6)).digest('hex'));
  assert.ok(setLayerRecipe(result,{...recipe(),...identity}));const valid=await recipeAvailability(doc,result);assert.equal(valid.available,false);assert.match(valid.reason,/Source pixels match/);
  source.buffer[0]^=1;assert.match((await recipeAvailability(doc,result)).reason,/no longer matches/);source.buffer[0]^=1;
  doc.setLayers([result]);assert.match((await recipeAvailability(doc,result)).reason,/no longer matches/);
});
it("failed PSD serialization does not leave prompts in generic document resources", () => {
  const {doc}=fixture();setRecipePrivacy({savePrompts:true});const write=PSDParser.writeImageResources;
  PSDParser.writeImageResources=()=>{assert.ok(doc.resources.r1060);throw Error('Simulated writer failure');};
  try{assert.throws(()=>save(doc),/Simulated/);assert.equal(doc.resources.r1060,undefined);}finally{PSDParser.writeImageResources=write;}
});
it("oversized XMP is dropped before UTF-8 decoding without affecting PSD pixels", async () => {
  const {BinaryUtils}=await import("../../../../src/core/binary/binary-utils.js");
  const {doc,result}=fixture();const raw=save(doc),huge=replaceXmp(raw,'a'.repeat(RECIPE_LIMITS.xmpBytes+1));
  const read=BinaryUtils.readUtf8;
  BinaryUtils.readUtf8=function(bytes,...args){assert.ok(bytes.length<=RECIPE_LIMITS.xmpBytes,"Oversized packet reached UTF-8 decoder");return read(bytes,...args)};
  try{const reopened=open(huge);assert.deepEqual(reopened.layers[1].buffer,result.buffer);assert.equal(getLayerRecipe(reopened,reopened.layers[1]),null);}finally{BinaryUtils.readUtf8=read;}
});
