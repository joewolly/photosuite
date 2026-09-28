/** M3's only segmentation contract. No document, DOM, history or runtime authority. */
import { JobError } from "./job-service.js";
export const SUBJECT_LIMITS = Object.freeze({ dimension: 8192, pixels: 4194304, inputSize: 512, modelBytes: 94377615 });
export const SUBJECT_MODEL = Object.freeze({ name: "BiRefNet-lite", revision: "aa62cd87eafb9cc43056d08ef3615a14628b831d", sha256: "79bc52b86f15cf146646e2e82ee9a6589151e4d28db4c190c9dd98c3a3a7344c", runtime: "onnxruntime-web-1.22.0-wasm" });
export const SUBJECT_SETTINGS = Object.freeze({ size: 512, resize: "bilinear-letterbox", alpha: "neutral-128-multiply", color: "srgb8", combination: "replace" });
const fail = (code, message) => { throw new JobError(code, message); };
export function validateSubjectInput(input) {
  const r = input?.rect;
  if (!r || ![r.x, r.y].every(Number.isSafeInteger) || Math.abs(r.x) > 8192 || Math.abs(r.y) > 8192) fail("invalid-request", "Unsupported source position.");
  for (const n of [r.width, r.height, input.documentWidth, input.documentHeight]) if (!Number.isSafeInteger(n) || n < 1 || n > SUBJECT_LIMITS.dimension) fail("resource-limit", "Select Subject supports dimensions from 1 to 8192 pixels.");
  const count = r.width * r.height;
  if (count > SUBJECT_LIMITS.pixels || input.documentWidth * input.documentHeight > SUBJECT_LIMITS.pixels) fail("resource-limit", "Select Subject supports up to 4 megapixels per layer and canvas.");
  if (!(input.rgba instanceof Uint8Array || input.rgba instanceof Uint8ClampedArray) || input.rgba.length !== count * 4 || !(input.rgba.buffer instanceof ArrayBuffer)) fail("invalid-request", "Select Subject needs tightly packed RGBA8 pixels.");
  if (input.color !== "srgb8" || input.alpha !== "straight") fail("invalid-request", "Select Subject needs straight-alpha sRGB8 pixels.");
  return input.rgba.byteLength;
}
export function subjectMapping(rect) {
  const size = SUBJECT_LIMITS.inputSize, scale = Math.min(size / rect.width, size / rect.height);
  const width = Math.max(1, Math.round(rect.width * scale)), height = Math.max(1, Math.round(rect.height * scale));
  return { source: { ...rect }, modelSize: size, width, height, left: Math.floor((size - width) / 2), top: Math.floor((size - height) / 2), scaleX: width / rect.width, scaleY: height / rect.height };
}
function sampleAxis(value, size) {
  const v = Math.max(0, Math.min(size - 1, value)), lo = Math.floor(v);
  return [lo, Math.min(lo + 1, size - 1), v - lo];
}
export function prepareSubjectTensor(input) {
  validateSubjectInput(input);
  const mapping = subjectMapping(input.rect), size = mapping.modelSize, plane = size * size;
  const tensor = new Float32Array(plane * 3), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let c = 0; c < 3; c++) tensor.fill((128 / 255 - mean[c]) / std[c], c * plane, (c + 1) * plane);
  const { width: sw, height: sh } = input.rect;
  for (let y = 0; y < mapping.height; y++) {
    const [y0, y1, fy] = sampleAxis((y + 0.5) / mapping.scaleY - 0.5, sh);
    for (let x = 0; x < mapping.width; x++) {
      const [x0, x1, fx] = sampleAxis((x + 0.5) / mapping.scaleX - 0.5, sw);
      const indices = [(y0 * sw + x0) * 4, (y0 * sw + x1) * 4, (y1 * sw + x0) * 4, (y1 * sw + x1) * 4];
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      for (let c = 0; c < 3; c++) {
        let value = 0;
        for (let k = 0; k < 4; k++) {
          const i = indices[k], alpha = input.rgba[i + 3] / 255;
          value += weights[k] * (input.rgba[i + c] * alpha + 128 * (1 - alpha));
        }
        tensor[c * plane + (mapping.top + y) * size + mapping.left + x] = (value / 255 - mean[c]) / std[c];
      }
    }
  }
  return { tensor, mapping };
}
export function reconstructSubjectMask(input, mapping, data, dims) {
  validateSubjectInput(input);
  const size = SUBJECT_LIMITS.inputSize;
  if (JSON.stringify(mapping) !== JSON.stringify(subjectMapping(input.rect)) || !(data instanceof Float32Array) || data.length !== size * size || !Array.isArray(dims) || dims.join(",") !== `1,1,${size},${size}`) fail("malformed-result", "The subject model returned the wrong dimensions or mapping.");
  const coverage = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) fail("malformed-result", "The subject model returned invalid coverage.");
    coverage[i] = 1 / (1 + Math.exp(-data[i]));
  }
  const r = input.rect, bytes = new Uint8Array(r.width * r.height);
  for (let y = 0; y < r.height; y++) {
    const [sy0, sy1, fy] = sampleAxis((y + 0.5) * mapping.scaleY - 0.5, mapping.height);
    const y0 = sy0 + mapping.top, y1 = sy1 + mapping.top;
    for (let x = 0; x < r.width; x++) {
      if (x + r.x < 0 || y + r.y < 0 || x + r.x >= input.documentWidth || y + r.y >= input.documentHeight) continue;
      const [sx0, sx1, fx] = sampleAxis((x + 0.5) * mapping.scaleX - 0.5, mapping.width);
      const x0 = sx0 + mapping.left, x1 = sx1 + mapping.left;
      const value = (coverage[y0 * size + x0] * (1 - fx) + coverage[y0 * size + x1] * fx) * (1 - fy)
        + (coverage[y1 * size + x0] * (1 - fx) + coverage[y1 * size + x1] * fx) * fy;
      const i = y * r.width + x;
      bytes[i] = Math.round(value * input.rgba[i * 4 + 3]);
    }
  }
  return { pixelFormat: "coverage8", rect: { ...r }, byteLength: bytes.length, bytes, outsideCoverage: 0, mode: "intersect", mapping, model: { ...SUBJECT_MODEL }, settings: { ...SUBJECT_SETTINGS } };
}
export function copySubjectResult(result) {
  const r = result?.rect;
  if (!r || ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || r.width < 1 || r.height < 1 || r.width > 8192 || r.height > 8192 || r.width * r.height > SUBJECT_LIMITS.pixels
    || result.pixelFormat !== "coverage8" || !(result.bytes instanceof Uint8Array) || result.bytes.length !== r.width * r.height || result.byteLength !== result.bytes.length
    || result.outsideCoverage !== 0 || result.mode !== "intersect" || JSON.stringify(result.model) !== JSON.stringify(SUBJECT_MODEL) || JSON.stringify(result.settings) !== JSON.stringify(SUBJECT_SETTINGS)
    || JSON.stringify(result.mapping) !== JSON.stringify(subjectMapping(r))) fail("malformed-result", "The subject worker returned an invalid mask.");
  return { ...result, rect: { ...r }, bytes: result.bytes.slice(), mapping: subjectMapping(r), model: { ...SUBJECT_MODEL }, settings: { ...SUBJECT_SETTINGS }, timings: result.timings && { ...result.timings } };
}
