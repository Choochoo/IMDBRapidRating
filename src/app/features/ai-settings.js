import { AiSettingsView, PostMethod, PutMethod } from "../app-constants.js";
import { Config } from "../config.js";

const OptionElementName = "option";
const DeleteMethod = "DELETE";
const DefaultAction = "default";
const EditAction = "edit";
const RemoveAction = "remove";
const ChooseModelLabel = "Choose a model";

export class AiSettingsFeature {
  OpenAiSettings() {
    this.NavigateToSettings(AiSettingsView);
    this.SyncAiSettingsForm();
  }

  SyncAiSettingsForm() {
    if (this.State.activeView !== AiSettingsView)
      return;
    this.RenderAiProviders();
    this.RenderAiConnections();
    this.UpdateRecommendationAiChoices();
    if (!this.State.ai.connections.length)
      this.BeginNewAiConnection();
    else if (!this.State.ai.editingConnectionId)
      this.HideAiConnectionEditor();
  }

  RenderAiProviders() {
    const selected = this.Elements.aiProvider.value;
    const options = this.State.ai.providers.map(BuildProviderOption);
    this.Elements.aiProvider.replaceChildren(BuildProviderPlaceholder(), ...options);
    if (this.FindAiProvider(selected))
      this.Elements.aiProvider.value = selected;
  }

  RenderAiConnections() {
    const connections = this.State.ai.connections;
    this.Elements.aiConnectionsOverview.hidden = !connections.length;
    this.Elements.aiConnectionsList.replaceChildren(...connections.map(BuildConnectionCard));
    this.ShowAiSettingsStatus(this.BuildAiSettingsSummary());
  }

  BuildAiSettingsSummary() {
    if (!this.State.ai.checked)
      return "Checking your saved AI choices…";
    const count = this.State.ai.connections.length;
    if (!count)
      return "Choose a service to connect your first AI.";
    return `${count.toLocaleString()} AI ${count === 1 ? "choice" : "choices"} saved.`;
  }

  BeginNewAiConnection() {
    this.State.ai.editingConnectionId = "";
    this.ResetAiEditor();
    this.ShowAiConnectionEditor();
    this.Elements.aiUseDefault.checked = !this.State.ai.connections.length;
    this.ShowAiSettingsStatus("First, choose the AI service you recognize.");
  }

  BeginEditAiConnection(connectionId) {
    const connection = this.FindAiConnection(connectionId);
    if (!connection)
      return;
    this.State.ai.editingConnectionId = connection.id;
    this.ResetAiEditor();
    this.ApplyConnectionToEditor(connection);
    this.ShowAiConnectionEditor();
    this.ShowAiSettingsStatus("Your saved key stays hidden. Find the current models to continue.");
  }

  ApplyConnectionToEditor(connection) {
    this.Elements.aiProvider.value = connection.providerId;
    this.Elements.aiBaseUrl.value = connection.baseUrl || "";
    this.Elements.aiConnectionName.value = connection.name;
    this.Elements.aiUseDefault.checked = connection.isDefault;
    this.ApplyAiProviderSelection();
  }

  ShowAiConnectionEditor() {
    this.Elements.aiConnectionEditor.hidden = false;
    this.Elements.aiCancel.hidden = !this.State.ai.connections.length;
  }

  HideAiConnectionEditor() {
    this.Elements.aiConnectionEditor.hidden = true;
    this.State.ai.editingConnectionId = "";
    this.ResetAiEditor();
  }

  ResetAiEditor() {
    this.Elements.aiProvider.value = "";
    this.Elements.aiBaseUrl.value = "";
    this.Elements.aiApiKey.value = "";
    this.Elements.aiConnectionName.value = "";
    this.Elements.aiUseDefault.checked = false;
    this.ApplyAiProviderSelection();
    this.ResetAiModelPicker();
    this.ShowAiSettingsError("");
  }

  HandleAiProviderChange() {
    const provider = this.ReadSelectedAiProvider();
    if (!this.State.ai.editingConnectionId)
      this.Elements.aiConnectionName.value = provider?.name || "";
    this.ApplyAiProviderSelection();
    this.HandleAiConnectionInput();
  }

  ApplyAiProviderSelection() {
    const provider = this.ReadSelectedAiProvider();
    this.Elements.aiKeyPanel.hidden = !provider;
    this.Elements.aiProviderDescription.textContent = provider?.description || "";
    this.Elements.aiServerUrlPanel.hidden = !provider?.needsServerUrl;
    this.Elements.aiKeyOptional.hidden = Boolean(provider?.keyRequired);
    this.UpdateAiKeyHelp(provider);
  }

  UpdateAiKeyHelp(provider) {
    const steps = Array.isArray(provider?.tutorial) ? provider.tutorial : [];
    this.Elements.aiKeyTutorialSteps.replaceChildren(...steps.map(BuildTutorialStep));
    this.Elements.aiKeyHelpLink.hidden = !provider?.keyHelpUrl;
    this.Elements.aiKeyHelpLink.href = provider?.keyHelpUrl || "";
    this.Elements.aiKeyHint.textContent = this.BuildAiKeyHint(provider);
  }

