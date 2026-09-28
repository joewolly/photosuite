import { JobError } from "./job-service.js";
import { generateUuid } from "../../core/uid.js";
import { validateUpscaleConfig, validateUpscaleInput, copyUpscaleResult, upscaleGeometry, extendUpscaleRGB, combineUpscaleAlphaAsync } from "./upscale-workload.js";
function nativeInvoke(...args) {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  if (!invoke) return Promise.reject(new JobError("backend-unavailable", "AI Upscale requires the PhotoSuite desktop application."));
  return invoke(...args);
}
function providerError(error) { return error instanceof JobError ? error : new JobError("provider-failure", String(error?.message || error).slice(0, 500)); }
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
      const requestId = generateUuid(); let settled = false, timer, cancelling = callbacks.signal.aborted;
      const cancel = () => { cancelling = true; if (!settled) void invoke("comfy_cancel", { requestId }).catch(() => {}); return false; };
      callbacks.signal.addEventListener("abort", cancel, { once: true });
      const poll = async () => {
        if (settled) return;
        try {
          if (cancelling) await invoke("comfy_cancel", { requestId });
          else { const status = await invoke("comfy_status", { requestId }); if (["Preparing", "Uploading", "Queued", "Generating", "Receiving result"].includes(status?.stage)) callbacks.progress({ kind: "stage", stage: status.stage }); }
        } catch { /* Main request owns errors. */ }
        if (!settled) timer = setTimeout(poll, 500);
      };
      const finish = () => { settled = true; clearTimeout(timer); callbacks.signal.removeEventListener("abort", cancel); };
      void (async () => {
        try {
          validateUpscaleInput(input);
          if (cancelling) throw new JobError("cancellation", "AI Upscale cancelled.");
          const start = performance.now(), g = upscaleGeometry(input.width, input.height, input.scale);
          callbacks.progress({ kind: "stage", stage: "Preparing" });
          const rgba = extendUpscaleRGB(input.rgba, input.width, input.height), prepared = performance.now();
          const metadata = { requestId, config: input.config, width: input.width, height: input.height, scale: input.scale };
          const promise = invoke("comfy_upscale", rgba, { headers: { "x-photosuite-upscale": encodeURIComponent(JSON.stringify(metadata)) } }); timer = setTimeout(poll, 0);
          const raw = await promise, received = performance.now();
          if (cancelling) throw new JobError("cancellation", "AI Upscale cancelled.");
          const output = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
          finish(); callbacks.progress({ kind: "stage", stage: "Restoring transparency" });
          await combineUpscaleAlphaAsync(input, output, callbacks.signal);
          callbacks.complete({ width: g.outputWidth, height: g.outputHeight, scale: 4, pixelFormat: "rgba8", bytes: output,
            timings: { rgbPreparationMs: prepared - start, transportMs: received - prepared, alphaMs: performance.now() - received } });
        } catch (error) { finish(); callbacks.fail(providerError(error)); }
      })();
      return cancel;
    },
  };
}
