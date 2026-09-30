import { getRecipePrivacy } from "../../document/formats/metadata/generation-recipes.js";
import { loadLocalInpaintConfig, saveLocalInpaintConfig, saveRecipePrivacy } from "../../core/app-settings.js";
import { createAIProviders, providerSelection } from "../../features/modernization/ai-providers.js";
import { loadGenerativeConfig, saveGenerativeCheckpoint } from "../../core/app-settings.js";

/** Explicit settings actions only; displaying this pane does not use the network. */
export function mountLocalInpaintSettings(pane) {
  const providers = createAIProviders();
  const intro = document.createElement("p");
  intro.textContent = "Remove selected pixels using your own local ComfyUI 0.37.0 or 0.37.4 service and SD 1.5 inpainting checkpoint with CLIP and VAE. PhotoSuite installs or downloads none of these.";
  pane.appendChild(intro);
  const fields = {};
  for (const [key, title, type] of [["enabled", "Enable local AI Remove", "checkbox"], ["endpoint", "Local endpoint", "text"], ["checkpoint", "Checkpoint identifier", "text"]]) {
    const label = document.createElement("label"), input = document.createElement("input");
    label.style.display = "block"; label.style.margin = "12px 0";
    label.textContent = title + " "; input.type = type; input.setAttribute("aria-label", title);
    if (type === "text") {
      input.style.width = "100%"; input.maxLength = key === "endpoint" ? 100 : 240;
      input.setAttribute("data-inpaint-field", "true");
    }
    fields[key] = input; label.appendChild(input); pane.appendChild(label);
  }
  fields.endpoint.placeholder = "http://127.0.0.1:8188";
  fields.checkpoint.placeholder = "Exact installed checkpoint filename";
  const save = document.createElement("button"), test = document.createElement("button"), status = document.createElement("p");
  save.textContent = "Save settings"; test.textContent = "Test Connection";
  test.style.marginLeft = "10px"; status.setAttribute("role", "status"); status.style.whiteSpace = "normal";
  pane.appendChild(save); pane.appendChild(test); pane.appendChild(status);
  const privacy = document.createElement("p");
  privacy.textContent = "Only numeric loopback endpoints are supported. Images are sent when you invoke AI Remove or Generative Fill. Your external service may retain uploaded crops, masks, prompts and results, and may have its own network behavior.";
  pane.appendChild(privacy);
  const generationLabel = document.createElement("label"), generation = document.createElement("input"), generationSave = document.createElement("button");
  generationLabel.textContent = "Generative Fill checkpoint (separate from AI Remove) "; generationLabel.style.display = "block";
  generation.setAttribute("aria-label", "Generative Fill checkpoint"); generation.setAttribute("data-inpaint-field", "true"); generation.maxLength = 240; generation.style.width = "100%";
  generationLabel.appendChild(generation); pane.appendChild(generationLabel);
  const generationHelp = document.createElement("p");
  generationHelp.textContent = "Generative Fill requires ComfyUI 0.37.4 and the reviewed sd-v1-5-inpainting.ckpt. Check readiness in Edit → Generative Fill. Accepted results can save optional provenance in PSD/PSB metadata. Saved recipes do not support Regenerate in v1.";
  pane.appendChild(generationHelp);
  generationSave.textContent = "Save generation checkpoint"; pane.appendChild(generationSave);
  generationSave.addEventListener("click", async () => {
    try { await saveGenerativeCheckpoint(generation.value.trim()); status.textContent = "Generation checkpoint saved. Generative Fill uses the shared endpoint and its own model setting."; }
    catch (error) { status.textContent = error.message; }
  });
  const metadataTitle = document.createElement("h3"); metadataTitle.textContent = "Generation metadata"; pane.appendChild(metadataTitle);
  const privacyFields = {};
  for (const [key, title] of [["saveRecipes", "Save generation recipes in PSD/PSB metadata"], ["savePrompts", "Save generative prompts in PSD metadata"]]) {
    const label = document.createElement("label"), input = document.createElement("input");
    label.style.display = "block"; label.style.margin = "12px 0"; input.type = "checkbox";
    input.setAttribute("aria-label", title); label.appendChild(input); label.appendChild(document.createTextNode(" " + title));
    pane.appendChild(label); privacyFields[key] = input;
  }
  const privacyHelp = document.createElement("p"), privacySave = document.createElement("button");
  privacyHelp.textContent = "Prompts are excluded by default. Turn off recipes to omit all PhotoSuite generation metadata. These options apply to every PSD/PSB save, including reopened files. Use Save As to create a stripped copy; raster layers stay intact. Existing files and your external backend history are unchanged.";
  pane.appendChild(privacyHelp); privacySave.textContent = "Save generation privacy"; pane.appendChild(privacySave);
  privacyFields.saveRecipes.addEventListener("change", () => { privacyFields.savePrompts.disabled = !privacyFields.saveRecipes.checked; });
  privacySave.addEventListener("click", async () => {
    privacySave.disabled = true;
    try {
      await saveRecipePrivacy({ saveRecipes: privacyFields.saveRecipes.checked, savePrompts: privacyFields.savePrompts.checked });
      status.textContent = "Generation privacy saved. Use Save As to write a PSD/PSB with these privacy settings.";
    } catch (error) { status.textContent = error.message; }
    finally { privacySave.disabled = false; }
  });
  let revision = 0;
  const config = () => ({ enabled: fields.enabled.checked, endpoint: fields.endpoint.value.trim(), checkpoint: fields.checkpoint.value.trim() });
  for (const field of Object.values(fields)) field.addEventListener("input", () => { revision++; status.textContent = "Unsaved changes. Connection has not been checked for these settings."; });
  save.addEventListener("click", async () => {
    const own = ++revision; save.disabled = true;
    try { await saveLocalInpaintConfig(config()); if (own === revision) status.textContent = "Settings saved. Use Test Connection to check service, workflow and checkpoint availability."; }
    catch (error) { if (own === revision) status.textContent = error.message; }
    finally { save.disabled = false; }
  });
  test.addEventListener("click", async () => {
    const own = ++revision; test.disabled = true; status.textContent = "Checking local service, workflow and checkpoint…";
    try {
      const result = await providers.check("ai-remove", providerSelection(config()));
      if (own === revision) status.textContent = "Ready: ComfyUI " + result.version + "; checkpoint " + result.model + ". Model compatibility is confirmed by a successful generation. Save changes before editing.";
    } catch (error) { if (own === revision) status.textContent = error.message; }
    finally { test.disabled = false; }
  });
  return {
    async refresh() {
      const own = ++revision;
      try {
        const value = await loadLocalInpaintConfig();
        const generative = await loadGenerativeConfig();
        if (own !== revision) return;
        fields.enabled.checked = value.enabled; fields.endpoint.value = value.endpoint; fields.checkpoint.value = value.checkpoint;
        generation.value = generative.checkpoint;
        const savedPrivacy = getRecipePrivacy();
        privacyFields.saveRecipes.checked = savedPrivacy.saveRecipes; privacyFields.savePrompts.checked = savedPrivacy.savePrompts;
        privacyFields.savePrompts.disabled = !savedPrivacy.saveRecipes;
        status.textContent = value.enabled ? "Configured. Connection has not been checked." : "Disabled. No service connection is made during normal editing.";
      } catch (error) { if (own === revision) status.textContent = error.message; }
    },
  };
}
