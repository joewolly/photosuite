/** Bounded, internal production lifecycle. Editor authority lives only in adapters. */
export const JOB_LIMITS = Object.freeze({ queue: 2, retained: 3, bytes: 48 * 1024 * 1024, summaries: 32 });
export const JOB_TERMINAL = new Set(["committed", "discarded", "cancelled", "failed", "stale"]);
export class JobError extends Error {
  constructor(code, message) { super(message); this.name = "JobError"; this.code = code; }
}
const transitions = {
  queued: ["preparing", "cancelled", "stale", "failed"],
  preparing: ["running", "cancelled", "stale", "failed"],
  running: ["preview", "cancelled", "stale", "failed"],
  preview: ["committed", "discarded", "cancelled", "stale", "failed"],
};
function errorInfo(error, fallback = "provider-failure") {
  return Object.freeze({ code: error instanceof JobError ? error.code : fallback,
    message: error instanceof JobError ? error.message : "The operation failed. Please try again." });
}
function progressInfo(value) {
  if (!value || !["indeterminate", "stage", "numeric"].includes(value.kind)) return null;
  const stage = typeof value.stage === "string" ? value.stage.slice(0, 80) : "Running";
  if (value.kind === "numeric") {
    if (!Number.isFinite(value.completed) || !Number.isFinite(value.total) || value.total <= 0 || value.completed < 0 || value.completed > value.total) return null;
    return Object.freeze({ kind: "numeric", stage, completed: value.completed, total: value.total });
  }
  return Object.freeze({ kind: value.kind, stage });
}
function copyInput(value, budget = { bytes: 0, nodes: 0 }, depth = 0) {
  if (++budget.nodes > 10000 || depth > 12) throw new JobError("resource-limit", "This request is too complex.");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    budget.bytes += value.length * 2;
    if (budget.bytes > JOB_LIMITS.bytes) throw new JobError("resource-limit", "This request is too large.");
    return value;
  }
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) {
    budget.bytes += value.byteLength;
    if (!(value.buffer instanceof ArrayBuffer) || budget.bytes > JOB_LIMITS.bytes) throw new JobError("resource-limit", "This request is too large.");
    return new Uint8Array(value); // Copy the logical view, never its oversized backing store.
  }
  if (Array.isArray(value)) return value.map((item) => copyInput(item, budget, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyInput(item, budget, depth + 1)]));
  throw new JobError("invalid-request", "Requests may contain only copied bytes and primitive metadata.");
}

