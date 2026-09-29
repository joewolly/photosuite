import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { readFileSync } from "node:fs";

import { BinaryUtils } from "../../../../src/core/binary/binary-utils.js";
import { RenderBuffer } from "../../../../src/core/render-buffer.js";
import { installBrowserGlobals } from "../../../helpers/stub-browser-globals.js";

let PSDResourceParser;
let restoreBrowserGlobals;

const mockWriteBuffer = (capacity = 256) => ({
  data: new Uint8Array(capacity),
  ensureCapacity() {},
});

const layerContext = { width: 100, height: 50, dpi: 72 };

/** Wrap one 8BIM additional-layer-info block. */
function wrapLayerInfoTag(tag, payload) {
  const block = new Uint8Array(12 + payload.length);
  BinaryUtils.writeAsciiRaw(block, 0, "8BIM");
  BinaryUtils.writeAsciiRaw(block, 4, tag);
  BinaryUtils.writeInt32BE(block, 8, payload.length);
  block.set(payload, 12);
  return block;
}

before(async () => {
  restoreBrowserGlobals = installBrowserGlobals();
  await import("../../../../src/engine/layer-system.js");
  ({ PSDResourceParser } = await import(
    "../../../../src/document/formats/psd/psd-resource-parser.js"
  ));
});

after(() => {
  if (restoreBrowserGlobals) restoreBrowserGlobals();
});

