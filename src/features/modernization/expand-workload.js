/** M8 coordinates and copied pixels. Document expansion and model padding are distinct. */
import { JobError } from "./job-service.js";
import { generationOptions, validateGenerativeConfig, validateGenerativeInput } from "./generative-workload.js";
import { prepareComfyMasked } from "./comfy-pixels.js";
export { EXPAND_WORKFLOW } from "./comfy-config.js";
export const EXPAND_LIMITS = Object.freeze({ dimension: 1024, pixels: 1048576, side: 512, exteriorPixels: 786432, sourceBytes: 16 * 1048576, layers: 64, candidates: 1, candidateBytes: 4 * 1048576, previewBytes: 4 * 1048576, overlap: 16 });
export function requireExpand(ok, message) { if (!ok) throw new JobError("invalid-request", message); }
export function expansionGeometry(width, height, sides) {
  requireExpand([width, height].every(v => Number.isSafeInteger(v) && v > 0 && v <= EXPAND_LIMITS.dimension), "Generative Expand requires a canvas at most 1024 × 1024.");
  const { left, top, right, bottom } = sides || {};
  requireExpand([left, top, right, bottom].every(v => Number.isSafeInteger(v) && v >= 0 && v <= EXPAND_LIMITS.side), "Each added edge must be an integer from 0 to 512 pixels.");
  const newWidth = width + left + right, newHeight = height + top + bottom;
  const pixels = newWidth * newHeight, exteriorPixels = pixels - width * height;
  requireExpand(Number.isSafeInteger(pixels * 4) && newWidth <= EXPAND_LIMITS.dimension && newHeight <= EXPAND_LIMITS.dimension && pixels <= EXPAND_LIMITS.pixels && exteriorPixels > 0 && exteriorPixels <= EXPAND_LIMITS.exteriorPixels, "Add at least one pixel; the final canvas must fit 1024 × 1024 with at most 786432 new pixels.");
  return Object.freeze({ width, height, left, top, right, bottom, newWidth, newHeight, exteriorPixels, byteLength: pixels * 4 });
}
export function insideOriginal(g, x, y) { return x >= g.left && x < g.left + g.width && y >= g.top && y < g.top + g.height; }
export function prepareExpandInput(source, g, config, options) {
  const { input: snapshot, settings } = prepareExpandSnapshot(source, g, options);
  const input = prepareComfyMasked(snapshot, validateGenerativeConfig(config));
  validateGenerativeInput(input);
  return { input, settings };
}
/** Provider pixels carry no authority inside the old rectangle, including transparent areas. */
export function containExpandResult(result, g) {
  requireExpand(result?.pixelFormat === "rgba8" && result.rect?.x === 0 && result.rect?.y === 0 && result.rect.width === g.newWidth && result.rect.height === g.newHeight && result.bytes?.length === g.byteLength && result.byteLength === g.byteLength, "Generative Expand returned the wrong expanded geometry.");
  for (let y = 0; y < g.newHeight; y++) for (let x = 0; x < g.newWidth; x++) {
    const offset = (y * g.newWidth + x) * 4;
    if (insideOriginal(g, x, y)) result.bytes.fill(0, offset, offset + 4);
    else result.bytes[offset + 3] = 255; // Exterior is opaque, containing any formerly off-canvas layer pixels.
  }
  result.name = "Generative Expand";
  return result;
}
export function expandedPreview(source, result, g) {
  const bytes = new Uint8ClampedArray(result.bytes);
  for (let y = 0; y < g.height; y++) bytes.set(source.subarray(y * g.width * 4, (y + 1) * g.width * 4), ((y + g.top) * g.newWidth + g.left) * 4);
  return bytes;
}
export function assertOriginalProjection(before, after, g) {
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width * 4; x++) requireExpand(before[y * g.width * 4 + x] === after[((y + g.top) * g.newWidth + g.left) * 4 + x], "Expanded composition changed protected original pixels.");
}

/** Unpadded feature snapshot. The provider supplies its own working resolution. */
export function prepareExpandSnapshot(source, g, options) {
  const settings = generationOptions({ ...options, count: options?.count ?? 1 });
  requireExpand(settings.count === 1, "Generative Expand retains one variation at a time.");
  requireExpand((source instanceof Uint8Array || source instanceof Uint8ClampedArray) && source.buffer instanceof ArrayBuffer && source.length === g.width * g.height * 4, "Invalid expanded source pixels.");
  const rgba = new Uint8Array(g.byteLength), mask = new Uint8Array(g.newWidth * g.newHeight);
  for (let y = 0; y < g.newHeight; y++) for (let x = 0; x < g.newWidth; x++) {
    const sx = Math.max(0, Math.min(g.width - 1, x - g.left)), sy = Math.max(0, Math.min(g.height - 1, y - g.top));
    const from = (sy * g.width + sx) * 4, to = (y * g.newWidth + x) * 4;
    rgba.set(source.subarray(from, from + 4), to);
    const seam = (g.left > 0 && x < g.left + EXPAND_LIMITS.overlap) || (g.right > 0 && x >= g.left + g.width - EXPAND_LIMITS.overlap)
      || (g.top > 0 && y < g.top + EXPAND_LIMITS.overlap) || (g.bottom > 0 && y >= g.top + g.height - EXPAND_LIMITS.overlap);
    mask[y * g.newWidth + x] = !insideOriginal(g, x, y) || seam ? 255 : 0;
  }
  return { input: { rect: { x: 0, y: 0, width: g.newWidth, height: g.newHeight }, rgba, mask, prompt: settings.prompt, seed: settings.seed }, settings };
}
