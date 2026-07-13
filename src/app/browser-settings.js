import { Config } from "./config.js";

export function ReadBrowserSettings() {
  try {
    return NormalizeSettings(JSON.parse(localStorage.getItem(Config.settingsKey) || "{}"));
  } catch {
    return NormalizeSettings({});
  }
}

export function SaveBrowserSettings(settings) {
  localStorage.setItem(Config.settingsKey, JSON.stringify(NormalizeSettings(settings)));
}

export function SaveImdbCookie(settings, cookie) {
  const normalized = NormalizeCookie(cookie);
  if (!HasImdbCookie(normalized))
    return { ok: false, error: "The IMDb connection is not signed in. Copy the full Cookie header containing at-main." };
  return SaveSetting(settings, "imdbCookie", normalized);
}

export function SaveTmdbKey(settings, apiKey) {
  const normalized = NormalizeBearerValue(apiKey);
  if (!normalized)
    return { ok: false, error: "Paste your TMDB API key." };
  return SaveSetting(settings, "tmdbApiKey", normalized);
}

export function SaveOpenAiKey(settings, apiKey) {
  const normalized = NormalizeBearerValue(apiKey);
  if (!normalized)
    return { ok: false, error: "Paste your OpenAI API key." };
  return SaveSetting(settings, "openAiApiKey", normalized);
}

export function SaveOpenAiModel(settings, model) {
  return SaveSetting(settings, "openAiModel", String(model || "").trim());
}

export function HasImdbCookie(cookie) {
  return /(?:^|;\s*)at-main=/.test(cookie || "");
}

export function NormalizeCookie(value) {
  return StripQuotes(String(value || "").trim())
    .replace(/^cookie\s*:\s*/i, "")
    .replace(/[\r\n]+/g, " ");
}

function SaveSetting(settings, key, value) {
  const next = NormalizeSettings({ ...settings, [key]: value });
  SaveBrowserSettings(next);
  Object.assign(settings, next);
  return { ok: true };
}

function NormalizeSettings(settings) {
  return {
    imdbCookie: NormalizeCookie(settings?.imdbCookie || ""),
    tmdbApiKey: NormalizeBearerValue(settings?.tmdbApiKey || ""),
    openAiApiKey: NormalizeBearerValue(settings?.openAiApiKey || ""),
    openAiModel: String(settings?.openAiModel || "").trim(),
    openAiModelLag: Number(settings?.openAiModelLag) || 2
  };
}

function NormalizeBearerValue(value) {
  return StripQuotes(String(value || "").trim())
    .replace(/^authorization:\s*/i, "")
    .replace(/^bearer\s+/i, "");
}

function StripQuotes(value) {
  const hasDoubleQuotes = value.startsWith("\"") && value.endsWith("\"");
  const hasSingleQuotes = value.startsWith("'") && value.endsWith("'");
  if (hasDoubleQuotes || hasSingleQuotes)
    return value.slice(1, -1);
  return value;
}
