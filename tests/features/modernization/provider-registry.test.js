import assert from "node:assert/strict";
import { before, it } from "node:test";
import { createHash } from "node:crypto";
import { AIProviderRegistry } from "../../../src/features/modernization/provider-registry.js";
import { AI_CAPABILITIES as C } from "../../../src/features/modernization/ai-capabilities.js";
import { createAIProviders, prepareComfyMasked } from "../../../src/features/modernization/ai-providers.js";
import { COMFY_PROVIDER_ID, GENERATIVE_MODEL, UPSCALE_MODEL, legacyProviderSelection } from "../../../src/features/modernization/comfy-config.js";
import { ModernizationJobs, JobError } from "../../../src/features/modernization/job-service.js";
import { startComfyRequest } from "../../../src/features/modernization/comfy-request.js";
import { prepareInpaintInput, prepareInpaintSnapshot } from "../../../src/features/modernization/inpaint-workload.js";
import { expansionGeometry, prepareExpandInput, prepareExpandSnapshot } from "../../../src/features/modernization/expand-workload.js";
import { flushJobs } from "./fake-provider.js";
import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
import { installXmlDom } from "../../helpers/xml-dom.js";
installBrowserGlobals(); installXmlDom();
const config = { enabled: true, endpoint: "http://127.0.0.1:8188", checkpoint: GENERATIVE_MODEL };
const selection = { providerId: "replacement", configuration: { revision: "one" } };
function input() { return { rect: { x: 1, y: 2, width: 3, height: 5 }, rgba: new Uint8Array(60).fill(128), mask: new Uint8Array(15).fill(255), seed: 42, prompt: "" }; }
function output(a = input()) { return { pixelFormat: "rgba8", rect: { ...a.rect }, byteLength: a.rgba.length, bytes: new Uint8Array(a.rgba.length).fill(203) }; }
function replacement(capabilities = [C.remove, C.fill, C.expand, C.upscale]) {
  const calls = [], disposed = [], checks = [];
  const handler = {
    support: { inputAlpha: true, outputAlpha: "rgba8", nativeAlpha: true },
    configure(value) { if (!value?.revision) throw new JobError("invalid-provider-configuration", "Missing revision."); return { revision: value.revision }; },
    describe: value => ({ model: "other-model", revision: value.revision }),
    check: async value => { checks.push(value); return { ready: true, version: "one", model: "other-model" }; },
    start(a, configuration, callbacks, identity) { const call = { input: a, configuration, ...callbacks, ...identity, cancels: 0 }; calls.push(call); return () => { call.cancels++; return false; }; },
    disposeResult: value => disposed.push(value),
  };
  const provider = { id: "replacement", label: "Detached producer", capabilities: Object.fromEntries(capabilities.map(c => [c, { ...handler }])) };
  return { calls, disposed, checks, provider, registry: new AIProviderRegistry([provider], Object.fromEntries(capabilities.map(c => [c, provider.id]))) };
}
function adapter() {
  const state = { captures: 0, commits: 0, disposals: 0, previews: 0, stale: false };
  return { state, capture: () => { state.captures++; return { documentId: "document-one" }; }, validate: () => { if (state.stale) throw new JobError("stale-result", "Source changed."); },
    preview: (_, result) => { state.previews++; state.result = result; }, commit: () => { state.commits++; }, dispose: () => { state.disposals++; state.result = null; } };
}
it("registration rejects duplicate identifiers, missing methods and unknown capabilities", () => {
  const f = replacement();
  for (const providers of [[f.provider, f.provider], [{ id: "" }], [{ id: "bad", capabilities: { [C.fill]: {} } }], [{ id: "bad", capabilities: { imaginary: {} } }]]) assert.throws(() => new AIProviderRegistry(providers), e => e.code === "invalid-provider-registration");
});
it("discovery is explicit, immutable and does not probe any backend", async () => {
  const f = replacement([C.fill]), found = f.registry.discover();
  assert.deepEqual(found[0].capabilities, [C.fill]); assert.equal(found[0].support[C.fill].nativeAlpha, true); assert.equal(f.checks.length, 0);
  assert.throws(() => found[0].capabilities.push(C.expand)); assert.throws(() => { found[0].support[C.fill].nativeAlpha = false; });
  f.provider.capabilities[C.fill].start = () => { throw Error("mutated descriptor"); };
  const jobs = new ModernizationJobs({ [C.fill]: f.registry.port(C.fill) }); const id = jobs.submit({ operation: C.fill, input: f.registry.request(C.fill, selection, input()), adapter: adapter() });
  await flushJobs(); assert.equal(f.calls.length, 1); jobs.cancel(id); f.calls[0].fail(new JobError("cancellation", "Cleanup."));
});
it("missing bindings/providers and unsupported capabilities fail before capture/execution without fallback", async () => {
  const f = replacement([C.fill]), jobs = new ModernizationJobs({ [C.fill]: f.registry.port(C.fill) }), a = adapter();
  for (const [capability, selected, code] of [[C.remove, selection, "unsupported-capability"], [C.edit, selection, "unsupported-capability"], [C.reference, selection, "unsupported-capability"], [C.fill, { ...selection, providerId: "missing" }, "missing-provider"], ["imaginary", selection, "unsupported-capability"]]) assert.throws(() => f.registry.request(capability, selected, input()), e => e.code === code);
  assert.throws(() => new AIProviderRegistry([f.provider]).resolve(C.fill, { configuration: selection.configuration }), e => e.code === "missing-provider");
  assert.throws(() => jobs.submit({ operation: C.fill, input: { providerId: "missing", configuration: {}, input: input() }, adapter: a }));
  await flushJobs(); assert.equal(a.state.captures, 0); assert.equal(f.calls.length, 0);
});
it("resolution reports configuration/profile and readiness remains unchecked until explicit check", async () => {
  const f = replacement([C.fill]);
  const resolved = f.registry.resolve(C.fill, { configuration: selection.configuration });
  assert.equal(resolved.providerId, "replacement"); assert.equal(resolved.configured, true); assert.equal(resolved.availability, "unchecked"); assert.equal(f.checks.length, 0);
  const ready = await f.registry.check(C.fill, selection); assert.equal(ready.availability, "available"); assert.equal(ready.model, "other-model"); assert.equal(f.checks.length, 1);
  assert.equal(f.registry.inspect(C.fill, { providerId: "missing" }).error.code, "missing-provider");
  assert.equal(f.registry.inspect(C.fill, { configuration: {} }).error.code, "invalid-provider-configuration");
});
it("unavailable providers and provider-specific preflight failures propagate", async () => {
  const f = replacement([C.fill]); f.provider.capabilities[C.fill].check = async () => ({ ready: false });
  const registry = new AIProviderRegistry([f.provider], { [C.fill]: "replacement" });
  await assert.rejects(registry.check(C.fill, selection), e => e.code === "provider-unavailable");
  f.provider.capabilities[C.fill].check = async () => { throw new JobError("missing-weights", "Install the configured weights."); };
  await assert.rejects(new AIProviderRegistry([f.provider]).check(C.fill, selection), e => e.code === "missing-weights");
});
it("configuration and input eligibility are rejected before snapshots or provider work", async () => {
  const f = replacement([C.fill]); f.provider.capabilities[C.fill].validateInput = () => { throw new JobError("unsupported-image", "Unsupported input class."); };
  const registry = new AIProviderRegistry([f.provider]), jobs = new ModernizationJobs({ [C.fill]: registry.port(C.fill) }), a = adapter();
  for (const configuration of [null, {}, { revision: () => {} }, { revision: new Uint8Array(1) }]) assert.throws(() => registry.resolve(C.fill, { providerId: "replacement", configuration }));
  assert.throws(() => jobs.submit({ operation: C.fill, input: { ...selection, input: input() }, adapter: a }), e => e.code === "unsupported-image");
  assert.throws(() => f.registry.request(C.fill, selection, { ...input(), rgba: new Uint8Array(1) }));
  await flushJobs(); assert.equal(a.state.captures, 0); assert.equal(f.calls.length, 0);
});
it("unknown input fields cannot carry document, model or transport authority across the capability boundary", () => {
  const f = replacement();
  for (const key of ["document", "config", "modelWidth", "workflow", "invoke", "history"]) assert.throws(() => f.registry.request(C.fill, selection, { ...input(), [key]: {} }), e => e.code === "invalid-request");
  assert.throws(() => f.registry.request(C.fill, selection, { ...input(), rect: { ...input().rect, document: {} } }));
  assert.equal(f.calls.length, 0);
});
it("upscale timing metadata retains only named finite measurements", () => {
  const f = replacement(), port = f.registry.port(C.upscale), raster = { width: 4, height: 4, scale: 4, pixelFormat: "rgba8", bytes: new Uint8Array(64) };
  const result = port.copyResult({ providerId: "replacement", output: { ...raster, timings: { alphaMs: 1, transportMs: 2, document: {} } } });
  assert.deepEqual(result.timings, { transportMs: 2, alphaMs: 1 });
  for (const alphaMs of [-1, Infinity, {}, "one"]) assert.throws(() => port.copyResult({ providerId: "replacement", output: { ...raster, timings: { alphaMs } } }), e => e.code === "malformed-result");
});
it("queued requests pin configuration and M1 copies pixels; later settings changes cannot retarget work", async () => {
  const f = replacement([C.fill]), jobs = new ModernizationJobs({ [C.fill]: f.registry.port(C.fill) }), a = input(), choice = { ...selection, configuration: { revision: "original" } };
  const request = f.registry.request(C.fill, choice, a); const id = jobs.submit({ operation: C.fill, input: request, adapter: adapter() });
  choice.configuration.revision = "changed"; a.rgba.fill(0); await flushJobs();
  assert.equal(f.calls[0].configuration.revision, "original"); assert.equal(f.calls[0].input.rgba[0], 128); assert.equal(f.calls[0].input.config, undefined); assert.equal(f.calls[0].input.modelWidth, undefined);
  jobs.cancel(id); f.calls[0].complete(output());
});
for (const action of ["cancel", "stale", "close", "supersede", "failure", "discard", "accept"]) it(`registry port preserves M1 ${action}, terminal cleanup and late-result disposal`, async () => {
  const f = replacement([C.fill]), jobs = new ModernizationJobs({ [C.fill]: f.registry.port(C.fill) }), a = adapter(), session = jobs.createSession();
  const submit = () => jobs.submit({ operation: C.fill, input: f.registry.request(C.fill, selection, input()), adapter: a, session });
  const id = submit(); await flushJobs(); const call = f.calls[0], raw = output();
  if (action === "cancel") jobs.cancel(id);
  if (action === "stale") { a.state.stale = true; jobs.revalidate(id); }
  if (action === "close") jobs.closeDocument("document-one");
  if (action === "supersede") submit();
  if (action === "failure") call.fail(new JobError("model-crash", "Model crashed."));
  else call.complete(raw);
  if (["discard", "accept"].includes(action)) {
    assert.equal(jobs.get(id).state, "preview"); assert.notEqual(a.state.result.bytes, raw.bytes); raw.bytes.fill(0); assert.equal(a.state.result.bytes[0], 203);
    if (action === "discard") jobs.discard(id); else assert.equal(jobs.accept(id), true);
  }
  const expected = { cancel: "cancelled", stale: "stale", close: "cancelled", supersede: "cancelled", failure: "failed", discard: "discarded", accept: "committed" }[action];
  assert.equal(jobs.get(id).state, expected); assert.equal(jobs.get(id).hasInput, false); assert.equal(jobs.get(id).hasResult, false); assert.equal(a.state.commits, action === "accept" ? 1 : 0);
  if (action === "failure") assert.equal(jobs.get(id).error.code, "model-crash");
  const late = output(); call.complete(late); assert.ok(f.disposed.includes(late)); assert.equal(jobs.get(id).state, expected);
  await flushJobs(); for (const job of jobs.list()) jobs.cancel(job.id); f.calls.at(-1)?.fail(new JobError("cancellation", "Cleanup."));
});
it("malformed output cannot publish a preview or mutate an adapter", async () => {
  const f = replacement([C.fill]), jobs = new ModernizationJobs({ [C.fill]: f.registry.port(C.fill) }), a = adapter();
  const id = jobs.submit({ operation: C.fill, input: f.registry.request(C.fill, selection, input()), adapter: a }); await flushJobs();
  f.calls[0].complete({ ...output(), bytes: new Uint8Array(1) }); assert.equal(jobs.get(id).state, "failed"); assert.equal(a.state.previews, 0); assert.equal(a.state.commits, 0); assert.equal(f.disposed.length, 1);
});
it("late backend status cannot overwrite local output assembly; cancellation stays active until settlement", async () => {
  const stages = [], aborted = new AbortController(); let releaseStatus, sawStatus, done;
  const polled = new Promise(resolve => { sawStatus = resolve; }), finished = new Promise(resolve => { done = resolve; });
  const invoke = command => {
    if (command === "comfy_status") { sawStatus(); return new Promise(resolve => { releaseStatus = resolve; }); }
    return Promise.resolve();
  };
  startComfyRequest(invoke, { signal: aborted.signal, progress: p => stages.push(p.stage), complete: done, fail: done }, async (_, check, poll, stopPolling) => {
    poll(); await polled; stopPolling(); stages.push("Restoring transparency"); releaseStatus({ stage: "Generating" }); await flushJobs(); aborted.abort(); check();
  });
  const error = await finished; assert.equal(error.code, "cancellation"); assert.deepEqual(stages, ["Preparing", "Restoring transparency"]);
});
it("ComfyUI capability declarations retain four workflows, independent enable/model settings and alpha adaptation", () => {
  const registry = createAIProviders(), found = registry.discover()[0]; assert.equal(found.id, COMFY_PROVIDER_ID); assert.deepEqual([...found.capabilities].sort(), [C.remove, C.fill, C.expand, C.upscale].sort());
  for (const c of [C.remove, C.fill, C.expand, C.upscale]) {
    const selected = legacyProviderSelection(c, config), resolved = registry.resolve(c, selected);
    assert.equal(resolved.support.inputAlpha, true); assert.equal(resolved.support.nativeAlpha, false); assert.equal(resolved.configuration.endpoint, config.endpoint);
    assert.equal(resolved.profile.workflow, { [C.remove]: "photosuite-remove-v1", [C.fill]: "photosuite-generative-fill-v1", [C.expand]: "photosuite-generative-expand-v1", [C.upscale]: "photosuite-upscale-v1" }[c]);
  }
  assert.throws(() => registry.resolve(C.remove, legacyProviderSelection(C.remove, { ...config, enabled: false })));
  for (const c of [C.fill, C.expand, C.upscale]) assert.doesNotThrow(() => registry.resolve(c, legacyProviderSelection(c, { ...config, enabled: false, checkpoint: "unrelated.ckpt" })));
  assert.equal(registry.resolve(C.upscale, legacyProviderSelection(C.upscale, config)).configuration.model, UPSCALE_MODEL);
  assert.throws(() => registry.resolve(C.fill, legacyProviderSelection(C.fill, config, "other.ckpt")));
});
for (const endpoint of ["http://localhost:8188", "https://127.0.0.1:8188", "http://127.1:8188", "http://2130706433:8188", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:8188/path", "http://127.0.0.1:8188?q=x", "http://user@127.0.0.1:8188", "http://10.0.0.1:8188"]) it(`registry rejects endpoint ${endpoint} for every capability before IPC`, async () => {
  let invoked = 0; const registry = createAIProviders({ invoke: () => { invoked++; } });
  for (const c of [C.remove, C.fill, C.expand, C.upscale]) await assert.rejects(registry.check(c, legacyProviderSelection(c, { ...config, endpoint })));
  assert.equal(invoked, 0);
});
it("neutral snapshots adapt byte-exactly to legacy padding/masks/prompts for odd and boundary dimensions", () => {
  // Captured by executing the released 1e1421db preparation code, before this refactor.
  const baselineRGB = ["86cce9ca72d3153e0d8d5aaa60613cd99996091348fd14eb4ab57d386af67c22", "7907062e7973bc76c49d0bf0253c75e331399a23a264e1cf566a16dbc5b6693c", "245cabef80ea3173fd03b530b56a4c0d8be173feadf16f32f6065e02d4f3b20e", "a4901f35d381a7ebad650fc6c33936a093f09840a29e1cd0250960447f2c2102"];
  const hash = bytes => createHash("sha256").update(bytes).digest("hex"); let index = 0;
  for (const [width, height] of [[3, 5], [320, 256], [513, 511], [1024, 1024]]) {
    const layer = { rect: { x: 0, y: 0, width, height }, buffer: Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 251) };
    const mask = { rect: { x: 0, y: 0, width: 3, height: 5 }, channel: new Uint8Array(16).fill(127) };
    const legacy = prepareInpaintInput(layer, mask, width, height, config, 42), neutral = prepareInpaintSnapshot(layer, mask, width, height, 42);
    assert.deepEqual(prepareComfyMasked(neutral.input, config), legacy.input); assert.deepEqual(neutral.coverage, legacy.coverage);
    assert.equal(hash(legacy.input.rgba), baselineRGB[index++]);
    assert.equal(hash(legacy.input.mask), "83119c900d68cfae3e57a2b9203a4f12edfde518d491a9e60461b754dc829fac");
  }
  const g = expansionGeometry(3, 5, { left: 7, top: 9, right: 11, bottom: 13 }), source = new Uint8Array(60).fill(127), options = { prompt: " 猫\n ", count: 1, seed: 42 };
  assert.deepEqual(prepareComfyMasked(prepareExpandSnapshot(source, g, options).input, config), prepareExpandInput(source, g, config, options).input);
  const padded = prepareComfyMasked(prepareExpandSnapshot(source, g, options).input, config);
  assert.equal(hash(padded.rgba), "01af75f29fcdafd0156ec8442b56b71f14110d2eef55464f5d27561af28d31e1");
  assert.equal(hash(padded.mask), "e6329ebb7e14fd847724402d9faa1244bfc600887dc7e9c936e9448bbf69e2f3");
});

