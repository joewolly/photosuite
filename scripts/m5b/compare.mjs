/** Developer evaluation using PhotoSuite's actual existing raster interpolation. */
import fs from 'node:fs';
import { installBrowserGlobals } from '../../tests/helpers/stub-browser-globals.js';
import { combineUpscaleAlpha } from '../../src/features/modernization/upscale-workload.js';
installBrowserGlobals();
const { rasterizeWithMatrix } = await import('../../src/document/render/raster-transform.js');
const { Rect } = await import('../../src/core/math/rect.js');
const dir=process.argv[2], manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json')), receipts=[];
for(const c of manifest.cases){
 const rgba=new Uint8Array(fs.readFileSync(`${dir}/${c.id}.bin`)),input={width:c.width,height:c.height,scale:4,rgba};
 const output=new Uint8Array(fs.readFileSync(`${dir}/${c.id}-output.bin`));
 combineUpscaleAlpha(input,output);fs.writeFileSync(`${dir}/${c.id}-alpha.bin`,output);
 const report={id:c.id,width:c.width*4,height:c.height*4,baselines:[]};
 for(const [mode,name] of ['nearest','bilinear','sharper'].entries()){
  const start=performance.now(),result=rasterizeWithMatrix([rgba.slice(),new Rect(0,0,c.width,c.height)],mode,[4,0,0,0,4,0,0,0,1]);
  if(result.rect.width!==c.width*4||result.rect.height!==c.height*4)throw Error('Wrong interpolation geometry');
  fs.writeFileSync(`${dir}/${c.id}-${name}.bin`,result.buffer);report.baselines.push({mode:name,ms:performance.now()-start});
 }
 receipts.push(report);
}
fs.writeFileSync(dir+'/comparison.json',JSON.stringify(receipts,null,2)+'\n');
