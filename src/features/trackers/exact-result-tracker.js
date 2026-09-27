/** Three bounded M0 commits. Prepared results and history bytes never alias live state. */
import { BinaryUtils } from "../../core/binary/binary-utils.js";
import { HistoryEntry } from "../../document/model/document.js";
import { Layer, LayerSectionType } from "../../document/model/layer.js";
import { SelectTool, prepareSelectionHistoryEntry } from "../../document/tools/selection-tools.js";
import { boundsOfPathRecords } from "../../engine/compositing/selection-utils.js";
import { EventChannel } from "../../document/model/tool-base.js";
import { cloneResultMask, copyCoverage, maskFromPayload, requireResult, RESULT_LIMITS, validateResultPayload, validateResultRect, validateMaskAllocation } from "../results/result-contract.js";
import { captureResultTarget, getResultDocumentInfo, validateResultTarget } from "../results/result-targets.js";

const preparedResults = new WeakMap();
const historyStates = new WeakMap();

function prepareMaskSurface(doc, layer, mask) {
  // Use the existing raster/vector layout on a detached layer, including the
  // derived combined mask in d and the editable raster mask in warpData.
  const surface = new Layer();
  const cache = surface.renderCache;
  Object.assign(surface, layer);
  surface.renderCache = cache;
  surface.add = { ...layer.add };
  if (layer.add.vmsk) {
    const vector = layer.add.vmsk;
    requireResult(Number.isFinite(vector.feather) && vector.feather >= 0 && vector.feather <= RESULT_LIMITS.maxFeather, "Unsupported vector mask feather");
    requireResult(Number.isInteger(vector.density) && vector.density >= 0 && vector.density <= 255, "Unsupported vector mask density");
    const bounds = boundsOfPathRecords(vector.pathRecords);
    bounds.inflate(Math.ceil(vector.feather * 2.2) + 1, Math.ceil(vector.feather * 2.2) + 1);
    bounds.x = Math.floor(bounds.x); bounds.y = Math.floor(bounds.y);
    bounds.width = Math.ceil(bounds.width); bounds.height = Math.ceil(bounds.height);
    validateResultRect(bounds, 1, true);
    if (mask) validateResultRect(bounds.union(mask.getSelectionRect()), 1, true);
    surface.add.vmsk = vector.clone();
  }
  surface.warpData = surface.add.vmsk?.isEnabled && mask ? cloneResultMask(mask) : null;
  surface.d = cloneResultMask(mask);
  // getMask() finds warpData even when d has not been rasterized yet.
  surface.invalidate(doc);
  return { d: surface.d, warpData: surface.warpData, renderCache: surface.renderCache };
}

function combineMasks(existing, incoming, mode) {
  requireResult(mode === "create" || mode === "intersect", "Unsupported mask mode");
  if (!existing) return incoming;
  requireResult(mode === "intersect", "A raster mask already exists; use intersect");
  requireResult(existing.isEnabled && incoming.isEnabled, "Enable both masks before combining");
  validateMaskAllocation(existing);
  validateMaskAllocation(incoming);
  // combineWith may allocate the union when both outside values are nonzero.
  validateResultRect(existing.getSelectionRect().union(incoming.getSelectionRect()), 1, true);
  const result = existing.combineWith(incoming);
  result.enabled = existing.enabled;
  return result;
}

function nextLayerId(doc) {
  let id = doc.resources.r1044 ? BinaryUtils.readUint32BE(doc.resources.r1044, 0) : 0;
  for (const layer of doc.layers) {
    if (Number.isInteger(layer.add.lyid) && layer.add.lyid > 0) id = Math.max(id, layer.add.lyid);
  }
  requireResult(id < 0xffffffff, "Layer ID space exhausted");
  return id + 1;
}

