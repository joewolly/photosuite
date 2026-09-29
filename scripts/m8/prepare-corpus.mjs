import fs from 'node:fs';
import {expansionGeometry,prepareExpandInput} from '../../src/features/modernization/expand-workload.js';
const dir=process.argv[2], manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json'));
for(const item of manifest.cases){
 const g=expansionGeometry(item.width,item.height,item.expansion),source=new Uint8Array(fs.readFileSync(`${dir}/${item.id}.bin`));
 const {input}=prepareExpandInput(source,g,{enabled:true,endpoint:'http://127.0.0.1:8188',checkpoint:'sd-v1-5-inpainting.ckpt'},{prompt:item.prompt,seed:item.seed,count:1});
 fs.writeFileSync(`${dir}/${item.id}-model.bin`,Buffer.concat([input.rgba,input.mask]));
 Object.assign(item,{geometry:g,modelWidth:input.modelWidth,modelHeight:input.modelHeight,modelOffset:input.modelOffset});
}
fs.writeFileSync(dir+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
