/**
 * The quick-select session: one superpixel graph of the layer being selected,
 * plus the selection the user has scribbled out of it so far.
 *
 * Breaking a layer into superpixels and measuring the boundaries between them
 * is expensive, so it happens once per layer and is kept here, keyed by a
 * fingerprint of the layer's index, bounds and first pixels. Painting with the
 * quick-select brush writes foreground or background marks into
 * `brushMaskBuffer`; `recomputeQuickSelectSelection` then resolves the marks
 * the graph has not seen yet into a minimum cut around them and folds the
 * result into the selection, so a stroke keeps adding to what earlier strokes
 * already claimed rather than starting over.
 *
 * There is one session because there is one layer being quick-selected at a
 * time on the legacy Object Select path. That path still analyses on the main
 * thread (a deferred banner is not worker execution). Quick Select brush jobs
 * use the separate modernization worker and do not rely on this fingerprint.
 */

import { AppEvent, EventType, UiCommand } from "../../core/event-bus.js";
import { createQuickSelectComputation, resetQuickSelectSelection, recomputeQuickSelectSelection } from "../../engine/compositing/quick-select-computation.js";
export { resetQuickSelectSelection, recomputeQuickSelectSelection, adoptDocumentSelection, hasDocumentSelectionDiverged } from "../../engine/compositing/quick-select-computation.js";

/** The live session. Its `key` is empty until a layer has been analysed. */
export const quickSelectSession = { key: "" };

/**
 * How far in from a selection rectangle's edges the foreground crosshair is
 * drawn, as a fraction of the rectangle. The object-select tool draws its
 * marquee with the same inset so what the user sees is what gets marked.
 */
export const CROSSHAIR_INSET_RATIO = 0.12;

/**
 * Rebuild the shared quick-select session when the target layer changes.
 * `analyseNow` runs the analysis inline, for the gesture that needs the
 * session in the same tick; otherwise it is deferred so the banner can paint.
 */
export function syncQuickSelectOverlay(doc, sessionState, dispatcher, analyseNow) {
  if (!doc || doc.selectedLayerIndices.length == 0) return;
  if (sessionState.key == getLayerFingerprint(doc)) return;
  sessionState.key = getLayerFingerprint(doc);
  const layerPixelCount = doc.layers[doc.selectedLayerIndices[0]].rect.area();
  if (layerPixelCount == 0) return;
  const loadingLabel = "Image Analysis ...";
  const showLoadingBanner = layerPixelCount > 1e6 && analyseNow != true;
  if (showLoadingBanner) {
    const loadingEvent = new AppEvent(EventType.uiDispatch, true);
    loadingEvent.data = {
      dispatchKind: UiCommand.showAnalysisLoadingBanner,
      bannerLabel: loadingLabel,
    };
    dispatcher.dispatch(loadingEvent);
  }
  const analyse = function() {
    const analysedSession = createQuickSelectSession(doc);
    for (const sessionKey in analysedSession) sessionState[sessionKey] = analysedSession[sessionKey];
    if (showLoadingBanner) {
      const hideLoadingEvent = new AppEvent(EventType.uiDispatch, true);
      hideLoadingEvent.data = {
        dispatchKind: UiCommand.hideAnalysisLoadingBanner,
        bannerLabel: loadingLabel,
      };
      dispatcher.dispatch(hideLoadingEvent);
    }
  };
  if (analyseNow) analyse();
  else setTimeout(analyse, 30);
}

export function getLayerFingerprint(doc) {
  const layerIndex = doc.selectedLayerIndices[0];
  const layer = doc.layers[layerIndex];
  const layerRect = layer.rect;
  const layerBuffer = layer.buffer;
  return [layerIndex, layerRect.x, layerRect.y, layerRect.width, layerRect.height, layerBuffer[0], layerBuffer[1], layerBuffer[2], layerBuffer[3]].join(",");
}

export function createQuickSelectSession(doc) {
  const layer = doc.layers[doc.selectedLayerIndices[0]];
  return { key: getLayerFingerprint(doc), ...createQuickSelectComputation(layer.buffer, layer.rect) };
}

/**
 * Seed the quick-select session's brush mask for a scripted object selection:
 * background marks around the rectangle border, foreground crosshair at the
 * centre, then cut within the rectangle.
 */
export function seedObjectSelectionMask(shapeRect) {
  const sessionState = quickSelectSession;
  const maskRect = sessionState.rect;
  const brushMaskBuffer = sessionState.brushMaskBuffer;
  const maskWidth = maskRect.width;
  const maskHeight = maskRect.height;
  const leftEdge = shapeRect.x - maskRect.x;
  const rightEdge = leftEdge + shapeRect.width - 1;
  const centerX = Math.max(leftEdge, Math.min(rightEdge, leftEdge + rightEdge >>> 1));
  const topEdge = shapeRect.y - maskRect.y;
  const bottomEdge = topEdge + shapeRect.height - 1;
  const centerY = Math.max(topEdge, Math.min(bottomEdge, topEdge + bottomEdge >>> 1));
  const clipLeft = Math.max(leftEdge, 0);
  const clipRight = Math.min(rightEdge, maskWidth);
  const clipTop = Math.max(topEdge, 0);
  const clipBottom = Math.min(bottomEdge, maskHeight);
  resetQuickSelectSelection(sessionState);
  if (0 <= topEdge) {
    for (let x = clipLeft; x < clipRight; x++) brushMaskBuffer[topEdge * maskWidth + x] = 0;
  }
  if (bottomEdge < maskHeight) {
    for (let x = clipLeft; x < clipRight; x++) brushMaskBuffer[bottomEdge * maskWidth + x] = 0;
  }
  if (0 <= leftEdge) {
    for (let y = clipTop; y < clipBottom; y++) brushMaskBuffer[y * maskWidth + leftEdge] = 0;
  }
  if (rightEdge < maskWidth) {
    for (let y = clipTop; y < clipBottom; y++) brushMaskBuffer[y * maskWidth + rightEdge] = 0;
  }
  const crosshairHalfWidth = Math.round(shapeRect.width * CROSSHAIR_INSET_RATIO);
  const crosshairHalfHeight = Math.round(shapeRect.height * CROSSHAIR_INSET_RATIO);
  for (let x = Math.max(0, centerX - crosshairHalfWidth); x < Math.min(maskWidth, centerX + crosshairHalfWidth); x++) brushMaskBuffer[centerY * maskWidth + x] = 255;
  for (let y = Math.max(0, centerY - crosshairHalfHeight); y < Math.min(maskHeight, centerY + crosshairHalfHeight); y++) brushMaskBuffer[y * maskWidth + centerX] = 255;
  recomputeQuickSelectSelection(sessionState, { windowRect: shapeRect });
  return {
    channel: sessionState.selectionMaskBuffer.slice(0),
    rect: maskRect.clone(),
  };
}