  BuildAiKeyHint(provider) {
    const connection = this.FindAiConnection(this.State.ai.editingConnectionId);
    if (connection?.hasKey)
      return "A key is already saved. Leave this blank to keep it.";
    if (provider && !provider.keyRequired)
      return "Leave this blank if your AI server does not need a key.";
    return "Your key is encrypted when saved and never shown again.";
  }

  HandleAiConnectionInput() {
    this.ResetAiModelPicker();
    this.ShowAiSettingsStatus("Find your models after entering the connection details.");
    this.ShowAiSettingsError("");
  }

  async FindAiModels() {
    const connection = this.ReadAiConnectionForm();
    const error = this.ValidateAiDraft(connection);
    if (error)
      return this.ShowAiSettingsError(error);
    this.SetAiSettingsBusy(true, "Securely finding your models…");
    try {
      const payload = await this.RequestJson(Config.aiModelsUrl, PostMethod, connection);
      this.ApplyDiscoveredModels(payload.models);
    } finally {
      this.SetAiSettingsBusy(false);
    }
  }

  ValidateAiDraft(connection) {
    const provider = this.FindAiProvider(connection.providerId);
    if (!provider)
      return "Choose your AI service first.";
    if (provider.needsServerUrl && !connection.baseUrl)
      return "Enter the AI server address first.";
    const saved = this.FindAiConnection(connection.connectionId);
    if (provider.keyRequired && !connection.apiKey && !saved?.hasKey)
      return "Paste your private access key first.";
    return "";
  }

  ApplyDiscoveredModels(models) {
    this.State.ai.models = Array.isArray(models) ? models : [];
    this.Elements.aiModelPanel.hidden = false;
    this.Elements.aiModelSearch.value = "";
    this.RenderAiModelOptions();
    this.SelectSavedAiModel();
    this.ShowAiSettingsStatus(`${this.State.ai.models.length.toLocaleString()} current models found. Choose one, then test and save.`);
    this.ShowAiSettingsError("");
  }

