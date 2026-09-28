import { JobError } from "./job-service.js";
import { validateQuickSelectInput, copyQuickSelectResult } from "./quick-select-workload.js";

/** Each execution owns a dedicated worker, retired on success, failure or cancel. */
export function createQuickSelectProvider(workerFactory = () => new Worker(new URL("./quick-select-worker.js", import.meta.url), { type: "module" })) {
  return {
    validateInput: validateQuickSelectInput,
    copyResult: copyQuickSelectResult,
    start(input, callbacks, identity) {
      let worker;
      let ended = false;
      const stop = () => {
        ended = true;
        if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); worker = null; }
        return true;
      };
      try {
        worker = workerFactory();
        worker.onmessage = ({ data }) => {
          if (ended || data?.id !== identity.id || data.revision !== identity.revision) return;
          if (data.progress) { callbacks.progress(data.progress); return; }
          stop();
          if (data.error) callbacks.fail(new JobError("provider-failure", "Quick Select failed. Please try again."));
          else callbacks.complete(data.result);
        };
        worker.onerror = worker.onmessageerror = (event) => {
          event.preventDefault?.(); stop();
          callbacks.fail(new JobError("worker-failure", "The selection worker stopped. Please try again."));
        };
        const transfers = [input.rgba.buffer, ...input.strokes.map((stroke) => stroke.marks.buffer)];
        if (input.base) transfers.push(input.base.channel.buffer);
        worker.postMessage({ ...identity, input }, [...new Set(transfers)]);
      } catch { stop(); callbacks.fail(new JobError("worker-failure", "The selection worker could not start.")); }
      return stop;
    },
  };
}
