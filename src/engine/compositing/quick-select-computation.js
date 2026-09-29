/** Editor-independent graph-cut state. All arrays belong to the caller. */
import { allocBuffer } from "./buffer-utils.js";
import { buildQuickSelectColorAnalysis } from "./color-range.js";
import { copyChannel } from "./pixel-ops.js";
import { buildSuperpixelGraph, collectMarkedSegments, cutRegionFromSeeds, fitColorClusters, rasterizeSegmentSelection, refineMaskBoundary } from "./quick-select-graph-cut.js";
const UNMARKED = 128;

export function createQuickSelectComputation(layerBuffer, layerRect) {
  const rectWidth = layerRect.width;
  const rectHeight = layerRect.height;
  const pixelCount = rectWidth * rectHeight;
  const brushMaskBuffer = allocBuffer(pixelCount);
  brushMaskBuffer.fill(UNMARKED);
  const segmentation = buildQuickSelectColorAnalysis(layerBuffer, rectWidth, rectHeight);
  const graph = buildSuperpixelGraph(layerBuffer, rectWidth, rectHeight, segmentation);
  return {
    layerRgbaBuffer: layerBuffer,
    rect: layerRect.clone(),
    imageWidth: rectWidth,
    imageHeight: rectHeight,
    brushMaskBuffer: brushMaskBuffer,
    segmentation: segmentation,
    graph: graph,
    selectedSegments: new Uint8Array(graph.segmentCount),
    resolvedForeground: new Uint8Array(graph.segmentCount),
    resolvedBackground: new Uint8Array(graph.segmentCount),
    selectionMaskBuffer: allocBuffer(pixelCount),
    brushRadius: 0,
    baseSelectionMask: null,
    baseSelectionSegments: null,
    emittedSelection: null,
  };
}

/** Drop the scribbles and the selection, for a stroke that starts fresh. */
export function resetQuickSelectSelection(sessionState) {
  if (sessionState.graph == null) return;
  sessionState.brushMaskBuffer.fill(UNMARKED);
  sessionState.selectedSegments.fill(0);
  sessionState.resolvedForeground.fill(0);
  sessionState.resolvedBackground.fill(0);
  sessionState.selectionMaskBuffer.fill(0);
  sessionState.baseSelectionMask = null;
  sessionState.baseSelectionSegments = null;
  sessionState.emittedSelection = null;
}

/**
 * Start again from the selection the document holds now.
 *
 * The session's scribbles only describe the selection it produced itself, so
 * once the document's selection comes from somewhere else — a history step, a
 * marquee, a deselect — they describe nothing. The scribbles are dropped and
 * the selection that is there becomes the ground the next stroke adds to: it
 * is kept pixel for pixel, so a feathered or hand-drawn selection survives
 * being added to, and only what a stroke marks as background is taken back
 * out of it.
 */
export function adoptDocumentSelection(sessionState, selectionMask) {
  if (sessionState.graph == null) return;
  resetQuickSelectSelection(sessionState);
  if (selectionMask == null) return;
  const graph = sessionState.graph;
  const pixelCount = sessionState.imageWidth * sessionState.imageHeight;
  const baseMask = allocBuffer(pixelCount);
  copyChannel(selectionMask.channel, selectionMask.rect, baseMask, sessionState.rect);
  sessionState.baseSelectionMask = baseMask;
  sessionState.selectionMaskBuffer.set(baseMask);
  // Which superpixels the adopted selection covers. A background stroke over
  // one of them has to be able to cut the region it belongs to back out, so
  // they join the superpixels this session selected itself as ground a
  // subtracting cut may take.
  const coveredCounts = new Uint32Array(graph.segmentCount);
  const segmentSizes = new Uint32Array(graph.segmentCount);
  for (let pixelIdx = 0; pixelIdx < pixelCount; pixelIdx++) {
    const segId = graph.labels[pixelIdx];
    segmentSizes[segId]++;
    if (baseMask[pixelIdx] > 127) coveredCounts[segId]++;
  }
  const baseSegments = new Uint8Array(graph.segmentCount);
  for (let segId = 0; segId < graph.segmentCount; segId++) {
    if (coveredCounts[segId] * 2 > segmentSizes[segId]) baseSegments[segId] = 1;
  }
  sessionState.baseSelectionSegments = baseSegments;
}

/** True when the document's selection is no longer the one this session made. */
export function hasDocumentSelectionDiverged(sessionState, selectionMask) {
  return sessionState.graph != null && sessionState.emittedSelection !== selectionMask;
}

/**
 * Fold whatever the brush has marked since the last pass into the selection.
 *
 * Foreground marks grow a cut around themselves and are added; background
 * marks cut a region back out of what is already selected. Marks the graph has
 * already resolved are left alone, so dragging the brush back over ground it
 * has covered neither re-runs the cut nor undoes it.
 */
