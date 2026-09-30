import { loadAIProviderSelection } from "../../core/app-settings.js";
import { requireInpaintSource } from "../../features/modernization/inpaint-target.js";
import { removalROI } from "../../features/modernization/inpaint-workload.js";
/** Opening this dialog uploads nothing. Durable provenance obeys save privacy preferences. */
export async function showGenerativeDialog(controller, doc) {
  requireInpaintSource(doc, "Generative Fill"); removalROI(doc.selectionMask, doc.width, doc.height);
  const config = await loadAIProviderSelection("generate.fill");
  if (!controller.openDocs.includes(doc)) throw new Error("The source document was closed.");
  const dialog = document.createElement("dialog"); dialog.setAttribute("aria-label", "Generative Fill");
  Object.assign(dialog.style, { background: "#292929", color: "#eee", border: "1px solid #666", borderRadius: "8px", padding: "24px", width: "440px", maxWidth: "80vw" });
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; dialog.appendChild(el); return el; };
  text("h2", "Generative Fill"); text("p", `Replace the selected region in ${doc.name || "Untitled"}. Accept adds one raster layer.`);
  const field = (label, tag) => { const wrap = text("label", label + " "); wrap.style.display = "block"; wrap.style.margin = "12px 0"; const el = document.createElement(tag); el.setAttribute("aria-label", label); el.setAttribute("data-inpaint-field", "true"); wrap.appendChild(el); return el; };
  const prompt = field("Prompt (optional)", "textarea"); prompt.rows = 3; prompt.maxLength = 1024; prompt.style.width = "100%"; prompt.placeholder = "Describe the replacement, or leave empty for contextual fill";
  const count = field("Variations", "select"); for (const n of [1, 2, 3]) { const option = document.createElement("option"); option.value = String(n); option.textContent = String(n); count.appendChild(option); }
  const seed = field("Seed (blank for random)", "input"); seed.type = "text"; seed.inputMode = "numeric"; seed.maxLength = 10;
  text("p", "Prompts and selected image context go to your local ComfyUI. Its files and history may retain them. Accepted results retain optional PhotoSuite provenance. Prompts are excluded from PSD/PSB saves by default. Change this in Preferences → AI Remove → Generation metadata. Saved recipes do not support Regenerate in v1.");
  const status = text("p", "Check the local backend before generating."); status.setAttribute("role", "status");
  const button = (label, action) => { const el = text("button", label); el.style.marginRight = "8px"; el.addEventListener("click", action); return el; };
  const check = button("Check backend", async () => {
    check.disabled = run.disabled = true; status.textContent = "Checking local service and generation checkpoint…";
    try { const info = await controller.getSelectionJobs().aiProviders.check("generate.fill", config); status.textContent = `Ready: ${info.label} ${info.version}.`; run.disabled = false; }
    catch (error) { status.textContent = error.message; }
    finally { check.disabled = false; }
  });
  const run = button("Generate", () => {
    try {
      if (seed.value !== "" && !/^\d+$/.test(seed.value)) throw new Error("Enter an integer seed or leave it blank for random.");
      controller.getSelectionJobs().submitGenerative(doc, config, { prompt: prompt.value, count: Number(count.value), seed: seed.value === "" ? null : Number(seed.value) });
      prompt.value = ""; dialog.close();
    } catch (error) { status.textContent = error.message; }
  }); run.disabled = true;
  button("Cancel", () => dialog.close());
  dialog.addEventListener("close", () => { prompt.value = ""; dialog.remove(); }, { once: true });
  controller.mainColumn.appendChild(dialog); dialog.showModal(); prompt.focus();
}