export function prepareExactResult(controller, target, payload, historyLabel) {
  const { doc, layer } = validateResultTarget(controller, target);
  const kind = target.operation;
  let state;
  if (kind === "insertRaster") {
    const { rect, view } = validateResultPayload(payload, "rgba8");
    const name = payload.name ?? "Result";
    requireResult(typeof name === "string" && name.length > 0 && name.length <= RESULT_LIMITS.maxNameLength, "Invalid layer name");
    requireResult(layer.add.lsct !== LayerSectionType.BoundingDivider, "Cannot insert at a group divider");
    // newLayer(true) avoids advancing a document resource during preparation.
    const result = doc.newLayer(true);
    result.add.lyid = nextLayerId(doc);
    result.rect = rect;
    result.buffer = view.slice();
    result.setName(name);
    const anchor = doc.layers.indexOf(layer);
    const insertIndex = anchor + (layer.add.lsct === LayerSectionType.OpenGroup ? 0 : 1);
    state = { kind, target, doc, layer, result, insertIndex, selectedBefore: doc.selectedLayerIndices.slice(), pathsBefore: doc.selectedLayerPaths == null ? null : JSON.parse(JSON.stringify(doc.selectedLayerPaths)), liveResult: null };
  } else if (kind === "setSelection") {
    const { rect, view } = validateResultPayload(payload, "coverage8");
    const entry = prepareSelectionHistoryEntry(copyCoverage(doc.selectionMask), {
      selection: copyCoverage({ rect, channel: view }), label: "select.setSelection",
    }, exactResultTracker);
    state = { kind, target, doc, selection: entry.data, historyLabel: entry.name };
  } else {
    const incoming = maskFromPayload(payload);
    const before = cloneResultMask(layer.getMask());
    const after = combineMasks(before, incoming, payload.mode ?? "intersect");
    state = { kind, target, doc, layer, before, after, pixelContent: layer.pixelContent };
    state.surface = prepareMaskSurface(doc, layer, after);
  }
  if (historyLabel) state.historyLabel = historyLabel;
  const prepared = Object.freeze({});
  preparedResults.set(prepared, state);
  return prepared;
}

// Only the state touched by these commits is rolled back. No scripting or
// arbitrary callback transaction API is exposed.
function boundedCommit(doc, layer, mutate, postcondition) {
  const keys = ["layers", "root", "resources", "selectedLayerIndices", "selectedLayerPaths", "selectionMask", "historyIndex", "savedHistoryIndex", "layerCompsModified", "panelsDirty", "dirty", "stateChanged", "needsComposite", "dirtyRect", "lastGLDirtyRect", "needsScrollToSelected"];
  const before = Object.fromEntries(keys.map((key) => [key, doc[key]]));
  before.history = doc.history.slice();
  const comp = doc.layerComps.lastAppliedComp;
  const layerBefore = layer && { d: layer.d, warpData: layer.warpData, renderCache: layer.renderCache, pixelContent: layer.pixelContent };
  try {
    mutate();
    requireResult(postcondition(), "Result transaction postcondition failed");
  } catch (error) {
    Object.assign(doc, before);
    if (comp === undefined) delete doc.layerComps.lastAppliedComp;
    else doc.layerComps.lastAppliedComp = comp;
    if (layer) Object.assign(layer, layerBefore);
    throw error;
  }
}

function sameCoverage(left, right) {
  return left === right || !!left && !!right && left.rect.equals(right.rect)
    && left.channel.length === right.channel.length
    && left.channel.every((value, index) => value === right.channel[index]);
}
function sameMask(left, right) {
  return sameCoverage(left, right) && (!left || ["color", "density", "feather", "enabled", "isEnabled"].every((key) => left[key] === right[key]));
}
function retireCache(cache) {
  // Resource cleanup happens only after a successful mutation/history commit.
  try { cache.dispose(); } catch (error) { console.error("Result committed; render cache cleanup failed", error); }
}

