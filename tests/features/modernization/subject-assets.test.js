import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SUBJECT_MODEL, SUBJECT_LIMITS } from '../../../src/features/modernization/subject-workload.js';

it('bundled subject model and matching WASM runtime retain reviewed provenance', () => {
  const root = new URL('../../../', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('docs/m3/model-provenance.json', root)));
  const model = readFileSync(new URL(provenance.artifact, root));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(model.length, SUBJECT_LIMITS.modelBytes);
  assert.equal(hash(model), SUBJECT_MODEL.sha256);
  assert.equal(provenance.artifactSha256, SUBJECT_MODEL.sha256);
  for (const [name, expected] of Object.entries(provenance.runtimeFilesSha256)) {
    assert.equal(hash(readFileSync(new URL('src/vendor/onnxruntime/' + name, root))), expected, name);
  }
});
