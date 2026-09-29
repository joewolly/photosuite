import { validateExpandSource } from "./expand-source.js";
import { containExpandResult, expandedPreview } from "./expand-workload.js";
import { commitExactExpansion } from "../trackers/exact-expand-tracker.js";
export function createExpandAdapter(controller, context, onPreview, onMetrics = () => {}) {
  return {
    capture() { validateExpandSource(controller, context); return context; },
    validate(c, accept) { validateExpandSource(controller, c, accept); },
    preview(c, result, id) {
      const start = performance.now(); containExpandResult(result, c.geometry);
      onPreview({ bytes: expandedPreview(c.pixels, result, c.geometry), geometry: c.geometry }, id);
      onMetrics({ previewMs: performance.now() - start });
    },
    commit(c, result) {
      const start = performance.now(); validateExpandSource(controller, c, true);
      commitExactExpansion(controller, c, containExpandResult(result, c.geometry));
      onMetrics({ acceptMs: performance.now() - start });
    },
    dispose() { onPreview(null); },
  };
}
