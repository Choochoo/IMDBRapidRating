import { BuildDefaultHelpPreferences, HelpReminderShowLimit, HelpReminderSnoozeDurationMs, NormalizeHelpPreferences } from "../../shared/help-preferences.js";
import { SetupGuideFlowIds } from "./setup-guide-definitions.js";

const HelpReminderIdPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/;

const HelpReminderIdValues = {
  connectImdb: "connect-imdb",
  importImdb: "import-imdb",
  importLetterboxd: "import-letterboxd",
  connectAi: "connect-ai"
};
export const HelpReminderIds = Object.freeze(HelpReminderIdValues);

const HelpReminderValues = {
  [HelpReminderIds.connectImdb]: BuildReminder("Connect IMDb once so ratings made here can reach your account.", SetupGuideFlowIds.connectImdb, "sign-in-imdb"),
  [HelpReminderIds.importImdb]: BuildReminder("Already rated on IMDb? Import once to skip repeats and make recommendations stronger.", SetupGuideFlowIds.importImdbRatings, "open-imdb-exports"),
  [HelpReminderIds.importLetterboxd]: BuildReminder("Import your Letterboxd export to unlock simple two-way sync without sharing a password.", SetupGuideFlowIds.importLetterboxd, "open-letterboxd-data"),
  [HelpReminderIds.connectAi]: BuildReminder("Connect an OpenAI-compatible service when you want personal watchlist ideas.", SetupGuideFlowIds.connectOpenAi, "create-openai-key")
};
export const HelpReminders = Object.freeze(HelpReminderValues);

export function CanShowHelpReminder(preferences, reminderId, completed = false, now = new Date()) {
  const normalized = NormalizeHelpPreferences(preferences);
  if (!normalized.enabled || completed || !IsHelpReminderId(reminderId))
    return false;
  const reminder = normalized.reminders[reminderId];
  if (!reminder)
    return true;
  if (reminder.shownCount >= HelpReminderShowLimit)
    return false;
  return !IsHelpReminderSnoozed(reminder, now);
}

export function SelectHelpReminder(reminders, preferences, completedIds = [], now = new Date()) {
  if (!Array.isArray(reminders))
    return null;
  const completed = new Set(completedIds);
  return reminders.find((reminder) => CanShowHelpReminder(preferences, reminder?.id, completed.has(reminder?.id), now)) || null;
}

export function SelectContextualHelpReminder(context, preferences, now = new Date()) {
  const reminders = ReadReminderOrder(context.view).map((id) => ({ id, ...HelpReminders[id] }));
  const completedIds = ReadCompletedReminderIds(context);
  return SelectHelpReminder(reminders, preferences, completedIds, now);
}

export function RecordHelpReminderShown(preferences, reminderId, now = new Date()) {
  const next = BuildEditableHelpPreferences(preferences);
  if (!IsHelpReminderId(reminderId))
    return next;
  const current = BuildHelpReminderRecord(next.reminders[reminderId]);
  current.shownCount = Math.min(current.shownCount + 1, HelpReminderShowLimit);
  current.lastShownAt = BuildIsoTimestamp(now);
  current.snoozedUntil = "";
  next.reminders[reminderId] = current;
  return next;
}

export function SnoozeHelpReminder(preferences, reminderId, now = new Date()) {
  const next = BuildEditableHelpPreferences(preferences);
  if (!IsHelpReminderId(reminderId))
    return next;
  const current = BuildHelpReminderRecord(next.reminders[reminderId]);
  const snoozeEnd = ReadTimestamp(now) + HelpReminderSnoozeDurationMs;
  current.snoozedUntil = new Date(snoozeEnd).toISOString();
  next.reminders[reminderId] = current;
  return next;
}

export function DisableHelpReminders(preferences) {
  const next = BuildEditableHelpPreferences(preferences);
  next.enabled = false;
  return next;
}

export function EnableHelpReminders() {
  return BuildDefaultHelpPreferences();
}

export function SetHelpRemindersEnabled(preferences, enabled) {
  return enabled ? EnableHelpReminders() : DisableHelpReminders(preferences);
}

function ReadReminderOrder(view) {
  if (view === "sync")
    return [HelpReminderIds.importLetterboxd, HelpReminderIds.importImdb, HelpReminderIds.connectImdb];
  if (view === "ai" || view === "ai-settings")
    return [HelpReminderIds.connectAi, HelpReminderIds.importImdb, HelpReminderIds.connectImdb];
  return [HelpReminderIds.connectImdb, HelpReminderIds.importImdb];
}

function ReadCompletedReminderIds(context) {
  const pairs = [
    [HelpReminderIds.connectImdb, context.imdbConnected],
    [HelpReminderIds.importImdb, context.imdbImported],
    [HelpReminderIds.importLetterboxd, context.letterboxdImported],
    [HelpReminderIds.connectAi, context.aiConnected]
  ];
  return pairs.filter(([, complete]) => complete).map(([id]) => id);
}

function BuildEditableHelpPreferences(preferences) {
  const normalized = NormalizeHelpPreferences(preferences);
  const reminders = Object.fromEntries(Object.entries(normalized.reminders).map(CloneHelpReminderEntry));
  return { enabled: normalized.enabled, reminders };
}

function CloneHelpReminderEntry([id, reminder]) {
  return [id, { ...reminder }];
}

function BuildHelpReminderRecord(reminder = {}) {
  return {
    shownCount: Number.isInteger(reminder.shownCount) ? reminder.shownCount : 0,
    lastShownAt: reminder.lastShownAt || "",
    snoozedUntil: reminder.snoozedUntil || ""
  };
}

function IsHelpReminderSnoozed(reminder, now) {
  if (!reminder.snoozedUntil)
    return false;
  return Date.parse(reminder.snoozedUntil) > ReadTimestamp(now);
}

function IsHelpReminderId(reminderId) {
  return typeof reminderId === "string" && HelpReminderIdPattern.test(reminderId);
}

function BuildIsoTimestamp(value) {
  return new Date(ReadTimestamp(value)).toISOString();
}

function ReadTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function BuildReminder(body, tutorialId, stepId) {
  return Object.freeze({ title: "Need help?", body, tutorialId, stepId, actionLabel: "Yes, show me" });
}
