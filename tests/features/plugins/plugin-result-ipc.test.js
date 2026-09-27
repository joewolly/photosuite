import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { deflateSync, inflateSync } from "node:zlib";
import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
installBrowserGlobals();
let Document, Rect, handlePluginIpcMessage, registerPluginResultFrame, TrackerRegistry;
before(async () => {
  ({ Document } = await import("../../../src/document/model/document.js"));
  ({ Rect } = await import("../../../src/core/math/rect.js"));
  ({ TrackerRegistry } = await import("../../../src/features/trackers/tracker-registry.js"));
  ({ handlePluginIpcMessage } = await import("../../../src/features/plugins/plugin-host-ipc.js"));
  ({ registerPluginResultFrame } = await import("../../../src/features/plugins/plugin-result-ipc.js"));
});
function fixture(register = true) {
  const listeners = {};
  const frame = { contentWindow: { replies: [], postMessage(value) { this.replies.push(value); } }, addEventListener(name, fn) { listeners[name] = fn; } };
  let attached = true;
  document.querySelectorAll = () => attached ? [frame] : [];
  if (register) registerPluginResultFrame(frame);
  const doc = new Document("secret/path/name.psd"); doc.width = 8; doc.height = 8;
  const layer = doc.newLayer(); layer.setName("Raster"); layer.rect = new Rect(0, 0, 8, 8); layer.buffer = new Uint8Array(256);
  doc.setLayers([layer]);
  const controller = { openDocs: [doc], getCurrentDoc: () => doc };
  let sequence = 0, sessionId;
  const send = (cmd, fields = {}) => {
    handlePluginIpcMessage(controller, { psPlugin: 1, apiVersion: 1, cmd, requestId: "req-" + ++sequence, sequence: sequence - 1, sessionId, ...fields }, frame.contentWindow);
    return frame.contentWindow.replies.at(-1);
  };
  const cap = send("getCapabilities"); sessionId = cap.sessionId;
  return { doc, frame, listeners, controller, cap, send, detach: () => { attached = false; } };
}
function prepare(f, operation = "insertRaster") {
  const info = f.send("getDocumentInfo");
  const reply = f.send("prepareResultTarget", { documentId: info.documentId, layerId: info.layers[0].layerId, operation });
  assert.equal(reply.cmd, "resultTarget", JSON.stringify(reply));
  return { documentId: info.documentId, targetToken: reply.targetToken };
}
const raster = () => ({ pixelFormat: "rgba8", rect: { x: -1, y: 2, width: 3, height: 5 }, byteLength: 60, bytes: new Uint8Array(60).fill(123) });
describe("M0 plugin session boundary", () => {
  it("commits from a registered frame and redoes without any plugin", () => {
    const f = fixture(); const token = prepare(f);
    const reply = f.send("insertRaster", { ...token, payload: raster() });
    assert.equal(reply.cmd, "resultCommitted"); assert.equal(f.doc.layers.length, 2);
    f.detach(); const history = new TrackerRegistry.History(); history.stepHistoryBackward(f.doc); history.stepHistoryForward(f.doc);
    assert.deepEqual(f.doc.layers[1].buffer, raster().bytes);
  });
  it("does not grant writes from an attribute alone", () => {
    const f = fixture(false); assert.equal(f.cap.cmd, "error"); assert.match(f.cap.error, /not registered/);
  });
  it("rejects wrong session and version, malformed IDs and sequences", () => {
    for (const fields of [{ sessionId: "wrong" }, { apiVersion: 2 }, { sequence: NaN }, { requestId: "" }]) {
      const f = fixture(); const reply = f.send("getDocumentInfo", fields); assert.equal(reply.cmd, "error"); assert.equal(f.doc.history.length, 1);
    }
  });
  it("rejects replay and consumes a target exactly once", () => {
    const f = fixture(); const token = prepare(f);
    assert.equal(f.send("insertRaster", { ...token, payload: raster() }).cmd, "resultCommitted");
    assert.equal(f.send("insertRaster", { ...token, payload: raster(), sequence: 3 }).cmd, "error");
    assert.match(f.send("insertRaster", { ...token, payload: raster(), sequence: 4 }).error, /consumed/);
    assert.equal(f.doc.history.length, 2);
  });
  it("silences detached senders and expires a reloaded WindowProxy session", () => {
    const f = fixture(); const token = prepare(f); const count = f.frame.contentWindow.replies.length;
    f.detach(); f.send("insertRaster", { ...token, payload: raster() }); assert.equal(f.frame.contentWindow.replies.length, count); assert.equal(f.doc.history.length, 1);
    const g = fixture(); const old = prepare(g); g.listeners.load();
    assert.match(g.send("insertRaster", { ...old, payload: raster() }).error, /session/); assert.equal(g.doc.history.length, 1);
  });
  it("rejects wrong document, unsupported capability, and malformed pixels without mutation", () => {
    const f = fixture(); const token = prepare(f);
    assert.equal(f.send("insertRaster", { ...token, documentId: "other", payload: raster() }).cmd, "error");
    const second = prepare(f);
    assert.equal(f.send("insertRaster", { ...second, payload: { ...raster(), byteLength: 4 } }).cmd, "error");
    assert.match(f.send("prepareResultTarget", { documentId: token.documentId, operation: "generate" }).error, /Unsupported/);
    assert.match(f.send("runNativeCommand").error, /Unknown/); assert.equal(f.doc.layers.length, 1);
  });
  it("copies logical 3 by 5 mask bytes and keeps old ping replies intact", () => {
    const f = fixture(); f.doc.selectionMask = { rect: new Rect(2, 3, 3, 5), channel: new Uint8Array(16).fill(128) };
    const reply = f.send("getSelectionMask"); assert.equal(reply.mask.byteLength, 15); assert.equal(reply.rect.x, 2);
    new Uint8Array(reply.mask).fill(1); assert.equal(f.doc.selectionMask.channel[0], 128);
    const pong = f.send("ping"); assert.deepEqual(Object.keys(pong).sort(), ["cmd", "psPlugin", "requestId"]);
  });
  it("capabilities/info expose copied summaries without paths, models, credentials or native access", () => {
    const f = fixture(); const info = f.send("getDocumentInfo");
    const text = JSON.stringify([f.cap, info]); assert.doesNotMatch(text, /secret|native|credential|history|buffer|sourceUrl/);
    info.layers[0].name = "tampered"; assert.equal(f.doc.layers[0].getName(), "Raster");
    assert.deepEqual(f.cap.operations, ["insertRaster", "setSelection", "applyRasterMask"]);
  });
  it("the example client negotiates and inserts through the real host transaction path", async () => {
    const f = fixture(); let click, receive; const log = { textContent: "" };
    const parent = { postMessage(message) { handlePluginIpcMessage(f.controller, message, f.frame.contentWindow); } };
    f.frame.contentWindow.postMessage = (data) => { queueMicrotask(() => receive({ source: parent, data })); };
    vm.runInNewContext(readFileSync(new URL("../../../examples/plugins/hello-panel/exact-result.js", import.meta.url), "utf8"), {
      window: { addEventListener(name, fn) { receive = fn; } },
      document: { getElementById(id) { return id === "insert-exact" ? { addEventListener(name, fn) { click = fn; } } : log; } },
      parent, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, console,
    });
    await click();
    assert.match(log.textContent, /Inserted/); assert.equal(f.doc.layers.length, 2);
    assert.deepEqual(f.doc.layers[1].rect, new Rect(16, 24, 3, 5));
    assert.deepEqual(Array.from(f.doc.layers[1].buffer.slice(0, 8)), [255, 0, 64, 255, 255, 16, 64, 255]);
  });
  it("preserves getComposite with the actual PNG encoder and copied source pixels", () => {
    const f = fixture();
    const context = vm.createContext({ window: {}, pako: { deflate: deflateSync, inflate: inflateSync }, Uint8Array, Uint16Array, Uint32Array, ArrayBuffer, console });
    vm.runInContext(readFileSync(new URL("../../../src/vendor/upng/UPNG.js", import.meta.url), "utf8"), context);
    const previous = globalThis.UPNG; globalThis.UPNG = context.UPNG;
    try {
      f.doc.buffer = new Uint8Array(8 * 8 * 4).fill(255);
      const reply = f.send("getComposite");
      assert.equal(reply.cmd, "composite", reply.error);
      assert.equal(reply.width, 8); assert.equal(reply.height, 8); assert.equal(reply.scale, 1);
      const decoded = context.UPNG.decode(reply.png);
      assert.equal(decoded.width, 8); assert.equal(decoded.height, 8);
      new Uint8Array(reply.png).fill(0); assert.equal(f.doc.buffer[0], 255);
    } finally { globalThis.UPNG = previous; }
  });
  it("preserves shell legacy script and ArrayBuffer routes", async () => {
    const { handleHostWindowMessage } = await import("../../../src/ui/shell/app-controller.js");
    const { FileLoader } = await import("../../../src/ui/shell/file-loader.js");
    const events = []; let completed = 0;
    const controller = { dispatch(event) { events.push(event); }, onComplete() { completed++; } };
    handleHostWindowMessage(controller, { data: "app.echoToOE('hello')", source: {} });
    assert.equal(events[0].data.dispatchKind, "runExtensionScriptSnippet");
    assert.equal(events[0].data.scriptSource, "app.echoToOE('hello')"); assert.equal(completed, 1);
    const previous = FileLoader.processLoadedBytes; let opened;
    FileLoader.processLoadedBytes = (...args) => { opened = args; };
    try {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(24).fill(0)]).buffer;
      handleHostWindowMessage(controller, { data: bytes, source: {} });
      assert.equal(opened[1], bytes); assert.equal(opened[2], controller);
    } finally { FileLoader.processLoadedBytes = previous; }
  });
  it("revokes pending results when a frame is removed and reattached", () => {
    const previous = globalThis.MutationObserver; let notify;
    globalThis.MutationObserver = class { constructor(callback) { notify = callback; } observe() {} };
    try {
      const f = fixture(false); f.frame.ownerDocument = {}; registerPluginResultFrame(f.frame);
      const caps = f.send("getCapabilities");
      // Exercise the removal observer even if the same frame is already back.
      notify([{ removedNodes: [f.frame] }]);
      assert.match(f.send("getDocumentInfo", { sessionId: caps.sessionId, sequence: 1 }).error, /session/);
    } finally { globalThis.MutationObserver = previous; }
  });
  it("preserves the legacy Hello World example's script sender", () => {
    const posted = []; let click;
    vm.runInNewContext(readFileSync(new URL("../../../examples/plugins/hello-panel/panel.js", import.meta.url), "utf8"), {
      window: { addEventListener() {} }, document: { getElementById(id) { return id === "add-text" ? { addEventListener(event, fn) { click = fn; } } : { textContent: "" }; } }, parent: { postMessage(value) { posted.push(value); } }, Date, console,
    });
    click(); assert.equal(typeof posted[0], "string"); assert.match(posted[0], /artLayers.add/);
  });
});
