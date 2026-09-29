import assert from 'node:assert/strict';
import { before, it } from 'node:test';
import { installBrowserGlobals } from '../../helpers/stub-browser-globals.js';
import { fakeProvider, flushJobs } from './fake-provider.js';
installBrowserGlobals();
let Document, Rect, TrackerRegistry, LayerSystem, SelectionJobs, createSelectionAdapter, captureResultTarget, getResultDocumentInfo, closeResultDocumentSession, prepareExactResult, commitExactResult;
before(async () => {
  ({ Document } = await import('../../../src/document/model/document.js'));
  ({ Rect } = await import('../../../src/core/math/rect.js'));
  ({ TrackerRegistry } = await import('../../../src/features/trackers/tracker-registry.js'));
  ({ LayerSystem } = await import('../../../src/engine/layer-system.js')); LayerSystem.webglEnabled = false;
  ({ SelectionJobs } = await import('../../../src/features/modernization/selection-jobs.js'));
  ({ createSelectionAdapter } = await import('../../../src/features/modernization/selection-target.js'));
  ({ captureResultTarget, getResultDocumentInfo, closeResultDocumentSession } = await import('../../../src/features/results/result-targets.js'));
  ({ prepareExactResult, commitExactResult } = await import('../../../src/features/trackers/exact-result-tracker.js'));
});
function fixture() {
  const doc = new Document('same.psd'); doc.width = 80; doc.height = 60; doc.buffer = new Uint8Array(80 * 60 * 4);
  const layer = doc.newLayer(); layer.setName('Source'); layer.rect = new Rect(-3, 5, 20, 16);
  layer.buffer = Uint8Array.from({ length: 1280 }, (_, i) => i % 4 === 3 ? 255 : i % 256);
  doc.setLayers([layer]); doc.selectedLayerIndices = [0];
  const controller = { openDocs: [doc], getCurrentDoc: () => doc, pointerState: { isDown: false } };
  const fake = fakeProvider();
  fake.provider.validateInput = (input) => input.rgba.length + input.strokes.reduce((n, s) => n + s.marks.length, 0);
  fake.provider.copyResult = (r) => ({ ...r, rect: { ...r.rect }, bytes: r.bytes.slice() });
  const bridge = new SelectionJobs(controller, fake.provider, false), history = new TrackerRegistry.History();
  const stroke = { rect: { x: 1, y: 9, width: 3, height: 3 }, marks: new Uint8Array(9).fill(255), radius: 2 };
  const submit = () => { bridge.begin(doc, 0); return bridge.submitStroke(doc, stroke); };
  const result = () => ({ pixelFormat: 'coverage8', rect: { x: -3, y: 5, width: 20, height: 16 }, byteLength: 320, bytes: Uint8Array.from({ length: 320 }, (_, i) => i % 256) });
  return { doc, layer, controller, ...fake, bridge, history, stroke, submit, result };
}
function assertUnchanged(f, length = 1) { assert.equal(f.doc.history.length, length); assert.equal(f.doc.selectionMask, null); }
it('real M0 Accept creates exactly one history entry; Undo/Redo preserve soft coverage without another provider', async () => {
  const f = fixture(), id = f.submit(), before = f.layer.buffer.slice(); await flushJobs();
  const result = f.result(), expected = result.bytes.slice(); f.calls[0].complete(result);
  assertUnchanged(f); assert.equal(f.doc.toolOverlayState.jobSelectionPreview.jobId, id);
  result.bytes.fill(0); assert.deepEqual(f.doc.toolOverlayState.jobSelectionPreview.channel, expected);
  assert.equal(f.bridge.jobs.accept(id), true); assert.equal(f.doc.history.length, 2);
  assert.equal(f.doc.toolOverlayState.jobSelectionPreview, null); assert.equal(f.bridge.sessions.size, 0);
  assert.deepEqual(f.doc.selectionMask.channel, expected); assert.deepEqual(f.layer.buffer, before);
  f.history.stepHistoryBackward(f.doc); assert.equal(f.doc.selectionMask, null);
  f.history.stepHistoryForward(f.doc); assert.deepEqual(f.doc.selectionMask.channel, expected); assert.equal(f.calls.length, 1);
});
for (const action of ['discard', 'cancel']) it(`${action} removes only transient preview and releases session/input/results`, async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); f.calls[0].complete(f.result());
  f.bridge.jobs[action](id); assertUnchanged(f); assert.equal(f.doc.toolOverlayState.jobSelectionPreview, null);
  assert.equal(f.bridge.sessions.size, 0); assert.equal(f.bridge.jobs.get(id).hasResult, false);
});
it('tab switches retain original target; Accept never edits the new active document', async () => {
  const f = fixture(), g = fixture(), id = f.submit(); await flushJobs();
  f.controller.openDocs.push(g.doc); f.controller.getCurrentDoc = () => g.doc;
  f.calls[0].complete(f.result()); f.bridge.jobs.accept(id);
  assert.equal(f.doc.history.length, 2); assertUnchanged(g);
});
it('Discard remains bound to the original document after tab switch', async () => {
  const f = fixture(), g = fixture(), id = f.submit(); await flushJobs(); f.calls[0].complete(f.result());
  f.controller.openDocs.push(g.doc); f.controller.getCurrentDoc = () => g.doc; f.bridge.jobs.discard(id);
  assertUnchanged(f); assertUnchanged(g);
});
it('close/reopen same filename revokes old session and ignores late results', async () => {
  const f = fixture(), id = f.submit(); await flushJobs();
  const previous = getResultDocumentInfo(f.doc).documentId;
  f.bridge.close(f.doc); closeResultDocumentSession(f.doc); const g = fixture(); f.controller.openDocs = [g.doc];
  assert.notEqual(getResultDocumentInfo(g.doc).documentId, previous);
  f.calls[0].complete(f.result()); assert.equal(f.bridge.jobs.get(id).state, 'cancelled');
  assert.equal(f.bridge.jobs.get(id).error.code, 'document-closed'); assertUnchanged(g); assertUnchanged(f);
});
const mutations = {
  'source pixels beyond the first pixel': (f) => f.layer.buffer[100]++,
  'source region': (f) => f.layer.rect.x++,
  'canvas dimensions': (f) => f.doc.width++,
  'selection bytes': (f) => { f.doc.selectionMask = { rect: new Rect(0, 0, 1, 1), channel: new Uint8Array(4).fill(60) }; },
  'target deleted': (f) => f.doc.setLayers([]),
  'target replaced with matching name/id/bytes': (f) => { const replacement = f.layer.clone(); f.doc.setLayers([replacement]); },
  'target reordered by identity': (f) => { const other = f.doc.newLayer(); f.doc.setLayers([other, f.layer]); },
  'source mask channel becomes active': (f) => { f.layer.pixelContent = 1; },
  'source lock': (f) => { f.layer.add.lspf = 1; },
  'document session revoked': (f) => closeResultDocumentSession(f.doc),
  'history head replaced at same index': (f) => { f.doc.history[0] = { ...f.doc.history[0] }; },
};
for (const [label, mutate] of Object.entries(mutations)) it(`running result becomes stale when ${label}`, async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); mutate(f); f.calls[0].complete(f.result());
  assert.equal(f.bridge.jobs.get(id).state, 'stale'); assert.equal(f.bridge.jobs.get(id).hasResult, false);
  assert.equal(f.doc.history.length, 1); assert.equal(f.doc.toolOverlayState.jobSelectionPreview ?? null, null);
});
function setSelection(f) {
  const target = captureResultTarget(f.controller, { documentId: getResultDocumentInfo(f.doc).documentId, operation: 'setSelection' });
  commitExactResult(f.controller, prepareExactResult(f.controller, target, f.result()));
}
for (const direction of ['undo', 'redo']) it(`${direction} during computation invalidates preview`, async () => {
  const f = fixture(); setSelection(f);
  if (direction === 'redo') f.history.stepHistoryBackward(f.doc);
  const id = f.submit(); await flushJobs();
  if (direction === 'undo') f.history.stepHistoryBackward(f.doc); else f.history.stepHistoryForward(f.doc);
  f.calls[0].complete(f.result()); assert.equal(f.bridge.jobs.get(id).state, 'stale');
});
for (const kind of ['pointer', 'transform', 'dialog']) it(`Accept rejects an active ${kind} without history`, async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); f.calls[0].complete(f.result());
  if (kind === 'pointer') f.controller.pointerState.isDown = true;
  if (kind === 'transform') f.controller.getActiveToolEntry = () => ({ activeOp: {} });
  if (kind === 'dialog') f.controller.documentView = { getTopDialog: () => ({}) };
  assert.equal(f.bridge.jobs.accept(id), false); assert.equal(f.bridge.jobs.get(id).state, 'stale'); assertUnchanged(f);
});
it('preview revalidates exact bytes at Accept even before periodic checking', async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); f.calls[0].complete(f.result());
  f.layer.buffer[500]++; assert.equal(f.bridge.jobs.accept(id), false); assertUnchanged(f);
});
it('periodic revalidation removes stale overlay and terminates stale active worker', async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); f.layer.buffer[500]++;
  f.bridge.tick(1000); assert.equal(f.bridge.jobs.get(id).state, 'stale'); assert.equal(f.calls[0].cancellations, 1);
});
it('successive correction gestures supersede old requests; late A cannot replace B', async () => {
  const f = fixture(), a = f.submit(); await flushJobs();
  f.bridge.begin(f.doc, 1); const b = f.bridge.submitStroke(f.doc, { ...f.stroke, marks: new Uint8Array(9) }); await flushJobs();
  assert.equal(f.calls[1].input.strokes.length, 2); assert.equal(f.calls[1].revision, 2);
  const newer = f.result(); newer.bytes.fill(128); f.calls[1].complete(newer); f.calls[0].complete(f.result());
  assert.equal(f.bridge.jobs.get(a).state, 'cancelled'); assert.equal(f.doc.toolOverlayState.jobSelectionPreview.jobId, b);
  assert.ok(f.doc.toolOverlayState.jobSelectionPreview.channel.every((b) => b === 128)); assertUnchanged(f);
  f.bridge.jobs.accept(b); assert.equal(f.doc.history.length, 2);
});
it('malformed result coordinates fail with no overlay/history', async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); const r = f.result(); r.rect.x++;
  f.calls[0].complete(r); assert.equal(f.bridge.jobs.get(id).error.code, 'malformed-result'); assertUnchanged(f);
});
it('history commit failure is rolled back by M0 and job becomes failed', async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); f.calls[0].complete(f.result());
  f.doc.pushHistory = () => { throw new Error('failure'); };
  assert.equal(f.bridge.jobs.accept(id), false); assert.equal(f.bridge.jobs.get(id).state, 'failed'); assertUnchanged(f);
});
it('source size rejected before brush construction, worker transfer or mutation', () => {
  const f = fixture(); f.doc.width = f.doc.height = 4096;
  assert.throws(() => f.bridge.begin(f.doc, 0), (e) => e.code === 'resource-limit'); assert.equal(f.calls.length, 0); assertUnchanged(f);
});
it('abandoned empty gesture releases its document while tab switches retain submitted jobs', async () => {
  const f = fixture(); f.bridge.begin(f.doc, 0); assert.equal(f.bridge.sessions.size, 1);
  f.bridge.abandonGesture(f.doc); assert.equal(f.bridge.sessions.size, 0);
  const id = f.submit(); await flushJobs(); f.bridge.abandonGesture(f.doc);
  assert.equal(f.bridge.jobs.get(id).state, 'running'); assert.equal(f.bridge.sessions.size, 1);
});
it('source byte comparison handles unaligned independently owned buffers exactly', async () => {
  const f = fixture(); const backing = new Uint8Array(1281); backing.set(f.layer.buffer, 1); f.layer.buffer = backing.subarray(1);
  const id = f.submit(); await flushJobs(); f.layer.buffer[1279] ^= 1; f.calls[0].complete(f.result());
  assert.equal(f.bridge.jobs.get(id).state, 'stale');
});
it('real Quick Select gesture preserves coordinates, keeps source/selection/history untouched, and owns its brush buffer', async () => {
  const { QuickSelectTool } = await import('../../../src/document/tools/selection-tools.js');
  const { BrushStroke } = await import('../../../src/features/brush/brush-stroke.js');
  const { Point } = await import('../../../src/core/math/point.js');
  const { KeyboardHandler } = await import('../../../src/core/keyboard-handler.js');
  const f = fixture(), tool = new QuickSelectTool(), scratch = BrushStroke.scratchBuffer;
  f.doc.pathViewport.screenToDocPoint = (x, y) => new Point(x - 100, y - 100);
  f.doc.pathViewport.zoomScale = 1; f.doc.pathViewport.rotationRadians = 0;
  f.controller.getSelectionJobs = () => f.bridge; f.controller.dispatch = () => {};
  const appData = { brushPresets: { samples: [], patterns: [] } }, keyboard = { isPressed: () => false };
  const before = f.layer.buffer.slice();
  tool.onMouseDown(f.doc, f.controller, appData, keyboard, { x: 104, y: 111, pressure: 1, isDown: true });
  assert.ok(tool.selectionGesture); assert.notEqual(tool.selectionGesture.stroke.getBuffer(), scratch);
  assert.equal(BrushStroke.scratchBuffer, scratch);
  tool.selectionGesture.stroke.lineTo(8, 11, 1);
  tool.onMouseUp(f.doc, f.controller); await flushJobs();
  assert.equal(tool.selectionGesture, null); assertUnchanged(f); assert.deepEqual(f.layer.buffer, before);
  const marks = f.calls[0].input.strokes[0]; assert.ok(marks.marks.some((b) => b === 255));
  assert.ok(marks.rect.x >= -3 && marks.rect.x < 17); assert.ok(marks.rect.y >= 5 && marks.rect.y < 21);
  assert.deepEqual(f.calls[0].input.rect, { x: -3, y: 5, width: 20, height: 16 });
  tool.onMouseDown(f.doc, f.controller, appData, { isPressed: (key) => key === KeyboardHandler.Shift }, { x: 112, y: 112, pressure: 1 });
  assert.ok(tool.selectionGesture.stroke.strokePoints.length >= 4);
  tool.disable(f.doc, f.controller); assert.equal(tool.selectionGesture, null);
});
