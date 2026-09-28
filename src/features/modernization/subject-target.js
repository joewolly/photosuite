/** Editor-owned authority for M3. Only explicit Accept enters unchanged M0. */
import { captureResultTarget, getResultDocumentInfo, validateResultTarget, requireIdleResultEditor, requireRasterMaskTarget } from "../results/result-targets.js";
import { prepareExactResult, commitExactResult } from "../trackers/exact-result-tracker.js";
import { Rect } from "../../core/math/rect.js";
import { JobError } from "./job-service.js";
import { validateSubjectInput } from "./subject-workload.js";
export function subjectInput(doc, layer) {
  return { rect: { x: layer.rect.x, y: layer.rect.y, width: layer.rect.width, height: layer.rect.height }, rgba: layer.buffer, documentWidth: doc.width, documentHeight: doc.height, color: "srgb8", alpha: "straight" };
}
export function requireSubjectSource(doc, remove = false) {
  const layer = doc?.layers[doc.selectedLayerIndices[0]];
  if (!doc || doc.activeChannels.length || doc.selectedLayerIndices.length !== 1 || !layer || !layer.hasPixelData() || layer.isGroup() || layer.add.TySh || layer.add.placedData || layer.hasFillContent() || layer.pixelContent > 0) throw new JobError("unsupported-image", "Select the pixels of one ordinary raster layer in RGB mode.");
  validateSubjectInput(subjectInput(doc, layer));
  if (remove) requireRasterMaskTarget(layer);
  return layer;
}
function metadata(layer) { return JSON.stringify([layer.rect, layer.layerFlags, layer.pixelContent, layer.add.lspf, layer.add.TySh, layer.add.placedData]); }
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
    const av = new Uint32Array(a.buffer, a.byteOffset, a.length / 4), bv = new Uint32Array(b.buffer, b.byteOffset, b.length / 4);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
  } else for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
export function createSubjectAdapter(controller, doc, layer, remove, onMetrics = () => {}) {
  return {
    capture() {
      if (requireSubjectSource(doc, remove) !== layer) throw new JobError("stale-result", "The source layer changed.");
      const info = getResultDocumentInfo(doc), operation = remove ? "applyRasterMask" : "setSelection";
      const target = captureResultTarget(controller, { documentId: info.documentId, layerId: info.layers[doc.layers.indexOf(layer)].layerId, operation });
      return { doc, layer, target, documentId: info.documentId, pixels: layer.buffer.slice(), metadata: metadata(layer), overlay: null };
    },
    validate(context, accept) {
      if (!controller.openDocs.includes(doc)) throw new JobError("document-closed", "The source document was closed.");
      try {
        validateResultTarget({ openDocs: controller.openDocs }, context.target);
        if (requireSubjectSource(doc, remove) !== layer || metadata(layer) !== context.metadata || !sameBytes(context.pixels, layer.buffer)) throw new Error("Source changed");
        if (accept) requireIdleResultEditor(controller);
      } catch { throw new JobError("stale-result", "The source, selection or target changed. Rerun Select Subject."); }
    },
    preview(context, result, jobId) {
      const start = performance.now(), r = result.rect;
      if (!layer.rect.equals(new Rect(r.x, r.y, r.width, r.height))) throw new JobError("malformed-result", "Subject selection returned the wrong source bounds.");
      // Enforce source alpha and canvas containment again at the editor boundary.
      for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
        const i = y * r.width + x;
        result.bytes[i] = x + r.x < 0 || y + r.y < 0 || x + r.x >= doc.width || y + r.y >= doc.height ? 0 : Math.min(result.bytes[i], context.pixels[i * 4 + 3]);
      }
      context.overlay = { jobId, rect: new Rect(r.x, r.y, r.width, r.height), channel: result.bytes };
      doc.toolOverlayState.jobSelectionPreview = context.overlay; doc.dirty = true;
      onMetrics({ ...result.timings, previewMs: performance.now() - start });
    },
    commit(context, result) {
      const start = performance.now();
      const receipt = commitExactResult(controller, prepareExactResult(controller, context.target, result, remove ? "layer.removeBackground" : "Select Subject"));
      if (receipt.documentId !== context.documentId || receipt.operation !== (remove ? "applyRasterMask" : "setSelection")) throw new Error("Unexpected subject commit receipt");
      onMetrics({ acceptMs: performance.now() - start });
    },
    dispose(context) {
      if (context?.overlay && doc.toolOverlayState.jobSelectionPreview === context.overlay) { doc.toolOverlayState.jobSelectionPreview = null; doc.dirty = true; }
    },
  };
}
