/** M5b pixel-only contract. RGB8 interpreted as sRGB; no profile conversion. */
import { JobError } from "./job-service.js";
import { validateUpscaleConfig } from "./comfy-config.js";
export { UPSCALE_MODEL, validateUpscaleConfig } from "./comfy-config.js";
export const UPSCALE_LIMITS = Object.freeze({ scale: 4, sourceDimension: 1024, sourcePixels: 524288,
  outputDimension: 4096, outputPixels: 8388608, outputBytes: 32 * 1024 * 1024, workingBytes: 384 * 1024 * 1024 });
function requireUpscale(ok, message) { if (!ok) throw new JobError("invalid-request", message); }
export function upscaleGeometry(width, height, scale = 4) {
  requireUpscale([width, height, scale].every(Number.isSafeInteger) && width > 0 && height > 0 && scale === 4, "AI Upscale requires positive integer dimensions and the model's native 4× scale.");
  const outputWidth = width * scale, outputHeight = height * scale, outputPixels = outputWidth * outputHeight, outputBytes = outputPixels * 4;
  // Includes source copies, IPC/decode/result copies, alpha scratch, new raster/composite and history allowance.
  const workingBytes = outputBytes * 10 + width * height * 24 + 4 * 1024 * 1024;
  requireUpscale([outputWidth, outputHeight, outputPixels, outputBytes, workingBytes].every(Number.isSafeInteger)
    && width <= UPSCALE_LIMITS.sourceDimension && height <= UPSCALE_LIMITS.sourceDimension && width * height <= UPSCALE_LIMITS.sourcePixels
    && outputWidth <= UPSCALE_LIMITS.outputDimension && outputHeight <= UPSCALE_LIMITS.outputDimension && outputPixels <= UPSCALE_LIMITS.outputPixels
    && outputBytes <= UPSCALE_LIMITS.outputBytes && workingBytes <= UPSCALE_LIMITS.workingBytes,
  "AI Upscale limit: source ≤1024 per side / 524,288 pixels; result ≤4096 per side / 8,388,608 pixels / 32 MiB RGBA. Use a smaller source.");
  return { width, height, scale, outputWidth, outputHeight, outputPixels, outputBytes, workingBytes };
}
function bytes(value, count) {
  requireUpscale((value instanceof Uint8Array || value instanceof Uint8ClampedArray) && value.buffer instanceof ArrayBuffer && value.length === count, "Invalid AI Upscale pixel bytes.");
}
export function validateUpscaleInput(input) {
  const geometry = upscaleGeometry(input?.width, input?.height, input?.scale);
  validateUpscaleConfig(input.config); bytes(input.rgba, geometry.width * geometry.height * 4);
  return input.rgba.length;
}
/** Breadth-first color extension: covered straight RGB survives, hidden RGB never enters inference. */
export function extendUpscaleRGB(rgba, width, height) {
  upscaleGeometry(width, height); bytes(rgba, width * height * 4);
  const output = new Uint8Array(rgba.length), seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  for (let i = 0; i < seen.length; i++) {
    output[i * 4 + 3] = 255;
    if (rgba[i * 4 + 3]) { seen[i] = 1; queue[tail++] = i; output.set(rgba.subarray(i * 4, i * 4 + 3), i * 4); }
  }
  const visit = (neighbor, source) => {
    if (seen[neighbor]) return;
    seen[neighbor] = 1; queue[tail++] = neighbor;
    output.set(output.subarray(source * 4, source * 4 + 3), neighbor * 4);
  };
  while (head < tail) {
    const i = queue[head++], x = i % width;
    if (x) visit(i - 1, i); if (x + 1 < width) visit(i + 1, i);
    if (i >= width) visit(i - width, i); if (i + width < seen.length) visit(i + width, i);
  }
  return output;
}
function cubic(x) {
  const v = Math.abs(x);
  return v <= 1 ? 1.5 * v * v * v - 2.5 * v * v + 1 : v < 2 ? -0.5 * v * v * v + 2.5 * v * v - 4 * v + 2 : 0;
}
/** Separable Catmull-Rom alpha, pixel-center aligned, edge-clamped, rounded/clamped to UNORM8. */
function* alphaRows(input, output) {
  const g = upscaleGeometry(input.width, input.height, input.scale); bytes(input.rgba, g.width * g.height * 4); bytes(output, g.outputBytes);
  let opaque = true;
  for (let i = 3; i < input.rgba.length; i += 4) if (input.rgba[i] !== 255) { opaque = false; break; }
  if (opaque) {
    for (let y = 0; y < g.outputHeight; y++) {
      for (let x = 0; x < g.outputWidth; x++) output[(y * g.outputWidth + x) * 4 + 3] = 255;
      if (y % 32 === 31) yield;
    }
    return;
  }
  const scratch = new Float32Array(g.outputWidth * g.height);
  const indices = new Int32Array(g.outputWidth * 4), weights = new Float64Array(g.outputWidth * 4);
  for (let x = 0; x < g.outputWidth; x++) {
    const source = (x + 0.5) / g.scale - 0.5, base = Math.floor(source);
    for (let k = -1; k <= 2; k++) { indices[x * 4 + k + 1] = Math.max(0, Math.min(g.width - 1, base + k)); weights[x * 4 + k + 1] = cubic(source - base - k); }
  }
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.outputWidth; x++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += input.rgba[(y * g.width + indices[x * 4 + k]) * 4 + 3] * weights[x * 4 + k];
      scratch[y * g.outputWidth + x] = sum;
    }
    if (y % 32 === 31) yield;
  }
  for (let y = 0; y < g.outputHeight; y++) {
    const source = (y + 0.5) / g.scale - 0.5, base = Math.floor(source), rows = [], verticalWeights = [];
    for (let k = -1; k <= 2; k++) { rows.push(Math.max(0, Math.min(g.height - 1, base + k)) * g.outputWidth); verticalWeights.push(cubic(source - base - k)); }
    for (let x = 0; x < g.outputWidth; x++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += scratch[rows[k] + x] * verticalWeights[k];
      const offset = (y * g.outputWidth + x) * 4, alpha = Math.max(0, Math.min(255, Math.round(sum)));
      output[offset + 3] = alpha;
      if (!alpha) output.fill(0, offset, offset + 3);
    }
    if (y % 32 === 31) yield;
  }
}
export function combineUpscaleAlpha(input, output) {
  for (const step of alphaRows(input, output)) void step;
  return output;
}
/** Yield during output assembly so cancellation retains immediate editor authority. */
export async function combineUpscaleAlphaAsync(input, output, signal) {
  const check = () => { if (signal.aborted) throw new JobError("cancellation", "AI Upscale cancelled."); };
  check();
  for (const step of alphaRows(input, output)) { void step; check(); await new Promise(resolve => setTimeout(resolve, 0)); }
  check(); return output;
}
export function copyUpscaleResult(result) {
  try {
    const g = upscaleGeometry(result?.width / 4, result?.height / 4, result?.scale);
    requireUpscale(result.pixelFormat === "rgba8", "Invalid result format."); bytes(result.bytes, g.outputBytes);
    return { width: result.width, height: result.height, scale: 4, pixelFormat: "rgba8", bytes: result.bytes.slice(), timings: { ...result.timings } };
  } catch { throw new JobError("malformed-result", "AI Upscale returned invalid result dimensions or pixels."); }
}
/** Small preview only. Actual retained raster is never resampled for Accept. */
export function upscaleThumbnail(result, maxSide = 256) {
  const ratio = Math.min(1, maxSide / Math.max(result.width, result.height));
  const width = Math.max(1, Math.round(result.width * ratio)), height = Math.max(1, Math.round(result.height * ratio)), rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(result.height - 1, Math.floor((y + 0.5) / ratio)) * result.width + Math.min(result.width - 1, Math.floor((x + 0.5) / ratio))) * 4;
    rgba.set(result.bytes.subarray(source, source + 4), (y * width + x) * 4);
  }
  return { width, height, rgba };
}
