import { getLayerRecipe, getRecipePrivacy, recipeAvailability } from "../../document/formats/metadata/generation-recipes.js";
/** Passive provenance only. Text nodes ensure imported prompts never become markup. */
export function showGenerativeInfo(controller, doc) {
  const layer = doc?.selectedLayerIndices.length === 1 ? doc.layers[doc.selectedLayerIndices[0]] : null;
  if (!layer) return;
  const recipe = getLayerRecipe(doc, layer), privacy = getRecipePrivacy();
  const dialog = document.createElement("dialog"); dialog.setAttribute("aria-label", "Generative Info");
  Object.assign(dialog.style, { background: "#292929", color: "#eee", border: "1px solid #666", borderRadius: "8px", padding: "24px", width: "480px", maxWidth: "80vw", maxHeight: "80vh", overflow: "auto" });
  const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; node.style.overflowWrap = "anywhere"; dialog.appendChild(node); return node; };
  text("h2", "Generative Info"); text("p", layer.getName());
  if (!recipe) text("p", "No supported PhotoSuite generation provenance is associated with this layer. Its raster pixels remain usable.");
  else {
    for (const [key, value] of [["Operation", "Generative Fill"], ["Prompt", recipe.prompt ?? "Not retained"], ["Checkpoint filename (not a verified model hash)", recipe.checkpoint], ["Backend type", "ComfyUI"], ["Workflow", recipe.workflow], ["Seed", recipe.seed], ["Generated", recipe.createdAt]]) {
      text("strong", key); const node = text("p", String(value)); node.style.whiteSpace = "pre-wrap"; node.style.marginTop = "4px";
    }
    text("p", "A seed and prompt do not guarantee identical results. Models, workflows, runtime versions and hardware can change the output.");
    const reason = text("p", "Regenerate is unavailable: recipe v1 does not save exact selection coverage. Checking local source pixels…");
    reason.setAttribute("role", "status");
    void recipeAvailability(doc, layer).then(state => { reason.textContent = state.reason; }).catch(() => { reason.textContent = "Regenerate is unavailable: original source could not be validated, and exact selection coverage is not saved."; });
    const regenerate = text("button", "Regenerate"); regenerate.disabled = true; regenerate.title = "Exact selection coverage is not saved in recipe v1.";
  }
  text("p", privacy.saveRecipes ? (privacy.savePrompts ? "PSD/PSB saves include retained prompts. Change this in Preferences → AI Remove → Generation metadata." : "PSD/PSB saves exclude prompts. Change this in Preferences → AI Remove → Generation metadata.") : "PSD/PSB saves omit all generation metadata. Raster layers are preserved.");
  const close = text("button", "Close"); close.style.marginLeft = "8px"; close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true }); controller.mainColumn.appendChild(dialog); dialog.showModal();
}
