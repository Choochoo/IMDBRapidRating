import assert from "node:assert/strict";
import test from "node:test";
import { CanShowHelpReminder, DisableHelpReminders, EnableHelpReminders, HelpReminderIds, RecordHelpReminderShown, SelectContextualHelpReminder, SelectHelpReminder, SnoozeHelpReminder } from "../src/app/help-reminder-policy.js";
import { BuildDefaultHelpPreferences, HelpReminderShowLimit, HelpReminderSnoozeDurationMs } from "../shared/help-preferences.js";

const ReminderId = "imdb-import";
const CompletedReminderId = "complete";
const FirstShownAt = new Date("2026-07-23T12:00:00.000Z");

function TestDefaultReminderEligibility() {
  const preferences = BuildDefaultHelpPreferences();
  assert.equal(CanShowHelpReminder(preferences, ReminderId, false, FirstShownAt), true);
  assert.equal(CanShowHelpReminder(preferences, ReminderId, true, FirstShownAt), false);
  assert.equal(CanShowHelpReminder(preferences, "Invalid reminder", false, FirstShownAt), false);
}

function TestReminderShowLimit() {
  let preferences = BuildDefaultHelpPreferences();
  for (let count = 0; count < HelpReminderShowLimit; count += 1)
    preferences = RecordHelpReminderShown(preferences, ReminderId, FirstShownAt);
  assert.equal(preferences.reminders[ReminderId].shownCount, HelpReminderShowLimit);
  assert.equal(CanShowHelpReminder(preferences, ReminderId, false, FirstShownAt), false);
}

function TestReminderSnooze() {
  const preferences = SnoozeHelpReminder(BuildDefaultHelpPreferences(), ReminderId, FirstShownAt);
  const beforeEnd = new Date(FirstShownAt.getTime() + HelpReminderSnoozeDurationMs - 1);
  const afterEnd = new Date(FirstShownAt.getTime() + HelpReminderSnoozeDurationMs + 1);
  assert.equal(CanShowHelpReminder(preferences, ReminderId, false, beforeEnd), false);
  assert.equal(CanShowHelpReminder(preferences, ReminderId, false, afterEnd), true);
}

function TestShownRecordContents() {
  const preferences = RecordHelpReminderShown(BuildDefaultHelpPreferences(), ReminderId, FirstShownAt);
  const record = preferences.reminders[ReminderId];
  assert.deepEqual(record, { shownCount: 1, lastShownAt: FirstShownAt.toISOString(), snoozedUntil: "" });
}

function TestReminderSelection() {
  const reminders = [{ id: CompletedReminderId }, { id: ReminderId }, { id: "later" }];
  const preferences = BuildDefaultHelpPreferences();
  const selected = SelectHelpReminder(reminders, preferences, [CompletedReminderId], FirstShownAt);
  assert.equal(selected, reminders[1]);
}

function TestReminderTogglePolicy() {
  const shown = RecordHelpReminderShown(BuildDefaultHelpPreferences(), ReminderId, FirstShownAt);
  const disabled = DisableHelpReminders(shown);
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.reminders, shown.reminders);
  assert.deepEqual(EnableHelpReminders(), BuildDefaultHelpPreferences());
}

function TestContextualReminderSelection() {
  const context = { view: "sync", imdbConnected: true, imdbImported: false, letterboxdImported: false, aiConnected: false };
  const reminder = SelectContextualHelpReminder(context, BuildDefaultHelpPreferences(), FirstShownAt);
  assert.equal(reminder.id, HelpReminderIds.importLetterboxd);
  assert.equal(reminder.actionLabel, "Yes, show me");
}

function TestContextualCompletion() {
  const context = { view: "rater", imdbConnected: true, imdbImported: true, letterboxdImported: false, aiConnected: false };
  assert.equal(SelectContextualHelpReminder(context, BuildDefaultHelpPreferences(), FirstShownAt), null);
}

test("default help reminders are eligible until completed", TestDefaultReminderEligibility);
test("help reminders stop after the appearance limit", TestReminderShowLimit);
test("not now snoozes a help reminder for seven days", TestReminderSnooze);
test("showing a reminder records an exact persistence entry", TestShownRecordContents);
test("selection skips completed reminders", TestReminderSelection);
test("help reminders can be disabled and reset", TestReminderTogglePolicy);
test("contextual reminders prioritize the current setup task", TestContextualReminderSelection);
test("contextual reminders derive completion from live app state", TestContextualCompletion);
