/** Reviewed backend profiles. No network access, provider fallback or setting writes. */
import { JobError } from "./job-service.js";
export const COMFY_PROVIDER_ID = "comfyui-local";
export const GENERATIVE_MODEL = "sd-v1-5-inpainting.ckpt";
export const GENERATIVE_WORKFLOW = "photosuite-generative-fill-v1";
export const EXPAND_WORKFLOW = "photosuite-generative-expand-v1";
export const UPSCALE_MODEL = "realesr-general-x4v3.pth";
export function validateInpaintConfig(value, requireEnabled = true) {
  if (requireEnabled && !value?.enabled) throw new JobError("backend-setup", "Enable AI Remove in Preferences → AI Remove and configure your local service.");
  const match = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([0-9]+)\/?$/.exec(value?.endpoint);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new JobError("backend-setup", "Use http://127.0.0.1:PORT or http://[::1]:PORT with no path, query or credentials.");
  if (typeof value?.checkpoint !== "string" || !value.checkpoint.length || value.checkpoint.length > 240
    || /[\u0000-\u001f\u007f\\]/.test(value.checkpoint) || value.checkpoint.includes("..") || value.checkpoint.startsWith("/")) throw new JobError("backend-setup", "Enter the exact compatible checkpoint identifier from your local ComfyUI installation.");
  return { enabled: value.enabled === true, endpoint: value.endpoint, checkpoint: value.checkpoint };
}
export function validateGenerativeConfig(config) {
  const value = validateInpaintConfig({ ...config, enabled: true });
  if (value.checkpoint !== GENERATIVE_MODEL) throw new JobError("backend-setup", `Generative Fill requires the reviewed ${GENERATIVE_MODEL} checkpoint. Configure its separate setting in Preferences → AI Remove.`);
  return value;
}
export function validateUpscaleConfig(config) {
  const match = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([0-9]+)\/?$/.exec(config?.endpoint);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new JobError("invalid-request", "Set the ComfyUI endpoint in Preferences → AI Remove to http://127.0.0.1:PORT or http://[::1]:PORT.");
  if (config.model !== UPSCALE_MODEL) throw new JobError("invalid-request", "AI Upscale requires the reviewed realesr-general-x4v3.pth model in ComfyUI's upscale_models folder.");
  return { endpoint: config.endpoint, model: config.model };
}
/** Legacy store interpretation is exact: enable applies to Remove only. */
export function legacyProviderSelection(capability, local, generationCheckpoint = GENERATIVE_MODEL) {
  const config = capability === "enhance.upscale" ? { endpoint: local.endpoint, model: UPSCALE_MODEL }
    : capability === "ai-remove" ? { ...local } : { enabled: true, endpoint: local.endpoint, checkpoint: generationCheckpoint };
  return { providerId: COMFY_PROVIDER_ID, configuration: config };
}
