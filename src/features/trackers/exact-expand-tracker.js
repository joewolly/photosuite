/** Narrow M0 extension: one staged canvas expansion + exterior raster + history item. */
import { Document, HistoryEntry } from "../../document/model/document.js";
import { EventChannel } from "../../document/model/tool-base.js";
import { Rect } from "../../core/math/rect.js";
import { BinaryUtils } from "../../core/binary/binary-utils.js";
import { resizeDocumentCanvas } from "../../document/model/layer-translate.js";
import { validateExpandSource, sameExpandBytes } from "../modernization/expand-source.js";
import { assertOriginalProjection, requireExpand } from "../modernization/expand-workload.js";

const historyStates = new WeakMap();
function layerCopy(layer) {
  const copy = layer.clone(); copy.pixelContent = layer.pixelContent;
  for (const mask of [copy.d, copy.warpData]) if (mask) mask.overlayTintRgb = { ...mask.overlayTintRgb };
  return copy;
}
function snapshot(doc) {
  return { width: doc.width, height: doc.height, layers: doc.layers.map(layerCopy), guides: doc.guides.map(a => a.slice()),
    selected: doc.selectedLayerIndices.slice(), paths: doc.selectedLayerPaths == null ? null : structuredClone(doc.selectedLayerPaths),
    resources: structuredClone(doc.resources), buffer: doc.getRasterData().slice() };
}
function detached(state) {
  const doc = new Document("Generative Expand staging");
  doc.width = state.width; doc.height = state.height;
  doc.guides = state.guides.map(a => a.slice()); doc.resources = structuredClone(state.resources);
  doc.setLayers(state.layers.map(layerCopy)); doc.selectedLayerIndices = state.selected.slice();
  doc.markDirty(); return doc;
}
function disposeStage(doc) {
  try { doc.glTexture?.delete(); } catch { /* Detached GPU resources have no document authority. */ }
  for (const l of doc.layers) try { l.renderCache.dispose(); } catch { /* Best effort GPU cleanup. */ }
}
function install(doc, state, identities) {
  // Allocate copies before touching live geometry. Keep layer identities for other history entries/M7.
  const copies = state.layers.map(layerCopy);
  doc.width = state.width; doc.height = state.height;
  for (let i = 0; i < copies.length; i++) Object.assign(identities[i], copies[i]);
  doc.layers = identities.slice(0, copies.length); // Avoid setLayers disposing rollback-owned caches.
  doc.guides = state.guides.map(a => a.slice());
  doc.resources = structuredClone(state.resources); doc.selectedLayerIndices = state.selected.slice();
  doc.selectedLayerPaths = state.paths == null ? null : structuredClone(state.paths);
  doc.buffer = state.buffer.slice(); doc.glTexture = null;
  doc.rebuildLayerTree(); doc.markDirty(); doc.panelsDirty = doc.stateChanged = true;
}
function atomicInstall(doc, state, identities, finalize) {
  const before = { ...doc }, layerBefore = identities.map(l => ({ ...l }));
  const oldHistory = doc.history.slice(), compBefore = { ...doc.layerComps };
  try {
    install(doc, state, identities);
    finalize?.();
    requireExpand(doc.width === state.width && doc.height === state.height && doc.layers.length === state.layers.length && doc.layers.every((l, i) => l === identities[i] && l.rect.equals(state.layers[i].rect) && sameExpandBytes(l.buffer, state.layers[i].buffer)), "Expansion transaction postcondition failed.");
  } catch (error) {
    for (let i = 0; i < identities.length; i++) Object.assign(identities[i], layerBefore[i]);
    Object.assign(doc, before); doc.history = oldHistory; Object.assign(doc.layerComps, compBefore);
    throw error;
  }
  // Old render caches must remain intact until all geometry/history postconditions pass.
  try { before.glTexture?.delete(); } catch { /* A successful edit must not fail on GPU cleanup. */ }
  for (const l of layerBefore) try { l.renderCache.dispose(); } catch { /* Best effort. */ }
}
export const exactExpandTracker = {
  id: EventChannel.EVENT_DOCUMENT,
  undo(data, doc) { replay(data, doc, false); },
  redo(data, doc) { replay(data, doc, true); },
};
function replay(data, doc, forward) {
  const s = historyStates.get(data);
  requireExpand(s?.doc === doc, "Wrong expansion history document.");
  atomicInstall(doc, forward ? s.after : s.before, s.identities);
}
export function commitExactExpansion(controller, context, payload) {
  validateExpandSource(controller, context, true);
  const { doc, geometry: g } = context, before = snapshot(doc), stage = detached(before);
  let after;
  try {
    resizeDocumentCanvas(stage, new Rect(-g.left, -g.top, g.newWidth, g.newHeight));
    for (let i = 0; i < stage.layers.length; i++) requireExpand(sameExpandBytes(stage.layers[i].buffer, before.layers[i].buffer), "Canvas translation changed source pixels.");
    const result = stage.newLayer(true);
    let id = doc.resources.r1044 ? BinaryUtils.readUint32BE(doc.resources.r1044, 0) : 0;
    for (const l of stage.layers) if (Number.isInteger(l.add.lyid)) id = Math.max(id, l.add.lyid);
    requireExpand(id < 0xffffffff, "Layer ID space exhausted.");
    result.add.lyid = id + 1; result.rect = new Rect(0, 0, g.newWidth, g.newHeight);
    requireExpand(payload.byteLength === g.byteLength && payload.bytes.length === g.byteLength, "Wrong expansion raster size.");
    result.buffer = payload.bytes.slice(); result.setName("Generative Expand");
    stage.setLayers([...stage.layers, result]); stage.selectedLayerIndices = [stage.layers.length - 1];
    const counter = new Uint8Array(4); BinaryUtils.writeUint32BE(counter, 0, id + 1); stage.resources.r1044 = counter;
    stage.markDirty(); assertOriginalProjection(context.pixels, stage.getRasterData(), g);
    after = snapshot(stage);
  } finally { disposeStage(stage); }
  validateExpandSource(controller, context, true);
  const entry = new HistoryEntry("Generative Expand", exactExpandTracker); entry.data = Object.freeze({});
  const identities = [...doc.layers, after.layers.at(-1).clone()];
  const state = { doc, before, after, identities };
  historyStates.set(entry.data, state);
  try {
    atomicInstall(doc, after, identities, () => {
      doc.pushHistory(entry);
      requireExpand(doc.history[doc.historyIndex] === entry, "Expansion history finalization failed.");
    });
  } catch (error) { historyStates.delete(entry.data); throw error; }
  return { operation: "expandCanvas", documentId: context.documentId };
}
