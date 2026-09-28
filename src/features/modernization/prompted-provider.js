import { JobError } from "./job-service.js";
import { PROMPTED_LIMITS, validatePromptedInput, copyPromptedResult } from "./prompted-workload.js";
const messages = {
  "model-missing": "Object Selection AI is missing from this installation. Use Classical mode or reinstall PhotoSuite.",
  "model-corrupt": "Object Selection AI data failed verification. Use Classical mode or reinstall PhotoSuite.",
  "inference-failure": "Object Selection AI failed. Retry or use Classical mode.",
};
export function createPromptedProvider(workerFactory = () => new Worker(new URL("./prompted-worker.js", import.meta.url), { type: "module" }), idleMs = PROMPTED_LIMITS.idleMs) {
  let worker = null, timer = null, owner = null;
  const retire = () => { clearTimeout(timer); timer = null; owner = null; if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); worker = null; } };
  return {
    validateInput: validatePromptedInput, copyResult: copyPromptedResult,
    releaseSession(sessionId) { if (owner === sessionId) retire(); },
    dispose: retire,
    start(input, callbacks, identity) {
      if (owner && owner !== input.sessionId) retire();
      clearTimeout(timer); timer = null; owner = input.sessionId;
      let ended = false;
      const stop = () => { if (!ended) { ended = true; retire(); } return true; };
      try {
        worker ??= workerFactory();
        worker.onmessage = ({ data }) => {
          if (ended || data?.id !== identity.id || data.revision !== identity.revision) return;
          if (data.progress) { callbacks.progress(data.progress); return; }
          ended = true;
          worker.onmessage = worker.onerror = worker.onmessageerror = null;
          if (data.error || data.result?.sessionId !== input.sessionId) {
            retire(); const code = Object.hasOwn(messages, data.error?.code) ? data.error.code : "inference-failure";
            callbacks.fail(new JobError(code, messages[code]));
          } else { timer = setTimeout(retire, idleMs); callbacks.complete(data.result); }
        };
        worker.onerror = worker.onmessageerror = (event) => { event.preventDefault?.(); stop(); callbacks.fail(new JobError("worker-failure", "Object Selection AI stopped unexpectedly. Retry or use Classical mode.")); };
        worker.postMessage({ ...identity, input }, [input.rgba.buffer]);
      } catch { stop(); callbacks.fail(new JobError("runtime-unavailable", "Object Selection AI could not start. Retry or use Classical mode.")); }
      return stop;
    },
  };
}
