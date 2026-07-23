import assert from "node:assert/strict";
import test from "node:test";
import { HelpRemindersFeature } from "../src/app/features/help-reminders.js";
import { HelpReminderIds } from "../src/app/help-reminder-policy.js";
import { BuildDefaultHelpPreferences } from "../shared/help-preferences.js";

test("the app offers one contextual reminder after startup", VerifyStartupReminder);
test("active work suppresses automatic help", VerifyBusySuppression);
test("hiding tips persists the setting and keeps the card closed", VerifyDisableFlow);

async function VerifyStartupReminder() {
  const feature = BuildFeature();
  feature.StartHelpReminders();
  await feature.HelpPreferenceSavePromise;
  assert.equal(feature.ShownReminder.id, HelpReminderIds.connectImdb);
  assert.equal(feature.HelpReminderShownThisSession, true);
  assert.equal(feature.Settings.helpPreferences.reminders[HelpReminderIds.connectImdb].shownCount, 1);
}

function VerifyBusySuppression() {
  const feature = BuildFeature();
  feature.State.locked = true;
  feature.StartHelpReminders();
  assert.equal(feature.ShownReminder, null);
}

async function VerifyDisableFlow() {
  const feature = BuildFeature();
  feature.StartHelpReminders();
  await feature.DisableHelpReminders();
  assert.equal(feature.Settings.helpPreferences.enabled, false);
  assert.equal(feature.ReminderHidden, true);
}

function BuildFeature() {
  const feature = new HelpRemindersFeature();
  feature.Elements = BuildElements();
  feature.Settings = { helpPreferences: BuildDefaultHelpPreferences() };
  feature.State = BuildState();
  feature.User = { id: "user-1" };
  feature.MediaSwitching = false;
  ConfigureFeatureTestDoubles(feature);
  feature.InitializeHelpReminderState();
  return feature;
}

function ConfigureFeatureTestDoubles(feature) {
  feature.ShownReminder = null;
  feature.ReminderHidden = false;
  feature.IsDialogOpen = () => false;
  feature.ShowHelpReminder = (reminder) => feature.ShownReminder = reminder;
  feature.HideHelpReminder = () => feature.ReminderHidden = true;
  feature.SaveAccountPreferences = async ({ helpPreferences }) => feature.Settings.helpPreferences = helpPreferences;
}

function BuildElements() {
  return {
    helpReminder: {},
    helpRemindersEnabled: { checked: true },
    helpRemindersStatus: { textContent: "" }
  };
}

function BuildState() {
  return {
    activeView: "rater",
    locked: false,
    live: { configured: false },
    ai: { configured: false, loading: false },
    letterboxd: { importedAt: "" }
  };
}

globalThis.document = { hidden: false, querySelector: () => null };
globalThis.window = {
  clearTimeout: () => undefined,
  setTimeout: (callback) => {
    callback();
    return 1;
  }
};
