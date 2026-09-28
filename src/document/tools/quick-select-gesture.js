/** Existing brush rasterizer, with no paint target or document mutation. */
import { BrushStroke } from "../../features/brush/brush-stroke.js";
import { showToast } from "../../core/user-prompts.js";
import { KeyboardHandler } from "../../core/keyboard-handler.js";
import { getDevicePixelRatio } from "../../core/dom.js";
import { AxisDragAnchor } from "../model/axis-drag-anchor.js";

export function beginQuickSelectGesture(tool, doc, controller, appData, keyboard, pointer) {
  try {
    const bounds = controller.getSelectionJobs().begin(doc, tool.toolOptions.qsmode);
    const stroke = new BrushStroke(tool.toolOptions.brush, appData.brushPresets.samples, appData.brushPresets.patterns,
      { opacity: 1, smoothing: tool.toolOptions.smth * 50 * getDevicePixelRatio() / doc.pathViewport.zoomScale,
        pixelSnap: tool.toolOptions.emode === 1, gp: tool.toolOptions.prsr }, tool.toolOptions.qsmode === 2 ? 0 : 16777215, 0, bounds, new Uint8Array(bounds.area() * 4));
    const point = doc.pathViewport.screenToDocPoint(pointer.x, pointer.y);
    if (keyboard.isPressed(KeyboardHandler.Shift) && tool.lastStrokePointDoc) {
      const anchor = tool.lastStrokePointDoc;
      stroke.moveTo(anchor.x, anchor.y, pointer.pressure);
      stroke.lineTo(.001 * anchor.x + .999 * point.x, .001 * anchor.y + .999 * point.y, pointer.pressure);
      stroke.lineTo(point.x, point.y, pointer.pressure);
    } else stroke.moveTo(point.x, point.y, pointer.pressure);
    tool.lastStrokePointDoc = point;
    tool.selectionGesture = { doc, stroke, bounds, anchor: new AxisDragAnchor(point, doc.pathViewport.rotationRadians), radius: tool.toolOptions.brush.Brsh.v.diameter.v.val / 2 };
  } catch (error) { tool.selectionGesture = null; showToast(error.message); }
}
export function moveQuickSelectGesture(tool, doc, keyboard, pointer) {
  const gesture = tool.selectionGesture;
  if (!gesture || gesture.doc !== doc || !pointer.isDown) return;
  const point = gesture.anchor.constrainAxisDragPoint(doc.pathViewport.screenToDocPoint(pointer.x, pointer.y), keyboard);
  if (point.equals(tool.lastStrokePointDoc)) return;
  gesture.stroke.lineTo(point.x, point.y, pointer.pressure);
  tool.lastStrokePointDoc = point;
}
export function finishQuickSelectGesture(tool, doc, controller) {
  const gesture = tool.selectionGesture;
  tool.selectionGesture = null;
  if (!gesture || gesture.doc !== doc) return;
  gesture.stroke.finish();
  const dirty = gesture.stroke.getDirtyBounds();
  if (dirty.isEmpty()) { controller.getSelectionJobs().abandonGesture(doc); return; }
  const rgba = gesture.stroke.getBuffer();
  const marks = new Uint8Array(dirty.area()).fill(128);
  for (let y = 0; y < dirty.height; y++) for (let x = 0; x < dirty.width; x++) {
    const offset = ((dirty.y - gesture.bounds.y + y) * gesture.bounds.width + dirty.x - gesture.bounds.x + x) * 4;
    if (rgba[offset + 3] === 255 && (rgba[offset] === 0 || rgba[offset] === 255)) marks[y * dirty.width + x] = rgba[offset];
  }
  try {
    controller.getSelectionJobs().submitStroke(doc, { rect: { x: dirty.x, y: dirty.y, width: dirty.width, height: dirty.height }, marks, radius: gesture.radius });
    if (tool.toolOptions.qsmode === 0) tool.dispatchToolOptionUpdate({ qsmode: 1 }, controller);
  } catch (error) { showToast(error.message); }
}
