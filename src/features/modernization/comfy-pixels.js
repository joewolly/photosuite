/** Reviewed ComfyUI working-resolution adapter. No document coordinates are inferred. */
export function comfyWorkingSize(rect) { return { modelWidth: Math.max(512, Math.ceil(rect.width / 8) * 8), modelHeight: Math.max(512, Math.ceil(rect.height / 8) * 8) }; }
/** Compatibility adaptation stays below the capability port, including masked padding. */
export function prepareComfyMasked(input, configuration) {
  const { modelWidth, modelHeight } = comfyWorkingSize(input.rect);
  const rgba = new Uint8Array(modelWidth * modelHeight * 4), mask = new Uint8Array(modelWidth * modelHeight);
  for (let y = 0; y < modelHeight; y++) for (let x = 0; x < modelWidth; x++) {
    const source = (Math.min(y, input.rect.height - 1) * input.rect.width + Math.min(x, input.rect.width - 1)) * 4;
    rgba.set(input.rgba.subarray(source, source + 4), (y * modelWidth + x) * 4);
    if (x < input.rect.width && y < input.rect.height) mask[y * modelWidth + x] = input.mask[y * input.rect.width + x];
  }
  return { ...input, rgba, mask, modelWidth, modelHeight, modelOffset: { x: 0, y: 0 }, config: configuration };
}
