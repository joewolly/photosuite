/** Editor authority stays here; the provider sees only a bounded crop and mask. */
import { captureResultTarget, getResultDocumentInfo, validateResultTarget, requireIdleResultEditor } from "../results/result-targets.js";
import { prepareExactResult, commitExactResult } from "../trackers/exact-result-tracker.js";
import { copyCoverage } from "../results/result-contract.js";
import { JobError } from "./job-service.js";
import { checkedRect } from "./inpaint-workload.js";

export function requireInpaintSource(doc, name = "AI Remove") {
  const layer = doc?.layers[doc.selectedLayerIndices[0]];
  if (!doc || doc.activeChannels.length || doc.selectedLayerIndices.length !== 1 || !layer || layer !== doc.layers.at(-1)
    || !layer.hasPixelData() || layer.isGroup() || layer.add.TySh || layer.add.placedData || layer.hasFillContent() || layer.pixelContent > 0
    || layer.getMask() || layer.add.vmsk || layer.add.lfx2 || layer.add.lfXS || layer.isClippingMask || layer.blendMode !== "norm" || layer.Opct !== 255
    || (layer.add.iOpa != null && layer.add.iOpa !== 255) || layer.add.knko
    || (layer.add.brst && layer.add.brst.some((value) => value !== 1)) || !layer.isVisible())
    throw new JobError("invalid-request", `${name} currently needs the topmost ordinary raster layer, visible at full opacity in Normal mode, without masks, clipping or effects. Select the area to edit on that layer.`);
  const size = checkedRect(layer.rect) * 4;
  if (!(layer.buffer instanceof Uint8Array || layer.buffer instanceof Uint8ClampedArray) || layer.buffer.length !== size) throw new JobError("invalid-request", "The source layer has unsupported pixel data.");
  return layer;
}
function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function sameRect(a, b) { return a && b && ["x", "y", "width", "height"].every((key) => a[key] === b[key]); }
function sameSelection(a, b) {
  if (!sameRect(a?.rect, b?.rect)) return false;
  const count = a.rect.width * a.rect.height;
  // Editor coverage buffers may contain alignment bytes outside the rectangle.
  // They are not selected pixels and copyCoverage deliberately zeroes them.
  return sameBytes(a.channel.subarray(0, count), b.channel?.subarray(0, count));
}
function metadata(layer) { return JSON.stringify([layer.rect, layer.layerFlags, layer.pixelContent, layer.add.lspf, layer.Opct, layer.blendMode, layer.blendIfData]); }
export function createInpaintAdapter(controller, doc, layer, roi, coverage, name = "AI Remove") {
  return {
    capture() {
      requireInpaintSource(doc, name);
      const info = getResultDocumentInfo(doc);
      const target = captureResultTarget(controller, { documentId: info.documentId, layerId: info.layers[doc.layers.indexOf(layer)].layerId, operation: "insertRaster" });
      return { doc, layer, target, documentId: info.documentId, pixels: layer.buffer.slice(), metadata: metadata(layer),
        selection: copyCoverage(doc.selectionMask), roi: { ...roi }, coverage: coverage.slice(), overlay: null };
    },
    validate(context, accept) {
      if (!controller.openDocs.includes(context.doc)) throw new JobError("document-closed", "The source document was closed.");
      try {
        validateResultTarget({ openDocs: controller.openDocs }, context.target);
        if (requireInpaintSource(context.doc, name) !== context.layer || metadata(context.layer) !== context.metadata
          || !sameBytes(context.pixels, context.layer.buffer)
          || !sameSelection(context.selection, context.doc.selectionMask)) throw new Error("Source changed");
        if (accept) requireIdleResultEditor(controller);
      } catch { throw new JobError("stale-result", `The source layer, target or selection changed. Rerun ${name}.`); }
    },
    preview(context, result, jobId) {
      if (!sameRect(context.roi, result.rect) || result.bytes.length !== context.coverage.length * 4) throw new JobError("malformed-result", `${name} returned the wrong document mapping.`);
      // The editor constrains even a malicious provider's output. Context is not permission.
      for (let i = 0; i < context.coverage.length; i++) {
        const alpha = context.coverage[i];
        result.bytes[i * 4 + 3] = alpha;
        if (!alpha) result.bytes.fill(0, i * 4, i * 4 + 3);
      }
      const prior = context.doc.toolOverlayState.jobRasterPreview;
      if (prior?.canvas) { prior.canvas.width = prior.canvas.height = 0; prior.canvas = null; }
      context.overlay = { jobId, rect: { ...context.roi }, bytes: result.bytes, canvas: null };
      context.doc.toolOverlayState.jobRasterPreview = context.overlay;
      context.doc.dirty = true;
    },
    commit(context, result, recipe = null) {
      const receipt = commitExactResult(controller, prepareExactResult(controller, context.target, result, name, recipe));
      context.provenanceFailed = recipe !== null && !receipt.provenanceAttached;
      if (receipt.documentId !== context.documentId || receipt.operation !== "insertRaster") throw new Error(`Unexpected ${name} commit receipt`);
    },
    dispose(context) {
      if (context?.doc.toolOverlayState.jobRasterPreview === context?.overlay) {
        context.doc.toolOverlayState.jobRasterPreview = null; context.doc.dirty = true;
      }
      if (context?.overlay?.canvas) { context.overlay.canvas.width = context.overlay.canvas.height = 0; context.overlay.canvas = null; }
    },
  };
}
