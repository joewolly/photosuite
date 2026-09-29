import fs from 'node:fs';
import { extendUpscaleRGB } from '../../src/features/modernization/upscale-workload.js';
const dir=process.argv[2], manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json'));
for(const c of manifest.cases){const source=new Uint8Array(fs.readFileSync(`${dir}/${c.id}.bin`));fs.writeFileSync(`${dir}/${c.id}-model.bin`,extendUpscaleRGB(source,c.width,c.height));}
