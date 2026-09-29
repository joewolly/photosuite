/** Strict M8 document gate and source freshness, independent of transient viewport state. */
import { getResultDocumentInfo, requireIdleResultEditor } from "../results/result-targets.js";
import { validateMaskAllocation } from "../results/result-contract.js";
import { adjustmentKeyOf } from "../../document/formats/psd/adjustment-parsers.js";
import { JobError } from "./job-service.js";
import { EXPAND_LIMITS, requireExpand, expansionGeometry } from "./expand-workload.js";

export function requireExpandDocument(doc) {
  const reject = detail => requireExpand(false, `Generative Expand v1: ${detail}`);
  if (!doc || !doc.layers.length || doc.layers.length > EXPAND_LIMITS.layers) reject("use a document with 1–64 raster/group entries.");
  if ((doc.bitDepth != null && doc.bitDepth !== 8) || (doc.colorMode != null && doc.colorMode !== 3)) reject("only RGB8 documents are supported.");
  if (doc.selectionMask || doc.activeChannels.length) reject("deselect and select RGB channels first.");
  if (doc.extraChannels.length || doc.slices.length || doc.paths.length > 1 || doc.paths[0]?.add.vmsk.pathRecords.length > 2) reject("document paths, extra channels and slices are not supported.");
  if (doc.layerComps.list.v.length || doc.add.FEid?.length || doc.indexedColorTable) reject("layer comps, linked assets and indexed color are not supported.");
  if (doc.guides.some(axis => axis.length > 1024 || axis.some(v => !Number.isFinite(v) || Math.abs(v) > 1000000))) reject("unsupported guide geometry.");
  let bytes = 0;
  for (const layer of doc.layers) {
    const a = layer.add;
    if (a.artb || a.TySh || a.placedData || a.vmsk || a.lfx2 || a.lfXS || a.lmfx || layer.hasFillContent() || adjustmentKeyOf(a) != null || layer.hasSmartFilters()) reject("artboards, text, Smart Objects, vectors, effects and adjustment/fill layers are not supported.");
    if (layer.isClippingMask || !["norm", "pass"].includes(layer.blendMode) || (!layer.isGroup() && layer.blendMode !== "norm") || a.knko || a.brst || a.lnsr === "bgnd") reject("use ordinary Normal raster layers or Normal/Pass Through groups, without clipping, knockout or background layers.");
    const r = layer.rect;
    if (![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || Math.abs(r.x) > 8192 || Math.abs(r.y) > 8192 || r.width < 0 || r.height < 0 || r.width > 4096 || r.height > 4096) reject("layer bounds exceed the supported geometry.");
    // PSD normalizes empty group markers to zero bytes; newly created markers use four.
    const emptyGroup = (layer.isGroup() || a.lsct === 3) && r.width === 0 && r.height === 0 && layer.buffer?.length === 0;
    if (!(layer.buffer instanceof Uint8Array || layer.buffer instanceof Uint8ClampedArray) || (!emptyGroup && layer.buffer.length !== Math.max(4, r.width * r.height * 4))) reject("unsupported raster buffer.");
    if (!layer.isGroup() && a.lsct !== 3 && !layer.hasPixelData()) reject("only ordinary raster layers and groups are supported.");
    bytes += layer.buffer.byteLength;
    const mask = layer.getMask();
    if (mask) {
      validateMaskAllocation(mask);
      if (mask.feather !== 0 || mask.rect.width > 4096 || mask.rect.height > 4096) reject("raster masks must have zero feather and bounded dimensions.");
      bytes += mask.channel.byteLength;
    }
    if (bytes > EXPAND_LIMITS.sourceBytes) reject("raster and mask buffers exceed 16 MiB.");
  }
  return bytes;
}
export function sameExpandBytes(a, b) { return a?.length === b?.length && a.every((v, i) => v === b[i]); }
function metadata(doc) {
  const value = JSON.stringify([doc.width, doc.height, doc.guides, doc.resources, doc.add, doc.paths, doc.layerComps, doc.selectedLayerIndices, doc.selectedLayerPaths,
    doc.layers.map(l => [l.rect, l.add, l.name, l.layerFlags, l.Opct, l.blendMode, l.blendIfData, l.pixelContent, l.isClippingMask, l.getMask() && { ...l.getMask(), channel: undefined }])]);
  requireExpand(value.length <= 1048576, "Document geometry metadata exceeds the 1,048,576-character M8 limit.");
  return value;
}
export function captureExpandSource(controller, doc, g) {
  requireIdleResultEditor(controller); requireExpandDocument(doc);
  requireExpand(controller.openDocs.includes(doc), "The source document was closed.");
  expansionGeometry(doc.width, doc.height, g);
  doc.markDirty(); const pixels = doc.getRasterData().slice();
  return { documentId: getResultDocumentInfo(doc).documentId, doc, geometry: g, pixels, metadata: metadata(doc), layers: doc.layers.slice(),
    buffers: doc.layers.map(l => l.buffer.slice()), masks: doc.layers.map(l => l.getMask()?.channel.slice()), history: doc.history.slice(), historyIndex: doc.historyIndex };
}
export function validateExpandSource(controller, context, accept = false) {
  const { doc, geometry: g } = context;
  if (!controller.openDocs.includes(doc) || getResultDocumentInfo(doc).documentId !== context.documentId) throw new JobError("document-closed", "The source document was closed.");
  if (accept) requireIdleResultEditor(controller);
  const stale = () => { throw new JobError("stale-result", "The source pixels, geometry or history changed. Rerun Generative Expand."); };
  try { requireExpandDocument(doc); } catch { stale(); }
  if (doc.width !== g.width || doc.height !== g.height || metadata(doc) !== context.metadata || doc.historyIndex !== context.historyIndex || doc.history.length !== context.history.length || doc.history.some((h, i) => h !== context.history[i]) || doc.layers.some((l, i) => l !== context.layers[i] || !sameExpandBytes(l.buffer, context.buffers[i]) || (l.getMask() && !sameExpandBytes(l.getMask().channel, context.masks[i])))) stale();
  doc.markDirty(); if (!sameExpandBytes(doc.getRasterData(), context.pixels)) stale();
}
