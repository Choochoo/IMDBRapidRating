import { AiSettingsView, ChangeEvent, ClickEvent, MovieMediaType, SyncView } from "../app-constants.js";
import { HelpReminders, RecordHelpReminderShown, SelectContextualHelpReminder, SetHelpRemindersEnabled, SnoozeHelpReminder } from "../help-reminder-policy.js";
import { SetupGuideActionIds, SetupGuideFlowIds } from "../setup-guide-definitions.js";
import { PathForView } from "../view-routes.js";
import { NormalizeHelpPreferences } from "../../../shared/help-preferences.js";

const HelpReminderDelayMs = 900;

export class HelpRemindersFeature {
  InitializeHelpReminderState() {
    this.HelpReminderShownThisSession = false;
    this.HelpRemindersReady = false;
    this.HelpReminderTimer = 0;
    this.ActiveHelpReminder = null;
    this.HelpPreferenceSavePromise = Promise.resolve();
    this.HelpPreferenceSaveVersion = 0;
  }

  StartHelpReminders() {
    this.HelpRemindersReady = true;
    this.ScheduleHelpReminder();
  }

  BindHelpReminderSystem() {
    this.ConfigureHelpReminderCallbacks();
    this.BindHelpPreferenceEvents();
    this.BindSetupGuideEntryEvents();
    this.RegisterLocalSetupGuideActions();
    this.SyncHelpPreferenceUi();
  }

  ConfigureHelpReminderCallbacks() {
    const actions = {
      onLater: (reminder) => this.SnoozeActiveHelpReminder(reminder).catch(() => null),
      onHide: () => this.DisableHelpReminders().catch(() => null),
      onSettings: () => this.OpenHelpSettings(),
      onTutorial: () => this.ClearActiveHelpReminder()
    };
    this.ConfigureHelpReminderActions(actions);
  }

  BindHelpPreferenceEvents() {
    this.Elements.openHelp.addEventListener(ClickEvent, () => this.OpenManualSetupGuide());
    this.Elements.openSetupGuide.addEventListener(ClickEvent, () => this.OpenManualSetupGuide());
    this.Elements.helpRemindersEnabled.addEventListener(ChangeEvent, () => this.HandleHelpReminderToggle());
  }

  BindSetupGuideEntryEvents() {
    this.Elements.imdbShowSteps.addEventListener(ClickEvent, () => this.OpenImdbSetupGuide());
    this.Elements.aiShowSteps.addEventListener(ClickEvent, () => this.OpenManualSetupGuide(SetupGuideFlowIds.connectOpenAi));
    this.Elements.syncImdbGuide.addEventListener(ClickEvent, () => this.OpenManualSetupGuide(SetupGuideFlowIds.importImdbRatings));
    this.Elements.syncLetterboxdGuide.addEventListener(ClickEvent, () => this.OpenManualSetupGuide(SetupGuideFlowIds.importLetterboxd));
    this.Elements.syncToLetterboxdGuide.addEventListener(ClickEvent, () => this.OpenManualSetupGuide(SetupGuideFlowIds.rapidRaterToLetterboxd));
    this.Elements.syncToImdbGuide.addEventListener(ClickEvent, () => this.OpenManualSetupGuide(SetupGuideFlowIds.letterboxdToImdb));
  }

  RegisterLocalSetupGuideActions() {
    const actions = this.ReadLocalSetupGuideActions();
    for (const [id, action] of actions)
      this.RegisterSetupGuideAction(id, () => this.RunLocalSetupGuideAction(action));
  }

  ReadLocalSetupGuideActions() {
    return [
      [SetupGuideActionIds.openImdbConnection, () => this.ShowImdbDialog()],
      [SetupGuideActionIds.openAiSettings, () => this.OpenAiSetupSettings()],
      [SetupGuideActionIds.chooseImdbCsv, () => this.Elements.csvFile.click()],
      [SetupGuideActionIds.chooseLetterboxdExport, () => this.Elements.letterboxdFile.click()],
      [SetupGuideActionIds.openMovieSync, () => this.OpenMovieSyncView()],
      [SetupGuideActionIds.downloadLetterboxdFile, () => this.RunLetterboxdDownload()],
      [SetupGuideActionIds.queueLetterboxdToImdb, () => this.RunLetterboxdToImdb()]
    ];
  }

  RunLocalSetupGuideAction(action) {
    this.CloseSetupGuide();
    action();
  }

  OpenImdbSetupGuide() {
    this.HideImdbDialog();
    this.OpenManualSetupGuide(SetupGuideFlowIds.connectImdb);
  }

  OpenManualSetupGuide(flowId = "") {
    this.HideHelpReminder();
    this.ActiveHelpReminder = null;
    this.OpenSetupGuide(flowId);
  }

  OpenAiSetupSettings() {
    this.NavigateToSettings(AiSettingsView);
    window.setTimeout(() => this.Elements.aiBaseUrl.focus(), 0);
  }

  OpenMovieSyncView() {
    if (this.State.mediaType === MovieMediaType)
      return this.NavigateToView(SyncView);
    const path = PathForView(SyncView, MovieMediaType);
    window.history.pushState({ view: SyncView, mediaType: MovieMediaType }, "", path);
    this.ActivateMedia(MovieMediaType, SyncView).catch((error) => this.ShowStartupError(error));
  }

  RunLetterboxdDownload() {
    this.DownloadLetterboxdSync().catch((error) => this.ShowSyncError(error));
  }