class ExactResultTracker {
  constructor() { this.id = EventChannel.EVENT_DOCUMENT; }
  undo(data, doc) { this.apply(data, doc, false); }
  redo(data, doc) { this.apply(data, doc, true); }
  apply(data, doc, forward, disposePrevious = true) {
    const state = historyStates.get(data);
    requireResult(state && state.doc === doc, "Wrong result history document");
    let nextLayers, result, surface;
    if (state.kind === "insertRaster") {
      nextLayers = doc.layers.slice();
      if (forward) {
        requireResult(!state.liveResult || !nextLayers.includes(state.liveResult), "Result layer is already present");
        const restored = state.result.clone();
        // Later history entries may target this layer object. Keep its identity
        // through undo/redo, but restore pixels from the private snapshot.
        result = state.liveResult ?? restored;
        if (state.liveResult) Object.assign(result, restored);
        nextLayers.splice(state.insertIndex, 0, result);
      } else {
        const index = nextLayers.indexOf(state.liveResult);
        requireResult(index >= 0, "Result layer no longer exists");
        nextLayers.splice(index, 1);
      }
    } else if (state.kind === "applyRasterMask") {
      requireResult(doc.layers.includes(state.layer), "Mask target no longer exists");
      surface = forward && state.surface ? state.surface : prepareMaskSurface(doc, state.layer, forward ? state.after : state.before);
    }
    const previousCache = state.layer?.renderCache;
    boundedCommit(doc, state.layer, () => {
      if (state.kind === "insertRaster") {
        doc.selectedLayerIndices = forward ? [state.insertIndex] : state.selectedBefore.slice();
        doc.selectedLayerPaths = forward || state.pathsBefore == null ? null : JSON.parse(JSON.stringify(state.pathsBefore));
        if (forward) {
          const counter = new Uint8Array(4);
          const previous = doc.resources.r1044 ? BinaryUtils.readUint32BE(doc.resources.r1044, 0) : 0;
          BinaryUtils.writeUint32BE(counter, 0, Math.max(previous, result.add.lyid));
          doc.resources = { ...doc.resources, r1044: counter };
        }
        doc.setLayers(nextLayers);
        doc.markDirty();
      } else if (state.kind === "setSelection") {
        const selection = { ...state.selection,
          selectionMaskBefore: copyCoverage(state.selection.selectionMaskBefore),
          selectionMaskAfter: copyCoverage(state.selection.selectionMaskAfter),
        };
        SelectTool.prototype[forward ? "redo" : "undo"].call(this, selection, doc);
      } else {
        Object.assign(state.layer, surface);
        state.layer.pixelContent = forward ? 1 : state.pixelContent;
        doc.markDirty();
      }
      doc.panelsDirty = doc.stateChanged = true;
    }, () => {
      if (state.kind === "insertRaster") return doc.layers.length === nextLayers.length
        && doc.layers.every((item, index) => item === nextLayers[index])
        && (!forward || result.rect.equals(state.result.rect)
          && result.buffer.length === state.result.buffer.length
          && result.buffer.every((value, index) => value === state.result.buffer[index]));
      if (state.kind === "setSelection") return sameCoverage(doc.selectionMask,
        forward ? state.selection.selectionMaskAfter : state.selection.selectionMaskBefore);
      return sameMask(state.layer.getMask(), forward ? state.after : state.before);
    });
    if (state.kind === "applyRasterMask" && disposePrevious) retireCache(previousCache);
    if (state.kind === "insertRaster" && forward) state.liveResult = result;
    if (state.kind === "applyRasterMask") state.surface = null;
  }
}
export const exactResultTracker = new ExactResultTracker();

export function commitExactResult(controller, prepared) {
  const state = preparedResults.get(prepared);
  requireResult(state, "Result has already been consumed");
  preparedResults.delete(prepared);
  validateResultTarget(controller, state.target);
  const { doc } = state;
  const entry = new HistoryEntry(state.historyLabel ?? (state.kind === "insertRaster" ? "layer.newLayer" : "layer.addRasterMask"), exactResultTracker);
  // History exposes no retained pixels or masks for later actions to mutate.
  entry.data = Object.freeze({});
  historyStates.set(entry.data, state);
  const previousCache = state.layer?.renderCache;
  boundedCommit(doc, state.layer, () => {
    exactResultTracker.apply(entry.data, doc, true, false);
    doc.pushHistory(entry);
  }, () => doc.history[doc.historyIndex] === entry);
  if (state.kind === "applyRasterMask") retireCache(previousCache);
  const documentId = state.target.documentId;
  state.target = null; // Release freshness snapshots; history retains only replay data.
  return { documentId, operation: state.kind };
}

export function removeBackgroundFromSelection(controller) {
  const doc = controller.getCurrentDoc();
  requireResult(doc && doc.selectionMask, "Make a foreground selection before Remove Background");
  requireResult(doc.selectedLayerIndices.length === 1, "Select one raster layer");
  const info = getResultDocumentInfo(doc);
  const target = captureResultTarget(controller, {
    documentId: info.documentId, layerId: info.layers[doc.selectedLayerIndices[0]].layerId,
    operation: "applyRasterMask",
  });
  const selection = doc.selectionMask;
  const bytes = selection.channel.subarray(0, selection.rect.area());
  const prepared = prepareExactResult(controller, target, {
    pixelFormat: "coverage8", rect: selection.rect, byteLength: bytes.length, bytes,
    outsideCoverage: 0, mode: "intersect",
  }, "layer.removeBackground");
  return commitExactResult(controller, prepared);
}
