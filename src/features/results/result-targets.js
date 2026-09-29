/** Runtime-only identities. PSD IDs, paths, names and tab indices are not authority. */
import { generateUuid } from "../../core/uid.js";
import { cloneResultMask, copyCoverage, requireResult, RESULT_OPERATIONS, validateResultRect } from "./result-contract.js";

const documents = new WeakMap();
const targets = new WeakMap();

function sessionFor(doc) {
  let session = documents.get(doc);
  if (!session) {
    session = { id: generateUuid(), layers: new WeakMap() };
    documents.set(doc, session);
  }
  return session;
}
function layerIdFor(session, layer) {
  if (!session.layers.has(layer)) session.layers.set(layer, generateUuid());
  return session.layers.get(layer);
}
export function closeResultDocumentSession(doc) {
  documents.delete(doc);
}
export function getResultDocumentInfo(doc) {
  requireResult(doc, "No open document");
  const session = sessionFor(doc);
  return {
    documentId: session.id, width: doc.width, height: doc.height,
    hasSelection: doc.selectionMask != null,
    layers: doc.layers.map((layer, index) => ({
      layerId: layerIdFor(session, layer), name: layer.getName(),
      selected: doc.selectedLayerIndices.includes(index),
      kind: layer.isGroup() ? "group" : layer.hasPixelData() && !layer.add.TySh && !layer.add.placedData ? "raster" : "other",
    })),
  };
}

export function requireIdleResultEditor(controller) {
  requireResult(!controller.pointerState?.isDown && !controller.documentView?.getTopDialog?.() && !controller.getActiveToolEntry?.()?.activeOp, "Finish the active gesture or dialog first");
}
function sameBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function sameCoverage(a, b) {
  return a === b || !!a && !!b && a.rect.equals(b.rect) && sameBytes(a.channel, b.channel);
}
function maskMetadata(mask) {
  if (!mask) return "null";
  return JSON.stringify([mask.color, mask.density, mask.feather, mask.enabled, mask.isEnabled, mask.parametersApplied]);
}
function vectorMetadata(layer) {
  const vector = layer.add.vmsk;
  return vector ? JSON.stringify(vector.clone()) : "null";
}
function layerMetadata(layer) {
  return JSON.stringify([layer.rect, layer.layerFlags, layer.add.lspf, layer.add.lsct, layer.add.lyid, layer.add.TySh != null, layer.add.placedData != null]);
}

export function captureResultTarget(controller, request) {
  requireIdleResultEditor(controller);
  requireResult(RESULT_OPERATIONS.includes(request.operation), "Unsupported result operation");
  const doc = controller.openDocs?.find((item) => sessionFor(item).id === request.documentId);
  requireResult(doc, "Wrong or closed document session");
  validateResultRect({ x: 0, y: 0, width: doc.width, height: doc.height }, 4);
  requireResult(!doc.layers.some((layer) => layer.add.artb), "Artboard documents are not supported by M0");
  requireResult(!doc.activeChannels.length, "Select the RGB channels first");
  const session = sessionFor(doc);
  const layer = request.operation === "setSelection" || request.layerId == null ? null : doc.layers.find((item) => layerIdFor(session, item) === request.layerId);
  requireResult(request.operation === "setSelection" || layer, "Invalid target layer");
  const record = {
    doc, session, layer, operation: request.operation,
    width: doc.width, height: doc.height,
    stack: doc.layers.slice(), history: doc.history.slice(), historyIndex: doc.historyIndex,
    selection: copyCoverage(doc.selectionMask),
    metadata: layer && layerMetadata(layer),
    stackMetadata: doc.layers.map((item) => JSON.stringify([item.add.lsct, item.add.lspf, item.layerFlags, !!item.add.artb])),
  };
  if (layer) {
    let section = doc.root.getSectionByIndex(doc.layers.indexOf(layer));
    if (request.operation === "insertRaster" && layer.add.lsct === 1) requireResult(!layer.add.lspf, "Unlock the insertion group first");
    while (section?.parent?.parent) {
      section = section.parent;
      requireResult(!section.layer.add.lspf && section.layer.isVisible(), "Unlock and show the parent group first");
    }
  }
  if (request.operation === "applyRasterMask") {
    requireRasterMaskTarget(layer);
    const { byteLength } = validateResultRect(layer.rect, 4, true);
    requireResult(layer.buffer instanceof Uint8Array && layer.buffer.length <= Math.max(4, byteLength) && layer.buffer.length >= byteLength, "Unsupported raster buffer");
    record.pixels = layer.buffer.slice();
    record.mask = cloneResultMask(layer.getMask());
    record.vector = vectorMetadata(layer);
  }
  const target = Object.freeze({ documentId: session.id, layerId: request.layerId, operation: request.operation });
  targets.set(target, record);
  return target;
}

export function requireRasterMaskTarget(layer) {
  requireResult(layer && !layer.isGroup() && layer.hasPixelData() && !layer.add.TySh && !layer.add.placedData && !layer.hasFillContent(), "Remove Background requires an ordinary raster layer");
  requireResult(layer.isVisible() && !layer.add.lspf && layer.add.lnsr !== "bgnd", "Unlock and show the raster layer first");
  requireResult(!layer.getMask() || layer.getMask().isEnabled, "Enable the existing raster mask first");
}

export function validateResultTarget(controller, target) {
  requireIdleResultEditor(controller);
  const state = targets.get(target);
  requireResult(state && controller.openDocs?.includes(state.doc) && documents.get(state.doc) === state.session, "Stale or closed document target");
  const { doc, layer } = state;
  requireResult(doc.width === state.width && doc.height === state.height && !doc.activeChannels.length, "Document geometry or channels changed");
  requireResult(doc.layers.length === state.stack.length && doc.layers.every((item, index) => item === state.stack[index]), "Target layer stack changed; prepare again");
  requireResult(doc.historyIndex === state.historyIndex && doc.history.length === state.history.length && doc.history.every((entry, index) => entry === state.history[index]), "Document history changed; prepare again");
  requireResult(doc.layers.every((item, index) => JSON.stringify([item.add.lsct, item.add.lspf, item.layerFlags, !!item.add.artb]) === state.stackMetadata[index]), "Layer hierarchy or locks changed");
  requireResult(!layer || layerMetadata(layer) === state.metadata, "Target layer changed");
  if (state.operation !== "insertRaster") requireResult(sameCoverage(doc.selectionMask, state.selection), "Selection changed; prepare again");
  if (state.operation === "applyRasterMask") {
    requireRasterMaskTarget(layer);
    requireResult(sameBytes(layer.buffer, state.pixels) && sameCoverage(layer.getMask(), state.mask) && maskMetadata(layer.getMask()) === maskMetadata(state.mask) && vectorMetadata(layer) === state.vector, "Target pixels or mask changed; prepare again");
  }
  return { doc, layer };
}
