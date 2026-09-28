/** Editor-owned M4 source proof and existing M0 selection commit. */
import { captureResultTarget, getResultDocumentInfo, validateResultTarget, requireIdleResultEditor } from "../results/result-targets.js";
import { prepareExactResult, commitExactResult } from "../trackers/exact-result-tracker.js";
import { requireQuickSelectSource } from "./selection-target.js";
import { PROMPTED_MODEL, PROMPTED_SETTINGS } from "./prompted-workload.js";
import { JobError } from "./job-service.js";
import { Rect } from "../../core/math/rect.js";
export const requirePromptedSource = requireQuickSelectSource;
export function promptedInput(doc, layer, sessionId, points, box) {
  return { rect: { x: layer.rect.x, y: layer.rect.y, width: layer.rect.width, height: layer.rect.height }, rgba: layer.buffer, documentWidth: doc.width, documentHeight: doc.height,
    color: "srgb8", alpha: "straight", model: { ...PROMPTED_MODEL }, settings: { ...PROMPTED_SETTINGS }, sessionId, points, box };
}
const metadata = (layer) => JSON.stringify([layer.rect, layer.layerFlags, layer.pixelContent, layer.add.lspf, layer.add.TySh, layer.add.placedData]);
export function createPromptedAdapter(controller, doc, layer, sessionId, onMetrics = () => {}) {
  return {
    capture() {
      const info = getResultDocumentInfo(doc);
      return { documentId: info.documentId, target: captureResultTarget(controller, { documentId: info.documentId, operation: "setSelection" }), pixels: layer.buffer.slice(), metadata: metadata(layer), overlay: null };
    },
    validate(context, accept) {
      try {
        validateResultTarget({ openDocs: controller.openDocs }, context.target);
        if (requirePromptedSource(doc) !== layer || metadata(layer) !== context.metadata || context.pixels.length !== layer.buffer.length) throw new Error();
        const a = new DataView(context.pixels.buffer, context.pixels.byteOffset, context.pixels.byteLength), b = new DataView(layer.buffer.buffer, layer.buffer.byteOffset, layer.buffer.byteLength);
        for (let i = 0; i < a.byteLength; i += 4) if (a.getUint32(i) !== b.getUint32(i)) throw new Error();
        if (accept) requireIdleResultEditor(controller);
      } catch { throw new JobError("stale-result", "The source or selection changed. Start a new Object Selection session."); }
    },
    preview(context, result, jobId) {
      const start = performance.now(), r = result.rect;
      if (result.sessionId !== sessionId || !layer.rect.equals(new Rect(r.x, r.y, r.width, r.height))) throw new JobError("malformed-result", "Object Selection returned the wrong source.");
      for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) { const i = y * r.width + x; result.bytes[i] = x + r.x < 0 || y + r.y < 0 || x + r.x >= doc.width || y + r.y >= doc.height ? 0 : Math.min(result.bytes[i], context.pixels[i * 4 + 3]); }
      context.overlay = { jobId, rect: new Rect(r.x, r.y, r.width, r.height), channel: result.bytes };
      doc.toolOverlayState.jobSelectionPreview = context.overlay; doc.dirty = true;
      onMetrics({ ...result.timings, previewMs: performance.now() - start, candidate: result.candidate, scores: result.scores });
    },
    commit(context, result) {
      const receipt = commitExactResult(controller, prepareExactResult(controller, context.target, result, "Object Selection"));
      if (receipt.documentId !== context.documentId || receipt.operation !== "setSelection") throw new Error("Unexpected Object Selection receipt");
    },
    dispose(context) { if (context?.overlay && doc.toolOverlayState.jobSelectionPreview === context.overlay) { doc.toolOverlayState.jobSelectionPreview = null; doc.dirty = true; } },
  };
}
