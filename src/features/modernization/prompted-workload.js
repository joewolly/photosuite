/** Document-coordinate prompt contract. Tensor details stay in this adapter. */
import { JobError } from "./job-service.js";

export const PROMPTED_LIMITS = Object.freeze({ pixels: 4194304, dimension: 8192, points: 64, size: 1024, embeddingBytes: 16777216, cacheMs: 120000, idleMs: 30000 });
export const PROMPTED_MODEL = Object.freeze({ name: "SAM-2.1-Hiera-Tiny", revision: "de431c4043854a71d8101e17995dfe596bf101a5", encoderSha256: "d1a57be72fc8cbbe25ea6dc1aac74432552eb1aaabaca13d6e3290f339d718f4", decoderSha256: "40433699e5555adb18401d1f69ad12d58ec93e2209f41873c4077609a363f25f", runtime: "onnxruntime-web-1.22.0-wasm" });
export const PROMPTED_SETTINGS = Object.freeze({ size: 1024, resize: "bilinear-square-half-pixel", alpha: "neutral-128-multiply", color: "srgb8", candidates: "single-click-best-iou-else-stability-0.98-delta-0.05", coverage: "sigmoid-interpolated-logits", priorMask: false });
const fail = (message) => { throw new JobError("invalid-request", message); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validatePromptedInput(input) {
  const r = input?.rect;
  if (!r || ![r.x, r.y].every(Number.isSafeInteger) || Math.abs(r.x) > 8192 || Math.abs(r.y) > 8192) fail("Unsupported source position.");
  if (![r.width, r.height, input.documentWidth, input.documentHeight].every((n) => Number.isSafeInteger(n) && n > 0 && n <= PROMPTED_LIMITS.dimension)
    || r.width * r.height > PROMPTED_LIMITS.pixels || input.documentWidth * input.documentHeight > PROMPTED_LIMITS.pixels) fail("Object Selection supports up to 4 megapixels per layer and canvas, with axes up to 8192 pixels.");
  if (!(input.rgba instanceof Uint8Array || input.rgba instanceof Uint8ClampedArray) || input.rgba.length !== r.width * r.height * 4 || !(input.rgba.buffer instanceof ArrayBuffer)) fail("Object Selection needs tightly packed RGBA8 pixels.");
  if (input.color !== "srgb8" || input.alpha !== "straight" || !equal(input.model, PROMPTED_MODEL) || !equal(input.settings, PROMPTED_SETTINGS)) fail("Unsupported Object Selection model or settings.");
  if (typeof input.sessionId !== "string" || !input.sessionId.length || input.sessionId.length > 128) fail("Invalid Object Selection session.");
  if (!Array.isArray(input.points) || input.points.length > PROMPTED_LIMITS.points) fail("Use at most 64 correction points per selection.");
  const inside = (x, y, edge = false) => Number.isFinite(x) && Number.isFinite(y) && x >= r.x && y >= r.y && (edge ? x <= r.x + r.width && y <= r.y + r.height : x < r.x + r.width && y < r.y + r.height);
  for (const point of input.points) if (!point || !["positive", "negative"].includes(point.kind) || !inside(point.x, point.y)) fail("Place correction points inside the source layer.");
  const b = input.box;
  if (b != null && (!inside(b.x, b.y) || !inside(b.x + b.width, b.y + b.height, true) || b.width <= 0 || b.height <= 0)) fail("Draw a nonempty box inside the source layer.");
  if (!b && !input.points.some((p) => p.kind === "positive")) fail("Start with a positive point or a box around the object.");
  return input.rgba.byteLength;
}
export function promptedMapping(rect) {
  return { source: { ...rect }, modelWidth: 1024, modelHeight: 1024, scaleX: 1024 / rect.width, scaleY: 1024 / rect.height, padX: 0, padY: 0, maskWidth: 256, maskHeight: 256 };
}
export function documentToModel(point, mapping) { return { x: (point.x - mapping.source.x) * mapping.scaleX, y: (point.y - mapping.source.y) * mapping.scaleY }; }
export function modelToDocument(point, mapping) { return { x: point.x / mapping.scaleX + mapping.source.x, y: point.y / mapping.scaleY + mapping.source.y }; }
export function preparePromptTensors(input) {
  validatePromptedInput(input);
  const mapping = promptedMapping(input.rect), points = [], labels = [];
  const add = (p, label) => { const v = documentToModel(p, mapping); points.push(v.x, v.y); labels.push(label); };
  if (input.box) { add(input.box, 2); add({ x: input.box.x + input.box.width, y: input.box.y + input.box.height }, 3); }
  for (const p of input.points) add(p, p.kind === "positive" ? 1 : 0);
  return { coords: new Float32Array(points), labels: new Int32Array(labels) };
}
function axis(value, size) {
  const v = Math.max(0, Math.min(size - 1, value)), low = Math.floor(v);
  return [low, Math.min(low + 1, size - 1), v - low];
}
export function preparePromptedImage(input) {
  validatePromptedInput(input);
  const r = input.rect, size = 1024, plane = size * size, tensor = new Float32Array(plane * 3);
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let y = 0; y < size; y++) {
    const [y0, y1, fy] = axis((y + .5) * r.height / size - .5, r.height);
    for (let x = 0; x < size; x++) {
      const [x0, x1, fx] = axis((x + .5) * r.width / size - .5, r.width);
      const indices = [(y0 * r.width + x0) * 4, (y0 * r.width + x1) * 4, (y1 * r.width + x0) * 4, (y1 * r.width + x1) * 4];
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      for (let c = 0; c < 3; c++) {
        let value = 0;
        for (let k = 0; k < 4; k++) { const i = indices[k], alpha = input.rgba[i + 3] / 255; value += weights[k] * (input.rgba[i + c] * alpha + 128 * (1 - alpha)); }
        tensor[c * plane + y * size + x] = (value / 255 - mean[c]) / std[c];
      }
    }
  }
  return tensor;
}
export function reconstructPromptedMask(input, logits, scores) {
  validatePromptedInput(input);
  if (!(logits instanceof Float32Array) || logits.length !== 4 * 256 * 256 || !(scores instanceof Float32Array) || scores.length !== 4 || !logits.every(Number.isFinite) || !scores.every(Number.isFinite)) throw new JobError("malformed-result", "Object Selection returned invalid masks.");
  // Official SAM2 image semantics: ambiguous single clicks use best predicted IoU
  // among tokens 1–3. Boxes/corrections use token 0, falling back only if unstable.
  let candidate = 1;
  for (let i = 2; i < 4; i++) if (scores[i] > scores[candidate]) candidate = i;
  if (input.box || input.points.length > 1) {
    let intersection = 0, union = 0;
    for (let i = 0; i < 65536; i++) { if (logits[i] > .05) intersection++; if (logits[i] > -.05) union++; }
    if (union === 0 || intersection / union >= .98) candidate = 0;
  }
  const r = input.rect, bytes = new Uint8Array(r.width * r.height), offset = candidate * 65536;
  for (let y = 0; y < r.height; y++) {
    const [y0, y1, fy] = axis((y + .5) * 256 / r.height - .5, 256);
    for (let x = 0; x < r.width; x++) {
      if (x + r.x < 0 || y + r.y < 0 || x + r.x >= input.documentWidth || y + r.y >= input.documentHeight) continue;
      const [x0, x1, fx] = axis((x + .5) * 256 / r.width - .5, 256);
      const value = (logits[offset + y0 * 256 + x0] * (1 - fx) + logits[offset + y0 * 256 + x1] * fx) * (1 - fy)
        + (logits[offset + y1 * 256 + x0] * (1 - fx) + logits[offset + y1 * 256 + x1] * fx) * fy;
      const i = y * r.width + x;
      bytes[i] = Math.round(input.rgba[i * 4 + 3] / (1 + Math.exp(-value)));
    }
  }
  return { pixelFormat: "coverage8", rect: { ...r }, bytes, byteLength: bytes.length, outsideCoverage: 0, mode: "intersect", mapping: promptedMapping(r), model: { ...PROMPTED_MODEL }, settings: { ...PROMPTED_SETTINGS }, sessionId: input.sessionId, candidate, scores: Array.from(scores) };
}
export function copyPromptedResult(result) {
  const r = result?.rect;
  if (!r || ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || Math.abs(r.x) > 8192 || Math.abs(r.y) > 8192 || r.width < 1 || r.height < 1 || r.width > 8192 || r.height > 8192 || r.width * r.height > PROMPTED_LIMITS.pixels
    || result.pixelFormat !== "coverage8" || !(result.bytes instanceof Uint8Array) || result.bytes.length !== r.width * r.height || result.byteLength !== result.bytes.length || result.mode !== "intersect" || result.outsideCoverage !== 0
    || !equal(result.mapping, promptedMapping(r)) || !equal(result.model, PROMPTED_MODEL) || !equal(result.settings, PROMPTED_SETTINGS) || typeof result.sessionId !== "string") throw new JobError("malformed-result", "Object Selection returned an invalid result.");
  return { ...result, bytes: result.bytes.slice(), rect: { ...r }, mapping: promptedMapping(r) };
}

