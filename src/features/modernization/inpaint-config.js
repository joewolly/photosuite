/** Non-secret configuration; reading this module never contacts a service. */
export { validateInpaintConfig } from "./comfy-config.js";
export const DEFAULT_INPAINT_CONFIG = Object.freeze({ enabled: false, endpoint: "http://127.0.0.1:8188", checkpoint: "" });
let current = { ...DEFAULT_INPAINT_CONFIG };
export function getInpaintConfig() { return { ...current }; }
export function setInpaintConfig(value) {
  current = { enabled: value?.enabled === true,
    endpoint: typeof value?.endpoint === "string" ? value.endpoint : DEFAULT_INPAINT_CONFIG.endpoint,
    checkpoint: typeof value?.checkpoint === "string" ? value.checkpoint : "" };
  return getInpaintConfig();
}