let Document, Rect, SelectionJobs, History;
before(async () => {
  ({ Document } = await import("../../../src/document/model/document.js")); ({ Rect } = await import("../../../src/core/math/rect.js"));
  ({ SelectionJobs } = await import("../../../src/features/modernization/selection-jobs.js"));
  const { TrackerRegistry } = await import("../../../src/features/trackers/tracker-registry.js"); History = TrackerRegistry.History;
  const { LayerSystem } = await import("../../../src/engine/layer-system.js"); LayerSystem.webglEnabled = false;
});
it("multi-candidate Fill and Regenerate pin the resolved provider configuration across caller mutation", async () => {
  const f = replacement(), doc = new Document("pinned.psd"); doc.width = 8; doc.height = 6;
  const layer = doc.newLayer(); layer.rect = new Rect(0, 0, 8, 6); layer.buffer = new Uint8Array(192).fill(255);
  doc.setLayers([layer]); doc.selectedLayerIndices = [0]; doc.buffer = layer.buffer.slice();
  doc.selectionMask = { rect: new Rect(2, 2, 3, 2), channel: new Uint8Array(8).fill(255) };
  const controller = { openDocs: [doc], getCurrentDoc: () => doc, pointerState: { isDown: false } };
  const bridge = new SelectionJobs(controller, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, f.registry);
  const choice = { providerId: "replacement", configuration: { revision: "original" } };
  bridge.submitGenerative(doc, choice, { prompt: "", count: 2, seed: 42 }); await flushJobs();
  const pinned = bridge.generative.current.selection; choice.configuration.revision = "changed"; choice.providerId = "missing";
  assert.equal(Object.isFrozen(pinned), true); assert.equal(Object.isFrozen(pinned.configuration), true);
  f.calls[0].complete(output(f.calls[0].input)); await flushJobs(); assert.equal(f.calls[1].configuration.revision, "original");
  f.calls[1].complete(output(f.calls[1].input)); await bridge.generative.current.provenanceReady;
  bridge.generative.regenerate(true); await flushJobs(); assert.equal(f.calls[2].configuration.revision, "original");
  bridge.generative.release(); f.calls[2].fail(new JobError("cancellation", "Cleanup.")); assert.equal(doc.layers.length, 1);
});
for (const capability of [C.remove, C.fill, C.expand, C.upscale]) it(`replacement provider executes ${capability} through unchanged feature/history authority`, async () => {
  const f = replacement(), doc = new Document("replacement.psd"); doc.width = 8; doc.height = 6;
  const layer = doc.newLayer(); layer.rect = new Rect(0, 0, 8, 6); layer.buffer = new Uint8Array(192).fill(128); for (let i = 3; i < 192; i += 4) layer.buffer[i] = 255;
  doc.setLayers([layer]); doc.selectedLayerIndices = [0]; doc.buffer = layer.buffer.slice();
  if ([C.remove, C.fill].includes(capability)) doc.selectionMask = { rect: new Rect(2, 2, 3, 2), channel: new Uint8Array(8).fill(255) };
  const controller = { openDocs: [doc], getCurrentDoc: () => doc, pointerState: { isDown: false }, onDocumentOpened(created) { this.openDocs.push(created); } };
  const bridge = new SelectionJobs(controller, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, f.registry);
  const original = layer.buffer.slice(), initialHistory = doc.history.length;
  const id = capability === C.remove ? bridge.submitAI(doc, selection) : capability === C.fill ? bridge.submitGenerative(doc, selection, { prompt: "", count: 1, seed: 42 })
    : capability === C.expand ? bridge.submitExpand(doc, selection, { left: 2, top: 1, right: 0, bottom: 0 }, { prompt: "", count: 1, seed: 42 }) : bridge.submitUpscale(doc, selection);
  await flushJobs(); const call = f.calls[0]; assert.equal(call.input.config, undefined); assert.equal(call.input.modelWidth, undefined); assert.equal(call.input.rgba.length, (capability === C.upscale ? 8 * 6 : call.input.rect.width * call.input.rect.height) * 4);
  const result = capability === C.upscale ? { width: 32, height: 24, scale: 4, pixelFormat: "rgba8", bytes: new Uint8Array(32 * 24 * 4).fill(203) } : output(call.input);
  call.complete(result); if (capability === C.fill) await bridge.generative.current.provenanceReady;
  assert.equal(bridge.jobs.get(id).state, "preview"); assert.equal(doc.history.length, initialHistory); assert.deepEqual(layer.buffer, original);
  if (capability === C.fill) assert.equal(bridge.generative.accept(), true); else assert.equal(bridge.jobs.accept(id), true);
  assert.deepEqual(layer.buffer, original); assert.equal(f.calls.length, 1);
  if (capability === C.upscale) { assert.equal(controller.openDocs.length, 2); assert.equal(doc.history.length, initialHistory); }
  else {
    assert.equal(doc.historyIndex, initialHistory); const accepted = doc.layers.at(-1).buffer.slice(), history = new History();
    history.stepHistoryBackward(doc); history.stepHistoryForward(doc); assert.deepEqual(doc.layers.at(-1).buffer, accepted); assert.equal(f.calls.length, 1);
  }
  assert.equal(bridge.jobs.get(id).hasResult, false);
});
