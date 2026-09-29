import assert from "node:assert/strict";
import { it } from "node:test";
import { installTauriWindowMock, makeMockSettingsStore } from "../helpers/minimal-app-controller.js";
import { getRecipePrivacy, setRecipePrivacy } from "../../src/document/formats/metadata/generation-recipes.js";

it("generation privacy persists only booleans and restores without backend contact", async () => {
  const mock=makeMockSettingsStore(),restore=installTauriWindowMock({load:async()=>mock.store});
  let backendCalls=0;window.__TAURI__.core={invoke(){backendCalls++;throw Error("No backend allowed");}};
  try {
    const {saveRecipePrivacy,loadPersistedAppStateFromStore}=await import("../../src/core/app-settings.js");
    await saveRecipePrivacy({saveRecipes:true,savePrompts:true,prompt:"PRIVATE",recipe:{seed:42},endpoint:"http://localhost:8188"});
    assert.deepEqual(mock.saved,{generationPrivacy:{saveRecipes:true,savePrompts:true}});
    setRecipePrivacy();assert.equal(getRecipePrivacy().savePrompts,false);
    await loadPersistedAppStateFromStore();assert.deepEqual(getRecipePrivacy(),{saveRecipes:true,savePrompts:true});
    await saveRecipePrivacy({saveRecipes:false,savePrompts:false});assert.deepEqual(getRecipePrivacy(),{saveRecipes:false,savePrompts:false});
    delete mock.saved.generationPrivacy;await loadPersistedAppStateFromStore();assert.deepEqual(getRecipePrivacy(),{saveRecipes:true,savePrompts:false});
    assert.equal(backendCalls,0);
    const previous=mock.store.save;mock.store.save=async()=>{throw Error('Disk failure');};
    await assert.rejects(()=>saveRecipePrivacy({saveRecipes:false}),/Disk failure/);assert.deepEqual(getRecipePrivacy(),{saveRecipes:true,savePrompts:false});mock.store.save=previous;
  } finally {restore();setRecipePrivacy();}
});
