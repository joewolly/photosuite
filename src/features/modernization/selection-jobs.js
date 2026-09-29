import { generationOptions, validateGenerativeConfig } from "./generative-workload.js";
import { createExpandProvider } from "./comfy-provider.js";
import { expansionGeometry, prepareExpandInput } from "./expand-workload.js";
import { captureExpandSource } from "./expand-source.js";
import { createExpandAdapter } from "./expand-target.js";
import { GenerativeSession } from "./generative-session.js";
import { createGenerativeProvider } from "./comfy-provider.js";
import { createUpscaleProvider } from "./upscale-provider.js";
import { prepareUpscaleSource, createUpscaleAdapter } from "./upscale-target.js";
/** Application-owned Quick Select sessions; providers never see this module. */
import { ModernizationJobs, JOB_TERMINAL, JobError } from "./job-service.js";
import { createQuickSelectProvider } from "./quick-select-provider.js";
import { createSelectionAdapter, requireQuickSelectSource } from "./selection-target.js";
import { getResultDocumentInfo } from "../results/result-targets.js";
import { showToast } from "../../core/user-prompts.js";
import { createComfyProvider } from "./comfy-provider.js";
import { prepareInpaintInput } from "./inpaint-workload.js";
import { requireInpaintSource, createInpaintAdapter } from "./inpaint-target.js";

import { createSubjectProvider } from "./subject-provider.js";
import { requireSubjectSource, subjectInput, createSubjectAdapter } from "./subject-target.js";
import { createPromptedProvider } from "./prompted-provider.js";
import { requirePromptedSource, promptedInput, createPromptedAdapter } from "./prompted-target.js";
import { generateUuid } from "../../core/uid.js";

