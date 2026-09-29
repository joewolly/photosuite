/** Coordinates and bytes only. Inference padding is never a document rectangle. */
import { JobError } from "./job-service.js";
import { validateInpaintConfig } from "./inpaint-config.js";
export const INPAINT_LIMITS = Object.freeze({ dimension: 1024, pixels: 1024 * 1024, context: 64, sourcePixels: 4 * 1024 * 1024, sourceDimension: 8192 });
function requireInput(ok, message) { if (!ok) throw new JobError("invalid-request", message); }
export function checkedRect(rect, maxDimension = 8192, maxPixels = INPAINT_LIMITS.sourcePixels) {
  requireInput(rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger)
    && Math.abs(rect.x) <= 1000000 && Math.abs(rect.y) <= 1000000
    && rect.width > 0 && rect.height > 0 && rect.width <= maxDimension && rect.height <= maxDimension
    && rect.width * rect.height <= maxPixels, "AI Remove bounds exceed the supported size. Use a smaller selection or source layer.");
  return rect.width * rect.height;
}
function byteView(value, length, padded = false) {
  requireInput((value instanceof Uint8Array || value instanceof Uint8ClampedArray) && value.buffer instanceof ArrayBuffer
    && value.length >= length && value.length <= (padded ? Math.ceil(length / 4) * 4 : length), "AI Remove received invalid pixel or mask bytes.");
}
export function removalROI(selection, width, height) {
  requireInput(selection != null, "Select the area to remove first.");
  const count = checkedRect(selection.rect);
  byteView(selection.channel, count, true);
  requireInput(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 32768 && height <= 32768, "Unsupported document dimensions.");
  const r = selection.rect;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = Math.max(0, r.y); y < Math.min(height, r.y + r.height); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(width, r.x + r.width); x++) {
      if (!selection.channel[(y - r.y) * r.width + x - r.x]) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  requireInput(right >= left && bottom >= top, "Select a nonempty area inside the canvas first.");
  const x = Math.max(0, left - INPAINT_LIMITS.context), y = Math.max(0, top - INPAINT_LIMITS.context);
  const rect = { x, y, width: Math.min(width, right + 1 + INPAINT_LIMITS.context) - x, height: Math.min(height, bottom + 1 + INPAINT_LIMITS.context) - y };
  checkedRect(rect, INPAINT_LIMITS.dimension, INPAINT_LIMITS.pixels);
  return rect;
}
export function prepareInpaintInput(layer, selection, width, height, config, seed = crypto.getRandomValues(new Uint32Array(1))[0]) {
  validateInpaintConfig(config);
  byteView(layer.buffer, checkedRect(layer.rect) * 4);
  const rect = removalROI(selection, width, height);
  const modelWidth = Math.max(512, Math.ceil(rect.width / 8) * 8), modelHeight = Math.max(512, Math.ceil(rect.height / 8) * 8);
  const rgba = new Uint8Array(modelWidth * modelHeight * 4), mask = new Uint8Array(modelWidth * modelHeight);
  const coverage = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < modelHeight; y++) for (let x = 0; x < modelWidth; x++) {
    const dx = rect.x + Math.min(x, rect.width - 1), dy = rect.y + Math.min(y, rect.height - 1);
    const offset = (y * modelWidth + x) * 4;
    if (dx >= layer.rect.x && dy >= layer.rect.y && dx < layer.rect.x + layer.rect.width && dy < layer.rect.y + layer.rect.height) {
      const source = ((dy - layer.rect.y) * layer.rect.width + dx - layer.rect.x) * 4;
      rgba.set(layer.buffer.subarray(source, source + 4), offset);
    }
    if (x < rect.width && y < rect.height && dx >= selection.rect.x && dy >= selection.rect.y && dx < selection.rect.x + selection.rect.width && dy < selection.rect.y + selection.rect.height) {
      const alpha = selection.channel[(dy - selection.rect.y) * selection.rect.width + dx - selection.rect.x];
      coverage[y * rect.width + x] = alpha;
      mask[y * modelWidth + x] = alpha ? 255 : 0;
    }
  }
  const input = { rect, modelWidth, modelHeight, modelOffset: { x: 0, y: 0 }, rgba, mask, seed, config: { ...config } };
  validateInpaintInput(input);
  return { input, coverage };
}
export function validateInpaintInput(input) {
  checkedRect(input?.rect, INPAINT_LIMITS.dimension, INPAINT_LIMITS.pixels);
  validateInpaintConfig(input.config);
  requireInput(input.modelWidth === Math.max(512, Math.ceil(input.rect.width / 8) * 8)
    && input.modelHeight === Math.max(512, Math.ceil(input.rect.height / 8) * 8)
    && input.modelOffset?.x === 0 && input.modelOffset?.y === 0
    && Number.isSafeInteger(input.seed) && input.seed >= 0 && input.seed <= 0xffffffff, "Invalid AI Remove model mapping or seed.");
  const pixels = input.modelWidth * input.modelHeight;
  byteView(input.rgba, pixels * 4); byteView(input.mask, pixels);
  return pixels * 5;
}
export function cropInpaintResult(input, data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  byteView(bytes, input.modelWidth * input.modelHeight * 4);
  const result = new Uint8Array(input.rect.width * input.rect.height * 4);
  for (let y = 0; y < input.rect.height; y++) {
    const offset = ((y + input.modelOffset.y) * input.modelWidth + input.modelOffset.x) * 4;
    result.set(bytes.subarray(offset, offset + input.rect.width * 4), y * input.rect.width * 4);
  }
  return { pixelFormat: "rgba8", rect: { ...input.rect }, byteLength: result.length, bytes: result, name: "AI Remove" };
}
export function copyInpaintResult(result) {
  try {
    const length = checkedRect(result?.rect, INPAINT_LIMITS.dimension, INPAINT_LIMITS.pixels) * 4;
    requireInput(result.pixelFormat === "rgba8" && result.byteLength === length, "Invalid result format.");
    byteView(result.bytes, length);
    return { pixelFormat: "rgba8", rect: { ...result.rect }, byteLength: length, bytes: result.bytes.slice(), name: "AI Remove" };
  } catch { throw new JobError("malformed-result", "AI Remove returned invalid result dimensions or bytes."); }
}