export class ModernizationJobs {
  #providers; #jobs = new Map(); #queue = []; #active = null; #next = 0;
  #sessions = new WeakMap(); #listeners = new Set();
  constructor(providers) { this.#providers = new Map(Object.entries(providers)); }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  createSession() { const session = Object.freeze({}); this.#sessions.set(session, 0); return session; }
  get(id) {
    const job = this.#jobs.get(id);
    if (!job) return null;
    return Object.freeze({ id, operation: job.operation, documentId: job.documentId, revision: job.revision,
      state: job.state, progress: job.progress, error: job.error, cancelled: job.cancelled,
      stopping: this.#active?.job === job && job.cancelled, hasInput: !!job.input, hasResult: !!job.result });
  }
  list() { return [...this.#jobs.keys()].map((id) => this.get(id)); }
  #emit(job) {
    const view = this.get(job.id);
    for (const listener of this.#listeners) {
      try { listener(view); } catch (error) { console.error("Job observer failed", error); }
    }
  }
  #transition(job, state, error = null) {
    if (!transitions[job.state]?.includes(state)) throw new JobError("invalid-transition", "This job can no longer perform that action.");
    job.state = state; job.error = error;
    if (JOB_TERMINAL.has(state)) {
      this.#queue = this.#queue.filter((item) => item !== job);
      try { job.adapter?.dispose?.(job.context, job.result); }
      catch (error) { console.error("Job resource cleanup failed", error); }
      finally { job.context = job.input = job.result = job.adapter = job.session = null; }
    }
    this.#emit(job);
  }
  submit({ operation, input, adapter, session = this.createSession() }) {
    const provider = this.#providers.get(operation);
    if (!provider) throw new JobError("unsupported-operation", "This operation is not supported.");
    if (!this.#sessions.has(session)) throw new JobError("invalid-request", "Invalid selection session.");
    // Validation and capacity checks precede cloning and editor snapshots.
    const byteLength = provider.validateInput(input);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > JOB_LIMITS.bytes) throw new JobError("resource-limit", "This request is too large.");
    const live = [...this.#jobs.values()].filter((job) => !JOB_TERMINAL.has(job.state) && job.session !== session);
    if (live.length >= JOB_LIMITS.retained || this.#queue.filter((job) => job.session !== session).length >= JOB_LIMITS.queue + (this.#active ? 0 : 1)) throw new JobError("resource-limit", "The selection job queue is full.");
    const ownedInput = copyInput(input);
    const context = adapter.capture();
    for (const job of this.#jobs.values()) if (job.session === session && !JOB_TERMINAL.has(job.state)) this.cancel(job.id);
    const revision = this.#sessions.get(session) + 1;
    this.#sessions.set(session, revision);
    const job = { id: "m1-" + ++this.#next, operation, revision, session, adapter, context,
      documentId: context.documentId, input: ownedInput, result: null, state: "queued", cancelled: false,
      progress: Object.freeze({ kind: "indeterminate", stage: "Queued" }), error: null };
    this.#jobs.set(job.id, job); this.#queue.push(job);
    for (const [id, old] of this.#jobs) {
      if (this.#jobs.size <= JOB_LIMITS.summaries) break;
      if (JOB_TERMINAL.has(old.state) && this.#active?.job !== old) this.#jobs.delete(id);
    }
    this.#emit(job); queueMicrotask(() => this.#pump());
    return job.id;
  }
  #fresh(job, accept = false) {
    try {
      if (this.#sessions.get(job.session) !== job.revision) throw new JobError("stale-result", "A newer selection request replaced this one.");
      job.adapter.validate(job.context, accept);
      return true;
    } catch (error) {
      this.#transition(job, "stale", errorInfo(error, "stale-result"));
      this.#stopExecution(job);
      return false;
    }
  }
  revalidate(id) {
    const job = this.#jobs.get(id);
    return !!job && !JOB_TERMINAL.has(job.state) && this.#fresh(job);
  }
  #pump() {
    if (this.#active || !this.#queue.length) return;
    const job = this.#queue.shift();
    if (JOB_TERMINAL.has(job.state)) { this.#pump(); return; }
    const execution = { job, settled: false, abort: new AbortController(), cancel: null };
    this.#active = execution;
    this.#transition(job, "preparing");
    queueMicrotask(() => {
      if (JOB_TERMINAL.has(job.state) || !this.#fresh(job)) { this.#settle(execution); return; }
      this.#transition(job, "running");
      // Observers may synchronously cancel on a state change.
      if (JOB_TERMINAL.has(job.state)) { this.#settle(execution); return; }
      const provider = this.#providers.get(job.operation);
      const callbacks = {
        signal: execution.abort.signal,
        progress: (value) => {
          if (execution.settled || job.state !== "running") return;
          const progress = progressInfo(value);
          if (progress) { job.progress = progress; this.#emit(job); }
        },
        complete: (result) => {
          if (execution.settled) { this.#disposeResult(provider, result); return; }
          try {
            if (job.state !== "running" || !this.#fresh(job)) return;
            // Provider arrays never alias retained preview/M0 input.
            const ownedResult = provider.copyResult(result);
            if (job.state !== "running") return;
            job.result = ownedResult;
            job.adapter.preview?.(job.context, job.result, job.id);
            if (job.state === "running") this.#transition(job, "preview");
          } catch (error) {
            if (!JOB_TERMINAL.has(job.state)) this.#transition(job, "failed", errorInfo(error, "malformed-result"));
          } finally { this.#disposeResult(provider, result); this.#settle(execution); }
        },
        fail: (error) => {
          if (execution.settled) return;
          if (!JOB_TERMINAL.has(job.state)) this.#transition(job, "failed", errorInfo(error));
          this.#settle(execution);
        },
      };
      try {
        const input = job.input; job.input = null;
        execution.cancel = provider.start(input, callbacks, { id: job.id, revision: job.revision });
        if (job.cancelled && !execution.settled && execution.cancel?.() === true) this.#settle(execution);
      } catch (error) { callbacks.fail(error); }
    });
  }
  #settle(execution) {
    if (execution.settled) return;
    execution.settled = true; execution.cancel = null;
    if (this.#active === execution) this.#active = null;
    this.#emit(execution.job); queueMicrotask(() => this.#pump());
  }
  #disposeResult(provider, result) {
    try { provider.disposeResult?.(result); } catch (error) { console.error("Provider result cleanup failed", error); }
  }
  #stopExecution(job) {
    const execution = this.#active?.job === job ? this.#active : null;
    if (!execution) return;
    execution.abort.abort();
    try { if (execution.cancel?.() === true) this.#settle(execution); } catch { /* keep slot until completion */ }
  }
  cancel(id, code = "cancellation") {
    const job = this.#jobs.get(id);
    if (!job || JOB_TERMINAL.has(job.state)) return false;
    job.cancelled = true;
    this.#queue = this.#queue.filter((item) => item !== job);
    this.#transition(job, "cancelled", { code, message: code === "document-closed" ? "The source document was closed." : "Selection cancelled." });
    this.#stopExecution(job);
    queueMicrotask(() => this.#pump());
    return true;
  }
  closeDocument(documentId) {
    for (const job of this.#jobs.values()) if (job.documentId === documentId) this.cancel(job.id, "document-closed");
  }
  discard(id) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== "preview") throw new JobError("invalid-transition", "Only a preview can be discarded.");
    this.#transition(job, "discarded");
  }
  accept(id) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== "preview" || job.cancelled) throw new JobError("invalid-transition", "Only a current preview can be accepted.");
    if (!this.#fresh(job, true)) return false;
    try {
      job.adapter.commit(job.context, job.result);
      this.#transition(job, "committed");
      return true;
    } catch (error) { this.#transition(job, "failed", errorInfo(error)); return false; }
  }
  /** Re-publish an owned preview (candidate navigation); never creates history. */
  showPreview(id) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== "preview") throw new JobError("invalid-transition", "Only a current preview can be shown.");
    if (!this.#fresh(job)) return false;
    try { job.adapter.preview?.(job.context, job.result, job.id); this.#emit(job); return true; }
    catch (error) { this.#transition(job, "failed", errorInfo(error)); return false; }
  }
}
