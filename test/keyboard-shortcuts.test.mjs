import assert from "node:assert/strict";
import test from "node:test";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";
import { AreKeyboardShortcutsEqual, DefaultKeyboardShortcuts, DisplayShortcutKey, NormalizeKeyboardShortcuts, NormalizeShortcutKey, ReadShortcutAction, ReadShortcutRating, SwapKeyboardShortcut, ValidateKeyboardShortcuts } from "../shared/keyboard-shortcuts.js";

const RateTenAction = "rate-10";
const NoOp = () => undefined;
const OneKey = "1";
const RateOneAction = "rate-1";
const SkipAction = "skip";
const SkipKey = "n";
const StreamingCountry = "US";
const UpperSkipKey = "N";
const ZKey = "z";

test("keyboard shortcuts normalize defaults and reject incomplete or duplicate maps", VerifyShortcutValidation);
test("assigning an occupied shortcut swaps the two actions", VerifyShortcutSwap);
test("shortcut keys normalize letters and display Space clearly", VerifyShortcutKeys);
test("custom shortcut dispatch resolves ratings and Skip by semantic action", VerifyShortcutDispatch);
test("account refresh applies shortcut changes without a rating-state revision", VerifyRemoteShortcutRefresh);

function VerifyShortcutValidation() {
  assert.equal(ValidateKeyboardShortcuts(DefaultKeyboardShortcuts).ok, true);
  assert.equal(ValidateKeyboardShortcuts({ skip: SkipKey }).ok, false);
  const duplicate = { ...DefaultKeyboardShortcuts, skip: OneKey };
  assert.match(ValidateKeyboardShortcuts(duplicate).error, /different key/);
  assert.deepEqual(NormalizeKeyboardShortcuts(null), DefaultKeyboardShortcuts);
}

function VerifyShortcutSwap() {
  const swapped = SwapKeyboardShortcut(DefaultKeyboardShortcuts, RateOneAction, SkipKey);
  assert.equal(swapped[RateOneAction], SkipKey);
  assert.equal(swapped.skip, OneKey);
  assert.equal(AreKeyboardShortcutsEqual(swapped, DefaultKeyboardShortcuts), false);
}

function VerifyShortcutKeys() {
  assert.equal(NormalizeShortcutKey(UpperSkipKey), SkipKey);
  assert.equal(NormalizeShortcutKey("Backspace"), "");
  assert.equal(DisplayShortcutKey(" "), "Space");
  assert.equal(ReadShortcutAction(DefaultKeyboardShortcuts, UpperSkipKey), SkipAction);
  assert.equal(ReadShortcutRating(RateTenAction), 10);
}

function VerifyShortcutDispatch() {
  const decisions = [];
  const flashes = [];
  const app = Object.create(RapidRaterApp.prototype);
  app.Settings = { keyboardShortcuts: { ...DefaultKeyboardShortcuts, [RateTenAction]: ZKey, skip: "s" } };
  app.FlashShortcutAction = (action) => flashes.push(action);
  app.MarkActive = (rating, status) => decisions.push({ rating, status });
  app.HandleShortcutKey(BuildKeyEvent(ZKey));
  app.HandleShortcutKey(BuildKeyEvent("S"));
  app.HandleShortcutKey(BuildKeyEvent("`"));
  assert.deepEqual(decisions, [{ rating: 10, status: "rated" }, { rating: null, status: "notSeen" }]);
  assert.deepEqual(flashes, [RateTenAction, SkipAction]);
}

async function VerifyRemoteShortcutRefresh() {
  const shortcuts = { ...DefaultKeyboardShortcuts, [RateTenAction]: ZKey, skip: "0" };
  const app = Object.create(RapidRaterApp.prototype);
  Object.assign(app, BuildRefreshApp(shortcuts));
  const changed = await app.RefreshAccountStateFromServer();
  assert.equal(changed, true);
  assert.equal(app.Settings.keyboardShortcuts[RateTenAction], ZKey);
  assert.equal(app.shortcutUpdates, 1);
}

function BuildRefreshApp(shortcuts) {
  return {
    User: { email: "user@example.com" },
    StateDirty: false,
    AccountRevision: 8,
    State: { live: { queueCounts: {} } },
    Settings: { streamingCountry: StreamingCountry, keyboardShortcuts: DefaultKeyboardShortcuts },
    ShortcutSettingsDirty: true,
    shortcutUpdates: 0,
    FetchJson: async () => ({ revision: 8, settings: { streamingCountry: StreamingCountry, keyboardShortcuts: shortcuts } }),
    ApplyShortcutUi() { this.shortcutUpdates++; },
    UpdateSettingsButtons: NoOp
  };
}

function BuildKeyEvent(key) {
  return { key, preventDefault: NoOp };
}
