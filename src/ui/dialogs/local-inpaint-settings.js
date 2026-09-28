import { loadLocalInpaintConfig, saveLocalInpaintConfig } from "../../core/app-settings.js";
import { testInpaintConnection } from "../../features/modernization/comfy-provider.js";

/** Explicit settings actions only; displaying this pane does not use the network. */
export function mountLocalInpaintSettings(pane) {
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
  privacy.textContent = "Only numeric loopback endpoints are supported. Images are sent only when you invoke AI Remove. Your external service may retain uploaded crops, masks and results, and may have its own network behavior.";
  pane.appendChild(privacy);
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
      const result = await testInpaintConnection(config());
      if (own === revision) status.textContent = "Ready: ComfyUI " + result.version + "; checkpoint " + result.model + ". Model compatibility is confirmed by a successful generation. Save changes before editing.";
    } catch (error) { if (own === revision) status.textContent = error.message; }
    finally { test.disabled = false; }
  });
  return {
    async refresh() {
      const own = ++revision;
      try {
        const value = await loadLocalInpaintConfig();
        if (own !== revision) return;
        fields.enabled.checked = value.enabled; fields.endpoint.value = value.endpoint; fields.checkpoint.value = value.checkpoint;
        status.textContent = value.enabled ? "Configured. Connection has not been checked." : "Disabled. No service connection is made during normal editing.";
      } catch (error) { if (own === revision) status.textContent = error.message; }
    },
  };
}
