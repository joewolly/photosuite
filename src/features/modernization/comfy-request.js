/** One JS transport lifetime per M1 execution; Rust owns HTTP/GPU settlement. */
import { JobError } from "./job-service.js";
import { generateUuid } from "../../core/uid.js";
export function nativeComfyInvoke(command, args, options) {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  if (!invoke) return Promise.reject(new JobError("backend-unavailable", "Local AI requires the PhotoSuite desktop application."));
  return invoke(command, args, options);
}
export function comfyError(error) { return error instanceof JobError ? error : new JobError("provider-failure", String(error?.message || error).slice(0, 500)); }
export function startComfyRequest(invoke, callbacks, execute) {
  const requestId = generateUuid(); let settled = false, timer, polling = true, cancelling = callbacks.signal.aborted;
  const cancel = () => {
    cancelling = true;
    if (!settled) void invoke("comfy_cancel", { requestId }).catch(() => {});
    return false; // M1 revokes immediately; retain its active slot until execution settles.
  };
  callbacks.signal.addEventListener("abort", cancel, { once: true });
  const poll = async () => {
    if (settled || !polling) return;
    try {
      if (cancelling) await invoke("comfy_cancel", { requestId }); // Also covers abort before Rust acquires its lease.
      else {
        const status = await invoke("comfy_status", { requestId });
        if (!settled && polling && ["Preparing", "Uploading", "Queued", "Generating", "Receiving result"].includes(status?.stage)) callbacks.progress({ kind: "stage", stage: status.stage });
      }
    } catch { /* The main execution reports authoritative failure. */ }
    if (!settled && polling) timer = setTimeout(poll, 500);
  };
  const check = () => { if (cancelling) throw new JobError("cancellation", "Local AI operation cancelled."); };
  const stopPolling = () => { polling = false; clearTimeout(timer); };
  const finish = () => { settled = true; stopPolling(); callbacks.signal.removeEventListener("abort", cancel); };
  void (async () => {
    try {
      check(); callbacks.progress({ kind: "stage", stage: "Preparing" });
      const result = await execute(requestId, check, () => { timer = setTimeout(poll, 0); }, stopPolling);
      check(); finish(); callbacks.complete(result);
    } catch (error) { finish(); callbacks.fail(comfyError(error)); }
  })();
  return cancel;
}
