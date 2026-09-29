import { JobError } from "./job-service.js";
import { validateSubjectInput, copySubjectResult } from "./subject-workload.js";
const errors = {
  "model-missing": "Subject selection is missing from this installation. Reinstall PhotoSuite or use a manual selection.",
  "model-corrupt": "Subject selection could not load because its data is damaged. Reinstall PhotoSuite or use a manual selection.",
  "malformed-result": "Subject selection returned an invalid mask. Please try again.",
  "inference-failure": "Subject selection failed. Please try again or make a manual selection.",
};
/** One lazily started worker. Brief warm reuse; cancel/crash retires it immediately. */
export function createSubjectProvider(workerFactory = () => new Worker(new URL("./subject-worker.js", import.meta.url), { type: "module" }), idleMs = 30000) {
  let worker = null, idleTimer = null;
  const retire = () => {
    clearTimeout(idleTimer); idleTimer = null;
    if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); worker = null; }
  };
  return {
    validateInput: validateSubjectInput, copyResult: copySubjectResult,
    start(input, callbacks, identity) {
      clearTimeout(idleTimer); idleTimer = null;
      let ended = false;
      const stop = () => { ended = true; retire(); return true; };
      try {
        worker ??= workerFactory();
        worker.onmessage = ({ data }) => {
          if (ended || data?.id !== identity.id || data.revision !== identity.revision) return;
          if (data.progress) { callbacks.progress(data.progress); return; }
          ended = true;
          worker.onmessage = worker.onerror = worker.onmessageerror = null;
          if (data.error) { retire(); const code = Object.hasOwn(errors, data.error.code) ? data.error.code : "inference-failure"; callbacks.fail(new JobError(code, errors[code])); }
          else { idleTimer = setTimeout(retire, idleMs); callbacks.complete(data.result); }
        };
        worker.onerror = worker.onmessageerror = (event) => {
          event.preventDefault?.(); stop(); callbacks.fail(new JobError("worker-failure", "Subject selection stopped unexpectedly. Please try again or use a manual selection."));
        };
        worker.postMessage({ ...identity, input }, [input.rgba.buffer]);
      } catch { stop(); callbacks.fail(new JobError("runtime-unavailable", "Subject selection could not start. Please try again or use a manual selection.")); }
      return stop;
    },
    dispose: retire,
  };
}
