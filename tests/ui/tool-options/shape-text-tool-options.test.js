/**
 * tool-option panel split: exports + apply-tool dispatch shape.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
import { UiCommand } from "../../../src/core/event-bus.js";
import { Matrix2D } from "../../../src/core/math/matrix2d.js";

installBrowserGlobals();

let ToolOptionBase;
let BrushOptionBase;
let CropOptionBase;
let PaintBrushOption;
let CompactCropOption;
let TextFontOptionBase;
let dispatchApplyDocumentToolAction;

before(async () => {
  ({ ToolOptionBase, BrushOptionBase, CropOptionBase } = await import(
    "../../../src/ui/tool-options/tool-option-base.js"
  ));
  ({ PaintBrushOption } = await import(
    "../../../src/ui/tool-options/brush-fill-tool-options.js"
  ));
  ({
    CompactCropOption,
    TextFontOptionBase,
    dispatchApplyDocumentToolAction
  } = await import("../../../src/ui/tool-options/shape-text-tool-options.js"));
});

describe("ui/tool-options split", () => {
  it("free transform displays finite width and preserves it when editing height", () => {
    // Stub only view widgets; exercise the production event/affine paths.
    const widget = (suffix = "") => ({
      value: 0, setValue(value) { this.value = value; },
      getValue() { return this.value; }, getDisplaySuffix() { return suffix; }
    });
    const panel = Object.create(TextFontOptionBase.prototype);
    panel.body = document.createElement("div");
    panel.transformControlsSpan = document.createElement("span");
    panel.confirmWidget = { el: document.createElement("span") };
    panel.warpButton = { clearActive() {} };
    panel.transformInputs = {
      refPointAngle: widget(), xInput: widget(), yInput: widget(),
      widthInput: widget("%"), keepAspectBtn: { isPressed: () => false },
      heightInput: widget("%"), rotationInput: widget(),
      hSkewInput: widget(), vSkewInput: widget(), interpolationDropdown: widget()
    };
    const matrix = new Matrix2D(1.5, 0, 0, 2, 0, 0);
    panel.onToolEvent({ freeTransform: {
      boundsRect: { width: 200, height: 100 }, decomposedMatrix: matrix,
      refPointIndex: 4, refPoint: { x: 0, y: 0 }
    } });
    assert.equal(panel.transformInputs.widthInput.getValue(), 150);
    assert.equal(panel.transformInputs.heightInput.getValue(), 200);
    let action;
    panel.dispatchAction = value => { action = value; };
    panel.transformInputs.heightInput.setValue(125);
    panel.onTransformInput({ target: panel.transformInputs.heightInput });
    assert.equal(action.transformMatrix.a, 1.5);
    assert.equal(action.transformMatrix.d, 1.25);
    assert.ok(Object.values(action.transformMatrix).every(Number.isFinite));
  });

  it("exports bases and concrete panels", () => {
    assert.equal(typeof ToolOptionBase, "function");
    assert.equal(typeof BrushOptionBase, "function");
    assert.equal(typeof CropOptionBase, "function");
    assert.equal(typeof PaintBrushOption, "function");
    assert.equal(typeof CompactCropOption, "function");
    assert.equal(typeof TextFontOptionBase, "function");
  });

  it("dispatchApplyDocumentToolAction sets dispatchKind (not opaque e)", () => {
    const sent = [];
    const panel = {
      routingChannel: 42,
      dispatch(evt) {
        sent.push(evt);
      }
    };
    dispatchApplyDocumentToolAction(panel, { subAction: "commit" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].data.dispatchKind, UiCommand.applyDocumentToolAction);
    assert.equal(sent[0].data.routingChannel, 42);
    assert.equal(sent[0].data.subAction, "commit");
    assert.equal(sent[0].data.e, undefined);
  });
});
