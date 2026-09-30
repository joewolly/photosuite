import { EXPAND_WORKFLOW } from "./expand-workload.js";
import { startComfyRequest, nativeComfyInvoke as nativeInvoke, comfyError as errorFor } from "./comfy-request.js";
import { validateInpaintConfig } from "./inpaint-config.js";
import { validateInpaintInput, cropInpaintResult, copyInpaintResult } from "./inpaint-workload.js";
import { validateGenerativeConfig, validateGenerativeInput, copyGenerativeResult, GENERATIVE_WORKFLOW } from "./generative-workload.js";
export async function testInpaintConnection(config, invoke = nativeInvoke) {
  validateInpaintConfig(config);
  try {
    const result = await invoke("comfy_preflight", { config });
    if (result?.ready !== true || !["0.37.0", "0.37.4"].includes(result.version) || result.workflow !== "photosuite-remove-v1" || result.model !== config.checkpoint) throw new Error("Local service capability response was incompatible.");
    return result;
  } catch (error) { throw errorFor(error); }
}
export function createComfyProvider(invoke = nativeInvoke) {
  return createMaskedProvider(invoke, false);
}
export async function testGenerativeConnection(config, invoke = nativeInvoke) {
  config = validateGenerativeConfig(config);
  try {
    const result = await invoke("comfy_generative_preflight", { config });
    if (result?.ready !== true || result.version !== "0.37.4" || result.workflow !== GENERATIVE_WORKFLOW || result.model !== config.checkpoint) throw new Error("Local generative capability response was incompatible.");
    return result;
  } catch (error) { throw errorFor(error); }
}
export function createGenerativeProvider(invoke = nativeInvoke) {
  return createMaskedProvider(invoke, true);
}
export function createExpandProvider(invoke = nativeInvoke) {
  return createMaskedProvider(invoke, true, true);
}
export async function testExpandConnection(config, invoke = nativeInvoke) {
  config = validateGenerativeConfig(config);
  try {
    const result = await invoke("comfy_expand_preflight", { config });
    if (result?.ready !== true || result.version !== "0.37.4" || result.workflow !== EXPAND_WORKFLOW || result.model !== config.checkpoint) throw new Error("Incompatible Generative Expand backend.");
    return result;
  } catch (error) { throw errorFor(error); }
}
function createMaskedProvider(invoke, generative, expand = false) {
  return {
    validateInput: generative ? validateGenerativeInput : validateInpaintInput,
    copyResult: generative ? copyGenerativeResult : copyInpaintResult,
    start(input, callbacks) {
      return startComfyRequest(invoke, callbacks, async (requestId, check, poll) => {
        const raw = new Uint8Array(input.rgba.length + input.mask.length);
        raw.set(input.rgba); raw.set(input.mask, input.rgba.length);
        const metadata = { requestId, config: input.config, width: input.modelWidth, height: input.modelHeight, seed: input.seed };
        const command = expand ? "comfy_expand" : generative ? "comfy_generative" : "comfy_inpaint";
        const body = generative ? { input: metadata, prompt: input.prompt } : metadata;
        const promise = invoke(command, raw, { headers: { "x-photosuite-inpaint": encodeURIComponent(JSON.stringify(body)) } });
        poll(); const bytes = await promise; check();
        return cropInpaintResult(input, bytes);
      });
    },
  };
}
