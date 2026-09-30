import { loadAIProviderSelection } from "../../core/app-settings.js";
import { requireExpandDocument } from "../../features/modernization/expand-source.js";
import { expansionGeometry } from "../../features/modernization/expand-workload.js";
/** Opening this dialog uploads nothing. M8 v1 saves no generation recipe or prompt. */
export async function showExpandDialog(controller, doc) {
  requireExpandDocument(doc);
  const config = await loadAIProviderSelection("generate.expand");
  if (!controller.openDocs.includes(doc)) throw new Error("The source document was closed.");
  const dialog = document.createElement("dialog"); dialog.setAttribute("aria-label", "Generative Expand");
  Object.assign(dialog.style, { background: "#292929", color: "#eee", border: "1px solid #666", borderRadius: "8px", padding: "24px", width: "440px", maxWidth: "80vw", maxHeight: "80vh", overflowY: "auto" });
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; dialog.appendChild(el); return el; };
  text("h2", "Generative Expand"); text("p", `Expand ${doc.name || "Untitled"} (${doc.width} × ${doc.height}). Accept changes the canvas and adds one exterior layer in one undo step. Original pixels remain exact.`);
  const field = (label, tag) => { const wrap = text("label", label + " "); wrap.style.display = "block"; wrap.style.margin = "12px 0"; const el = document.createElement(tag); el.setAttribute("aria-label", label); el.setAttribute("data-inpaint-field", "true"); wrap.appendChild(el); return el; };
  const prompt = field("Prompt (optional)", "textarea"); prompt.rows = 3; prompt.maxLength = 1024; prompt.style.width = "100%"; prompt.placeholder = "Describe the continuation, or leave empty for contextual expansion";
  const edges = {};
  for (const side of ["left", "top", "right", "bottom"]) {
    const el = field(`Added ${side} (pixels)`, "input"); el.type = "number"; el.min = "0"; el.max = "512"; el.step = "1"; el.value = side === "right" ? "128" : "0"; edges[side] = el;
  }
  const dimensions = text("p", "");
  const geometry = () => expansionGeometry(doc.width, doc.height, Object.fromEntries(Object.entries(edges).map(([key, el]) => [key, el.value.trim() === "" ? NaN : Number(el.value)])));
  const update = () => { try { const g = geometry(); dimensions.textContent = `Result: ${g.newWidth} × ${g.newHeight}. One variation; original bounds protected.`; } catch (error) { dimensions.textContent = error.message; } };
  for (const el of Object.values(edges)) el.addEventListener("input", update); update();
  const seed = field("Seed (blank for random)", "input"); seed.type = "text"; seed.inputMode = "numeric"; seed.maxLength = 10;
  text("p", "The expanded image and optional prompt go to your local ComfyUI. Its files and history may retain them. Expand v1 does not save generation recipes or prompts. Preview is temporary until Accept. Maximum final canvas: 1024 × 1024; maximum added edge: 512 pixels.");
  const status = text("p", "Check the local backend before generating."); status.setAttribute("role", "status");
  const button = (label, action) => { const el = text("button", label); el.style.marginRight = "8px"; el.addEventListener("click", action); return el; };
  const check = button("Check backend", async () => {
    check.disabled = run.disabled = true; status.textContent = "Checking local service and generation checkpoint…";
    try { const info = await controller.getSelectionJobs().aiProviders.check("generate.expand", config); status.textContent = `Ready: ${info.label} ${info.version}.`; run.disabled = false; }
    catch (error) { status.textContent = error.message; }
    finally { check.disabled = false; }
  });
  const run = button("Generate", () => {
    try {
      if (seed.value !== "" && !/^\d+$/.test(seed.value)) throw new Error("Enter an integer seed or leave it blank for random.");
      controller.getSelectionJobs().submitExpand(doc, config, geometry(), { prompt: prompt.value, count: 1, seed: seed.value === "" ? null : Number(seed.value) });
      prompt.value = ""; dialog.close();
    } catch (error) { status.textContent = error.message; }
  }); run.disabled = true;
  button("Cancel", () => dialog.close());
  dialog.addEventListener("close", () => { prompt.value = ""; dialog.remove(); }, { once: true });
  controller.mainColumn.appendChild(dialog); dialog.showModal(); prompt.focus();
}
