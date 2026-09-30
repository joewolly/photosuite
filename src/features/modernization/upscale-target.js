/** Editor authority stays here; provider receives only a copied rendered RGB8 composite. */
import { JobError } from "./job-service.js";
import { getResultDocumentInfo, requireIdleResultEditor } from "../results/result-targets.js";
import { upscaleGeometry, upscaleThumbnail } from "./upscale-workload.js";
import { FileFormatRegistry } from "../../document/formats/registry/file-format-registry.js";
import { Rect } from "../../core/math/rect.js";
function requireSource(doc) {
  if (!doc || doc.activeChannels.length || doc.layers.some(layer => layer.add.artb)) throw new JobError("unsupported-image", "AI Upscale requires an RGB document without artboards.");
  return upscaleGeometry(doc.width, doc.height);
}
function rendered(doc) { doc.markDirty(); return doc.getRasterData(); }
export function prepareUpscaleSource(controller, doc, config) {
  requireIdleResultEditor(controller); const g = requireSource(doc), start = performance.now();
  if (!controller.openDocs.includes(doc)) throw new JobError("document-closed", "The source document was closed.");
  const rgba = rendered(doc).slice();
  return { input: { width: g.width, height: g.height, scale: 4, rgba, ...(config === undefined ? {} : { config: { ...config } }) }, sourceCaptureMs: performance.now() - start };
}
export function createUpscaleAdapter(controller, doc, input, onPreview = () => {}, onMetrics = () => {}) {
  return {
    capture() {
      requireSource(doc);
      return { documentId: getResultDocumentInfo(doc).documentId, pixels: input.rgba.slice(), width: doc.width, height: doc.height,
        history: doc.history.slice(), historyIndex: doc.historyIndex, name: (doc.name || "Untitled").replace(/\.[^.]+$/, "") + " — AI Upscale 4x" };
    },
    validate(context, accept) {
      if (!controller.openDocs.includes(doc) || getResultDocumentInfo(doc).documentId !== context.documentId) throw new JobError("document-closed", "The source document was closed.");
      if (accept) requireIdleResultEditor(controller);
      const stale = () => { throw new JobError("stale-result", "The rendered source changed. Rerun AI Upscale."); };
      if (doc.width !== context.width || doc.height !== context.height || doc.historyIndex !== context.historyIndex || doc.history.length !== context.history.length || doc.history.some((entry, i) => entry !== context.history[i])) stale();
      requireSource(doc);
      const current = rendered(doc);
      if (current.length !== context.pixels.length) stale();
      const a = new Uint32Array(current.buffer, current.byteOffset, current.length / 4), b = new Uint32Array(context.pixels.buffer);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) stale();
    },
    preview(context, result, jobId) {
      if (result.width !== context.width * 4 || result.height !== context.height * 4) throw new JobError("malformed-result", "AI Upscale returned the wrong source dimensions.");
      const start = performance.now(); onPreview(upscaleThumbnail(result), jobId, result.width, result.height);
      onMetrics({ ...result.timings, previewMs: performance.now() - start });
    },
    commit(context, result) {
      const start = performance.now(), rect = new Rect(0, 0, result.width, result.height);
      const created = FileFormatRegistry.openFiles(context.name + ".psd", [{ data: result.bytes.slice().buffer, rect, layerName: "AI Upscale 4x" }]);
      // Normal import trims transparent margins; preserve the exact generated raster extent for M5b.
      created.layers[0].rect = rect; created.layers[0].buffer = result.bytes.slice();
      controller.onDocumentOpened(created);
      onMetrics({ newDocumentMs: performance.now() - start });
    },
    dispose() { onPreview(null); },
  };
}
