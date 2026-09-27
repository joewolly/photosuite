/** Minimal M0 client: no scripts, files, native bridge or model are needed. */
(function initExactResultExample() {
  const button = document.getElementById("insert-exact");
  const log = document.getElementById("log");
  const pending = new Map();
  let sessionId, sequence = 1, serial = 0;
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.psPlugin !== 1) return;
    const request = pending.get(event.data.requestId);
    if (!request) return;
    pending.delete(event.data.requestId);
    clearTimeout(request.timer);
    if (event.data.cmd === "error") request.reject(new Error(event.data.error));
    else request.resolve(event.data);
  });
  function request(cmd, fields = {}) {
    const requestId = "exact-" + ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Host did not reply. Reopen the plugin and try again.")); }, 10000);
      pending.set(requestId, { resolve, reject, timer });
      const message = { psPlugin: 1, apiVersion: 1, cmd, requestId, ...fields };
      if (cmd !== "getCapabilities") Object.assign(message, { sessionId, sequence: sequence++ });
      parent.postMessage(message, "*");
    });
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      // Negotiate again for every click, including after a frame reload/error.
      const capabilities = await request("getCapabilities");
      sessionId = capabilities.sessionId; sequence = capabilities.nextSequence;
      if (!capabilities.operations.includes("insertRaster")) throw new Error("Exact raster insertion is unavailable.");
      const info = await request("getDocumentInfo");
      const selected = info.layers.filter((layer) => layer.selected);
      if (selected.length !== 1) throw new Error("Select one layer as the insertion anchor.");
      const target = await request("prepareResultTarget", { documentId: info.documentId, layerId: selected[0].layerId, operation: "insertRaster" });
      const bytes = new Uint8Array(3 * 5 * 4);
      for (let i = 0; i < 15; i++) bytes.set([255, i * 16, 64, 255], i * 4);
      await request("insertRaster", {
        documentId: info.documentId, targetToken: target.targetToken,
        payload: { pixelFormat: "rgba8", rect: { x: 16, y: 24, width: 3, height: 5 }, byteLength: bytes.length, bytes, name: "Exact 3 × 5 result" },
      });
      log.textContent = "Inserted at (16, 24). Zoom in to inspect; Undo/Redo needs no plugin.\n" + log.textContent;
    } catch (error) {
      log.textContent = error.message + "\n" + log.textContent;
    } finally { button.disabled = false; }
  });
})();