export function recomputeQuickSelectSelection(sessionState, options) {
  const graph = sessionState.graph;
  if (graph == null) return;
  const settings = options == null ? {} : options;
  const pixelCount = sessionState.imageWidth * sessionState.imageHeight;
  const marks = collectMarkedSegments(graph, sessionState.brushMaskBuffer, pixelCount);
  const selectedSegments = sessionState.selectedSegments;

  const freshForeground = marks.foregroundSegments.filter((segId) => sessionState.resolvedForeground[segId] == 0);
  const freshBackground = marks.backgroundSegments.filter((segId) => sessionState.resolvedBackground[segId] == 0);
  if (freshForeground.length == 0 && freshBackground.length == 0) return;

  if (freshForeground.length != 0) {
    const grown = cutRegionFromSeeds(graph, freshForeground, marks.backgroundSegments, {
      modelSegments: marks.foregroundSegments,
      brushRadius: sessionState.brushRadius,
      windowRect: settings.windowRect,
    });
    for (let segId = 0; segId < graph.segmentCount; segId++) if (grown[segId]) selectedSegments[segId] = 1;
  }
  let removedSegments = null;
  if (freshBackground.length != 0) {
    removedSegments = cutRegionFromSeeds(graph, freshBackground, marks.foregroundSegments, {
      modelSegments: marks.backgroundSegments,
      brushRadius: sessionState.brushRadius,
      candidateSegments: subtractableSegments(sessionState, selectedSegments),
      windowRect: settings.windowRect,
    });
    for (let segId = 0; segId < graph.segmentCount; segId++) if (removedSegments[segId]) selectedSegments[segId] = 0;
    for (let i = 0; i < marks.backgroundSegments.length; i++) removedSegments[marks.backgroundSegments[i]] = 1;
  }
  // What the brush was dragged over is what the user asked for, whichever way
  // the cut around it went.
  for (let i = 0; i < marks.foregroundSegments.length; i++) {
    const segId = marks.foregroundSegments[i];
    selectedSegments[segId] = 1;
    sessionState.resolvedForeground[segId] = 1;
    sessionState.resolvedBackground[segId] = 0;
  }
  for (let i = 0; i < marks.backgroundSegments.length; i++) {
    const segId = marks.backgroundSegments[i];
    selectedSegments[segId] = 0;
    sessionState.resolvedBackground[segId] = 1;
    sessionState.resolvedForeground[segId] = 0;
  }

  const selectionMaskBuffer = sessionState.selectionMaskBuffer;
  rasterizeSegmentSelection(graph.labels, selectedSegments, selectionMaskBuffer, pixelCount);
  const boundaryModels = fitBoundaryColorModels(graph, selectedSegments);
  if (boundaryModels != null) {
    refineMaskBoundary(sessionState.layerRgbaBuffer, sessionState.imageWidth, sessionState.imageHeight,
      selectionMaskBuffer, boundaryModels.foreground, boundaryModels.background);
  }
  const baseMask = sessionState.baseSelectionMask;
  if (baseMask == null) return;
  // The selection this session inherited is kept as it was, minus whatever a
  // background scribble has since cut out of it.
  if (removedSegments != null) {
    for (let pixelIdx = 0; pixelIdx < pixelCount; pixelIdx++) if (removedSegments[graph.labels[pixelIdx]]) baseMask[pixelIdx] = 0;
  }
  for (let pixelIdx = 0; pixelIdx < pixelCount; pixelIdx++) {
    if (baseMask[pixelIdx] > selectionMaskBuffer[pixelIdx]) selectionMaskBuffer[pixelIdx] = baseMask[pixelIdx];
  }
}

/**
 * The superpixels a background stroke is allowed to cut out: the ones this
 * session selected, plus the ones the selection it adopted covers.
 */
function subtractableSegments(sessionState, selectedSegments) {
  const baseSegments = sessionState.baseSelectionSegments;
  if (baseSegments == null) return selectedSegments.slice(0);
  const subtractable = selectedSegments.slice(0);
  for (let segId = 0; segId < subtractable.length; segId++) if (baseSegments[segId]) subtractable[segId] = 1;
  return subtractable;
}

/**
 * Colour models for pulling the mask boundary off the superpixel grid: the
 * selected superpixels on one side, and the unselected superpixels that touch
 * them on the other. Null when the selection has no boundary to refine.
 */
function fitBoundaryColorModels(graph, selectedSegments) {
  const foregroundSegments = [];
  const backgroundSegments = [];
  for (let segId = 0; segId < graph.segmentCount; segId++) {
    if (selectedSegments[segId]) {
      foregroundSegments.push(segId);
      continue;
    }
    const arcEnd = graph.arcStart[segId + 1];
    for (let arc = graph.arcStart[segId]; arc < arcEnd; arc++) {
      if (selectedSegments[graph.arcSegment[arc]]) {
        backgroundSegments.push(segId);
        break;
      }
    }
  }
  if (foregroundSegments.length == 0 || backgroundSegments.length == 0) return null;
  return {
    foreground: fitColorClusters(graph, foregroundSegments, 4),
    background: fitColorClusters(graph, backgroundSegments, 4),
  };
}
