/** Bounded recipe/candidate coordination over M1 jobs; never a second job state machine. */
import { captureRecipeSource, createGenerationRecipe } from "../../document/formats/metadata/generation-recipes.js";
import { JOB_TERMINAL, JobError } from "./job-service.js";
import { requireInpaintSource, createInpaintAdapter } from "./inpaint-target.js";
import { prepareGenerativeInput, GENERATIVE_WORKFLOW } from "./generative-workload.js";

export class GenerativeSession {
  constructor(bridge) { this.bridge = bridge; this.current = null; this.notice = ""; }
  get jobs() { return this.bridge.jobs; }
  ready(session = this.current) {
    return !!session && !session.provenancePending && session.ids.length === session.settings.count && session.ids.every(id => this.jobs.get(id)?.state === "preview");
  }
  start(doc, config, options) {
    if (this.current || this.jobs.list().some(j => ["ai-remove", "generate.fill"].includes(j.operation) && (!JOB_TERMINAL.has(j.state) || j.stopping))) throw new JobError("resource-limit", "Accept, discard or finish cancelling the current masked generation first.");
    const started = performance.now(), layer = requireInpaintSource(doc, "Generative Fill");
    const prepared = prepareGenerativeInput(layer, doc.selectionMask, doc.width, doc.height, config, options);
    const session = { doc, layer, ...prepared, ids: [], selected: 0, seeds: [], completedAt: [], provenancePending: true, workflow: GENERATIVE_WORKFLOW };
    this.current = session; this.notice = "";
    session.provenanceReady = captureRecipeSource(doc, layer).then(value => {
      if (this.current === session) session.provenance = value;
    }).catch(() => { session.provenanceFailed = true; }).finally(() => {
      session.provenancePending = false;
      if (this.current === session) this.bridge.render();
    });
    this.metrics = { preparationMs: performance.now() - started, candidates: [] };
    try { this.next(session); } catch (error) { this.release(error.message); throw error; }
    return session.ids[0];
  }
  next(session) {
    if (this.current !== session) return;
    // Prior candidates must still carry valid authority before another expensive job.
    for (const id of session.ids) if (!this.jobs.revalidate(id)) return;
    const index = session.ids.length, seed = (session.settings.seed + index) >>> 0;
    const base = createInpaintAdapter(this.bridge.controller, session.doc, session.layer, session.input.rect, session.coverage, "Generative Fill");
    const adapter = { ...base,
      preview: (context, result, id) => {
        const start = performance.now(); base.preview(context, result, id);
        session.completedAt[index] ??= new Date().toISOString();
        this.metrics.candidates[index] = { seed, bytes: result.byteLength, previewMs: performance.now() - start };
      },
      commit: (context, result) => {
        if (this.current !== session || !this.ready(session) || session.selected !== index) throw new JobError("invalid-transition", "Only the chosen completed variation can be accepted.");
        const start = performance.now(); base.commit(context, result, createGenerationRecipe(session, index)); session.provenanceFailed ||= !!context.provenanceFailed; this.metrics.acceptMs = performance.now() - start;
      },
    };
    const id = this.jobs.submit({ operation: "generate.fill", input: { ...session.input, seed }, adapter });
    session.ids.push(id); session.seeds.push(seed); session.selected = index;
    this.bridge.labels.set(this.jobs.get(id).documentId, session.doc.name || "Untitled");
    this.bridge.render();
  }
  observe(job) {
    const session = this.current;
    if (!session || !session.ids.includes(job.id)) return;
    if (JOB_TERMINAL.has(job.state)) {
      const message = job.state === "committed" ? (session.provenanceFailed ? "Pixels accepted. Generation provenance could not be attached; it will not be saved." : "Accepted with generation provenance. Regenerate session ended.") : job.state === "stale" ? "Source or selection changed. Regenerate unavailable; make a new selection and run again." : job.error?.message || "Discarded. Regenerate session ended.";
      this.release(message); return;
    }
    if (job.state === "preview" && job.id === session.ids.at(-1) && session.ids.length < session.settings.count && !session.scheduled) {
      session.scheduled = true;
      queueMicrotask(() => {
        session.scheduled = false;
        if (this.current !== session) return;
        try { this.next(session); } catch (error) { this.release(error.message); }
      });
    }
  }
  select(index) {
    const session = this.current;
    if (!this.ready(session) || !Number.isInteger(index) || index < 0 || index >= session.ids.length) throw new JobError("invalid-transition", "Wait for the variations to finish.");
    const started = performance.now(); session.selected = index;
    const shown = this.jobs.showPreview(session.ids[index]);
    this.metrics.switchMs = performance.now() - started; this.bridge.render(); return shown;
  }
  accept() {
    const session = this.current;
    if (!this.ready(session)) throw new JobError("invalid-transition", "Wait for the variations to finish.");
    return this.jobs.accept(session.ids[session.selected]);
  }
  regenerate(reuseSeed = false) {
    const session = this.current;
    if (!this.ready(session)) throw new JobError("invalid-transition", "Regenerate requires a still-valid preview session.");
    for (const id of session.ids) if (!this.jobs.revalidate(id)) throw new JobError("stale-result", "Source or selection changed. Regenerate unavailable.");
    const { doc, input, settings } = session;
    const options = { ...settings, seed: reuseSeed ? settings.seed : null };
    this.release("");
    return this.start(doc, input.config, options);
  }
  release(message = "Discarded. Regenerate session ended.") {
    const session = this.current; this.current = null; this.notice = message;
    if (session) {
      for (const id of session.ids) {
        if (this.jobs.get(id)?.state === "preview") this.jobs.discard(id);
        else this.jobs.cancel(id);
      }
      session.input = session.coverage = session.doc = session.layer = session.settings = session.provenance = null;
      session.seeds.length = 0;
    }
    this.bridge.render();
  }
}