function plainRect(rect) { return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }
export class SelectionJobs {
  constructor(controller, provider = createQuickSelectProvider(), mount = true, inpaintProvider = createComfyProvider(), subjectProvider = createSubjectProvider(), promptedProvider = createPromptedProvider(), upscaleProvider = createUpscaleProvider(), generativeProvider = createGenerativeProvider(), expandProvider = createExpandProvider()) {
    this.controller = controller;
    this.promptedProvider = promptedProvider;
    this.jobs = new ModernizationJobs({ "generate.expand": expandProvider, "generate.fill": generativeProvider, "enhance.upscale": upscaleProvider, "quick-select": provider, "ai-remove": inpaintProvider, "segment.subject": subjectProvider, "segment.prompted": promptedProvider });
    this.sessions = new Map();
    this.labels = new Map();
    this.subjectModes = new Map();
    this.upscalePreviews = new Map();
    this.expandPreviews = new Map();
    this.latestCheck = 0;
    this.replacing = false;
    this.generative = new GenerativeSession(this);
    this.jobs.subscribe((job) => {
      this.generative.observe(job);
      if (JOB_TERMINAL.has(job.state) && !this.replacing) {
        for (const [doc, session] of this.sessions) if (session.jobId === job.id) {
          if (session.kind === "prompted") this.releasePrompted(doc, session);
          this.sessions.delete(doc);
        }
      }
      this.render();
    });
    if (mount) {
      this.el = document.createElement("div");
      this.el.setAttribute("aria-label", "Selection and image jobs");
      Object.assign(this.el.style, { position: "absolute", bottom: "20px", left: "64px", zIndex: "20", padding: "8px", background: "#292929", color: "#eee", border: "1px solid #666", borderRadius: "5px", maxWidth: "640px" });
      controller.mainColumn.appendChild(this.el);
      this.render();
    }
  }
  submitUpscale(doc, config) {
    if (this.jobs.list().some(job => job.operation === "enhance.upscale" && (!JOB_TERMINAL.has(job.state) || job.stopping))) throw new JobError("resource-limit", "Accept, discard or finish cancelling the current AI Upscale result first.");
    const { input, sourceCaptureMs } = prepareUpscaleSource(this.controller, doc, config);
    let jobId;
    jobId = this.jobs.submit({ operation: "enhance.upscale", input, adapter: createUpscaleAdapter(this.controller, doc, input,
      (thumbnail, id, width, height) => { if (thumbnail) this.upscalePreviews.set(id, { thumbnail, width, height }); else this.upscalePreviews.delete(jobId); },
      metrics => { this.lastUpscaleMetrics = { ...this.lastUpscaleMetrics, ...metrics, jobId }; }) });
    this.lastUpscaleMetrics = { jobId, sourceCaptureMs };
    this.labels.set(this.jobs.get(jobId).documentId, doc.name || "Untitled"); this.render(); return jobId;
  }
  submitExpand(doc, config, sides, options) {
    if (this.jobs.list().some(j => ["ai-remove", "generate.fill", "generate.expand"].includes(j.operation) && (!JOB_TERMINAL.has(j.state) || j.stopping))) throw new JobError("resource-limit", "Accept, discard or finish cancelling the current generation first.");
    const settings = generationOptions({ ...options, count: options?.count ?? 1 });
    if (settings.count !== 1) throw new JobError("invalid-request", "Generative Expand retains one variation at a time.");
    validateGenerativeConfig(config);
    const start = performance.now(), geometry = expansionGeometry(doc.width, doc.height, sides);
    const context = captureExpandSource(this.controller, doc, geometry);
    const { input } = prepareExpandInput(context.pixels, geometry, config, settings);
    let id;
    id = this.jobs.submit({ operation: "generate.expand", input, adapter: createExpandAdapter(this.controller, context,
      (preview, jobId) => { if (preview) this.expandPreviews.set(jobId, { ...preview, seed: input.seed }); else this.expandPreviews.delete(id); },
      metrics => { this.lastExpandMetrics = { ...this.lastExpandMetrics, ...metrics }; }) });
    this.lastExpandMetrics = { preparationMs: performance.now() - start, geometry, seed: input.seed };
    this.labels.set(this.jobs.get(id).documentId, doc.name || "Untitled"); this.render(); return id;
  }
  submitGenerative(doc, config, options) { return this.generative.start(doc, config, options); }
  submitAI(doc, config) {
    if (this.jobs.list().some((job) => ["ai-remove", "generate.fill", "generate.expand"].includes(job.operation) && (!JOB_TERMINAL.has(job.state) || job.stopping))) throw new JobError("resource-limit", "Accept, discard or finish cancelling the current AI Remove result first.");
    const layer = requireInpaintSource(doc);
    const { input, coverage } = prepareInpaintInput(layer, doc.selectionMask, doc.width, doc.height, config);
    const id = this.jobs.submit({ operation: "ai-remove", input, adapter: createInpaintAdapter(this.controller, doc, layer, input.rect, coverage) });
    this.labels.set(this.jobs.get(id).documentId, doc.name || "Untitled");
    this.render();
    return id;
  }
  submitSubject(doc, remove = false) {
    const layer = requireSubjectSource(doc, remove), start = performance.now();
    const prior = this.sessions.get(doc), session = { kind: "subject", layer, token: prior?.token || this.jobs.createSession(), jobId: null };
    if (prior?.kind === "prompted") this.releasePrompted(doc, prior);
    this.replacing = true;
    try {
      session.jobId = this.jobs.submit({ operation: "segment.subject", input: subjectInput(doc, layer), session: session.token,
        adapter: createSubjectAdapter(this.controller, doc, layer, remove, (metrics) => {
          this.lastSubjectMetrics = { ...this.lastSubjectMetrics, ...metrics, jobId: session.jobId };
        }) });
      this.sessions.set(doc, session);
      this.subjectModes.set(session.jobId, remove);
      this.labels.set(this.jobs.get(session.jobId).documentId, doc.name || "Untitled");
      this.lastSubjectMetrics = { jobId: session.jobId, inputPreparationMs: performance.now() - start };
      this.render();
      return session.jobId;
    } finally { this.replacing = false; }
  }
  begin(doc, mode) {
    const layer = requireQuickSelectSource(doc);
    let session = this.sessions.get(doc);
    if (session && (session.kind === "subject" || session.kind === "prompted" || session.layer !== layer || mode === 0 || session.jobId && !this.jobs.revalidate(session.jobId))) {
      if (session.jobId) this.jobs.cancel(session.jobId);
      this.sessions.delete(doc); session = null;
    }
    if (!session) {
      session = { layer, token: this.jobs.createSession(), strokes: [], replace: mode === 0, jobId: null };
      this.sessions.set(doc, session);
    }
    return layer.rect.clone();
  }
  abandonGesture(doc) {
    if (!this.sessions.get(doc)?.jobId) this.sessions.delete(doc);
  }
  releasePrompted(doc, session) {
    this.promptedProvider.releaseSession?.(session.sessionId);
    doc.toolOverlayState.objectSelectionPrompts = null; doc.dirty = true;
  }
  resetPrompted(doc) {
    const session = this.sessions.get(doc);
    if (session?.kind !== "prompted") return;
    if (session.jobId) this.jobs.cancel(session.jobId);
    if (this.sessions.get(doc) === session) { this.releasePrompted(doc, session); this.sessions.delete(doc); }
    this.render();
  }
  submitPrompt(doc, prompt) {
    const layer = requirePromptedSource(doc);
    let session = this.sessions.get(doc);
    if (session?.kind === "prompted" && (session.layer !== layer || session.jobId && !this.jobs.revalidate(session.jobId))) {
      this.resetPrompted(doc);
      throw new JobError("stale-result", "The source changed. Click again to start a new Object Selection session.");
    }
    if (session?.kind !== "prompted") {
      if (session?.jobId) this.jobs.cancel(session.jobId);
      // One active M4 source in the application bounds embeddings and retained pixels.
      for (const [other, active] of this.sessions) if (active.kind === "prompted") this.resetPrompted(other);
      session = { kind: "prompted", layer, token: this.jobs.createSession(), sessionId: generateUuid(), points: [], box: null, jobId: null };
    }
    const points = prompt.kind === "box" ? session.points.slice() : [...session.points, { kind: prompt.kind, x: prompt.x, y: prompt.y }];
    const box = prompt.kind === "box" ? { x: prompt.x, y: prompt.y, width: prompt.width, height: prompt.height } : session.box;
    const start = performance.now();
    this.replacing = true;
    try {
      session.jobId = this.jobs.submit({ operation: "segment.prompted", input: promptedInput(doc, layer, session.sessionId, points, box), session: session.token,
        adapter: createPromptedAdapter(this.controller, doc, layer, session.sessionId, (metrics) => { this.lastPromptedMetrics = { ...this.lastPromptedMetrics, ...metrics, jobId: session.jobId }; }) });
      session.points = points; session.box = box; this.sessions.set(doc, session);
      doc.toolOverlayState.objectSelectionPrompts = { points, box }; doc.dirty = true;
      this.lastPromptedMetrics = { jobId: session.jobId, inputPreparationMs: performance.now() - start };
      this.labels.set(this.jobs.get(session.jobId).documentId, doc.name || "Untitled"); this.render();
      return session.jobId;
    } finally { this.replacing = false; }
  }
  submitStroke(doc, stroke) {
    const session = this.sessions.get(doc);
    if (!session || requireQuickSelectSource(doc) !== session.layer) throw new JobError("stale-result", "The source layer changed. Rerun Quick Select.");
    if (session.jobId && !this.jobs.revalidate(session.jobId)) throw new JobError("stale-result", "The source changed. Rerun Quick Select.");
    const layer = session.layer;
    const selection = session.replace ? null : doc.selectionMask;
    const input = { rect: plainRect(layer.rect), rgba: layer.buffer,
      base: selection ? { rect: plainRect(selection.rect), channel: selection.channel.subarray(0, selection.rect.area()) } : null,
      strokes: [...session.strokes, stroke] };
    const started = performance.now();
    this.replacing = true;
    try {
      session.jobId = this.jobs.submit({ operation: "quick-select", input, session: session.token,
        adapter: createSelectionAdapter(this.controller, doc, layer) });
      session.strokes.push(stroke);
      const view = this.jobs.get(session.jobId);
      if (JOB_TERMINAL.has(view.state)) this.sessions.delete(doc);
      this.labels.set(view.documentId, doc.name || "Untitled");
      this.lastPreparationMs = performance.now() - started;
      this.render();
      return session.jobId;
    } catch (error) {
      if (!session.jobId) this.sessions.delete(doc);
      throw error;
    } finally { this.replacing = false; }
  }
  close(doc) {
    if (!doc) return;
    this.jobs.closeDocument(getResultDocumentInfo(doc).documentId);
    const session = this.sessions.get(doc);
    if (session?.kind === "prompted") this.releasePrompted(doc, session);
    this.sessions.delete(doc);
  }
  tick(now = performance.now()) {
    if (now - this.latestCheck < 500) return;
    this.latestCheck = now;
    for (const job of this.jobs.list()) if (!JOB_TERMINAL.has(job.state)) this.jobs.revalidate(job.id);
    this.render();
  }
  render() {
    if (!this.el) return;
    const latest = new Map();
    for (const id of this.subjectModes.keys()) if (!this.jobs.get(id)) this.subjectModes.delete(id);
    for (const job of this.jobs.list()) if (job.operation !== "generate.fill") latest.set(job.documentId + job.operation, job);
    for (const id of this.labels.keys()) if (![...latest.values()].some((job) => job.documentId === id)) this.labels.delete(id);
    const live = [...latest.values()].filter((job) => !JOB_TERMINAL.has(job.state));
    const recent = [...latest.values()].filter((job) => JOB_TERMINAL.has(job.state));
    const remaining = 3 - live.length;
    const rows = [...live, ...(remaining ? recent.slice(-remaining) : [])];
    const gen = this.generative.current;
    const signature = JSON.stringify([rows, gen && [gen.ids.map(id => this.jobs.get(id)), gen.selected], this.generative.notice]);
    if (signature === this.rendered) return;
    this.rendered = signature;
    this.el.replaceChildren();
    this.el.hidden = !rows.length && !gen && !this.generative.notice;
    this.renderGenerative();
    for (const job of rows) {
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", alignItems: "center", gap: "8px", minHeight: "28px" });
      const label = document.createElement("span");
      label.setAttribute("role", "status");
      const states = { queued: "Queued", preparing: "Preparing", running: job.progress.stage, preview: job.operation === "quick-select" ? "Ready to preview — paint to refine" : "Ready — review result", committed: "Accepted", discarded: "Discarded", cancelled: job.stopping ? "Cancelled — waiting for workload to stop" : "Cancelled", stale: "Source changed — rerun", failed: job.error?.message || "Failed" };
      const numeric = job.progress.kind === "numeric" && job.state === "running" ? ` (${job.progress.completed}/${job.progress.total})` : "";
      label.textContent = `${job.operation === "generate.expand" ? "Generative Expand" : job.operation === "enhance.upscale" ? "AI Upscale 4×" : job.operation === "ai-remove" ? "AI Remove" : job.operation === "segment.prompted" ? "Object Selection" : job.operation === "segment.subject" ? (this.subjectModes.get(job.id) ? "Remove Background" : "Select Subject") : "Quick Select"} · ${this.labels.get(job.documentId) || "Document"} · ${states[job.state]}${numeric}`;
      if (job.error) label.title = job.error.message;
      row.appendChild(label);
      const button = (text, action) => {
        const el = document.createElement("button"); el.textContent = text;
        el.addEventListener("click", () => { try { action(); } catch (error) { showToast(error.message); } });
        row.appendChild(el);
      };
      if (job.state === "preview") { button("Accept", () => this.jobs.accept(job.id)); button("Discard", () => this.jobs.discard(job.id)); }
      else if (!JOB_TERMINAL.has(job.state)) button("Cancel", () => this.jobs.cancel(job.id));
      this.el.appendChild(row);
      const expanded = this.expandPreviews.get(job.id);
      if (expanded && job.state === "preview") {
        const { geometry: g, bytes } = expanded, canvas = document.createElement("canvas");
        canvas.width = g.newWidth; canvas.height = g.newHeight;
        canvas.style.maxWidth = "560px"; canvas.style.maxHeight = "320px"; canvas.style.objectFit = "contain";
        canvas.style.background = "repeating-conic-gradient(#777 0% 25%, #bbb 0% 50%) 0 / 16px 16px";
        canvas.setAttribute("aria-label", `Expanded preview ${g.newWidth} × ${g.newHeight}; cyan boundary protects original content`);
        const ctx = canvas.getContext("2d"); ctx.putImageData(new ImageData(bytes, g.newWidth, g.newHeight), 0, 0);
        ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 1; ctx.strokeRect(g.left + 0.5, g.top + 0.5, g.width - 1, g.height - 1);
        this.el.appendChild(canvas);
        const size = document.createElement("div"); size.textContent = `${g.width} × ${g.height} → ${g.newWidth} × ${g.newHeight} · Seed ${expanded.seed} · Cyan: protected original bounds · Accept expands canvas`; this.el.appendChild(size);
      }
      const preview = this.upscalePreviews.get(job.id);
      if (preview && job.state === "preview") {
        const canvas = document.createElement("canvas"), { thumbnail } = preview;
        canvas.width = thumbnail.width; canvas.height = thumbnail.height;
        canvas.style.background = "repeating-conic-gradient(#777 0% 25%, #bbb 0% 50%) 0 / 16px 16px";
        canvas.setAttribute("aria-label", `AI Upscale preview; full result ${preview.width} × ${preview.height}`);
        canvas.getContext("2d").putImageData(new ImageData(thumbnail.rgba, thumbnail.width, thumbnail.height), 0, 0);
        this.el.appendChild(canvas);
        const size = document.createElement("div"); size.textContent = `${preview.width} × ${preview.height} · Accept opens new document`; this.el.appendChild(size);
      }
    }
  }
  renderGenerative() {
    const session = this.generative.current, row = document.createElement("div");
    Object.assign(row.style, { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", maxWidth: "620px" });
    const status = document.createElement("span"); status.setAttribute("role", "status"); row.appendChild(status);
    if (!session) { status.textContent = this.generative.notice; if (this.generative.notice) this.el.appendChild(row); return; }
    const ready = this.generative.ready(), active = this.jobs.get(session.ids.at(-1));
    status.textContent = `Generative Fill · ${session.doc.name || "Untitled"} · ${ready ? `Variation ${session.selected + 1}/${session.ids.length} · Seed ${session.seeds[session.selected]}` : `${active?.progress.stage || "Preparing"} · ${session.ids.length}/${session.settings.count}`}`;
    const button = (label, fn) => { const el = document.createElement("button"); el.textContent = label; el.addEventListener("click", () => { try { fn(); } catch (error) { showToast(error.message); } }); row.appendChild(el); };
    if (ready) {
      for (let index = 0; index < session.ids.length; index++) button(String.fromCharCode(65 + index), () => this.generative.select(index));
      button("Accept", () => this.generative.accept());
      button("Discard", () => this.generative.release());
      button("Regenerate", () => this.generative.regenerate());
      button("Reuse seeds", () => this.generative.regenerate(true));
    } else button("Cancel", () => this.generative.release("Cancelled. Regenerate session ended."));
    this.el.appendChild(row);
  }

}
