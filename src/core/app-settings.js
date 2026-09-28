import { setRecipePrivacy } from "../document/formats/metadata/generation-recipes.js";
import { GENERATIVE_MODEL, validateGenerativeConfig } from "../features/modernization/generative-workload.js";
/**
 * Tauri plugin-store persistence for application settings and editor prefs sync.
 */

import { Locale } from "./i18n/locale.js";
import { snapshotEditorParamsFromPrefs } from "./editor-preferences.js";
import { getInpaintConfig, setInpaintConfig, validateInpaintConfig } from "../features/modernization/inpaint-config.js";

/** Persisted under app_data_dir; see tauri-plugin-store. */
export const APP_SETTINGS_FILE = "settings.json";

const SETTINGS_VERSION = 1;

/** @type {Promise<import("@tauri-apps/plugin-store").Store> | null} */
let settingsStorePromise = null;

function getTauriStoreApi() {
  const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
  return tauri && tauri.store ? tauri.store : null;
}

async function openSettingsStore() {

  const storeApi = getTauriStoreApi();
  if (!storeApi || typeof storeApi.load !== "function") return null;

  if (!settingsStorePromise) {
    settingsStorePromise = storeApi.load(APP_SETTINGS_FILE, {
      autoSave: 100,
    });
  }

  return settingsStorePromise;
}

/** Copy store keys into the launch `environment` object shape when present. */
async function readEnvironmentFieldsFromStore(store) {
  const state = {};
  const lang = await store.get("lang");
  const theme = await store.get("theme");
  const panels = await store.get("panels");
  const eparams = await store.get("eparams");
  setInpaintConfig(await store.get("localInpainting"));
  setRecipePrivacy(await store.get("generationPrivacy"));

  if (lang != null) state.lang = lang;
  if (theme != null) state.theme = theme;
  if (panels != null) state.panels = panels;
  if (eparams != null) state.eparams = eparams;

  return Object.keys(state).length !== 0 ? state : null;
}

/** Configuration reads never probe the local service. */
export async function loadLocalInpaintConfig() {
  const store = await openSettingsStore();
  return store ? setInpaintConfig(await store.get("localInpainting")) : getInpaintConfig();
}
export async function saveLocalInpaintConfig(config) {
  if (config.enabled) validateInpaintConfig(config);
  const store = await openSettingsStore();
  if (!store) throw new Error("Local AI Remove settings require the PhotoSuite desktop application.");
  await store.set("localInpainting", { enabled: config.enabled === true, endpoint: config.endpoint, checkpoint: config.checkpoint });
  await store.save();
  return setInpaintConfig(config);
}

/**
 * Reads disk settings and returns a plain object for
 * {@link AppController.prototype.applyPersistedAppState}.
 * Keys match the launch `environment` payload (`lang`, `theme`, `panels`, `eparams`, …).
 */
export async function loadPersistedAppStateFromStore() {
  const store = await openSettingsStore();
  if (!store) return null;
  return readEnvironmentFieldsFromStore(store);
}

/** Snapshot editor prefs from the live controller into `eparams` for persistence. */
function buildEditorParamsSnapshot(prefs) {
  return snapshotEditorParamsFromPrefs(prefs);
}

/**
 * Snapshots user-facing prefs from the live controller into the store file.
 * Does not write `filesystem` — the Rust open dialog owns `lastOpenDirectory`.
 */
export async function persistAppSettings(appController) {

  const store = await openSettingsStore();
  if (!store) return;

  const appData = appController.appData;
  if (!appData || !appData.prefs) return;

  await store.set("version", SETTINGS_VERSION);
  await store.set("lang", Locale.getCurrentLanguageCode());
  await store.set("theme", appData.theme);
  await store.set("panels", appData.effectRows.slice());
  await store.set("eparams", buildEditorParamsSnapshot(appData.prefs));
  await store.save();
}

/**
 * Loads store settings into the controller, then continues startup.
 * URL / query-string launch config still wins when present (applied afterward).
 */
export async function applyStoredSettingsOnStartup(appController) {

  try {
    const storedState = await loadPersistedAppStateFromStore();
    if (storedState) appController.applyPersistedAppState(storedState);
  } catch (err) {
    console.warn("PhotoSuite: failed to load app settings", err);
  }
}

/** M6 stores only model configuration. Prompts and recipes never enter this store. */
export async function loadGenerativeConfig() {
  const settings = await loadLocalInpaintConfig(), store = await openSettingsStore();
  return { enabled: true, endpoint: settings.endpoint, checkpoint: (store && await store.get("generativeCheckpoint")) ?? GENERATIVE_MODEL };
}
export async function saveGenerativeCheckpoint(checkpoint) {
  const config = await loadGenerativeConfig(); validateGenerativeConfig({ ...config, checkpoint });
  const store = await openSettingsStore();
  if (!store) throw new Error("Generative Fill settings require the PhotoSuite desktop application.");
  await store.set("generativeCheckpoint", checkpoint); await store.save();
}

/** Only privacy booleans enter settings; never a prompt or recipe. */
export async function saveRecipePrivacy(value) {
  const next = { saveRecipes: value?.saveRecipes !== false, savePrompts: value?.savePrompts === true };
  const store = await openSettingsStore();
  if (!store) throw new Error("Generation privacy settings require the PhotoSuite desktop application.");
  await store.set("generationPrivacy", next); await store.save();
  return setRecipePrivacy(next);
}
