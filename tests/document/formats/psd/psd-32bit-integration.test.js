import assert from "node:assert/strict";
import { before, it } from "node:test";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { installBrowserGlobals } from "../../../helpers/stub-browser-globals.js";
import { installXmlDom } from "../../../helpers/xml-dom.js";
installBrowserGlobals(); installXmlDom();
// Use real DEFLATE, unlike the deliberately isolated channel unit tests.
globalThis.pako.inflateRaw = bytes => new Uint8Array(inflateRawSync(bytes));
let Document, PSDParser, RenderBuffer;
before(async () => {
  ({ Document } = await import("../../../../src/document/model/document.js"));
  ({ PSDParser } = await import("../../../../src/document/formats/psd/psd-parser.js"));
  ({ RenderBuffer } = await import("../../../../src/core/render-buffer.js"));
  const { TrackerRegistry } = await import("../../../../src/features/trackers/tracker-registry.js");
  const { registerTrackers } = await import("../../../../src/features/trackers/register-trackers.js");
  registerTrackers(TrackerRegistry);
  const { LayerSystem } = await import("../../../../src/engine/layer-system.js"); LayerSystem.webglEnabled = false;
});
for (const kind of ["raw", "zip-prediction"]) it(`imports actual layered Lr32 ${kind} PSD and saves edited RGB8 PSD/PSB`, () => {
  const bytes = readFileSync(new URL(`../../../fixtures/psd-32bit/layered-${kind}.psd`, import.meta.url));
  const doc = new Document("float.psd");
  PSDParser.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), doc);
  assert.equal(doc.layers.length, 2, "must not synthesize a composite Background");
  const top = doc.layers.find(layer => layer.name === "Float top");
  assert.ok(top); assert.equal(top.add.lyid, 42);
  const expected = [0, 64, 128, 255, 0, 255, 191, 32].flatMap(v => [v, v, v, 255]);
  assert.deepEqual([...top.buffer], expected, "both float rows decode without striping or wrapping");
  top.buffer[0] = 17; top.setName("Edited imported layer"); doc.markDirty();
  for (const psb of [false, true]) {
    const output = new RenderBuffer(), length = PSDParser.serialize(doc, output, [false, false, false, psb]);
    const reopened = new Document("edited.psd"); PSDParser.parse(output.data.slice(0, length).buffer, reopened);
    assert.equal(reopened.bitDepth, 8, "save uses the existing RGB8 architecture");
    assert.equal(reopened.layers.length, 2);
    assert.deepEqual([...reopened.layers.find(layer => layer.name === top.name).buffer], [17, ...expected.slice(1)]);
  }
});
