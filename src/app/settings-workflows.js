import { SaveImdbCookie, SaveOpenAiKey, SaveOpenAiModel, SaveTmdbKey } from "./browser-settings.js";
import { EscapeHtml, FormatCount } from "./util.js";

export async function SaveImdbConnectionFromDialog(app) {
  const cookie = app.Elements.imdbInput.value.trim();
  if (!cookie)
    return app.ShowImdbError("Sign in on IMDb, then paste the full Cookie request-header value.");
  app.SetImdbSaving(true);
  try {
    SaveBrowserValue(app.Settings, cookie, SaveImdbCookie);
  } finally {
    app.SetImdbSaving(false);
  }
  await ApplySavedImdbConnection(app);
}

export async function SaveTmdbKeyFromDialog(app) {
  const apiKey = app.Elements.tmdbInput.value.trim();
  if (!apiKey)
    return app.ShowTmdbError("Paste your TMDB API key.");
  app.SetTmdbSaving(true);
  try {
    SaveBrowserValue(app.Settings, apiKey, SaveTmdbKey);
  } finally {
    app.SetTmdbSaving(false);
  }
  await ApplySavedTmdbKey(app);
}

export async function SaveAiKeyFromDialog(app) {
  const apiKey = app.Elements.aiInput.value.trim();
  if (!apiKey)
    return app.ShowAiError("Paste your OpenAI API key.");
  app.SetAiSaving(true);
  try {
    SaveBrowserValue(app.Settings, apiKey, SaveOpenAiKey);
  } finally {
    app.SetAiSaving(false);
  }
  await ApplySavedAiKey(app);
}

export async function SaveSelectedAiModel(app) {
  const model = app.Elements.aiModelSelect.value.trim();
  app.SetAiModelSaving(true);
  SaveOpenAiModel(app.Settings, model);
  app.SetAiModelSaving(false);
  await ApplySavedAiModel(app, model);
}

function SaveBrowserValue(settings, value, save) {
  const result = save(settings, value);
  if (!result.ok)
    throw new Error(result.error);
}

async function ApplySavedImdbConnection(app) {
  await app.RefreshLiveStatus();
  app.HideImdbDialog();
  const queued = app.QueueRetryableImdbSubmits();
  if (queued > 0)
    return app.ShowToast(`IMDb connected. Queued <strong>${FormatCount(queued)}</strong> writes`);
  app.ShowToast("IMDb connected. <strong>Live ready</strong>");
}

async function ApplySavedTmdbKey(app) {
  await app.RefreshLiveStatus();
  app.HideTmdbDialog();
  app.RefreshVisibleMetadata();
  app.ShowToast("TMDB key saved. <strong>Metadata ready</strong>");
}

async function ApplySavedAiKey(app) {
  await app.RefreshAiStatus();
  app.HideAiDialog();
  app.ShowToast("OpenAI key saved. <strong>Recommendations ready</strong>");
}

async function ApplySavedAiModel(app, model) {
  app.State.ai.model = model;
  app.Settings.openAiModel = model;
  await app.RefreshAiModels().catch(() => null);
  app.ShowToast(`OpenAI model set to <strong>${EscapeHtml(model || "auto")}</strong>`);
}
