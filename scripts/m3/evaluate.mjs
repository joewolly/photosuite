/** Explicit real-model acceptance, separate from ordinary CI. Input: directory of RGBA .bin files + corpus manifest. */
import fs from 'node:fs';import path from 'node:path';import { performance } from 'node:perf_hooks';
import * as ort from '../../src/vendor/onnxruntime/ort.wasm.min.mjs';
import { prepareSubjectTensor,reconstructSubjectMask } from '../../src/features/modernization/subject-workload.js';
import { runQuickSelectWorkload } from '../../src/features/modernization/quick-select-workload.js';
const [source,out]=process.argv.slice(2);if(!source||!out)throw Error('Provide decoded corpus and output directories');fs.mkdirSync(out,{recursive:true});
ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('../../src/vendor/onnxruntime/',import.meta.url).href;
let t=performance.now();const session=await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(new URL('../../src/vendor/subject-model/birefnet-lite-512-fp16.onnx',import.meta.url))),{executionProviders:['wasm'],graphOptimizationLevel:'all'});const loadMs=performance.now()-t;
const records=[];
for(const item of JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))).cases){
 const {width,height}=item;const rgba=new Uint8Array(fs.readFileSync(path.join(source,item.id+'.bin')));const input={rect:{x:0,y:0,width,height},documentWidth:width,documentHeight:height,rgba,color:'srgb8',alpha:'straight'};
 t=performance.now();const p=prepareSubjectTensor(input);const preprocessMs=performance.now()-t;
 const tensor=new ort.Tensor('float32',p.tensor,[1,3,512,512]);t=performance.now();const outputs=await session.run({input_image:tensor});const inferenceMs=performance.now()-t;t=performance.now();
 const r=reconstructSubjectMask(input,p.mapping,outputs.output_image.data,outputs.output_image.dims);const reconstructMs=performance.now()-t;
 fs.writeFileSync(path.join(out,item.id+'-model.bin'),r.bytes);tensor.dispose();outputs.output_image.dispose();
 // Minimal prompting: one 9x9 foreground dab at the versioned, manually chosen visible subject point.
 const [sx,sy]=item.quickSelectSeed;const quick=runQuickSelectWorkload({...input,base:null,strokes:[{rect:{x:sx-4,y:sy-4,width:9,height:9},marks:new Uint8Array(81).fill(255),radius:5}]});
 fs.writeFileSync(path.join(out,item.id+'-quick.bin'),quick.bytes);
 // Sensitivity check: one much broader circular foreground dab, radius 10% of short side.
 const radius=Math.round(Math.min(width,height)*.1),diameter=radius*2+1,marks=new Uint8Array(diameter**2).fill(128);
 for(let y=0;y<diameter;y++)for(let x=0;x<diameter;x++)if(Math.hypot(x-radius,y-radius)<=radius)marks[y*diameter+x]=255;
 const wide=runQuickSelectWorkload({...input,base:null,strokes:[{rect:{x:sx-radius,y:sy-radius,width:diameter,height:diameter},marks,radius}]});
 fs.writeFileSync(path.join(out,item.id+'-quick-wide.bin'),wide.bytes);
 // A deliberately simple border-color foreground estimate (L2 RGB distance > 40).
 const mean=[0,0,0];let n=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!x||!y||x===width-1||y===height-1){for(let c=0;c<3;c++)mean[c]+=rgba[(y*width+x)*4+c];n++;}
 for(let c=0;c<3;c++)mean[c]/=n;const classical=new Uint8Array(width*height);for(let i=0;i<classical.length;i++){let d=0;for(let c=0;c<3;c++)d+=(rgba[i*4+c]-mean[c])**2;classical[i]=d>1600?rgba[i*4+3]:0;}
 fs.writeFileSync(path.join(out,item.id+'-border.bin'),classical);
 records.push({id:item.id,width,height,modelWidth:512,modelHeight:512,preprocessMs,inferenceMs,reconstructMs,quickTimings:quick.timings,rssBytes:process.memoryUsage().rss});console.log(JSON.stringify(records.at(-1)));
}
await session.release();fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({runtime:'Node WASM, not native Tauri',loadMs,records},null,2)+'\n');