/** Hash all source bytes plus every encoder-affecting setting, never a weak fingerprint. */
export async function promptedSourceKey(input, digest = (bytes) => crypto.subtle.digest("SHA-256", bytes)) {
  validatePromptedInput(input);
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
  const pixels = hex(await digest(input.rgba));
  return hex(await digest(new TextEncoder().encode(JSON.stringify([pixels, input.rect, input.documentWidth, input.documentHeight, input.color, input.alpha, input.model, input.settings]))));
}

/** Exactly one immutable source embedding, at most 16 MiB, at most two minutes. */
export class PromptedEmbeddingCache {
  constructor(now = () => performance.now()) { this.now = now; this.entry = null; }
  get(key, owner) {
    const e = this.entry;
    if (e && (e.key !== key || e.owner !== owner || this.now() - e.created >= PROMPTED_LIMITS.cacheMs)) this.clear();
    return this.entry?.value || null;
  }
  put(key, owner, value, bytes, dispose) {
    this.clear();
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > PROMPTED_LIMITS.embeddingBytes) { dispose(value); throw new JobError("resource-limit", "Object Selection embedding exceeds its memory bound."); }
    this.entry = { key, owner, value, bytes, dispose, created: this.now() };
  }
  clear() { const e = this.entry; this.entry = null; if (e) e.dispose(e.value); }
}
