import { ActiveClass, AiSettingsView, RaterView, SettingsView } from "../app-constants.js";
import { AreKeyboardShortcutsEqual, DefaultKeyboardShortcuts, DisplayShortcutKey, KeyboardShortcutDescriptors, NormalizeKeyboardShortcuts, NormalizeShortcutKey, ReadShortcutAction, SwapKeyboardShortcut } from "../../../shared/keyboard-shortcuts.js";

const EscapeKey = "Escape";
const TabKey = "Tab";
const CaptureLabel = "Press a key";
const AriaCurrentAttribute = "aria-current";
const AriaLabelAttribute = "aria-label";
const ButtonElementName = "button";

export class SettingsFeature {
  InitializeSettingsState() {
    this.SettingsReturnView = RaterView;
    this.ShortcutDraft = { ...DefaultKeyboardShortcuts };
    this.ShortcutCaptureAction = "";
    this.ShortcutSettingsDirty = false;
    this.ShortcutSettingsBusy = false;
  }

  IsSettingsView(view) {
    return view === SettingsView || view === AiSettingsView;
  }

  NavigateToSettings(view = SettingsView) {
    if (!this.IsSettingsView(this.State.activeView))
      this.SettingsReturnView = this.State.activeView;
    this.NavigateToView(view);
  }

  CloseSettings() {
    this.NavigateToView(this.SettingsReturnView || RaterView);
  }

  CanLeaveShortcutSettings(view) {
    const leavingEditor = this.State.activeView === SettingsView && view !== SettingsView;
    if (!leavingEditor || !this.ShortcutSettingsDirty)
      return true;
    return window.confirm("Discard your unsaved keyboard shortcut changes?");
  }

  SelectSettingsSection(view) {
    const connections = view === AiSettingsView;
    this.Elements.shortcutSettingsPanel.hidden = connections;
    this.Elements.connectionSettingsPanel.hidden = !connections;
    this.UpdateSettingsNavigation(this.Elements.settingsShortcutsNav, !connections);
    this.UpdateSettingsNavigation(this.Elements.settingsConnectionsNav, connections);
    this.Elements.settingsView.scrollTop = 0;
  }

  UpdateSettingsNavigation(link, active) {
    link.classList.toggle(ActiveClass, active);
    if (active)
      return link.setAttribute(AriaCurrentAttribute, "page");
    link.removeAttribute(AriaCurrentAttribute);
  }

  SyncShortcutSettingsForm() {
    if (this.State.activeView !== SettingsView)
      return;
    this.ShortcutDraft = NormalizeKeyboardShortcuts(this.Settings.keyboardShortcuts);
    this.ShortcutCaptureAction = "";
    this.ShortcutSettingsDirty = false;
    this.RenderShortcutSettings();
    this.ShowShortcutSettingsStatus("Shortcuts are saved to your account.");
  }

  RenderShortcutSettings() {
    const rows = KeyboardShortcutDescriptors.map((descriptor) => BuildShortcutRow(descriptor, this.ShortcutDraft[descriptor.action]));
    this.Elements.shortcutSettingsList.replaceChildren(...rows);
    this.UpdateShortcutSaveButton();
  }

  HandleShortcutListClick(event) {
    const button = event.target.closest?.("[data-shortcut-capture]");
    if (button)
      this.BeginShortcutCapture(button.dataset.shortcutCapture);
  }

  BeginShortcutCapture(action) {
    this.ShortcutCaptureAction = action;
    this.RenderShortcutSettings();
    const button = this.Elements.shortcutSettingsList.querySelector(`[data-shortcut-capture="${action}"]`);
    button?.classList.add("recording");
    if (button)
      button.textContent = CaptureLabel;
    this.ShowShortcutSettingsStatus("Press one printable key. Escape cancels.");
  }

  HandleShortcutCaptureKey(event) {
    if (!this.ShortcutCaptureAction)
      return;
    if (event.key === TabKey)
      return this.CancelShortcutCapture();
    event.preventDefault();
    if (event.key === EscapeKey)
      return this.CancelShortcutCapture();
    this.CaptureShortcutKey(event);
  }

  CaptureShortcutKey(event) {
    const key = event.altKey || event.ctrlKey || event.metaKey ? "" : NormalizeShortcutKey(event.key);
    if (!key)
      return this.ShowShortcutSettingsStatus("Choose one printable key without Ctrl, Alt, or Command.");
    this.AssignShortcutKey(this.ShortcutCaptureAction, key);
  }