  RunLetterboxdToImdb() {
    this.SyncMissingRatingsToImdb().catch((error) => this.ShowSyncError(error));
  }

  ScheduleHelpReminder(view = this.State.activeView, delay = HelpReminderDelayMs) {
    if (!this.HelpRemindersReady || this.HelpReminderShownThisSession)
      return;
    window.clearTimeout(this.HelpReminderTimer);
    this.HelpReminderTimer = window.setTimeout(() => this.OfferHelpReminder(view), delay);
  }

  OfferHelpReminder(view) {
    if (!this.CanOfferHelpReminder())
      return;
    const reminder = SelectContextualHelpReminder(this.BuildHelpReminderContext(view), this.Settings.helpPreferences);
    if (!reminder)
      return;
    this.HelpReminderShownThisSession = true;
    this.ActiveHelpReminder = reminder;
    this.ShowHelpReminder(reminder);
    this.RecordOfferedHelpReminder(reminder.id);
  }

  CanOfferHelpReminder() {
    if (!this.User || !this.HelpRemindersReady || this.HelpReminderShownThisSession)
      return false;
    if (document.hidden || this.IsHelpUiBusy())
      return false;
    return !document.querySelector(".header-menu[open]");
  }

  IsHelpUiBusy() {
    const actionBusy = this.State.locked || this.State.ai?.loading || this.MediaSwitching;
    return actionBusy || this.IsDialogOpen();
  }

  BuildHelpReminderContext(view) {
    return {
      view,
      imdbConnected: Boolean(this.State.live?.configured || this.Settings.imdbConfigured),
      imdbImported: Boolean(this.RatingsCsvText),
      letterboxdImported: Boolean(this.State.letterboxd?.importedAt),
      aiConnected: Boolean(this.State.ai?.configured || this.Settings.aiConfigured)
    };
  }

  RecordOfferedHelpReminder(id) {
    const next = RecordHelpReminderShown(this.Settings.helpPreferences, id);
    this.SaveHelpPreferences(next).catch(() => null);
  }

  ClearActiveHelpReminder() {
    this.ActiveHelpReminder = null;
  }

  async SnoozeActiveHelpReminder(value) {
    const reminder = this.ReadActiveHelpReminder(value);
    this.HideHelpReminder();
    this.ActiveHelpReminder = null;
    if (!reminder)
      return;
    const next = SnoozeHelpReminder(this.Settings.helpPreferences, reminder.id);
    await this.SaveHelpPreferences(next);
  }

  ReadActiveHelpReminder(value) {
    return value?.id && HelpReminders[value.id] ? value : this.ActiveHelpReminder;
  }

  async DisableHelpReminders() {
    const next = SetHelpRemindersEnabled(this.Settings.helpPreferences, false);
    this.HideHelpReminder();
    this.ActiveHelpReminder = null;
    await this.SaveHelpPreferences(next);
    this.ShowHelpPreferenceStatus("Helpful reminders are off. Tutorials are always available.");
  }

  OpenHelpSettings() {
    this.HideHelpReminder();
    this.ActiveHelpReminder = null;
    this.NavigateToSettings(AiSettingsView);
    window.setTimeout(() => this.FocusHelpSettings(), 0);
  }

  FocusHelpSettings() {
    this.Elements.helpSettings.scrollIntoView({ behavior: "smooth", block: "center" });
    this.Elements.helpRemindersEnabled.focus();
  }

  HandleHelpReminderToggle() {
    const enabled = this.Elements.helpRemindersEnabled.checked;
    const next = SetHelpRemindersEnabled(this.Settings.helpPreferences, enabled);
    this.SaveHelpPreferences(next).then(() => this.CompleteHelpReminderToggle(enabled)).catch((error) => this.ShowHelpPreferenceStatus(error.message));
  }

  CompleteHelpReminderToggle(enabled) {
    const message = enabled ? "Helpful reminders are on again." : "Helpful reminders are off. Tutorials stay available.";
    this.ShowHelpPreferenceStatus(message);
    if (!enabled)
      this.HideHelpReminder();
  }

  SaveHelpPreferences(next) {
    const previous = NormalizeHelpPreferences(this.Settings.helpPreferences);
    const requested = NormalizeHelpPreferences(next);
    const version = ++this.HelpPreferenceSaveVersion;
    this.Settings.helpPreferences = requested;
    this.SyncHelpPreferenceUi();
    const save = () => this.PersistHelpPreferences(requested, previous, version);
    const operation = this.HelpPreferenceSavePromise.catch(() => null).then(save);
    this.HelpPreferenceSavePromise = operation;
    return operation;
  }

  async PersistHelpPreferences(requested, previous, version) {
    try {
      await this.SaveAccountPreferences({ helpPreferences: requested });
    } catch (error) {
      if (version === this.HelpPreferenceSaveVersion)
        this.RestoreHelpPreferences(previous);
      throw error;
    }
  }

  RestoreHelpPreferences(previous) {
    this.Settings.helpPreferences = previous;
    this.SyncHelpPreferenceUi();
  }

  SyncHelpPreferenceUi() {
    const enabled = NormalizeHelpPreferences(this.Settings.helpPreferences).enabled;
    if (this.Elements?.helpRemindersEnabled)
      this.Elements.helpRemindersEnabled.checked = enabled;
    if (!enabled && this.Elements?.helpReminder)
      this.HideHelpReminder();
  }

  ShowHelpPreferenceStatus(message) {
    if (this.Elements?.helpRemindersStatus)
      this.Elements.helpRemindersStatus.textContent = message || "";
  }
}
