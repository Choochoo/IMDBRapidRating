import { ValidateApiKey, ValidateImdbCookie } from "./browser-settings.js";
import { EscapeHtml, FormatCount } from "./util.js";

export async function SaveImdbConnectionFromDialog(app) {
  const result = ValidateImdbCookie(app.Elements.imdbInput.value);
  if (!result.ok)
    return app.ShowImdbError(result.error);
  app.SetImdbSaving(true);
  try {
    await app.SaveAccountSecret("imdb", result.value);
  } finally {
    app.SetImdbSaving(false);
  }
  await ApplySavedImdbConnection(app);
}

export async function SaveTmdbKeyFromDialog(app) {
  const result = ValidateApiKey(app.Elements.tmdbInput.value, "TMDB");
  if (!result.ok)
    return app.ShowTmdbError(result.error);
  app.SetTmdbSaving(true);
  try {
    await app.SaveAccountSecret("tmdb", result.value);
  } finally {
    app.SetTmdbSaving(false);
  }
  await ApplySavedTmdbKey(app);
}

export async function SaveAiKeyFromDialog(app) {
  const result = ValidateApiKey(app.Elements.aiInput.value, "OpenAI");
  if (!result.ok)
    return app.ShowAiError(result.error);
  app.SetAiSaving(true);
  try {
    await app.SaveAccountSecret("openai", result.value);
  } finally {
    app.SetAiSaving(false);
  }
  await ApplySavedAiKey(app);
}

export async function SaveSelectedAiModel(app) {
  const model = app.Elements.aiModelSelect.value.trim();
  app.SetAiModelSaving(true);
  try {
    await app.SaveAccountPreferences(model);
  } finally {
    app.SetAiModelSaving(false);
  }
  app.State.ai.model = model;
  app.Settings.openAiModel = model;
  await app.RefreshAiModels().catch(() => null);
  app.ShowToast(`OpenAI model set to <strong>${EscapeHtml(model || "auto")}</strong>`);
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
