import { ValidateApiKey, ValidateImdbCookie } from "./browser-settings.js";
import { EscapeHtml, FormatCount } from "./util.js";
import { NormalizeStreamingCountry } from "../../shared/streaming-country.js";

export async function SaveImdbConnectionFromDialog(app) {
  const result = ValidateImdbCookie(app.Elements.imdbInput.value);
  if (!result.ok)
    return app.ShowImdbError(result.error);
  app.SetImdbSaving(true);
  let saved;
  try {
    saved = await app.SaveAccountSecret("imdb", result.value);
  } finally {
    app.SetImdbSaving(false);
  }
  await ApplySavedImdbConnection(app, saved);
}

export async function SaveTmdbSettingsFromDialog(app) {
  const result = ReadTmdbSettings(app);
  if (!result.ok)
    return app.ShowTmdbError(result.error);
  app.SetTmdbSaving(true);
  try {
    await SaveTmdbAccountSettings(app, result);
  } finally {
    app.SetTmdbSaving(false);
  }
  await ApplySavedTmdbSettings(app, result.country);
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
    await app.SaveAccountPreferences({ openAiModel: model });
  } finally {
    app.SetAiModelSaving(false);
  }
  app.State.ai.model = model;
  app.Settings.openAiModel = model;
  await app.RefreshAiModels().catch(() => null);
  app.ShowToast(`OpenAI model set to <strong>${EscapeHtml(model || "auto")}</strong>`);
}

async function ApplySavedImdbConnection(app, result) {
  await app.RefreshLiveStatus();
  await app.RefreshRemoteState();
  app.HideImdbDialog();
  const queued = Number(result?.resumedJobs) || 0;
  if (queued > 0)
    return app.ShowToast(`IMDb connected. Queued <strong>${FormatCount(queued)}</strong> writes`);
  app.ShowToast("IMDb connected. <strong>Live ready</strong>");
}

async function ApplySavedTmdbSettings(app, country) {
  await app.RefreshLiveStatus();
  app.HideTmdbDialog();
  app.RefreshVisibleMetadata();
  app.ShowToast(`TMDB settings saved. Streaming country: <strong>${EscapeHtml(country)}</strong>`);
}

async function SaveTmdbAccountSettings(app, settings) {
  if (settings.apiKey)
    await app.SaveAccountSecret("tmdb", settings.apiKey);
  await app.SaveAccountPreferences({ streamingCountry: settings.country });
}

function ReadTmdbSettings(app) {
  const country = NormalizeStreamingCountry(app.Elements.tmdbCountry.value);
  if (!country)
    return { ok: false, error: "Enter a two-letter streaming country code, such as US, CA, GB, or AU." };
  const rawKey = String(app.Elements.tmdbInput.value || "").trim();
  if (!rawKey)
    return { ok: true, country, apiKey: "" };
  const key = ValidateApiKey(rawKey, "TMDB");
  return key.ok ? { ok: true, country, apiKey: key.value } : key;
}

async function ApplySavedAiKey(app) {
  await app.RefreshAiStatus();
  app.HideAiDialog();
  app.ShowToast("OpenAI key saved. <strong>Recommendations ready</strong>");
}
