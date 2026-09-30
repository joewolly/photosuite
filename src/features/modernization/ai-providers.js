/** Application composition root. Only this layer selects backend implementations. */
import { AIProviderRegistry } from "./provider-registry.js";
import { AI_CAPABILITIES } from "./ai-capabilities.js";
import { COMFY_PROVIDER_ID, GENERATIVE_WORKFLOW, EXPAND_WORKFLOW, validateInpaintConfig, validateGenerativeConfig, validateUpscaleConfig } from "./comfy-config.js";
import { createComfyProvider, createGenerativeProvider, createExpandProvider, testInpaintConnection, testGenerativeConnection, testExpandConnection } from "./comfy-provider.js";
import { createUpscaleProvider, testUpscaleConnection } from "./upscale-provider.js";

import { comfyWorkingSize, prepareComfyMasked } from "./comfy-pixels.js";
export { comfyWorkingSize, prepareComfyMasked } from "./comfy-pixels.js";
export function createLocalComfyAIProvider({ invoke, overrides = {} } = {}) {
  const ports = Object.freeze({ ...overrides });
  const masked = (capability, transport, configure, check, workflow, prompted) => {
    const port = ports[capability] || transport;
    return {
      configure, check: config => check(config, invoke),
      support: { inputAlpha: true, outputAlpha: "selection-or-exterior", nativeAlpha: false, masks: true },
      describe: (config, input) => ({ backend: "comfyui", workflow, checkpoint: config.checkpoint,
        ...(input ? comfyWorkingSize(input.rect) : {}),
        ...(prompted ? { settings: { steps: 20, cfg: 7, sampler: "euler", scheduler: "normal", denoise: 1, maskGrowth: 0 } } : {}) }),
      start: (input, config, callbacks, identity) => port.start(prepareComfyMasked(input, config), callbacks, identity),
      disposeResult: output => port.disposeResult?.(output),
    };
  };
  const upscale = ports[AI_CAPABILITIES.upscale] || createUpscaleProvider(invoke);
  return { id: COMFY_PROVIDER_ID, label: "ComfyUI", capabilities: {
    [AI_CAPABILITIES.remove]: masked(AI_CAPABILITIES.remove, createComfyProvider(invoke), validateInpaintConfig, testInpaintConnection, "photosuite-remove-v1", false),
    [AI_CAPABILITIES.fill]: masked(AI_CAPABILITIES.fill, createGenerativeProvider(invoke), validateGenerativeConfig, testGenerativeConnection, GENERATIVE_WORKFLOW, true),
    [AI_CAPABILITIES.expand]: masked(AI_CAPABILITIES.expand, createExpandProvider(invoke), validateGenerativeConfig, testExpandConnection, EXPAND_WORKFLOW, true),
    [AI_CAPABILITIES.upscale]: {
      configure: validateUpscaleConfig, check: config => testUpscaleConnection(config, invoke),
      support: { inputAlpha: true, outputAlpha: "resized-source", nativeAlpha: false, scales: [4] },
      describe: config => ({ backend: "comfyui", workflow: "photosuite-upscale-v1", model: config.model }),
      start: (input, config, callbacks, identity) => upscale.start({ ...input, config }, callbacks, identity),
      disposeResult: output => upscale.disposeResult?.(output),
    },
  } };
}
export function createAIProviders(options) {
  return new AIProviderRegistry([createLocalComfyAIProvider(options)], Object.fromEntries([AI_CAPABILITIES.remove, AI_CAPABILITIES.fill, AI_CAPABILITIES.expand, AI_CAPABILITIES.upscale].map(capability => [capability, COMFY_PROVIDER_ID])));
}
/** Existing programmatic callers can pass the old config; production UI uses selections. */
export function providerSelection(value) { return value?.providerId !== undefined || value?.configuration !== undefined ? value : { providerId: COMFY_PROVIDER_ID, configuration: value }; }
