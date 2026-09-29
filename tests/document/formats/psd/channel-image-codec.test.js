import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

import { installBrowserGlobals } from "../../../helpers/stub-browser-globals.js";

let ChannelImageCodec;
let restoreBrowserGlobals;

before(async () => {
  restoreBrowserGlobals = installBrowserGlobals();
  await import("../../../../src/engine/layer-system.js");
  ({ ChannelImageCodec } = await import("../../../../src/document/formats/psd/channel-image-codec.js"));
});

after(() => { if (restoreBrowserGlobals) restoreBrowserGlobals(); });

describe("document/formats/psd/channel-image-codec.js", () => {
  it("packBitsEncodeRow / packBitsDecodeRow round-trip a single row", () => {
    const input = new Uint8Array([10, 10, 10, 20, 30, 40, 40, 40]);
    const encoded = new Uint8Array(64);
    const encLen = ChannelImageCodec.packBitsEncodeRow(input, 0, input.length, encoded, 0);
    const decoded = new Uint8Array(input.length);
    ChannelImageCodec.packBitsDecodeRow(encoded, 0, encLen, decoded, 0);
    assert.deepEqual([...decoded], [...input]);
  });

  it("encodePackBits / decodePackBits round-trip a 2-row image (16-bit scanline table)", () => {
    const width = 4, height = 2;
    const input = new Uint8Array([1, 1, 1, 1, 2, 3, 4, 5]);
    const output = new Uint8Array(128);
    const tablePos = 0, dataPos = height * 2;
    ChannelImageCodec.encodePackBits(input, output, width, height, tablePos, dataPos, 2);
    const decoded = new Uint8Array(width * height);
    ChannelImageCodec.decodePackBits(output, decoded, width, height, tablePos, dataPos, 2);
    assert.deepEqual([...decoded], [...input]);
  });

  it("decompressChannel returns a zeroed padded buffer for empty input", () => {
    const buf = ChannelImageCodec.decompressChannel(false, 8, new Uint8Array(0), 4, 4, 0, 0, 0);
    assert.equal(buf.length, 16);
    assert.ok([...buf].every((b) => b === 0));
  });

  // A 32-bit document stores each sample as a big-endian float where 0..1 is
  // black to white. Read as bytes they came out as one sample smeared across
  // four pixels, which is what turned a 32-bit PSD into vertical stripes.
  describe("32-bit float channels", () => {
    /** `values` as the big-endian float samples of a raw channel. */
    function rawFloatChannel(values) {
      const bytes = new Uint8Array(values.length * 4);
      const view = new DataView(bytes.buffer);
      values.forEach((value, i) => view.setFloat32(i * 4, value, false));
      return bytes;
    }

    it("scales float samples into the byte range the compositor uses", () => {
      const samples = [0, 0.5, 1, 213 / 255];
      const decoded = ChannelImageCodec.decompressChannel(
        false, 32, rawFloatChannel(samples), samples.length, 1, 0, 0, samples.length * 4,
      );
      // `allocBuffer` aligns to four, so read the samples the callers read.
      assert.deepEqual([...decoded.subarray(0, samples.length)], [0, 128, 255, 213]);
      assert.ok(decoded.length < samples.length * 4, "still one byte per sample, not per input byte");
    });

    it("clamps samples outside the displayable range rather than wrapping", () => {
      const samples = [-0.5, 4, Number.NaN];
      const decoded = ChannelImageCodec.decompressChannel(
        false, 32, rawFloatChannel(samples), samples.length, 1, 0, 0, samples.length * 4,
      );
      assert.deepEqual([...decoded.subarray(0, samples.length)], [0, 255, 0]);
    });

    // Floats are predicted the way TIFF predicts them: the row is split into
    // byte planes and the deltas run along it. The 16-bit routine reads those
    // planes as samples, so it has to be a separate pass.
    it("undoes the float predictor, which is not the 16-bit one", () => {
      const width = 3;
      const samples = [0.25, 0.5, 0.75];
      const raw = rawFloatChannel(samples);
      // Encode: de-interleave into byte planes, then delta along the row.
      const planar = new Uint8Array(width * 4);
      for (let sample = 0; sample < width; sample++) {
        for (let plane = 0; plane < 4; plane++) planar[plane * width + sample] = raw[sample * 4 + plane];
      }
      const predicted = planar.slice();
      for (let i = planar.length - 1; i > 0; i--) predicted[i] = (planar[i] - planar[i - 1]) & 255;
      // The zip branch reads past a 2-byte header and stops 4 bytes early; the
      // stubbed inflate hands back whatever sits between.
      const zipFramed = new Uint8Array(predicted.length + 6);
      zipFramed.set(predicted, 2);

      const decoded = ChannelImageCodec.decompressChannel(
        false, 32, zipFramed, width, 1, 0, 3, zipFramed.length,
      );
      assert.deepEqual([...decoded.subarray(0, width)], [64, 128, 191]);
    });
  });
});
