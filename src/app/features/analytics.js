import { AnalyticsConsentMarkup, BuildAnalyticsConsentElements } from "../analytics-consent-markup.js";
import { AcceptedAnalyticsConsent, DeclinedAnalyticsConsent, ReadAnalyticsConsent, UnknownAnalyticsConsent, WriteAnalyticsConsent } from "../analytics-consent.js";
import { CaptureAnalytics, IdentifyAnalyticsUser, ResetAnalyticsUser, StartAnalytics, StopAnalytics } from "../analytics-client.js";
import { AnalyticsEvents } from "../analytics-events.js";

const ClickEvent = "click";
const DisabledAnalyticsConfig = Object.freeze({ enabled: false, token: "", host: "" });

export class AnalyticsFeature {
  InitializeAnalyticsState() {
    this.AnalyticsConfig = DisabledAnalyticsConfig;
    this.AnalyticsConsent = ReadAnalyticsConsent();
    this.AnalyticsSettingsOpen = false;
    this.Elements.analyticsConsentRoot.innerHTML = AnalyticsConsentMarkup;
    this.AnalyticsElements = BuildAnalyticsConsentElements(this.Elements.analyticsConsentRoot);
    this.UpdateAnalyticsConsentUi();
  }

  BindAnalyticsEvents() {
    this.Elements.authAnalyticsSettings.addEventListener(ClickEvent, () => this.OpenAnalyticsSettings());
    this.Elements.settingsAnalyticsManage.addEventListener(ClickEvent, () => this.OpenAnalyticsSettings());
    this.AnalyticsElements.accept.addEventListener(ClickEvent, () => this.HandleAnalyticsAccept());
    this.AnalyticsElements.decline.addEventListener(ClickEvent, () => this.HandleAnalyticsDecline());
    this.AnalyticsElements.close.addEventListener(ClickEvent, () => this.CloseAnalyticsSettings());
  }

  ConfigureAnalytics(config, user = null) {
    this.AnalyticsConfig = NormalizeAnalyticsConfig(config);
    if (!this.AnalyticsConsent || !this.Elements?.authAnalyticsSettings)
      return;
    this.UpdateAnalyticsConsentUi();
    if (this.AnalyticsConsent.choice === AcceptedAnalyticsConsent)
      this.StartConfiguredAnalytics(user).catch(() => null);
  }

  async StartConfiguredAnalytics(user = this.User) {
    if (!this.AnalyticsConfig.enabled || this.AnalyticsConsent.choice !== AcceptedAnalyticsConsent)
      return;
    await StartAnalytics(this.AnalyticsConfig, user?.id || "");
  }

  async TrackAuthentication(method) {
    await this.StartConfiguredAnalytics().catch(() => null);
    IdentifyAnalyticsUser(this.User?.id);
    CaptureAnalytics(AnalyticsEvents.AuthenticationSucceeded, { method });
  }

  TrackProductEvent(eventName, properties = {}) {
    CaptureAnalytics(eventName, properties);
  }

  ResetAnalyticsAccount() {
    ResetAnalyticsUser();
  }

  HandleAnalyticsAccept() {
    this.AnalyticsConsent = WriteAnalyticsConsent(AcceptedAnalyticsConsent);
    this.AnalyticsSettingsOpen = false;
    this.UpdateAnalyticsConsentUi();
    this.StartConfiguredAnalytics().then(() => CaptureAnalytics(AnalyticsEvents.ConsentGranted)).catch(() => null);
  }

  HandleAnalyticsDecline() {
    this.AnalyticsConsent = WriteAnalyticsConsent(DeclinedAnalyticsConsent);
    this.AnalyticsSettingsOpen = false;
    StopAnalytics();
    this.UpdateAnalyticsConsentUi();
  }

  OpenAnalyticsSettings() {
    if (!this.AnalyticsConfig.enabled)
      return;
    this.AnalyticsSettingsOpen = true;
    this.UpdateAnalyticsConsentUi();
    this.AnalyticsElements.close.focus();
  }

  CloseAnalyticsSettings() {
    this.AnalyticsSettingsOpen = false;
    this.UpdateAnalyticsConsentUi();
  }

  UpdateAnalyticsConsentUi() {
    const enabled = this.AnalyticsConfig.enabled;
    this.Elements.authAnalyticsSettings.hidden = !enabled;
    this.Elements.settingsAnalyticsCard.hidden = !enabled;
    this.Elements.settingsAnalyticsStatus.textContent = ReadAnalyticsConsentLabel(this.AnalyticsConsent.choice);
    if (!enabled)
      return this.HideAnalyticsConsent();
    if (this.AnalyticsSettingsOpen || this.AnalyticsConsent.choice === UnknownAnalyticsConsent)
      return this.ShowAnalyticsConsent(this.AnalyticsSettingsOpen);
    this.HideAnalyticsConsent();
  }

  ShowAnalyticsConsent(manage) {
    this.AnalyticsElements.prompt.hidden = false;
    this.AnalyticsElements.close.hidden = !manage;
  }

  HideAnalyticsConsent() {
    this.AnalyticsElements.prompt.hidden = true;
  }
}

function NormalizeAnalyticsConfig(config) {
  const enabled = Boolean(config?.enabled && config.token && config.host);
  if (!enabled)
    return DisabledAnalyticsConfig;
  return Object.freeze({ enabled: true, token: String(config.token), host: String(config.host) });
}

function ReadAnalyticsConsentLabel(choice) {
  if (choice === AcceptedAnalyticsConsent)
    return "Optional analytics are allowed on this browser.";
  if (choice === DeclinedAnalyticsConsent)
    return "Only the necessary session cookie is allowed on this browser.";
  return "No analytics choice has been saved on this browser.";
}
