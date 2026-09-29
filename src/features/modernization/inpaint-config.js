/** Non-secret configuration; reading this module never contacts a service. */
import { JobError } from "./job-service.js";
export const DEFAULT_INPAINT_CONFIG = Object.freeze({ enabled: false, endpoint: "http://127.0.0.1:8188", checkpoint: "" });
let current = { ...DEFAULT_INPAINT_CONFIG };
export function getInpaintConfig() { return { ...current }; }
export function setInpaintConfig(value) {
  current = { enabled: value?.enabled === true,
    endpoint: typeof value?.endpoint === "string" ? value.endpoint : DEFAULT_INPAINT_CONFIG.endpoint,
    checkpoint: typeof value?.checkpoint === "string" ? value.checkpoint : "" };
  return getInpaintConfig();
}
export function validateInpaintConfig(value, requireEnabled = true) {
  if (requireEnabled && !value?.enabled) throw new JobError("backend-setup", "Enable AI Remove in Preferences → AI Remove and configure your local service.");
  const match = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([0-9]+)\/?$/.exec(value?.endpoint);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new JobError("backend-setup", "Use http://127.0.0.1:PORT or http://[::1]:PORT with no path, query or credentials.");
  if (typeof value?.checkpoint !== "string" || !value.checkpoint.length || value.checkpoint.length > 240
    || /[\u0000-\u001f\u007f\\]/.test(value.checkpoint) || value.checkpoint.includes("..") || value.checkpoint.startsWith("/")) throw new JobError("backend-setup", "Enter the exact compatible checkpoint identifier from your local ComfyUI installation.");
  return { enabled: value.enabled === true, endpoint: value.endpoint, checkpoint: value.checkpoint };
}
