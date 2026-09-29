/** Passive M7 provenance. No provider, graph, URL, filesystem or execution authority. */
export const RECIPE_NAMESPACE = "https://photosuite.app/ns/generation/1.0/";
export const RECIPE_SCHEMA = 1;
export const RECIPE_LIMITS = Object.freeze({ promptBytes: 2048, records: 64, metadataBytes: 256 * 1024, recordBytes: 8192, xmpBytes: 2 * 1024 * 1024 });
export const RECIPE_FIELD = "photosuite:generation";
const recipes = new WeakMap();
let privacy = Object.freeze({ saveRecipes: true, savePrompts: false });
export function getRecipePrivacy() { return { ...privacy }; }
export function setRecipePrivacy(value) {
  privacy = Object.freeze({ saveRecipes: value?.saveRecipes !== false, savePrompts: value?.savePrompts === true });
  return getRecipePrivacy();
}
const utf8 = value => new TextEncoder().encode(value).length;
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const layerId = value => uint(value) && value > 0;
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const rect = value => value && ["x", "y", "width", "height"].every(key => Number.isSafeInteger(value[key]))
  && Math.abs(value.x) <= 1000000 && Math.abs(value.y) <= 1000000 && value.width > 0 && value.height > 0
  && value.width <= 8192 && value.height <= 8192 && value.width * value.height <= 4 * 1024 * 1024;
const copyRect = value => ({ x: value.x, y: value.y, width: value.width, height: value.height });
const text = (value, bytes) => typeof value === "string" && utf8(value) <= bytes
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/.test(value)
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

