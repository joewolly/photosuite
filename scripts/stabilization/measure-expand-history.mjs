// Exact production M8 transactions with synthetic output; no inference timing claim.
// Run: node --expose-gc scripts/stabilization/measure-expand-history.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installBrowserGlobals } from '../../tests/helpers/stub-browser-globals.js';
installBrowserGlobals();
const {Document,HistoryEntry}=await import('../../src/document/model/document.js');
const {Rect}=await import('../../src/core/math/rect.js');
const {LayerSystem}=await import('../../src/engine/layer-system.js');LayerSystem.webglEnabled=false;
const {captureExpandSource}=await import('../../src/features/modernization/expand-source.js');
const {expansionGeometry,containExpandResult}=await import('../../src/features/modernization/expand-workload.js');
const {commitExactExpansion}=await import('../../src/features/trackers/exact-expand-tracker.js');
const {TrackerRegistry}=await import('../../src/features/trackers/tracker-registry.js');
const hash=b=>createHash('sha256').update(b).digest('hex');
const memory=()=>{global.gc?.();return process.memoryUsage()};
function bytes(d){return {layers:d.layers.reduce((s,l)=>s+l.buffer.byteLength+(l.getMask()?.channel.byteLength||0),0),composite:d.width*d.height*4}}
function state(d){d.markDirty();return {width:d.width,height:d.height,pixels:hash(d.getRasterData()),layers:d.layers.map(l=>({rect:{...l.rect},hash:hash(l.buffer)}))}}
const reports=[];
for(const size of [512,1000]){
 const doc=new Document('history-memory');doc.width=doc.height=size;
 const layer=doc.newLayer();layer.rect=new Rect(0,0,size,size);layer.buffer=new Uint8Array(size*size*4).fill(127);for(let i=3;i<layer.buffer.length;i+=4)layer.buffer[i]=255;doc.setLayers([layer]);doc.selectedLayerIndices=[0];doc.markDirty();
 const controller={openDocs:[doc],getCurrentDoc:()=>doc,pointerState:{isDown:false}},history=new TrackerRegistry.History();
 const initial=state(doc),baseline=memory(),entries=[];let gate;
 for(let i=0;i<64;i++){
  const before=bytes(doc),g=expansionGeometry(doc.width,doc.height,{left:0,right:1,top:0,bottom:0});
  let context;try{context=captureExpandSource(controller,doc,g)}catch(e){gate=e.message;break}
  const output=containExpandResult({pixelFormat:'rgba8',rect:{x:0,y:0,width:g.newWidth,height:g.newHeight},bytes:new Uint8Array(g.byteLength).fill(197),byteLength:g.byteLength},g);
  const start=performance.now();commitExactExpansion(controller,context,output);const acceptMs=performance.now()-start;context=null;
  const after=bytes(doc);entries.push({before,after,generatedBytes:g.byteLength,snapshotBytes:before.layers+before.composite+after.layers+after.composite,acceptMs,memory:memory()});
 }
 const final=state(doc),undoStart=performance.now();for(let i=0;i<entries.length;i++)history.stepHistoryBackward(doc);const undoMs=performance.now()-undoStart;assert.deepEqual(state(doc),initial);
 const redoStart=performance.now();for(let i=0;i<entries.length;i++)history.stepHistoryForward(doc);const redoMs=performance.now()-redoStart;assert.deepEqual(state(doc),final);
 const retained=memory();for(let i=0;i<100;i++)doc.pushHistory(new HistoryEntry('ordinary edit',{id:0,undo(){},redo(){}}));assert.equal(doc.history.length,100);assert.ok(!doc.history.some(e=>e.name==='Generative Expand'));
 for(let i=0;i<4;i++){await new Promise(r=>setImmediate(r));global.gc?.()}
 reports.push({size,baseline,entries,gate,retained,afterTrim:memory(),undoMs,redoMs,exactUndoRedo:true,retainedSnapshotBytes:entries.reduce((s,e)=>s+e.snapshotBytes,0)});
}
console.log(JSON.stringify(reports,null,2));
