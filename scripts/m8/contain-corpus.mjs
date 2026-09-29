import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { installBrowserGlobals } from '../../tests/helpers/stub-browser-globals.js';
import { installXmlDom } from '../../tests/helpers/xml-dom.js';
import { expansionGeometry, prepareExpandInput, containExpandResult, assertOriginalProjection, expandedPreview } from '../../src/features/modernization/expand-workload.js';
import { cropInpaintResult } from '../../src/features/modernization/inpaint-workload.js';
installBrowserGlobals();installXmlDom();
const [{Document},{Rect},{LayerSystem},{captureExpandSource},{commitExactExpansion},{TrackerRegistry},{PSDParser},{RenderBuffer},{registerTrackers}]=await Promise.all([
 import('../../src/document/model/document.js'),import('../../src/core/math/rect.js'),import('../../src/engine/layer-system.js'),import('../../src/features/modernization/expand-source.js'),import('../../src/features/trackers/exact-expand-tracker.js'),import('../../src/features/trackers/tracker-registry.js'),import('../../src/document/formats/psd/psd-parser.js'),import('../../src/core/render-buffer.js'),import('../../src/features/trackers/register-trackers.js')]);
LayerSystem.webglEnabled=false;registerTrackers(TrackerRegistry);
const hash=b=>createHash('sha256').update(b).digest('hex'),dir=process.argv[2],manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json')),receipts=[];
for(const c of manifest.cases){
 const doc=new Document(c.id+'.psd');doc.width=c.width;doc.height=c.height;
 const layer=doc.newLayer();layer.rect=new Rect(0,0,c.width,c.height);layer.buffer=new Uint8Array(fs.readFileSync(`${dir}/${c.id}.bin`));layer.setName('Source');doc.setLayers([layer]);doc.markDirty();const original=doc.getRasterData().slice();
 const g=expansionGeometry(c.width,c.height,c.expansion),controller={openDocs:[doc],pointerState:{isDown:false}},timings={};
 let start=performance.now();const context=captureExpandSource(controller,doc,g),{input}=prepareExpandInput(original,g,{enabled:true,endpoint:'http://127.0.0.1:8188',checkpoint:'sd-v1-5-inpainting.ckpt'},{prompt:c.prompt,count:1,seed:c.seed});timings.preparationMs=performance.now()-start;
 start=performance.now();const result=containExpandResult(cropInpaintResult(input,new Uint8Array(fs.readFileSync(`${dir}/${c.id}-output.bin`))),g);timings.cropContainmentMs=performance.now()-start;
 fs.writeFileSync(`${dir}/${c.id}-contained.bin`,result.bytes);fs.writeFileSync(`${dir}/${c.id}-preview.bin`,expandedPreview(original,result,g));
 start=performance.now();commitExactExpansion(controller,context,result);timings.acceptMs=performance.now()-start;
 doc.markDirty();const accepted=doc.getRasterData().slice();assertOriginalProjection(original,accepted,g);
 if(hash(layer.buffer)!==c.sourceSha256)throw Error('Source changed');
 const history=new TrackerRegistry.History();start=performance.now();history.stepHistoryBackward(doc);doc.markDirty();if(hash(doc.getRasterData())!==hash(original)||doc.width!==c.width||doc.height!==c.height)throw Error('Undo mismatch');timings.undoMs=performance.now()-start;
 start=performance.now();history.stepHistoryForward(doc);doc.markDirty();if(hash(doc.getRasterData())!==hash(accepted))throw Error('Redo mismatch');timings.redoMs=performance.now()-start;
 const files=[];
 for(const psb of [false,true]){const buffer=new RenderBuffer(),n=PSDParser.serialize(doc,buffer,[false,false,false,psb]);const bytes=buffer.data.slice(0,n),name=`${c.id}.${psb?'psb':'psd'}`;fs.writeFileSync(`${dir}/${name}`,bytes);const reopen=new Document(name);PSDParser.parse(bytes.buffer,reopen);reopen.setLayers(reopen.layers);reopen.invalidateAllLayers();reopen.markDirty();if(hash(reopen.getRasterData())!==hash(accepted)||hash(reopen.layers[0].buffer)!==c.sourceSha256||hash(reopen.layers[1].buffer)!==hash(result.bytes))throw Error('Reopen mismatch '+name);files.push({name,bytes:n});}
 receipts.push({id:c.id,geometry:g,originalChangedBytes:0,sourceSha256:c.sourceSha256,originalCompositeSha256:hash(original),acceptedCompositeSha256:hash(accepted),exteriorLayerSha256:hash(result.bytes),historyEntries:doc.history.length,geometrySha256:hash(JSON.stringify(doc.layers.map(l=>l.rect))),files,timings});
}
fs.writeFileSync(dir+'/containment-receipts.json',JSON.stringify(receipts,null,2)+'\n');console.log(`${receipts.length} exact containment/history/PSD+PSB cases passed`);
