/** Capability-specific detached pixel contracts; no backend or editor authority. */
import { JobError } from "./job-service.js";
import { checkedRect, INPAINT_LIMITS, copyInpaintResult } from "./inpaint-workload.js";
import { validatePrompt, copyGenerativeResult } from "./generative-workload.js";
import { upscaleGeometry, copyUpscaleResult } from "./upscale-workload.js";
export const AI_CAPABILITIES = Object.freeze({ remove: "ai-remove", fill: "generate.fill", expand: "generate.expand", edit: "edit.instruction", reference: "edit.reference", upscale: "enhance.upscale" });
function bytes(value, length) {
  if (!(value instanceof Uint8Array || value instanceof Uint8ClampedArray) || !(value.buffer instanceof ArrayBuffer) || value.length !== length) throw new JobError("invalid-request", "Invalid provider input pixel or mask bytes.");
}
function fields(value, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !allowed.includes(key))) throw new JobError("invalid-request", "Provider inputs require the capability's explicit pixel contract.");
}
export function validateMaskedSnapshot(input, prompted = false) {
  fields(input, prompted ? ["rect", "rgba", "mask", "seed", "prompt"] : ["rect", "rgba", "mask", "seed"]);
  fields(input.rect, ["x", "y", "width", "height"]);
  const pixels = checkedRect(input?.rect, INPAINT_LIMITS.dimension, INPAINT_LIMITS.pixels);
  bytes(input.rgba, pixels * 4); bytes(input.mask, pixels);
  if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) throw new JobError("invalid-request", "Invalid provider input seed.");
  if (prompted) validatePrompt(input.prompt);
  return pixels * 5 + (prompted ? new TextEncoder().encode(input.prompt).length : 0);
}
export const AI_CONTRACTS = Object.freeze({
  [AI_CAPABILITIES.remove]: Object.freeze({ validateInput: input => validateMaskedSnapshot(input), copyResult: copyInpaintResult }),
  [AI_CAPABILITIES.fill]: Object.freeze({ validateInput: input => validateMaskedSnapshot(input, true), copyResult: copyGenerativeResult }),
  [AI_CAPABILITIES.expand]: Object.freeze({ validateInput: input => validateMaskedSnapshot(input, true), copyResult: copyGenerativeResult }),
  [AI_CAPABILITIES.upscale]: Object.freeze({
    validateInput(input) { fields(input, ["width", "height", "scale", "rgba"]); const g = upscaleGeometry(input.width, input.height, input.scale); bytes(input.rgba, g.width * g.height * 4); return input.rgba.length; },
    copyResult(result) {
      const owned = copyUpscaleResult(result); owned.timings = {};
      for (const key of ["rgbPreparationMs", "transportMs", "alphaMs"]) if (result.timings?.[key] !== undefined) {
        if (!Number.isFinite(result.timings[key]) || result.timings[key] < 0) throw new JobError("malformed-result", "Invalid provider timing metadata.");
        owned.timings[key] = result.timings[key];
      }
      return owned;
    },
  }),
});
