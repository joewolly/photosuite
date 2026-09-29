/** M0 wire limits, deliberately centralized pending measured M1/M2 budgets. */
import { Rect } from "../../core/math/rect.js";
import { Mask } from "../../document/model/layer-masks.js";
import { allocBuffer } from "../../engine/compositing/buffer-utils.js";

export const RESULT_LIMITS = Object.freeze({
  maxDimension: 16384,
  maxPixels: 24000000,
  maxByteLength: 96000000,
  maxCoordinate: 1000000,
  maxFeather: 256,
  maxNameLength: 255,
});
export const RESULT_OPERATIONS = Object.freeze(["insertRaster", "setSelection", "applyRasterMask"]);

export function requireResult(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateResultRect(rect, channels = 1, allowEmpty = false) {
  requireResult(rect && typeof rect === "object", "Missing result rectangle");
  const { x, y, width, height } = rect;
  for (const value of [x, y, width, height]) requireResult(Number.isSafeInteger(value), "Rectangle must contain safe integers");
  requireResult(width >= (allowEmpty ? 0 : 1) && height >= (allowEmpty ? 0 : 1), "Invalid result dimensions");
  requireResult(width <= RESULT_LIMITS.maxDimension && height <= RESULT_LIMITS.maxDimension, "Result dimensions exceed limit");
  for (const value of [x, y, x + width, y + height]) requireResult(Math.abs(value) <= RESULT_LIMITS.maxCoordinate, "Result coordinates exceed limit");
  const pixels = width * height;
  const byteLength = pixels * channels;
  requireResult(Number.isSafeInteger(byteLength) && pixels <= RESULT_LIMITS.maxPixels && byteLength <= RESULT_LIMITS.maxByteLength, "Result allocation exceeds limit");
  return { rect: new Rect(x, y, width, height), byteLength };
}

export function validateResultPayload(payload, format) {
  requireResult(payload && payload.pixelFormat === format, "Unsupported pixel format; expected " + format);
  const checked = validateResultRect(payload.rect, format === "rgba8" ? 4 : 1);
  requireResult(payload.byteLength === checked.byteLength, "Declared byte length does not match dimensions");
  const bytes = payload.bytes;
  requireResult(bytes instanceof ArrayBuffer || bytes instanceof Uint8Array || bytes instanceof Uint8ClampedArray, "Bytes must be an ArrayBuffer or byte array");
  const backing = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
  requireResult(backing instanceof ArrayBuffer, "Shared buffers are not supported");
  requireResult(bytes.byteLength === checked.byteLength, "Pixel byte length does not match dimensions");
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { ...checked, view };
}

export function copyCoverage(selection) {
  if (!selection) return null;
  const { rect, byteLength } = validateResultRect(selection.rect, 1, true);
  requireResult(selection.channel && selection.channel.length >= byteLength, "Invalid coverage buffer");
  const channel = allocBuffer(byteLength);
  channel.set(selection.channel.subarray(0, byteLength));
  return { rect, channel };
}

export function cloneResultMask(mask) {
  if (!mask) return null;
  validateMaskAllocation(mask);
  const cloned = mask.clone();
  cloned.overlayTintRgb = { ...mask.overlayTintRgb };
  return cloned;
}

export function validateMaskAllocation(mask) {
  validateResultRect(mask.rect, 1, true);
  requireResult(Number.isFinite(mask.feather) && mask.feather >= 0 && mask.feather <= RESULT_LIMITS.maxFeather, "Unsupported mask feather");
  for (const value of [mask.density, mask.color]) requireResult(Number.isInteger(value) && value >= 0 && value <= 255, "Invalid mask coverage parameter");
  validateResultRect(mask.getSelectionRect(), 1, true);
  requireResult(mask.channel.length >= mask.rect.area() && mask.channel.length <= Math.ceil(mask.rect.area() / 4) * 4, "Invalid mask channel");
}

export function maskFromPayload(payload) {
  const checked = validateResultPayload(payload, "coverage8");
  const mask = new Mask();
  mask.rect = checked.rect;
  mask.color = payload.outsideCoverage ?? 0;
  mask.density = payload.density ?? 255;
  mask.feather = payload.feather ?? 0;
  mask.enabled = payload.linked ?? true;
  mask.isEnabled = payload.enabled ?? true;
  requireResult(typeof mask.enabled === "boolean" && typeof mask.isEnabled === "boolean", "Mask flags must be boolean");
  // Validate inflated bounds before allocating any channel.
  requireResult(Number.isFinite(mask.feather) && mask.feather >= 0 && mask.feather <= RESULT_LIMITS.maxFeather, "Unsupported mask feather");
  for (const value of [mask.color, mask.density]) requireResult(Number.isInteger(value) && value >= 0 && value <= 255, "Invalid mask coverage parameter");
  validateResultRect(mask.getSelectionRect());
  mask.channel = allocBuffer(checked.byteLength);
  mask.channel.set(checked.view);
  return mask;
}
