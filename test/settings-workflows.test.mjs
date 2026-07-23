import assert from "node:assert/strict";
import test from "node:test";
import { SaveTmdbSettingsFromDialog } from "../src/app/settings-workflows.js";

test("TMDB settings update the streaming country without replacing a saved key", VerifyCountryOnlySave);
test("TMDB settings reject an invalid streaming country", VerifyInvalidCountry);

async function VerifyCountryOnlySave() {
  const state = { preferences: [], secrets: [], errors: [], refreshed: 0 };
  await SaveTmdbSettingsFromDialog(BuildApp(state, "", " ca "));
  assert.deepEqual(state.secrets, []);
  assert.deepEqual(state.preferences, [{ streamingCountry: "CA" }]);
  assert.equal(state.refreshed, 1);
}

async function VerifyInvalidCountry() {
  const state = { preferences: [], secrets: [], errors: [], refreshed: 0 };
  await SaveTmdbSettingsFromDialog(BuildApp(state, "", "Canada"));
  assert.match(state.errors[0], /two-letter streaming country code/);
  assert.deepEqual(state.preferences, []);
}

function BuildApp(state, apiKey, country) {
  return {
    Elements: { tmdbInput: { value: apiKey }, tmdbCountry: { value: country } },
    ShowTmdbError: (value) => state.errors.push(value),
    SetTmdbSaving() {},
    SaveAccountSecret: async (type, value) => state.secrets.push({ type, value }),
    SaveAccountPreferences: async (value) => state.preferences.push(value),
    RefreshLiveStatus: async () => {},
    HideTmdbDialog() {},
    RefreshVisibleMetadata: () => state.refreshed++,
    ShowToast() {}
  };
}
