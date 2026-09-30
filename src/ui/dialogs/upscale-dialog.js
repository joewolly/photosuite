import { loadAIProviderSelection } from "../../core/app-settings.js";
import { upscaleGeometry } from "../../features/modernization/upscale-workload.js";
/** Explicit command only: opening the dialog does not upload pixels or run inference. */
export async function showUpscaleDialog(controller, doc) {
  const g = upscaleGeometry(doc?.width, doc?.height), config = await loadAIProviderSelection("enhance.upscale");
  if (!controller.openDocs.includes(doc)) throw new Error("The source document was closed.");
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "AI Upscale");
  Object.assign(dialog.style, { background: "#292929", color: "#eee", border: "1px solid #666", borderRadius: "8px", padding: "24px", maxWidth: "480px" });
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; dialog.appendChild(el); return el; };
  text("h2", "AI Upscale");
  text("p", `${doc.name || "Untitled"}: ${g.width} × ${g.height} → ${g.outputWidth} × ${g.outputHeight}`);
  text("p", `Real-ESRGAN general x4v3 · Native 4× · ${(g.outputBytes / 1048576).toFixed(1)} MiB raster`);
  text("p", "Accept opens a new unsaved raster document. The source stays unchanged. Transparency is resized separately.");
  text("p", "Small text, logos and fine detail may change. Review the result before use.");
  const status = text("p", "Backend not checked. Uses the ComfyUI endpoint from Preferences → AI Remove."); status.setAttribute("role", "status");
  const button = (label, action) => { const el = text("button", label); el.style.marginRight = "10px"; el.addEventListener("click", action); return el; };
  let ready = false;
  const check = button("Check backend", async () => {
    check.disabled = true; run.disabled = true; status.textContent = "Checking ComfyUI and upscale model…";
    try { const info = await controller.getSelectionJobs().aiProviders.check("enhance.upscale", config); ready = true; status.textContent = `Ready: ${info.label} ${info.version}, ${info.model}.`; }
    catch (error) { ready = false; status.textContent = error.message; }
    finally { check.disabled = false; run.disabled = !ready; }
  });
  const run = button("Run 4×", () => {
    try { controller.getSelectionJobs().submitUpscale(doc, config); dialog.close(); }
    catch (error) { status.textContent = error.message; }
  }); run.disabled = true;
  button("Cancel", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  controller.mainColumn.appendChild(dialog); dialog.showModal();
}
