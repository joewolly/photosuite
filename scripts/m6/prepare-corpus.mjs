import fs from 'node:fs';
import path from 'node:path';
import { prepareGenerativeInput } from '../../src/features/modernization/generative-workload.js';
const dir=process.argv[2],manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
for(const item of manifest.cases){
 const {width,height,id,prompt,seed}=item,rect={x:0,y:0,width,height};
 const prepared=prepareGenerativeInput({rect,buffer:new Uint8Array(fs.readFileSync(path.join(dir,id+'.bin')))},{rect,channel:new Uint8Array(fs.readFileSync(path.join(dir,id+'-selection.bin')))},width,height,{endpoint:'http://127.0.0.1:8188',checkpoint:'sd-v1-5-inpainting.ckpt'},{prompt,count:1,seed});
 const {input,coverage}=prepared;fs.writeFileSync(path.join(dir,id+'-model.bin'),Buffer.concat([input.rgba,input.mask]));fs.writeFileSync(path.join(dir,id+'-coverage.bin'),coverage);
 Object.assign(item,{roi:input.rect,modelWidth:input.modelWidth,modelHeight:input.modelHeight});
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
