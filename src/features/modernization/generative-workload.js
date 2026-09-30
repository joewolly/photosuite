/** M6 primitives only; no editor authority, durable recipe or provider graph. */
import { JobError } from "./job-service.js";
import { validateGenerativeConfig } from "./comfy-config.js";
export { GENERATIVE_MODEL, GENERATIVE_WORKFLOW, validateGenerativeConfig } from "./comfy-config.js";
import { prepareInpaintInput, prepareInpaintSnapshot, validateInpaintInput, copyInpaintResult } from "./inpaint-workload.js";

export const GENERATIVE_LIMITS = Object.freeze({ promptBytes: 2048, promptUnits: 1024, candidates: 3, candidateBytes: 4 * 1024 * 1024, retainedBytes: 12 * 1024 * 1024, thumbnailBytes: 0, maskGrowth: 0 });
export function validatePrompt(prompt) {
  if (typeof prompt !== "string" || prompt.length > GENERATIVE_LIMITS.promptUnits
    || new TextEncoder().encode(prompt).length > GENERATIVE_LIMITS.promptBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(prompt)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(prompt)) {
    throw new JobError("invalid-request", "Prompt must be valid text, at most 1024 characters and 2048 UTF-8 bytes.");
  }
  return prompt; // Including empty text and whitespace: never rewrite the user's prompt.
}
export function generationOptions(value) {
  const prompt = validatePrompt(value?.prompt);
  const count = value?.count;
  if (!Number.isSafeInteger(count) || count < 1 || count > GENERATIVE_LIMITS.candidates) throw new JobError("invalid-request", "Choose one to three variations.");
  const seed = value.seed === null ? crypto.getRandomValues(new Uint32Array(1))[0] : value.seed;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new JobError("invalid-request", "Seed must be an integer from 0 to 4294967295, or Random.");
  return { prompt, count, seed };
}
export function prepareGenerativeInput(layer, selection, width, height, config, options) {
  const settings = generationOptions(options);
  const prepared = prepareInpaintInput(layer, selection, width, height, validateGenerativeConfig(config), settings.seed);
  prepared.input.prompt = settings.prompt;
  return { ...prepared, settings };
}
export function validateGenerativeInput(input) {
  validatePrompt(input?.prompt); validateGenerativeConfig(input?.config);
  return validateInpaintInput(input) + new TextEncoder().encode(input.prompt).length;
}
export function copyGenerativeResult(result) {
  return { ...copyInpaintResult(result), name: "Generative Fill" };
}

/** Feature contract: working-resolution adaptation belongs to the provider. */
export function prepareGenerativeSnapshot(layer, selection, width, height, options) {
  const settings = generationOptions(options);
  const prepared = prepareInpaintSnapshot(layer, selection, width, height, settings.seed);
  prepared.input.prompt = settings.prompt;
  return { ...prepared, settings };
}
