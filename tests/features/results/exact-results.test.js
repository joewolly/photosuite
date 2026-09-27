import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
installBrowserGlobals();
let Document, Rect, Mask, VectorMask, LayerSectionType, TrackerRegistry, LayerSystem;
let getResultDocumentInfo, captureResultTarget, closeResultDocumentSession;
let prepareExactResult, commitExactResult, removeBackgroundFromSelection;
before(async () => {
  ({ Document } = await import("../../../src/document/model/document.js"));
  ({ Rect } = await import("../../../src/core/math/rect.js"));
  ({ Mask, VectorMask } = await import("../../../src/document/model/layer-masks.js"));
  ({ LayerSectionType } = await import("../../../src/document/model/layer.js"));
  ({ TrackerRegistry } = await import("../../../src/features/trackers/tracker-registry.js"));
  ({ LayerSystem } = await import("../../../src/engine/layer-system.js"));
  LayerSystem.webglEnabled = false;
  ({ getResultDocumentInfo, captureResultTarget, closeResultDocumentSession } = await import("../../../src/features/results/result-targets.js"));
  ({ prepareExactResult, commitExactResult, removeBackgroundFromSelection } = await import("../../../src/features/trackers/exact-result-tracker.js"));
});
function fixture() {
  const doc = new Document("same.psd");
  doc.width = 20; doc.height = 16;
  doc.buffer = new Uint8Array(20 * 16 * 4);
  const layer = doc.newLayer();
  layer.setName("Source");
  layer.rect = new Rect(-2, 3, 3, 5);
  layer.buffer = Uint8Array.from({ length: 60 }, (_, i) => i % 4 === 3 ? 255 : i);
  doc.setLayers([layer]); doc.selectedLayerIndices = [0];
  const controller = { openDocs: [doc], getCurrentDoc: () => doc };
  return { doc, layer, controller, history: new TrackerRegistry.History() };
}
function target(f, operation, layerIndex = 0) {
  const info = getResultDocumentInfo(f.doc);
  return captureResultTarget(f.controller, { documentId: info.documentId, layerId: info.layers[layerIndex]?.layerId, operation });
}
function payload(format = "rgba8", values) {
  const rect = new Rect(-3, 7, 3, 5);
  const bytes = values || Uint8Array.from({ length: 15 * (format === "rgba8" ? 4 : 1) }, (_, i) => i * 13 % 256);
  return { pixelFormat: format, rect, bytes, byteLength: bytes.length };
}
function apply(f, operation, data) { return commitExactResult(f.controller, prepareExactResult(f.controller, target(f, operation), data)); }
function select(f, data = payload("coverage8")) { apply(f, "setSelection", data); }
function stable(f) { return { layers: f.doc.layers.slice(), selection: f.doc.selectionMask, history: f.doc.history.slice(), index: f.doc.historyIndex, pixels: f.layer.buffer.slice(), mask: f.layer.getMask() }; }
function unchanged(f, before) {
  assert.deepEqual(f.doc.layers, before.layers); assert.equal(f.doc.selectionMask, before.selection);
  assert.deepEqual(f.doc.history, before.history); assert.equal(f.doc.historyIndex, before.index);
  assert.deepEqual(f.layer.buffer, before.pixels); assert.equal(f.layer.getMask(), before.mask);
}
describe("M0 real editor transactions", () => {
  it("inserts exact odd-size RGBA at negative coordinates, retaining sources and independent redo bytes", () => {
    const f = fixture(); const p = payload(); const expected = p.bytes.slice();
    apply(f, "insertRaster", { ...p, name: "Source" });
    assert.equal(f.doc.layers.length, 2); assert.equal(f.doc.layers[0], f.layer);
    assert.equal(f.doc.layers[1].getName(), "Source"); assert.ok(f.doc.layers[1].rect.equals(p.rect));
    assert.deepEqual(f.doc.layers[1].buffer, expected); assert.deepEqual(f.doc.selectedLayerIndices, [1]);
    assert.equal(f.doc.history.length, 2);
    p.bytes.fill(0); f.doc.layers[1].buffer.fill(0);
    f.history.stepHistoryBackward(f.doc); assert.deepEqual(f.doc.layers, [f.layer]);
    f.history.stepHistoryForward(f.doc); assert.deepEqual(f.doc.layers[1].buffer, expected);
  });
  it("replays an inserted layer and its later mask as a complete history chain", () => {
    const f = fixture(); apply(f, "insertRaster", payload());
    const inserted = f.doc.layers[1];
    select(f, payload("coverage8", new Uint8Array(15).fill(128)));
    removeBackgroundFromSelection(f.controller);
    const mask = inserted.getMask().clone(); const bytes = inserted.buffer.slice();
    for (let i = 0; i < 3; i++) f.history.stepHistoryBackward(f.doc);
    assert.deepEqual(f.doc.layers, [f.layer]);
    for (let i = 0; i < 3; i++) f.history.stepHistoryForward(f.doc);
    assert.equal(f.doc.layers[1], inserted);
    assert.deepEqual(inserted.buffer, bytes); assert.deepEqual(inserted.getMask().channel, mask.channel);
  });
  it("wires the visible Layer command to a real one-item history mutation", async () => {
    const { buildLayerMenu } = await import("../../../src/ui/menu/menu-bar-image-layer-menus.js");
    const { AppController } = await import("../../../src/ui/shell/app-controller.js");
    const { registerTrackers } = await import("../../../src/features/trackers/register-trackers.js");
    registerTrackers(TrackerRegistry);
    const menu = buildLayerMenu();
    assert.equal(menu.items.length, menu.menuActions.length);
    const index = menu.items.findIndex((item) => item.name === "layer.removeBackground");
    assert.ok(index >= 0);
    const f = fixture(); select(f); const count = f.doc.history.length;
    f.controller.onComplete = () => {};
    AppController.prototype.onUiDispatch.call(f.controller, { data: menu.menuActions[index].payload });
    assert.equal(f.doc.history.length, count + 1);
    assert.equal(f.doc.history.at(-1).name, "layer.removeBackground");
    assert.ok(f.layer.getMask());
  });
  it("rejects an active transform before preparing a target", () => {
    const f = fixture(); f.controller.getActiveToolEntry = () => ({ activeOp: {} });
    assert.throws(() => target(f, "setSelection"), /Finish/);
  });
  it("rejects changes to a captured selection and closed document membership", () => {
    const f = fixture(); select(f); const t = target(f, "setSelection");
    f.doc.selectionMask.channel[4]++;
    assert.throws(() => prepareExactResult(f.controller, t, payload("coverage8")), /Selection changed/);
    const prepared = prepareExactResult(f.controller, target(f, "insertRaster"), payload());
    f.controller.openDocs = []; assert.throws(() => commitExactResult(f.controller, prepared), /closed/);
  });
  it("bounds mask feather, parameters and combination extent before mutation", () => {
    const f = fixture(); const before = stable(f);
    for (const fields of [{ feather: 257 }, { density: -1 }, { outsideCoverage: 256 }, { enabled: 1 }, { linked: "yes" }]) {
      assert.throws(() => apply(f, "applyRasterMask", { ...payload("coverage8"), ...fields })); unchanged(f, before);
    }
    apply(f, "applyRasterMask", { ...payload("coverage8"), outsideCoverage: 255 });
    const masked = stable(f);
    assert.throws(() => apply(f, "applyRasterMask", { ...payload("coverage8"), rect: new Rect(50000, 7, 3, 5), outsideCoverage: 255 }), /limit/);
    unchanged(f, masked);
  });
  it("preserves explicit mask properties and rejects later mutation of history-owned data", () => {
    const f = fixture(); apply(f, "applyRasterMask", { ...payload("coverage8"), feather: 1, density: 120, outsideCoverage: 64, linked: false, enabled: false });
    const mask = f.layer.getMask();
    assert.equal(mask.feather, 1); assert.equal(mask.density, 120); assert.equal(mask.color, 64); assert.equal(mask.enabled, false); assert.equal(mask.isEnabled, false);
    mask.overlayTintRgb.h = 17; f.history.stepHistoryBackward(f.doc); f.history.stepHistoryForward(f.doc);
    assert.equal(f.layer.getMask().overlayTintRgb.h, 255);
  });
  it("restores the bounded stack after partial setLayers failure and rejects failed postconditions", () => {
    for (const silent of [false, true]) {
      const f = fixture(); const before = stable(f); const set = f.doc.setLayers;
      f.doc.setLayers = silent ? () => {} : function(layers) { set.call(this, layers); throw new Error("partial stack failure"); };
      assert.throws(() => apply(f, "insertRaster", payload()), /failure|postcondition/); unchanged(f, before);
    }
  });
  it("reserves the inserted PSD ID for subsequent ordinary layer creation", () => {
    const f = fixture(); apply(f, "insertRaster", payload());
    assert.notEqual(f.doc.newLayer().add.lyid, f.doc.layers[1].add.lyid);
  });
  it("full selection produces a reveal-canvas mask and clips outside the canvas", () => {
    const f = fixture(); const rect = new Rect(0, 0, f.doc.width, f.doc.height);
    select(f, { pixelFormat: "coverage8", rect, bytes: new Uint8Array(rect.area()).fill(255), byteLength: rect.area() });
    removeBackgroundFromSelection(f.controller);
    assert.ok(f.layer.getMask().rect.equals(rect)); assert.equal(f.layer.getMask().color, 0);
    assert.ok(f.layer.getMask().channel.every((v) => v === 255));
  });
  it("PSD save/reopen retains ordinary exact pixels and raster/vector masks", async () => {
    const { PSDParser } = await import("../../../src/document/formats/psd/psd-parser.js");
    const { RenderBuffer } = await import("../../../src/core/render-buffer.js");
    const { registerTrackers } = await import("../../../src/features/trackers/register-trackers.js");
    registerTrackers(TrackerRegistry);
    for (const vectorEnabled of [null, true, false]) {
      const f = fixture();
      if (vectorEnabled != null) { f.layer.add.vmsk = new VectorMask(); f.layer.add.vmsk.isEnabled = vectorEnabled; }
      select(f, payload("coverage8", new Uint8Array(15).fill(128)));
      removeBackgroundFromSelection(f.controller);
      apply(f, "insertRaster", payload());
      const pixels = f.layer.buffer.slice(), mask = f.layer.getMask().clone(), result = f.doc.layers[1].clone();
      const buffer = new RenderBuffer();
      const length = PSDParser.serialize(f.doc, buffer, [false, false, false, false]);
      const reopened = new Document("reopened.psd");
      PSDParser.parse(buffer.data.slice(0, length).buffer, reopened);
      assert.equal(reopened.layers.length, 2);
      assert.deepEqual(reopened.layers[0].buffer, pixels);
      assert.ok(reopened.layers[0].getMask().rect.equals(mask.rect));
      assert.deepEqual(reopened.layers[0].getMask().channel, mask.channel);
      assert.equal(reopened.layers[0].getMask().color, 0);
      assert.deepEqual(reopened.layers[1].buffer, result.buffer);
      assert.ok(reopened.layers[1].rect.equals(result.rect));
      if (vectorEnabled != null) assert.equal(reopened.layers[0].add.vmsk.isEnabled, vectorEnabled);
      assert.equal(reopened.selectionMask, null);
    }
  });
  it("inserts inside an open group and preserves duplicate names and IDs on imported sources", () => {
    const f = fixture(); const end = f.doc.createGroupEndLayer(); const group = f.doc.newLayer();
    group.add.lsct = LayerSectionType.OpenGroup; group.setName("Group");
    f.layer.add.lyid = group.add.lyid; delete end.add.lyid;
    f.doc.setLayers([end, f.layer, group]); f.doc.selectedLayerIndices = [2];
    const info = getResultDocumentInfo(f.doc); assert.equal(new Set(info.layers.map((l) => l.layerId)).size, 3);
    const prepared = prepareExactResult(f.controller, target(f, "insertRaster", 2), payload());
    commitExactResult(f.controller, prepared);
    assert.equal(f.doc.layers[3], group); assert.equal(f.doc.root.getSectionByIndex(2).parent.layer, group);
    assert.notEqual(f.doc.layers[2].add.lyid, group.add.lyid);
    f.history.stepHistoryBackward(f.doc); f.history.stepHistoryForward(f.doc);
    assert.equal(f.doc.root.getSectionByIndex(2).parent.layer, group);
  });
  for (const change of [
    (p) => { p.byteLength--; }, (p) => { p.bytes = p.bytes.slice(1); },
    (p) => { p.rect.width = 16385; }, (p) => { p.rect.width = p.rect.height = 6000; },
    (p) => { p.rect.x = NaN; }, (p) => { p.rect.y = 0.5; },
    (p) => { p.rect.width = -1; }, (p) => { p.rect.x = Number.MAX_SAFE_INTEGER; },
    (p) => { p.pixelFormat = "rgba16"; }, (p) => { p.bytes = []; },
  ]) it("rejects malformed/oversized raster before mutation: " + change.toString(), () => {
    const f = fixture(); const before = stable(f); const p = payload(); change(p);
    assert.throws(() => apply(f, "insertRaster", p)); unchanged(f, before);
  });
  it("identifies actual same-name documents and rejects wrong, closed and reopened sessions", () => {
    const f = fixture(), g = fixture(); f.controller.openDocs.push(g.doc);
    assert.notEqual(getResultDocumentInfo(f.doc).documentId, getResultDocumentInfo(g.doc).documentId);
    assert.throws(() => captureResultTarget(f.controller, { documentId: "bad", operation: "insertRaster" }));
    const t = target(f, "insertRaster"); closeResultDocumentSession(f.doc);
    assert.throws(() => prepareExactResult(f.controller, t, payload()), /closed/);
    assert.notEqual(getResultDocumentInfo(f.doc).documentId, t.documentId);
  });
  it("applies to captured document across tab changes", () => {
    const f = fixture(), g = fixture(); f.controller.openDocs.push(g.doc);
    const prepared = prepareExactResult(f.controller, target(f, "insertRaster"), payload());
    f.controller.getCurrentDoc = () => g.doc; commitExactResult(f.controller, prepared);
    assert.equal(f.doc.layers.length, 2); assert.equal(g.doc.layers.length, 1);
    assert.throws(() => commitExactResult(f.controller, prepared), /consumed/);
  });
  for (const mutation of ["delete", "reorder", "replace", "geometry", "history", "gesture", "dialog"]) it("rejects stale " + mutation + " targets", () => {
    const f = fixture(); const other = f.doc.newLayer(); other.setName("other"); f.doc.setLayers([f.layer, other]);
    const prepared = prepareExactResult(f.controller, target(f, "insertRaster"), payload());
    if (mutation === "delete") f.doc.setLayers([other]);
    if (mutation === "reorder") f.doc.setLayers([other, f.layer]);
    if (mutation === "replace") f.doc.setLayers([f.layer.clone(), other]);
    if (mutation === "geometry") f.doc.width++;
    if (mutation === "history") f.doc.pushHistory({ routingChannel: { id: 0 } });
    if (mutation === "gesture") f.controller.pointerState = { isDown: true };
    if (mutation === "dialog") f.controller.documentView = { getTopDialog: () => ({}) };
    const before = stable(f); assert.throws(() => commitExactResult(f.controller, prepared)); unchanged(f, before);
  });
  it("sets a 3 by 5 padded soft selection, preserving origin and copied undo/redo", () => {
    const f = fixture(); const p = payload("coverage8", new Uint8Array(15).fill(128));
    select(f, p); assert.equal(f.doc.selectionMask.channel.length, 16);
    assert.deepEqual(f.doc.selectionMask.channel.slice(0, 15), p.bytes); assert.ok(f.doc.selectionMask.rect.equals(p.rect));
    f.doc.selectionMask.channel.fill(1); p.bytes.fill(3);
    f.history.stepHistoryBackward(f.doc); assert.equal(f.doc.selectionMask, null);
    f.history.stepHistoryForward(f.doc); assert.deepEqual(f.doc.selectionMask.channel.slice(0, 15), new Uint8Array(15).fill(128));
  });
  it("distinguishes zero coverage from select all and undoes both", () => {
    const f = fixture(); const rect = new Rect(0, 0, f.doc.width, f.doc.height);
    const bytes = new Uint8Array(rect.area()).fill(255);
    select(f, { pixelFormat: "coverage8", rect, bytes, byteLength: bytes.length });
    assert.ok(f.doc.selectionMask.rect.equals(rect));
    select(f, payload("coverage8", new Uint8Array(15))); assert.equal(f.doc.selectionMask, null);
    f.history.stepHistoryBackward(f.doc); assert.ok(f.doc.selectionMask.rect.equals(rect));
    f.history.stepHistoryBackward(f.doc); assert.equal(f.doc.selectionMask, null);
  });
  it("Remove Background preserves source pixels and soft coverage, with one independent undo/redo", () => {
    const f = fixture(); select(f, payload("coverage8", new Uint8Array(15).fill(128)));
    const bytes = f.layer.buffer.slice(); const count = f.doc.history.length;
    removeBackgroundFromSelection(f.controller); assert.equal(f.doc.history.length, count + 1);
    assert.deepEqual(f.layer.buffer, bytes); assert.equal(f.layer.getMask().color, 0);
    const expected = f.layer.getMask().clone(); assert.equal(expected.channel[0], 128);
    f.history.stepHistoryBackward(f.doc); assert.equal(f.layer.getMask(), null);
    f.doc.selectionMask.channel.fill(0);
    f.history.stepHistoryForward(f.doc); assert.deepEqual(f.layer.getMask().channel, expected.channel);
    f.layer.getMask().channel.fill(2); f.history.stepHistoryBackward(f.doc); f.history.stepHistoryForward(f.doc);
    assert.deepEqual(f.layer.getMask().channel, expected.channel); assert.deepEqual(f.layer.buffer, bytes);
  });
  it("combines existing feather/density/outside coverage and restores original mask properties on undo", () => {
    const f = fixture(); const mask = new Mask(); mask.rect = new Rect(-3, 7, 3, 5);
    mask.channel = new Uint8Array(16).fill(64); mask.feather = 1; mask.density = 180; mask.color = 255; mask.enabled = false;
    f.layer.d = mask;
    select(f, payload("coverage8", new Uint8Array(15).fill(128)));
    const incoming = new Mask(); incoming.color = 0; incoming.rect = f.doc.selectionMask.rect.clone(); incoming.channel = f.doc.selectionMask.channel.slice();
    const expected = mask.combineWith(incoming);
    removeBackgroundFromSelection(f.controller);
    assert.deepEqual(f.layer.getMask().channel, expected.channel); assert.equal(f.layer.getMask().color, 0); assert.equal(f.layer.getMask().enabled, false);
    mask.channel.fill(0);
    f.history.stepHistoryBackward(f.doc); assert.equal(f.layer.getMask().feather, 1); assert.equal(f.layer.getMask().density, 180); assert.equal(f.layer.getMask().channel[0], 64);
  });
  it("coexists with enabled and disabled vector masks", async () => {
    for (const enabled of [true, false]) {
      const f = fixture(); f.layer.add.vmsk = new VectorMask(); f.layer.add.vmsk.isEnabled = enabled;
      const { rectanglePathRecords } = await import("../../../src/engine/compositing/shape-primitives.js");
      f.layer.add.vmsk.pathRecords = rectanglePathRecords(-3, 7, 2, 4, 0);
      const vector = f.layer.add.vmsk;
      select(f, payload("coverage8", new Uint8Array(15).fill(255)));
      removeBackgroundFromSelection(f.controller);
      assert.equal(f.layer.add.vmsk, vector); assert.ok(f.layer.getMask()); assert.ok(f.layer.d);
      if (!enabled) {
        assert.equal(f.layer.warpData, null);
        assert.equal(f.layer.getMask(), f.layer.d);
      }
      f.history.stepHistoryBackward(f.doc); assert.equal(f.layer.getMask(), null);
      f.history.stepHistoryForward(f.doc); assert.equal(f.layer.add.vmsk, vector); assert.ok(f.layer.getMask());
    }
  });
  for (const bad of ["none", "locked", "hidden", "text", "smart", "group", "disabledMask"]) it("rejects unsupported Remove Background state " + bad, () => {
    const f = fixture(); if (bad !== "none") select(f);
    if (bad === "locked") f.layer.add.lspf = 1;
    if (bad === "hidden") f.layer.setVisible(false);
    if (bad === "text") f.layer.add.TySh = {};
    if (bad === "smart") f.layer.add.placedData = {};
    if (bad === "group") f.layer.add.lsct = LayerSectionType.OpenGroup;
    if (bad === "disabledMask") { f.layer.d = new Mask(); f.layer.d.isEnabled = false; }
    const before = stable(f); assert.throws(() => removeBackgroundFromSelection(f.controller)); unchanged(f, before);
  });
  it("rejects changed source pixels beyond the first pixel and direct mask edits", () => {
    const f = fixture(); let t = target(f, "applyRasterMask"); f.layer.buffer[20]++;
    assert.throws(() => prepareExactResult(f.controller, t, payload("coverage8")), /changed/);
    apply(f, "applyRasterMask", payload("coverage8")); t = target(f, "applyRasterMask"); f.layer.getMask().color = 255;
    assert.throws(() => prepareExactResult(f.controller, t, payload("coverage8")), /changed/);
  });
  it("refuses create over an existing mask without mutation", () => {
    const f = fixture(); apply(f, "applyRasterMask", payload("coverage8")); const before = stable(f);
    assert.throws(() => apply(f, "applyRasterMask", { ...payload("coverage8"), mode: "create" }), /already exists/); unchanged(f, before);
  });
  for (const kind of ["insertRaster", "setSelection", "applyRasterMask"]) it("rolls back " + kind + " when history commit throws after mutation", () => {
    const f = fixture(); const before = stable(f); const push = f.doc.pushHistory;
    f.doc.pushHistory = function(entry) { push.call(this, entry); throw new Error("injected history failure"); };
    assert.throws(() => apply(f, kind, payload(kind === "insertRaster" ? "rgba8" : "coverage8")), /injected/);
    unchanged(f, before);
  });
});