describe("document/formats/psd/psd-resource-parser.js", () => {
  for (const isPSB of [false, true]) {
    it(`preserves native Smart Object and Smart Filter descriptors in ${isPSB ? "PSB" : "PSD"} SoLd blocks`, () => {
      const descriptor = JSON.parse(readFileSync(new URL("../../../fixtures/psd-smart-object/native-filter-descriptor.json", import.meta.url), "utf8"));
      const before = structuredClone(descriptor);
      const buffer = new RenderBuffer();
      const end = PSDResourceParser.writeAdditionalLayerInfo(buffer, 0, { placedData: descriptor }, isPSB, layerContext);
      assert.ok(end > 12, "Smart Object descriptor must not be silently skipped");
      assert.equal(BinaryUtils.readString(buffer.data, 4, 4), "SoLd");
      const reopened = {};
      PSDResourceParser.parseAdditionalLayerInfo(buffer.data, 0, end, reopened, isPSB, layerContext);
      assert.deepEqual(reopened.placedData, before);
      assert.equal(reopened.SoLd, undefined, "editor must receive its placedData key");
      assert.deepEqual(descriptor, before, "serialization must not mutate the live descriptor");
      assert.ok(reopened.placedData.filterFX.v.filterFXList.v.length > 0);
    });
  }

  it("reads lyid layer id", () => {
    const data = wrapLayerInfoTag("lyid", new Uint8Array([0, 0, 0, 42]));
    const layerAdd = {};
    const endPos = PSDResourceParser.parseAdditionalLayerInfo(
      data,
      0,
      data.length,
      layerAdd,
      false,
      layerContext,
    );
    assert.equal(endPos, 16);
    assert.equal(layerAdd.lyid, 42);
  });

  it("does not manufacture recipe-capable IDs from malformed or repeated lyid blocks", () => {
    for (const length of [0, 1, 2, 3, 5, 8]) {
      const bytes = wrapLayerInfoTag("lyid", new Uint8Array(length).fill(42)), add = {};
      PSDResourceParser.parseAdditionalLayerInfo(bytes, 0, bytes.length, add, false, layerContext);
      assert.equal(add.lyid, null);
    }
    const block = wrapLayerInfoTag("lyid", new Uint8Array([0, 0, 0, 42]));
    const twice = new Uint8Array(block.length * 2); twice.set(block); twice.set(block, block.length);
    const add = {}; PSDResourceParser.parseAdditionalLayerInfo(twice, 0, twice.length, add, false, layerContext);
    assert.equal(add.lyid, null);
  });

  it("reads iOpa fill opacity byte", () => {
    const data = wrapLayerInfoTag("iOpa", new Uint8Array([200, 0, 0, 0]));
    const layerAdd = {};
    PSDResourceParser.parseAdditionalLayerInfo(data, 0, data.length, layerAdd, false, layerContext);
    assert.equal(layerAdd.iOpa, 200);
  });

  it("reads lsct section divider with blend mode", () => {
    const payload = new Uint8Array(12);
    BinaryUtils.writeUint32BE(payload, 0, 1);
    BinaryUtils.writeAsciiRaw(payload, 8, "pass");
    const data = wrapLayerInfoTag("lsct", payload);
    const layerAdd = {};
    PSDResourceParser.parseAdditionalLayerInfo(data, 0, data.length, layerAdd, false, layerContext);
    assert.deepEqual(layerAdd.lsct, { type: 1, blendMode: "pass" });
  });

  it("writeAdditionalLayerInfo / parseAdditionalLayerInfo round-trip luni name", () => {
    const writeBuffer = mockWriteBuffer(64);
    const sourceAdd = { luni: "Layer 1" };
    const writeEnd = PSDResourceParser.writeAdditionalLayerInfo(
      writeBuffer,
      0,
      sourceAdd,
      false,
      layerContext,
    );
    const writtenBytes = [...writeBuffer.data.slice(0, writeEnd)];
    assert.deepEqual(writtenBytes, [
      56, 66, 73, 77, 108, 117, 110, 105, 0, 0, 0, 20, 0, 0, 0, 7, 0, 76, 0, 97, 0, 121, 0, 101,
      0, 114, 0, 32, 0, 49, 0, 0,
    ]);
    const parsedAdd = {};
    PSDResourceParser.parseAdditionalLayerInfo(
      writeBuffer.data,
      0,
      writeEnd,
      parsedAdd,
      false,
      layerContext,
    );
    assert.equal(parsedAdd.luni, "Layer 1");
  });

  it("clone copies fxrp point", () => {
    const point = {
      x: 1.5,
      y: 2.5,
      clone() {
        return { x: this.x, y: this.y, clone: this.clone };
      },
    };
    const cloned = PSDResourceParser.clone("fxrp", point);
    assert.equal(cloned.x, 1.5);
    assert.equal(cloned.y, 2.5);
  });

  // A 16- or 32-bit document leaves the ordinary Layer Info section empty and
  // keeps its layers in one of these blocks instead. Reading only `Lr16` left a
  // 32-bit file looking like it had no layers, and the reader invented a single
  // Background from the composite image.
  describe("deep-colour layer blocks", () => {
    function parseTagAndRecordHandoff(tag) {
      const payload = new Uint8Array([0, 2]); // layer count, as the block starts
      const block = new Uint8Array(12 + payload.length);
      block.set([0x38, 0x42, 0x49, 0x4d], 0); // "8BIM"
      block.set([...tag].map((ch) => ch.charCodeAt(0)), 4);
      new DataView(block.buffer).setUint32(8, payload.length, false);
      block.set(payload, 12);

      const handled = [];
      const restore = PSDResourceParser.layerRecordHandler;
      PSDResourceParser.layerRecordHandler = (context, data, pos) => handled.push({ pos });
      try {
        PSDResourceParser.parseAdditionalLayerInfo(block, 0, block.length, {}, false, {});
      } finally {
        PSDResourceParser.layerRecordHandler = restore;
      }
      return handled;
    }

    it("reads the layer records out of Lr16 and Lr32 alike", () => {
      assert.equal(parseTagAndRecordHandoff("Lr16").length, 1, "Lr16 did not hand over its records");
      assert.equal(parseTagAndRecordHandoff("Lr32").length, 1, "Lr32 did not hand over its records");
    });

    it("hands the handler the position the layer count starts at", () => {
      assert.deepEqual(parseTagAndRecordHandoff("Lr32"), [{ pos: 12 }]);
    });
  });
});