  SelectSavedAiModel() {
    const connection = this.FindAiConnection(this.State.ai.editingConnectionId);
    const saved = connection?.model || "";
    this.Elements.aiModelSelect.value = this.IsDiscoveredAiModel(saved) ? saved : "";
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
    return this.State.ai.models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query));
  }

  async SaveAiSettings() {
    const request = this.ReadAiSaveRequest();
    if (!this.IsDiscoveredAiModel(request.model))
      return this.ShowAiSettingsError("Choose a model from the list first.");
    this.SetAiSettingsBusy(true, "Testing the selected model…");
    try {
      const payload = await this.SaveAiConnectionRequest(request);
      this.ApplyAiConnectionState(payload, "Connected, tested, encrypted, and saved.");
    } finally {
      this.SetAiSettingsBusy(false);
    }
  }

  async SaveAiConnectionRequest(request) {
    const connectionId = this.State.ai.editingConnectionId;
    const url = connectionId ? `${Config.aiConnectionsUrl}/${connectionId}` : Config.aiConnectionsUrl;
    const method = connectionId ? PutMethod : PostMethod;
    return await this.RequestJson(url, method, request);
  }

  async SetDefaultAiConnection(connectionId) {
    const url = `${Config.aiConnectionsUrl}/${connectionId}/default`;
    const payload = await this.RequestJson(url, PutMethod, {});
    this.ApplyAiConnectionState(payload, "Default AI updated.");
  }

  async RemoveAiConnection(connectionId) {
    const connection = this.FindAiConnection(connectionId);
    if (!connection || !window.confirm(`Remove ${connection.name}?`))
      return;
    const payload = await this.RequestJson(`${Config.aiConnectionsUrl}/${connectionId}`, DeleteMethod, {});
    this.ApplyAiConnectionState(payload, "The AI choice and its encrypted key were removed.");
  }

  ApplyAiConnectionState(payload, message) {
    Object.assign(this.State.ai, payload, { checked: true, loading: false, models: [], editingConnectionId: "" });
    this.Settings.aiConfigured = Boolean(payload.configured);
    this.HideAiConnectionEditor();
    this.RenderAiProviders();
    this.RenderAiConnections();
    this.UpdateRecommendationAiChoices();
    this.UpdateAiControls();
    this.ShowAiSettingsStatus(message);
  }

  HandleAiConnectionListClick(event) {
    const button = event.target.closest("[data-ai-action]");
    if (!button)
      return;
    this.RunAiConnectionAction(button.dataset.aiAction, button.dataset.connectionId);
  }

  RunAiConnectionAction(action, connectionId) {
    if (action === EditAction)
      return this.BeginEditAiConnection(connectionId);
    if (action === DefaultAction)
      return this.SetDefaultAiConnection(connectionId).catch((error) => this.ShowAiSettingsError(error.message));
    if (action === RemoveAction)
      this.RemoveAiConnection(connectionId).catch((error) => this.ShowAiSettingsError(error.message));
  }

  ReadAiConnectionForm() {
    return {
      providerId: this.Elements.aiProvider.value,
      baseUrl: this.Elements.aiBaseUrl.value.trim(),
      apiKey: this.Elements.aiApiKey.value.trim(),
      connectionId: this.State.ai.editingConnectionId || undefined
    };
  }

  ReadAiSaveRequest() {
    return {
      ...this.ReadAiConnectionForm(),
      name: this.Elements.aiConnectionName.value.trim(),
      model: this.Elements.aiModelSelect.value,
      isDefault: this.Elements.aiUseDefault.checked
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
    for (const element of ReadAiEditorControls(this.Elements))
      element.disabled = value;
    this.Elements.aiAdd.disabled = value;
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

  UpdateRecommendationAiChoices() {
    const usable = this.State.ai.connections.filter((connection) => Boolean(connection.model));
    const selected = this.Elements.recommendationAiConnection.value;
    this.Elements.recommendationAiConnection.replaceChildren(...usable.map(BuildRecommendationOption));
    const fallback = this.State.ai.defaultConnectionId;
    this.Elements.recommendationAiConnection.value = usable.some((item) => item.id === selected) ? selected : fallback;
    this.Elements.recommendationAiControl.hidden = !usable.length;
  }

  IsDiscoveredAiModel(model) {
    return this.State.ai.models.some((item) => item.id === model);
  }

  FindAiConnection(connectionId) {
    return this.State.ai.connections.find((connection) => connection.id === connectionId) || null;
  }

  FindAiProvider(providerId) {
    return this.State.ai.providers.find((provider) => provider.id === providerId) || null;
  }

  ReadSelectedAiProvider() {
    return this.FindAiProvider(this.Elements.aiProvider.value);
  }

  ShowAiSettingsError(message) {
    this.Elements.aiSettingsError.textContent = message || "";
  }

  ShowAiSettingsStatus(message) {
    this.Elements.aiSettingsStatus.textContent = message || "";
  }
}

function BuildProviderOption(provider) {
  const option = document.createElement(OptionElementName);
  option.value = provider.id;
  option.textContent = provider.name;
  return option;
}

function BuildProviderPlaceholder() {
  const option = document.createElement(OptionElementName);
  option.value = "";
  option.textContent = "Choose an AI service";
  return option;
}

function BuildModelOption(model) {
  const option = document.createElement(OptionElementName);
  option.value = model.id;
  option.textContent = model.name && model.name !== model.id ? `${model.name} — ${model.id}` : model.id;
  return option;
}

function BuildModelPlaceholder() {
  const option = document.createElement(OptionElementName);
  option.value = "";
  option.textContent = ChooseModelLabel;
  return option;
}

function BuildTutorialStep(copy) {
  const item = document.createElement("li");
  item.textContent = copy;
  return item;
}

function BuildConnectionCard(connection) {
  const card = document.createElement("article");
  card.className = "ai-connection-choice";
  card.append(BuildConnectionCopy(connection), BuildConnectionActions(connection));
  return card;
}

function BuildConnectionCopy(connection) {
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  const detail = document.createElement("span");
  heading.textContent = connection.name;
  detail.textContent = `${connection.providerName} · ${connection.model || ChooseModelLabel}`;
  copy.append(heading, detail, BuildConnectionStatus(connection));
  return copy;
}

function BuildConnectionStatus(connection) {
  const status = document.createElement("small");
  const tested = connection.testStatus === "tested" ? "✓ Tested" : "Needs setup";
  status.textContent = connection.isDefault ? `${tested} · Default` : tested;
  return status;
}

function BuildConnectionActions(connection) {
  const actions = document.createElement("div");
  actions.className = "ai-connection-choice-actions";
  if (!connection.isDefault)
    actions.append(BuildActionButton("Use by default", DefaultAction, connection.id));
  actions.append(BuildActionButton("Edit", EditAction, connection.id));
  actions.append(BuildActionButton("Remove", RemoveAction, connection.id, "btn-outline-danger"));
  return actions;
}

function BuildActionButton(label, action, connectionId, style = "btn-outline-secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-sm ${style}`;
  button.textContent = label;
  button.dataset.aiAction = action;
  button.dataset.connectionId = connectionId;
  return button;
}

function BuildRecommendationOption(connection) {
  const option = document.createElement(OptionElementName);
  option.value = connection.id;
  option.textContent = `${connection.name} — ${connection.model}`;
  return option;
}

function ReadAiEditorControls(elements) {
  return [
    elements.aiProvider, elements.aiBaseUrl, elements.aiApiKey, elements.aiFindModels,
    elements.aiModelSearch, elements.aiModelSelect, elements.aiConnectionName,
    elements.aiUseDefault, elements.aiCancel
  ];
}
