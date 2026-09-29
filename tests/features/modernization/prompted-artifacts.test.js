import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PROMPTED_MODEL } from '../../../src/features/modernization/prompted-workload.js';
it('packaged SAM2 encoder and decoder match the provenance and runtime contract',()=>{
 const evidence=JSON.parse(fs.readFileSync(new URL('../../../docs/m4/model-evaluation.json',import.meta.url)));
 for(const name of ['encoder','decoder']){const bytes=fs.readFileSync(new URL('../../../src/vendor/prompted-model/'+name+'.onnx',import.meta.url));assert.equal(bytes.length,evidence.artifacts[name].bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),PROMPTED_MODEL[name+'Sha256']);assert.equal(PROMPTED_MODEL[name+'Sha256'],evidence.artifacts[name].sha256)}
 assert.ok(fs.existsSync(new URL('../../../src/vendor/prompted-model/LICENSE',import.meta.url)));assert.ok(fs.existsSync(new URL('../../../src/vendor/prompted-model/NOTICE',import.meta.url)));
});
