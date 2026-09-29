/** M1 source proof layered over the unmodified M0 commit boundary. */
import { captureResultTarget, getResultDocumentInfo, validateResultTarget, requireIdleResultEditor } from "../results/result-targets.js";
import { prepareExactResult, commitExactResult } from "../trackers/exact-result-tracker.js";
import { Rect } from "../../core/math/rect.js";
import { JobError } from "./job-service.js";
import { QUICK_SELECT_LIMITS } from "./quick-select-workload.js";

export function requireQuickSelectSource(doc) {
  const layer = doc?.layers[doc.selectedLayerIndices[0]];
  if (!doc || doc.activeChannels.length || doc.selectedLayerIndices.length !== 1 || !layer || !layer.hasPixelData() || layer.isGroup() || layer.add.TySh || layer.add.placedData || layer.hasFillContent() || layer.pixelContent > 0) throw new JobError("invalid-request", "Select one ordinary raster layer in RGB mode.");
  for (const dimension of [doc.width, doc.height, layer.rect.width, layer.rect.height]) if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > QUICK_SELECT_LIMITS.dimension) throw new JobError("resource-limit", "Quick Select dimensions must be between 1 and 8192 pixels.");
  for (const count of [doc.width * doc.height, layer.rect.area()]) if (!Number.isSafeInteger(count) || count <= 0 || count > QUICK_SELECT_LIMITS.pixels) throw new JobError("resource-limit", "Quick Select supports up to 4 megapixels per layer and canvas.");
  if (!(layer.buffer instanceof Uint8Array || layer.buffer instanceof Uint8ClampedArray) || layer.buffer.length !== layer.rect.area() * 4) throw new JobError("invalid-request", "This layer has unsupported pixel data.");
  return layer;
}
function metadata(layer) {
  return JSON.stringify([layer.rect, layer.layerFlags, layer.pixelContent, layer.add.lspf, layer.add.TySh, layer.add.placedData]);
}
function samePixels(left, right) {
  if (left.length !== right.length) return false;
  // Exact comparison, not a fingerprint. Word scans avoid a JS callback per byte.
  if (left.byteOffset % 4 === 0 && right.byteOffset % 4 === 0) {
    const length = Math.floor(left.byteLength / 4);
    const a = new Uint32Array(left.buffer, left.byteOffset, length);
    const b = new Uint32Array(right.buffer, right.byteOffset, length);
    for (let i = 0; i < length; i++) if (a[i] !== b[i]) return false;
    for (let i = length * 4; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}
export function createSelectionAdapter(controller, doc, sourceLayer, onDispose = () => {}) {
  return {
    capture() {
      const info = getResultDocumentInfo(doc);
      const target = captureResultTarget(controller, { documentId: info.documentId, operation: "setSelection" });
      return { doc, layer: sourceLayer, target, documentId: info.documentId,
        metadata: metadata(sourceLayer), pixels: sourceLayer.buffer.slice(), overlay: null };
    },
    validate(context, accept) {
      if (!controller.openDocs.includes(context.doc)) throw new JobError("document-closed", "The source document was closed.");
      try {
        // Gestures elsewhere do not invalidate byte-identical input. Accept still
        // requires the real controller to be idle, including dialogs/transforms.
        validateResultTarget({ openDocs: controller.openDocs }, context.target);
        if (!context.doc.layers.includes(context.layer) || metadata(context.layer) !== context.metadata
          || !samePixels(context.pixels, context.layer.buffer)) throw new Error("Source changed");
        if (accept) requireIdleResultEditor(controller);
      } catch { throw new JobError("stale-result", "The source or editor state changed. Rerun Quick Select."); }
    },
    preview(context, result, jobId) {
      const r = result.rect;
      if (!context.layer.rect.equals(new Rect(r.x, r.y, r.width, r.height))) throw new JobError("malformed-result", "The selection result has the wrong source bounds.");
      context.overlay = { jobId, rect: new Rect(r.x, r.y, r.width, r.height), channel: result.bytes };
      context.doc.toolOverlayState.jobSelectionPreview = context.overlay;
      context.doc.dirty = true;
    },
    commit(context, result) {
      const prepared = prepareExactResult(controller, context.target, result, "tools.quickSelection");
      const receipt = commitExactResult(controller, prepared);
      if (receipt.documentId !== context.documentId || receipt.operation !== "setSelection") throw new Error("Unexpected commit receipt");
    },
    dispose(context) {
      if (context?.doc.toolOverlayState.jobSelectionPreview === context?.overlay) {
        context.doc.toolOverlayState.jobSelectionPreview = null;
        context.doc.dirty = true;
      }
      onDispose();
    },
  };
}
