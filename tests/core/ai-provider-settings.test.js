import assert from "node:assert/strict";
import { after, it } from "node:test";
import { installTauriWindowMock } from "../helpers/minimal-app-controller.js";
import { AI_CAPABILITIES as C } from "../../src/features/modernization/ai-capabilities.js";
import { createAIProviders } from "../../src/features/modernization/ai-providers.js";
import { GENERATIVE_MODEL, UPSCALE_MODEL } from "../../src/features/modernization/comfy-config.js";
const values = new Map(), writes = [], commands = [];
const restore = installTauriWindowMock({ load: async () => ({ get: async key => values.get(key), set: async (key, value) => { writes.push(key); values.set(key, value); }, save: async () => {} }) });
window.__TAURI__.core = { invoke: command => { commands.push(command); throw Error("Unexpected IPC"); } };
const { loadAIProviderSelection, saveLocalInpaintConfig, saveGenerativeCheckpoint } = await import("../../src/core/app-settings.js");
after(restore);
it("v1 settings retain exact endpoint/checkpoint/enable semantics without migration writes or network", async () => {
  values.set("localInpainting", { enabled: false, endpoint: "http://[::1]:08188/", checkpoint: "folder/custom.ckpt" });
  values.set("generativeCheckpoint", GENERATIVE_MODEL);
  const registry = createAIProviders();
  const remove = await loadAIProviderSelection(C.remove); assert.deepEqual(remove.configuration, values.get("localInpainting"));
  assert.throws(() => registry.resolve(C.remove, remove));
  for (const c of [C.fill, C.expand]) {
    const choice = await loadAIProviderSelection(c); assert.deepEqual(choice.configuration, { enabled: true, endpoint: "http://[::1]:08188/", checkpoint: GENERATIVE_MODEL }); assert.doesNotThrow(() => registry.resolve(c, choice));
  }
  const upscale = await loadAIProviderSelection(C.upscale); assert.deepEqual(upscale.configuration, { endpoint: "http://[::1]:08188/", model: UPSCALE_MODEL }); assert.doesNotThrow(() => registry.resolve(C.upscale, upscale));
  assert.equal(await loadAIProviderSelection(C.edit), null); assert.equal(await loadAIProviderSelection(C.reference), null);
  assert.deepEqual(writes, []); assert.deepEqual(commands, []);
});
it("missing settings use only existing defaults; invalid saved values are preserved and rejected", async () => {
  values.clear(); const registry = createAIProviders();
  assert.deepEqual((await loadAIProviderSelection(C.remove)).configuration, { enabled: false, endpoint: "http://127.0.0.1:8188", checkpoint: "" });
  assert.equal((await loadAIProviderSelection(C.fill)).configuration.checkpoint, GENERATIVE_MODEL);
  values.set("localInpainting", { enabled: true, endpoint: "http://localhost:8188", checkpoint: "custom.ckpt" }); values.set("generativeCheckpoint", "different.ckpt");
  for (const c of [C.remove, C.fill, C.expand, C.upscale]) { const choice = await loadAIProviderSelection(c); assert.equal(choice.configuration.endpoint, "http://localhost:8188"); assert.throws(() => registry.resolve(c, choice)); }
  assert.equal((await loadAIProviderSelection(C.fill)).configuration.checkpoint, "different.ckpt"); assert.deepEqual(writes, []);
});
it("explicit settings saves preserve legacy keys and independent model choices", async () => {
  const local = { enabled: true, endpoint: "http://127.0.0.1:8188", checkpoint: "custom.ckpt" };
  await saveLocalInpaintConfig(local); await saveGenerativeCheckpoint(GENERATIVE_MODEL);
  assert.deepEqual(writes, ["localInpainting", "generativeCheckpoint"]); assert.deepEqual(values.get("localInpainting"), local);
  assert.equal((await loadAIProviderSelection(C.remove)).configuration.checkpoint, "custom.ckpt"); assert.equal((await loadAIProviderSelection(C.fill)).configuration.checkpoint, GENERATIVE_MODEL);
  assert.equal((await loadAIProviderSelection(C.upscale)).configuration.model, UPSCALE_MODEL); assert.deepEqual(commands, []);
});
