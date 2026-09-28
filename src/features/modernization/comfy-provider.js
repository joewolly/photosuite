import { JobError } from "./job-service.js";
import { generateUuid } from "../../core/uid.js";
import { validateInpaintConfig } from "./inpaint-config.js";
import { validateInpaintInput, cropInpaintResult, copyInpaintResult } from "./inpaint-workload.js";
import { validateGenerativeConfig, validateGenerativeInput, copyGenerativeResult, GENERATIVE_WORKFLOW } from "./generative-workload.js";
function nativeInvoke(command, args, options) {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  if (!invoke) return Promise.reject(new JobError("backend-unavailable", "Local AI Remove requires the PhotoSuite desktop application."));
  return invoke(command, args, options);
}
function errorFor(error) { return error instanceof JobError ? error : new JobError("provider-failure", String(error?.message || error).slice(0, 500)); }
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
function createMaskedProvider(invoke, generative) {
  return {
    validateInput: generative ? validateGenerativeInput : validateInpaintInput,
    copyResult: generative ? copyGenerativeResult : copyInpaintResult,
    start(input, callbacks) {
      const requestId = generateUuid();
      let settled = false, timer, cancelling = callbacks.signal.aborted;
      const cancel = () => {
        cancelling = true;
        if (!settled) void invoke("comfy_cancel", { requestId }).catch(() => {});
        return false; // Revocation is immediate in M1; network/GPU settlement is separate.
      };
      callbacks.signal.addEventListener("abort", cancel, { once: true });
      const poll = async () => {
        if (settled) return;
        try {
          if (cancelling) await invoke("comfy_cancel", { requestId }); // Covers cancellation before Rust registration.
          else {
            const status = await invoke("comfy_status", { requestId });
            if (["Preparing", "Uploading", "Queued", "Generating", "Receiving result"].includes(status?.stage)) callbacks.progress({ kind: "stage", stage: status.stage });
          }
        } catch { /* The inference request reports authoritative transport failure. */ }
        if (!settled) timer = setTimeout(poll, 500);
      };
      const finish = () => { settled = true; clearTimeout(timer); callbacks.signal.removeEventListener("abort", cancel); };
      void (async () => {
        try {
          if (cancelling) throw new JobError("cancellation", "AI Remove cancelled.");
          const raw = new Uint8Array(input.rgba.length + input.mask.length);
          raw.set(input.rgba); raw.set(input.mask, input.rgba.length);
          const metadata = { requestId, config: input.config, width: input.modelWidth, height: input.modelHeight, seed: input.seed };
          callbacks.progress({ kind: "stage", stage: "Preparing" });
          const command = generative ? "comfy_generative" : "comfy_inpaint";
          const body = generative ? { input: metadata, prompt: input.prompt } : metadata;
          const promise = invoke(command, raw, { headers: { "x-photosuite-inpaint": encodeURIComponent(JSON.stringify(body)) } });
          timer = setTimeout(poll, 0);
          const bytes = await promise;
          if (cancelling) throw new JobError("cancellation", "AI Remove cancelled.");
          const result = cropInpaintResult(input, bytes);
          finish(); callbacks.complete(result);
        } catch (error) { finish(); callbacks.fail(errorFor(error)); }
      })();
      return cancel;
    },
  };
}