  AssignShortcutKey(action, key) {
    const conflict = ReadShortcutAction(this.ShortcutDraft, key);
    this.ShortcutDraft = SwapKeyboardShortcut(this.ShortcutDraft, action, key);
    this.ShortcutCaptureAction = "";
    this.ShortcutSettingsDirty = !AreKeyboardShortcutsEqual(this.ShortcutDraft, this.Settings.keyboardShortcuts);
    this.RenderShortcutSettings();
    this.ShowShortcutSettingsStatus(BuildAssignmentStatus(action, conflict, key));
  }

  CancelShortcutCapture() {
    this.ShortcutCaptureAction = "";
    this.RenderShortcutSettings();
    this.ShowShortcutSettingsStatus("Key change canceled.");
  }

  ResetShortcutSettings() {
    this.ShortcutDraft = { ...DefaultKeyboardShortcuts };
    this.ShortcutCaptureAction = "";
    this.ShortcutSettingsDirty = !AreKeyboardShortcutsEqual(this.ShortcutDraft, this.Settings.keyboardShortcuts);
    this.RenderShortcutSettings();
    const status = this.ShortcutSettingsDirty ? "Default shortcuts are ready. Save to apply them." : "Default shortcuts are already active.";
    this.ShowShortcutSettingsStatus(status);
  }

  async SaveShortcutSettings() {
    this.SetShortcutSettingsBusy(true);
    try {
      await this.SaveAccountPreferences({ keyboardShortcuts: this.ShortcutDraft });
      this.CompleteShortcutSettingsSave();
    } finally {
      this.SetShortcutSettingsBusy(false);
    }
  }

  CompleteShortcutSettingsSave() {
    this.ShortcutDraft = NormalizeKeyboardShortcuts(this.Settings.keyboardShortcuts);
    this.ShortcutSettingsDirty = false;
    this.RenderShortcutSettings();
    this.ShowShortcutSettingsStatus("Keyboard shortcuts saved.");
  }

  SetShortcutSettingsBusy(value) {
    this.ShortcutSettingsBusy = value;
    this.Elements.shortcutReset.disabled = value;
    for (const button of this.Elements.shortcutSettingsList.querySelectorAll(ButtonElementName))
      button.disabled = value;
    this.UpdateShortcutSaveButton();
  }

  UpdateShortcutSaveButton() {
    this.Elements.shortcutSave.disabled = this.ShortcutSettingsBusy || !this.ShortcutSettingsDirty;
    this.Elements.shortcutSave.textContent = this.ShortcutSettingsBusy ? "Saving…" : "Save shortcuts";
  }

  ShowShortcutSettingsStatus(message) {
    this.Elements.shortcutSettingsStatus.textContent = message || "";
  }

  ApplyShortcutUi() {
    for (const descriptor of KeyboardShortcutDescriptors)
      this.UpdateShortcutControl(descriptor);
  }

  UpdateShortcutControl(descriptor) {
    const control = this.Elements.ratingFooter.querySelector(`[data-shortcut-action="${descriptor.action}"]`);
    if (!control)
      return;
    const display = DisplayShortcutKey(this.Settings.keyboardShortcuts[descriptor.action]);
    control.querySelector("[data-shortcut-label]").textContent = display;
    control.setAttribute(AriaLabelAttribute, `${descriptor.description} Keyboard shortcut ${display}.`);
  }
}

function BuildShortcutRow(descriptor, key) {
  const row = document.createElement("div");
  row.className = "shortcut-settings-row";
  row.append(BuildShortcutCopy(descriptor), BuildShortcutButton(descriptor, key));
  return row;
}

function BuildShortcutCopy(descriptor) {
  const copy = document.createElement("span");
  const label = document.createElement("strong");
  const description = document.createElement("small");
  label.textContent = descriptor.label;
  description.textContent = descriptor.description;
  copy.append(label, description);
  return copy;
}

function BuildShortcutButton(descriptor, key) {
  const button = document.createElement(ButtonElementName);
  button.type = ButtonElementName;
  button.className = "shortcut-key-capture btn btn-outline-secondary";
  button.dataset.shortcutCapture = descriptor.action;
  button.textContent = DisplayShortcutKey(key);
  button.setAttribute(AriaLabelAttribute, `Change ${descriptor.label} shortcut. Currently ${DisplayShortcutKey(key)}.`);
  return button;
}

function BuildAssignmentStatus(action, conflict, key) {
  const assigned = `${ReadDescriptorLabel(action)} now uses ${DisplayShortcutKey(key)}.`;
  if (!conflict || conflict === action)
    return assigned;
  return `${assigned} ${ReadDescriptorLabel(conflict)} received the previous key.`;
}

function ReadDescriptorLabel(action) {
  return KeyboardShortcutDescriptors.find((descriptor) => descriptor.action === action)?.label || action;
}
