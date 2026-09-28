import { KeyboardHandler } from "../../core/keyboard-handler.js";
import { getDevicePixelRatio } from "../../core/dom.js";
import { showToast } from "../../core/user-prompts.js";

/** Input is already in viewport pixels; its inverse matrix includes pan/zoom/rotation/DPI. */
export function promptPoint(doc, pointer) {
  const point = doc.pathViewport.screenToDocPoint(pointer.x, pointer.y);
  return { x: point.x, y: point.y };
}
function boxBetween(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }; }
export function beginPromptedGesture(tool, doc, keyboard, pointer) {
  tool.promptedGesture = { doc, start: promptPoint(doc, pointer), screenStart: { x: pointer.x, y: pointer.y }, negative: keyboard.isPressed(KeyboardHandler.Alt) || tool.toolOptions.objectPromptKind === "negative", dragged: false };
}
export function movePromptedGesture(tool, doc, pointer) {
  const g = tool.promptedGesture;
  if (!g || g.doc !== doc || !pointer.isDown) return;
  g.dragged ||= Math.hypot(pointer.x - g.screenStart.x, pointer.y - g.screenStart.y) > 5 * getDevicePixelRatio();
  if (!g.dragged) return;
  const b = boxBetween(g.start, promptPoint(doc, pointer));
  doc.toolOverlayState.overlayTransform = { coords: [b.x, b.y, b.x + b.width, b.y, b.x + b.width, b.y + b.height, b.x, b.y + b.height], commands: ["M", "L", "L", "L", "Z"] };
  doc.dirty = true;
}
export function finishPromptedGesture(tool, doc, controller, pointer) {
  const g = tool.promptedGesture; tool.promptedGesture = null;
  if (!g) return;
  g.doc.toolOverlayState.overlayTransform = null; g.doc.dirty = true;
  if (g.doc !== doc || !controller.openDocs.includes(doc)) return;
  const end = promptPoint(doc, pointer);
  const dragged = g.dragged || Math.hypot(pointer.x - g.screenStart.x, pointer.y - g.screenStart.y) > 5 * getDevicePixelRatio();
  try { controller.getSelectionJobs().submitPrompt(doc, dragged ? { kind: "box", ...boxBetween(g.start, end) } : { kind: g.negative ? "negative" : "positive", ...end }); }
  catch (error) { showToast(error.message); }
}
