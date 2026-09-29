/** Evaluate actual editor composition/serialization, not raw model context. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import { installBrowserGlobals } from '../../tests/helpers/stub-browser-globals.js';
installBrowserGlobals();
const [{Document},{Rect},{LayerSystem},{createInpaintAdapter},{cropInpaintResult},{RenderBuffer},{PSDParser}]=await Promise.all([
 import('../../src/document/model/document.js'),import('../../src/core/math/rect.js'),import('../../src/engine/layer-system.js'),import('../../src/features/modernization/inpaint-target.js'),import('../../src/features/modernization/inpaint-workload.js'),import('../../src/core/render-buffer.js'),import('../../src/document/formats/psd/psd-parser.js')]);
LayerSystem.webglEnabled=false;
const dir=process.argv[2],manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),rows=[];
for(const item of manifest.cases){
 const {id,width,height,roi,modelWidth,modelHeight}=item;if(!fs.existsSync(path.join(dir,id+'-output.bin')))continue;
 const source=new Uint8Array(fs.readFileSync(path.join(dir,id+'.bin'))),selection=new Uint8Array(fs.readFileSync(path.join(dir,id+'-selection.bin'))),coverage=new Uint8Array(fs.readFileSync(path.join(dir,id+'-coverage.bin')));
 const doc=new Document(id+'.psd');doc.width=width;doc.height=height;const layer=doc.newLayer();layer.rect=new Rect(0,0,width,height);layer.buffer=source.slice();layer.setName('Source');doc.setLayers([layer]);doc.selectedLayerIndices=[0];doc.selectionMask={rect:new Rect(0,0,width,height),channel:selection};doc.markDirty();doc.composite();const before=doc.buffer.slice();
 const controller={openDocs:[doc],getCurrentDoc:()=>doc,pointerState:{isDown:false}},adapter=createInpaintAdapter(controller,doc,layer,roi,coverage,'Generative Fill'),context=adapter.capture();
 const raw=new Uint8Array(fs.readFileSync(path.join(dir,id+'-output.bin'))),result=cropInpaintResult({rect:roi,modelWidth,modelHeight,modelOffset:{x:0,y:0}},raw);result.name='Generative Fill';
 const t=performance.now();adapter.preview(context,result,'corpus');const containmentMs=performance.now()-t;adapter.validate(context,true);adapter.commit(context,result);adapter.dispose(context);doc.composite();
 let outside=0,inside=0;for(let p=0;p<width*height;p++)for(let c=0;c<4;c++)if(before[p*4+c]!==doc.buffer[p*4+c]){if(selection[p])inside++;else outside++;}
 if(outside!==0)throw Error(id+' containment failed');if(hash(layer.buffer)!==hash(source))throw Error(id+' source changed');
 fs.writeFileSync(path.join(dir,id+'-contained.bin'),doc.buffer);fs.writeFileSync(path.join(dir,id+'-patch.bin'),result.bytes);
 rows.push({id,changedBytesOutsideSelection:outside,changedBytesInsideSelection:inside,rawSha256:hash(raw),sourceSha256:hash(source),patchSha256:hash(result.bytes),compositeSha256:hash(doc.buffer),containmentMs,roi,historyEntries:doc.history.length});
}
fs.writeFileSync(path.join(dir,'containment-receipts.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.map(r=>({id:r.id,outside:r.changedBytesOutsideSelection,inside:r.changedBytesInsideSelection})),null,2));
