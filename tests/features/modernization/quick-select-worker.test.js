import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Worker } from 'node:worker_threads';
import { Rect } from '../../../src/core/math/rect.js';
import { createQuickSelectComputation, adoptDocumentSelection, recomputeQuickSelectSelection } from '../../../src/engine/compositing/quick-select-computation.js';
import { runQuickSelectWorkload, validateQuickSelectInput } from '../../../src/features/modernization/quick-select-workload.js';
import { createQuickSelectProvider } from '../../../src/features/modernization/quick-select-provider.js';

export function inputFixture() {
  const rect = { x: -7, y: 11, width: 80, height: 60 };
  const rgba = new Uint8Array(80 * 60 * 4);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) rgba.set(x > 18 && x < 60 && y > 12 && y < 48 ? [230, 90, 30, 255] : [20, 40, 180, 255], (y * 80 + x) * 4);
  return { rect, rgba, base: null, strokes: [{ rect: { x: 22, y: 32, width: 14, height: 14 }, marks: new Uint8Array(196).fill(255), radius: 7 }] };
}
function reference(input) {
  const r = input.rect, session = createQuickSelectComputation(input.rgba, new Rect(r.x, r.y, r.width, r.height));
  if (input.base) adoptDocumentSelection(session, { rect: new Rect(input.base.rect.x, input.base.rect.y, input.base.rect.width, input.base.rect.height), channel: input.base.channel });
  for (const stroke of input.strokes) {
    for (let y = 0; y < stroke.rect.height; y++) for (let x = 0; x < stroke.rect.width; x++) {
      const value = stroke.marks[y * stroke.rect.width + x];
      if (value === 255 || value === 0) session.brushMaskBuffer[(y + stroke.rect.y - r.y) * r.width + x + stroke.rect.x - r.x] = value;
    }
    session.brushRadius = stroke.radius; recomputeQuickSelectSelection(session);
  }
  return session.selectionMaskBuffer;
}
it('worker workload matches the existing graph-cut algorithm at negative/nonzero document origins', () => {
  const input = inputFixture(), stages = [];
  const result = runQuickSelectWorkload(input, (p) => stages.push(p.stage));
  assert.deepEqual(result.rect, input.rect); assert.deepEqual(result.bytes, reference(input));
  assert.ok(result.bytes.some((b) => b > 0)); assert.deepEqual(stages, ['Analysing image', 'Refining']);
});
it('foreground/background correction replay and adopted soft coverage remain exact', () => {
  const input = inputFixture();
  input.base = { rect: { x: -7, y: 11, width: 3, height: 3 }, channel: new Uint8Array([64, 128, 192, 64, 128, 192, 64, 128, 192]) };
  input.strokes.push({ rect: { x: 30, y: 32, width: 12, height: 12 }, marks: new Uint8Array(144), radius: 6 });
  const result = runQuickSelectWorkload(input); assert.deepEqual(result.bytes, reference(input));
  assert.deepEqual([...result.bytes.subarray(0, 3)], [64, 128, 192]);
});
it('oversized source, excess correction history and malformed bytes fail before computation', () => {
  const input = inputFixture();
  assert.throws(() => validateQuickSelectInput({ ...input, rect: { x: 0, y: 0, width: 4096, height: 4096 } }), (e) => e.code === 'resource-limit');
  assert.throws(() => validateQuickSelectInput({ ...input, strokes: Array(33).fill(input.strokes[0]) }), (e) => e.code === 'resource-limit');
  assert.throws(() => validateQuickSelectInput({ ...input, rgba: new Uint8Array(4) }), (e) => e.code === 'invalid-request');
});
it('real module worker transfers only owned input and returns exact bytes without DOM globals', async () => {
  const input = inputFixture(), expected = runQuickSelectWorkload(input), owned = structuredClone(input);
  const worker = new Worker(new URL('./node-selection-worker.js', import.meta.url));
  try {
    const completed = new Promise((resolve, reject) => { worker.on('error', reject); worker.on('message', (m) => { if (m.result) resolve(m); else if (m.error) reject(new Error('worker failure')); }); });
    worker.postMessage({ id: 'proof', revision: 2, input: owned }, [owned.rgba.buffer, owned.strokes[0].marks.buffer]);
    assert.equal(owned.rgba.byteLength, 0); assert.equal(input.rgba.byteLength, 19200);
    const message = await completed; assert.equal(message.revision, 2); assert.deepEqual(message.result.bytes, expected.bytes);
  } finally { await worker.terminate(); }
});
it('worker protocol rejects foreign identities, handles crash/message error, and restarts independently', () => {
  const workers = [], results = [], errors = [], stages = [];
  const provider = createQuickSelectProvider(() => {
    const worker = { postMessage: (data, transfer) => { worker.received = structuredClone(data, { transfer }); }, terminate: () => { worker.terminated = true; } };
    workers.push(worker); return worker;
  });
  const callbacks = { complete: (r) => results.push(r), fail: (e) => errors.push(e), progress: (p) => stages.push(p) };
  provider.start(inputFixture(), callbacks, { id: 'A', revision: 1 });
  workers[0].onmessage({ data: { id: 'B', revision: 1, result: {} } }); assert.equal(results.length, 0);
  workers[0].onerror({ preventDefault() {} }); assert.equal(errors[0].code, 'worker-failure'); assert.ok(workers[0].terminated);
  const stop = provider.start(inputFixture(), callbacks, { id: 'B', revision: 2 });
  workers[1].onmessage({ data: { id: 'B', revision: 2, progress: { kind: 'stage', stage: 'Refining' } } }); assert.equal(stages.length, 1);
  assert.equal(stop(), true); assert.equal(workers[1].onmessage, null); assert.ok(workers[1].terminated);
  provider.start(inputFixture(), callbacks, { id: 'C', revision: 3 });
  workers[2].onmessageerror({}); assert.equal(errors.length, 2);
  provider.start(inputFixture(), callbacks, { id: 'D', revision: 4 });
  workers[3].onmessage({ data: { id: 'D', revision: 4, result: runQuickSelectWorkload(inputFixture()) } });
  assert.equal(results.length, 1); assert.ok(workers[3].terminated);
});
