export const HelpReminderShowLimit = 2;
export const HelpReminderSnoozeDurationMs = 7 * 24 * 60 * 60 * 1000;
export const MaximumHelpReminderCount = 64;
const IsoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const DefaultHelpPreferenceValues = {
  enabled: true,
  reminders: Object.freeze({})
};
export const DefaultHelpPreferences = Object.freeze(DefaultHelpPreferenceValues);

export function BuildDefaultHelpPreferences() {
  return { enabled: true, reminders: {} };
}

export function NormalizeHelpPreferences(value) {
  const result = ValidateHelpPreferences(value);
  return result.ok ? result.value : BuildDefaultHelpPreferences();
}

export function ValidateHelpPreferences(value) {
  if (!IsRecord(value))
    return BuildInvalidResult("Helpful reminder preferences must be an object.");
  if (!HasExactKeys(value, ["enabled", "reminders"]))
    return BuildInvalidResult("Helpful reminder preferences contain unsupported fields.");
  if (typeof value.enabled !== "boolean")
    return BuildInvalidResult("Helpful reminders must be enabled or disabled.");
  const reminders = ValidateHelpReminders(value.reminders);
  return reminders.ok ? { ok: true, value: { enabled: value.enabled, reminders: reminders.value } } : reminders;
}

function ValidateHelpReminders(value) {
  if (!IsRecord(value))
    return BuildInvalidResult("Helpful reminder history must be an object.");
  const entries = Object.entries(value);
  if (entries.length > MaximumHelpReminderCount)
    return BuildInvalidResult(`Helpful reminder history is limited to ${MaximumHelpReminderCount} items.`);
  const results = entries.map(ValidateHelpReminderEntry);
  const invalid = results.find((result) => !result.ok);
  return invalid || { ok: true, value: Object.fromEntries(results.map((result) => result.value)) };
}

function ValidateHelpReminderEntry([id, value]) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id))
    return BuildInvalidResult("Helpful reminder identifiers are invalid.");
  const result = ValidateHelpReminder(value);
  return result.ok ? { ok: true, value: [id, result.value] } : result;
}

function ValidateHelpReminder(value) {
  if (!IsRecord(value) || !HasExactKeys(value, ["shownCount", "lastShownAt", "snoozedUntil"]))
    return BuildInvalidResult("Helpful reminder history entries are invalid.");
  if (!Number.isInteger(value.shownCount) || value.shownCount < 0 || value.shownCount > HelpReminderShowLimit)
    return BuildInvalidResult(`Helpful reminders can be shown at most ${HelpReminderShowLimit} times.`);
  if (!IsTimestamp(value.lastShownAt) || !IsTimestamp(value.snoozedUntil))
    return BuildInvalidResult("Helpful reminder dates are invalid.");
  return { ok: true, value: { shownCount: value.shownCount, lastShownAt: NormalizeTimestamp(value.lastShownAt), snoozedUntil: NormalizeTimestamp(value.snoozedUntil) } };
}

function IsTimestamp(value) {
  if (value === "")
    return true;
  return typeof value === "string" && IsoTimestampPattern.test(value) && Number.isFinite(Date.parse(value));
}

function NormalizeTimestamp(value) {
  return value ? new Date(value).toISOString() : "";
}

function IsRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function HasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function BuildInvalidResult(error) {
  return { ok: false, error };
}
