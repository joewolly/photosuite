/** Pure worker request: copied RGBA, coverage and brush marks, no editor objects. */
import { Rect } from "../../core/math/rect.js";
import { createQuickSelectComputation, adoptDocumentSelection, recomputeQuickSelectSelection } from "../../engine/compositing/quick-select-computation.js";
import { JobError } from "./job-service.js";

export const QUICK_SELECT_LIMITS = Object.freeze({ pixels: 4 * 1024 * 1024, strokes: 32, dimension: 8192 });
function checkedRect(rect) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger)
    || rect.width < 1 || rect.height < 1 || rect.width > QUICK_SELECT_LIMITS.dimension || rect.height > QUICK_SELECT_LIMITS.dimension
    || Math.abs(rect.x) > 1000000 || Math.abs(rect.y) > 1000000) throw new JobError("invalid-request", "Invalid selection bounds.");
  const pixels = rect.width * rect.height;
  if (pixels > QUICK_SELECT_LIMITS.pixels) throw new JobError("resource-limit", "Quick Select supports up to 4 megapixels per layer and canvas.");
  return pixels;
}
function bytes(value, length) {
  if (!(value instanceof Uint8Array || value instanceof Uint8ClampedArray) || !(value.buffer instanceof ArrayBuffer) || value.byteLength !== length) throw new JobError("invalid-request", "Invalid selection input bytes.");
  return value.byteLength;
}
export function validateQuickSelectInput(input) {
  if (!input || !Array.isArray(input.strokes) || input.strokes.length < 1) throw new JobError("invalid-request", "Paint a selection stroke first.");
  if (input.strokes.length > QUICK_SELECT_LIMITS.strokes) throw new JobError("resource-limit", "Accept or discard this selection before adding more strokes.");
  let length = bytes(input.rgba, checkedRect(input.rect) * 4);
  if (input.base) length += bytes(input.base.channel, checkedRect(input.base.rect));
  for (const stroke of input.strokes) {
    length += bytes(stroke.marks, checkedRect(stroke.rect));
    if (!Number.isFinite(stroke.radius) || stroke.radius <= 0 || stroke.radius > 8192) throw new JobError("invalid-request", "Invalid brush radius.");
    if (stroke.rect.x < input.rect.x || stroke.rect.y < input.rect.y || stroke.rect.x + stroke.rect.width > input.rect.x + input.rect.width || stroke.rect.y + stroke.rect.height > input.rect.y + input.rect.height) throw new JobError("invalid-request", "Brush marks exceed the source region.");
  }
  return length;
}
function toRect(value) { return new Rect(value.x, value.y, value.width, value.height); }
export function runQuickSelectWorkload(input, progress = () => {}) {
  validateQuickSelectInput(input);
  const start = performance.now();
  progress({ kind: "stage", stage: "Analysing image" });
  const session = createQuickSelectComputation(input.rgba, toRect(input.rect));
  const analysisMs = performance.now() - start;
  if (input.base) adoptDocumentSelection(session, { rect: toRect(input.base.rect), channel: input.base.channel });
  progress({ kind: "stage", stage: "Refining" });
  for (const stroke of input.strokes) {
    for (let y = 0; y < stroke.rect.height; y++) for (let x = 0; x < stroke.rect.width; x++) {
      const mark = stroke.marks[y * stroke.rect.width + x];
      if (mark === 0 || mark === 255) session.brushMaskBuffer[(y + stroke.rect.y - input.rect.y) * input.rect.width + x + stroke.rect.x - input.rect.x] = mark;
    }
    session.brushRadius = stroke.radius;
    recomputeQuickSelectSelection(session);
  }
  return { pixelFormat: "coverage8", rect: { ...input.rect }, bytes: session.selectionMaskBuffer.slice(0, input.rect.width * input.rect.height),
    byteLength: input.rect.width * input.rect.height, timings: { analysisMs, refineMs: performance.now() - start - analysisMs } };
}
export function copyQuickSelectResult(result) {
  try {
    const length = checkedRect(result?.rect);
    if (result.pixelFormat !== "coverage8" || result.byteLength !== length) throw new Error("format");
    bytes(result.bytes, length);
    return { pixelFormat: "coverage8", rect: { ...result.rect }, bytes: new Uint8Array(result.bytes), byteLength: length };
  } catch { throw new JobError("malformed-result", "The selection worker returned an invalid result."); }
}
