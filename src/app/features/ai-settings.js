import { AiSettingsView, PostMethod, PutMethod } from "../app-constants.js";
import { Config } from "../config.js";

const OptionElementName = "option";

export class AiSettingsFeature {
  OpenAiSettings() {
    this.AiSettingsDirty = false;
    this.NavigateToSettings(AiSettingsView);
    this.SyncAiSettingsForm();
  }

  SyncAiSettingsForm() {
    if (this.State.activeView !== AiSettingsView || this.AiSettingsDirty)
      return;
    this.Elements.aiBaseUrl.value = this.State.ai.baseUrl || "";
    this.Elements.aiApiKey.value = "";
    this.ResetAiModelPicker();
    this.ShowAiSettingsStatus(this.BuildAiSettingsSummary());
    this.Elements.aiDelete.hidden = !this.State.ai.configured;
  }

  BuildAiSettingsSummary() {
    if (!this.State.ai.checked)
      return "Checking your saved connection…";
    if (!this.State.ai.configured)
      return "No AI service is connected yet.";
    return `Connected with ${this.State.ai.model}.`;
  }

  HandleAiConnectionInput() {
    this.AiSettingsDirty = true;
    this.ResetAiModelPicker();
    this.ShowAiSettingsStatus("Find models again after changing the server or key.");
    this.ShowAiSettingsError("");
  }

  async FindAiModels() {
    const connection = this.ReadAiConnectionForm();
    if (!connection.baseUrl)
      return this.ShowAiSettingsError("Paste your AI server URL first.");
    this.SetAiSettingsBusy(true, "Finding models…");
    try {
      const payload = await this.RequestJson(Config.aiModelsUrl, PostMethod, connection);
      this.ApplyDiscoveredModels(payload.models);
    } finally {
      this.SetAiSettingsBusy(false);
    }
  }

  ApplyDiscoveredModels(models) {
    this.State.ai.models = Array.isArray(models) ? models : [];
    this.Elements.aiModelPanel.hidden = false;
    this.Elements.aiModelSearch.value = "";
    this.RenderAiModelOptions();
    this.SelectSavedAiModel();
    this.ShowAiSettingsStatus(`${this.State.ai.models.length.toLocaleString()} models found. Choose one, then test and save.`);
    this.ShowAiSettingsError("");
  }

  SelectSavedAiModel() {
    const saved = this.State.ai.model || "";
    const found = this.State.ai.models.some((model) => model.id === saved);
    this.Elements.aiModelSelect.value = found ? saved : "";
    this.UpdateAiSaveButton();
  }

  FilterAiModels() {
    this.RenderAiModelOptions();
    this.UpdateAiSaveButton();
  }

  RenderAiModelOptions() {
    const selected = this.Elements.aiModelSelect.value;
    const models = this.ReadFilteredAiModels();
    this.Elements.aiModelSelect.replaceChildren(BuildModelPlaceholder(), ...models.map(BuildModelOption));
    if (models.some((model) => model.id === selected))
      this.Elements.aiModelSelect.value = selected;
    this.Elements.aiModelCount.textContent = `${models.length.toLocaleString()} of ${this.State.ai.models.length.toLocaleString()} models shown`;
  }

  ReadFilteredAiModels() {
    const query = this.Elements.aiModelSearch.value.trim().toLowerCase();
    if (!query)
      return this.State.ai.models;
    return this.State.ai.models.filter((model) => model.id.toLowerCase().includes(query));
  }

  async SaveAiSettings() {
    const request = { ...this.ReadAiConnectionForm(), model: this.Elements.aiModelSelect.value };
    if (!this.IsDiscoveredAiModel(request.model))
      return this.ShowAiSettingsError("Choose a model from the list first.");
    this.SetAiSettingsBusy(true, "Testing the selected model…");
    try {
      const payload = await this.RequestJson(Config.aiSettingsUrl, PutMethod, request);
      this.ApplySavedAiSettings(payload);
    } finally {
      this.SetAiSettingsBusy(false);
    }
  }

  ApplySavedAiSettings(payload) {
    Object.assign(this.State.ai, payload, { checked: true, loading: false });
    Object.assign(this.Settings, { aiConfigured: true, aiBaseUrl: payload.baseUrl, aiModel: payload.model });
    this.AiSettingsDirty = false;
    this.Elements.aiBaseUrl.value = payload.baseUrl;
    this.Elements.aiApiKey.value = "";
    this.Elements.aiDelete.hidden = false;
    this.UpdateAiControls();
    this.ShowAiSettingsStatus(`Connected and tested with ${payload.model}.`);
  }

  async RemoveAiSettings() {
    if (!window.confirm("Remove the saved AI connection?"))
      return;
    this.SetAiSettingsBusy(true, "Removing connection…");
    try {
      const payload = await this.RequestJson(Config.aiSettingsUrl, "DELETE", {});
      this.ApplyRemovedAiSettings(payload);
    } finally {
      this.SetAiSettingsBusy(false);
    }
  }

  ApplyRemovedAiSettings(payload) {
    this.State.ai = { ...this.State.ai, ...payload, checked: true, models: [], loading: false };
    Object.assign(this.Settings, { aiConfigured: false, aiBaseUrl: "", aiModel: "" });
    this.AiSettingsDirty = false;
    this.Elements.aiBaseUrl.value = "";
    this.Elements.aiApiKey.value = "";
    this.Elements.aiDelete.hidden = true;
    this.ResetAiModelPicker();
    this.UpdateAiControls();
    this.ShowAiSettingsStatus("The AI connection was removed.");
  }

  ReadAiConnectionForm() {
    return {
      baseUrl: this.Elements.aiBaseUrl.value.trim(),
      apiKey: this.Elements.aiApiKey.value.trim()
    };
  }

  ResetAiModelPicker() {
    this.State.ai.models = [];
    this.Elements.aiModelPanel.hidden = true;
    this.Elements.aiModelSearch.value = "";
    this.Elements.aiModelSelect.replaceChildren();
    this.UpdateAiSaveButton();
  }

  SetAiSettingsBusy(value, message = "") {
    this.State.ai.loading = value;
    this.Elements.aiBaseUrl.disabled = value;
    this.Elements.aiApiKey.disabled = value;
    this.Elements.aiFindModels.disabled = value;
    this.Elements.aiModelSearch.disabled = value;
    this.Elements.aiModelSelect.disabled = value;
    this.Elements.aiDelete.disabled = value;
    this.SetAiControlsDisabled(value);
    if (message)
      this.ShowAiSettingsStatus(message);
    this.UpdateAiSaveButton();
  }

  UpdateAiSaveButton() {
    const model = this.Elements.aiModelSelect.value;
    this.Elements.aiSave.disabled = this.State.ai.loading || !this.IsDiscoveredAiModel(model);
    this.Elements.aiSave.textContent = this.State.ai.loading ? "Working…" : "Test and save";
  }

  IsDiscoveredAiModel(model) {
    return this.State.ai.models.some((item) => item.id === model);
  }

  ShowAiSettingsError(message) {
    this.Elements.aiSettingsError.textContent = message || "";
  }

  ShowAiSettingsStatus(message) {
    this.Elements.aiSettingsStatus.textContent = message || "";
  }
}

function BuildModelOption(model) {
  const option = document.createElement(OptionElementName);
  option.value = model.id;
  option.textContent = model.id;
  return option;
}

function BuildModelPlaceholder() {
  const option = document.createElement(OptionElementName);
  option.value = "";
  option.textContent = "Choose a model";
  return option;
}
