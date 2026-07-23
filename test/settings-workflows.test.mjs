import assert from "node:assert/strict";
import test from "node:test";
import { SaveStreamingRegionFromDialog } from "../src/app/settings-workflows.js";

const NoOp = () => undefined;

test("viewing region settings update the streaming country", VerifyRegionSave);
test("viewing region settings reject an invalid country", VerifyInvalidCountry);

async function VerifyRegionSave() {
  const state = { preferences: [], errors: [], refreshed: 0 };
  await SaveStreamingRegionFromDialog(BuildApp(state, " ca "));
  assert.deepEqual(state.preferences, [{ streamingCountry: "CA" }]);
  assert.equal(state.refreshed, 1);
}

async function VerifyInvalidCountry() {
  const state = { preferences: [], errors: [], refreshed: 0 };
  await SaveStreamingRegionFromDialog(BuildApp(state, "Canada"));
  assert.match(state.errors[0], /two-letter streaming country code/);
  assert.deepEqual(state.preferences, []);
}

function BuildApp(state, country) {
  return {
    Elements: { regionCountry: { value: country } },
    ShowRegionError: (value) => state.errors.push(value),
    SetRegionSaving: NoOp,
    SaveAccountPreferences: async (value) => state.preferences.push(value),
    HideRegionDialog: NoOp,
    UpdateSettingsButtons: NoOp,
    RefreshVisibleMetadata: () => state.refreshed++,
    ShowToast: NoOp
  };
}
