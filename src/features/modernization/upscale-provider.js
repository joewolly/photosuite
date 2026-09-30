import { startComfyRequest, nativeComfyInvoke as nativeInvoke, comfyError as providerError } from "./comfy-request.js";
import { validateUpscaleConfig, validateUpscaleInput, copyUpscaleResult, upscaleGeometry, extendUpscaleRGB, combineUpscaleAlphaAsync } from "./upscale-workload.js";
export async function testUpscaleConnection(config, invoke = nativeInvoke) {
  validateUpscaleConfig(config);
  try {
    const result = await invoke("comfy_upscale_preflight", { config });
    if (result?.ready !== true || result.version !== "0.37.4" || result.workflow !== "photosuite-upscale-v1" || result.model !== config.model) throw new Error("Incompatible AI Upscale capability response.");
    return result;
  } catch (error) { throw providerError(error); }
}
export function createUpscaleProvider(invoke = nativeInvoke) {
  return { validateInput: validateUpscaleInput, copyResult: copyUpscaleResult,
    start(input, callbacks) {
      return startComfyRequest(invoke, callbacks, async (requestId, check, poll, stopPolling) => {
        validateUpscaleInput(input);
        const start = performance.now(), g = upscaleGeometry(input.width, input.height, input.scale);
        const rgba = extendUpscaleRGB(input.rgba, input.width, input.height), prepared = performance.now();
        const metadata = { requestId, config: input.config, width: input.width, height: input.height, scale: input.scale };
        const promise = invoke("comfy_upscale", rgba, { headers: { "x-photosuite-upscale": encodeURIComponent(JSON.stringify(metadata)) } });
        poll(); const raw = await promise, received = performance.now(); check(); stopPolling();
        const output = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
        callbacks.progress({ kind: "stage", stage: "Restoring transparency" });
        await combineUpscaleAlphaAsync(input, output, callbacks.signal);
        return { width: g.outputWidth, height: g.outputHeight, scale: 4, pixelFormat: "rgba8", bytes: output,
          timings: { rgbPreparationMs: prepared - start, transportMs: received - prepared, alphaMs: performance.now() - received } };
      });
    },
  };
}