/** Whitelist, type-check and copy every field. Never retain arbitrary JSON properties. */
export function normalizeRecipe(value) {
  if (!value || value.recipeVersion !== 1 || !layerId(value.layerId) || value.operation !== "generate.fill"
    || value.workflow !== "photosuite-generative-fill-v1" || value.backend !== "comfyui"
    || !text(value.checkpoint, 240) || !value.checkpoint || !uint(value.seed)
    || !text(value.createdAt, 24) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)
    || !Number.isFinite(Date.parse(value.createdAt)) || value.selectionPersistence !== "none") return null;
  if (value.prompt !== undefined && (!text(value.prompt, RECIPE_LIMITS.promptBytes) || value.prompt.length > 1024)) return null;
  const source = value.source, selection = value.selection, settings = value.settings;
  if (!source || !(source.layerId === null || layerId(source.layerId)) || !hash(source.sha256) || !rect(source.rect)
    || !Number.isInteger(source.documentWidth) || source.documentWidth < 1 || source.documentWidth > 32768
    || !Number.isInteger(source.documentHeight) || source.documentHeight < 1 || source.documentHeight > 32768
    || !selection || !hash(selection.sha256) || !rect(selection.rect)
    || !settings || settings.steps !== 20 || settings.cfg !== 7 || settings.sampler !== "euler"
    || settings.scheduler !== "normal" || settings.denoise !== 1 || settings.maskGrowth !== 0
    || !rect(settings.roi) || settings.roi.width > 1024 || settings.roi.height > 1024
    || settings.modelWidth !== Math.max(512, Math.ceil(settings.roi.width / 8) * 8)
    || settings.modelHeight !== Math.max(512, Math.ceil(settings.roi.height / 8) * 8)) return null;
  return {
    recipeVersion: 1, layerId: value.layerId, operation: "generate.fill", workflow: value.workflow,
    backend: "comfyui", checkpoint: value.checkpoint, seed: value.seed, createdAt: value.createdAt,
    ...(value.prompt === undefined ? {} : { prompt: value.prompt }),
    settings: { steps: 20, cfg: 7, sampler: "euler", scheduler: "normal", denoise: 1, maskGrowth: 0,
      roi: copyRect(settings.roi), modelWidth: settings.modelWidth, modelHeight: settings.modelHeight },
    source: { layerId: source.layerId, sha256: source.sha256, rect: copyRect(source.rect), documentWidth: source.documentWidth, documentHeight: source.documentHeight },
    selection: { sha256: selection.sha256, rect: copyRect(selection.rect) }, selectionPersistence: "none",
  };
}
export function normalizeRecipes(value) {
  if (!value || value.schemaVersion !== RECIPE_SCHEMA || !Array.isArray(value.records) || value.records.length > RECIPE_LIMITS.records) return null;
  const seen = new Set(), duplicates = new Set();
  for (const record of value.records) { if (seen.has(record?.layerId)) duplicates.add(record?.layerId); seen.add(record?.layerId); }
  const records = [];
  let size = 0;
  for (const item of value.records) {
    if (duplicates.has(item?.layerId)) continue;
    const record = normalizeRecipe(item);
    if (!record) continue;
    const bytes = utf8(JSON.stringify(record));
    if (bytes > RECIPE_LIMITS.recordBytes) continue;
    size += bytes;
    if (size > RECIPE_LIMITS.metadataBytes) return null;
    records.push(record);
  }
  return records.length ? { schemaVersion: RECIPE_SCHEMA, records } : null;
}
function uniqueLayers(doc) {
  const map = new Map();
  for (const layer of doc.layers) {
    const id = layer.add?.lyid;
    if (layerId(id)) map.set(id, map.has(id) ? null : layer);
  }
  return map;
}
function raster(layer) { return layer?.add?.lsct === 0 && layer.hasPixelData() && !layer.add.TySh && !layer.add.placedData && !layer.hasFillContent(); }
export function setLayerRecipe(layer, value) {
  const record = normalizeRecipe(value);
  if (!record || record.layerId !== layer.add.lyid || !raster(layer)) return false;
  recipes.set(layer, record); return true;
}
export function getLayerRecipe(doc, layer) {
  const value = layer && recipes.get(layer);
  return value && uniqueLayers(doc).get(value.layerId) === layer && layer.add.lyid === value.layerId && raster(layer) ? normalizeRecipe(value) : null;
}
/** Binding uses IDs as parsed, before any editor ID repair. Missing/duplicate IDs never bind. */
export function bindDocumentRecipes(doc, value) {
  const data = normalizeRecipes(value), layers = uniqueLayers(doc);
  if (data) for (const record of data.records) {
    const layer = layers.get(record.layerId);
    if (layer) setLayerRecipe(layer, record);
  }
}
/** Only live, unambiguous layers are serialized. Deleted/undone layers cannot leave orphan records. */
export function collectDocumentRecipes(doc) {
  if (!privacy.saveRecipes) return null;
  const records = [], layers = uniqueLayers(doc);
  for (const layer of doc.layers) {
    const value = recipes.get(layer);
    if (!value || layers.get(value.layerId) !== layer || layer.add.lyid !== value.layerId || !raster(layer)) continue;
    const record = normalizeRecipe(value);
    if (!record) continue;
    if (!privacy.savePrompts) delete record.prompt;
    records.push(record);
    if (records.length === RECIPE_LIMITS.records) break;
  }
  return normalizeRecipes({ schemaVersion: 1, records });
}
async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
/** Called only for an explicit M6 generation; digest copies input before yielding. */
export async function captureRecipeSource(doc, layer) {
  const selection = doc.selectionMask, sourceRect = copyRect(layer.rect), selectionRect = copyRect(selection.rect);
  const id = uniqueLayers(doc).get(layer.add.lyid) === layer ? layer.add.lyid : null;
  const documentWidth = doc.width, documentHeight = doc.height;
  const [pixels, coverage] = await Promise.all([sha256(layer.buffer), sha256(selection.channel.subarray(0, selectionRect.width * selectionRect.height))]);
  return { source: { layerId: id, rect: sourceRect, documentWidth, documentHeight, sha256: pixels }, selection: { rect: selectionRect, sha256: coverage } };
}
export function createGenerationRecipe(session, index) {
  if (!session.provenance) return null;
  return { recipeVersion: 1, layerId: 1, operation: "generate.fill", workflow: session.workflow, backend: "comfyui",
    checkpoint: session.input.config.checkpoint, seed: session.seeds[index], createdAt: session.completedAt[index], prompt: session.settings.prompt,
    settings: { steps: 20, cfg: 7, sampler: "euler", scheduler: "normal", denoise: 1, maskGrowth: 0,
      roi: copyRect(session.input.rect), modelWidth: session.input.modelWidth, modelHeight: session.input.modelHeight },
    ...session.provenance, selectionPersistence: "none" };
}
/** Informational, local-only source check; never authorizes execution, even on a match. */
export async function recipeAvailability(doc, layer) {
  const record = getLayerRecipe(doc, layer);
  if (!record) return { available: false, reason: "No supported, unambiguous generation recipe." };
  const source = uniqueLayers(doc).get(record.source.layerId);
  if (!source || !raster(source) || !rect(source.rect) || doc.width !== record.source.documentWidth || doc.height !== record.source.documentHeight
    || JSON.stringify(copyRect(source.rect)) !== JSON.stringify(record.source.rect)
    || !source.buffer || source.buffer.length !== source.rect.width * source.rect.height * 4
    || await sha256(source.buffer) !== record.source.sha256) return { available: false, reason: "Original generation source no longer matches this recipe." };
  return { available: false, reason: "Source pixels match. Regenerate is unavailable: exact selection coverage is not saved in recipe v1. Make a new selection to start a new Generative Fill." };
}
