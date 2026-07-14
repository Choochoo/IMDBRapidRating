import { Config } from "./config.js";

export function ReadBrowserSettings() {
  try {
    return NormalizeLegacySettings(JSON.parse(localStorage.getItem(Config.settingsKey) || "{}"));
  } catch {
    return NormalizeLegacySettings({});
  }
}

export function ApplyAccountSettings(settings, remote) {
  Object.assign(settings, {
    imdbConfigured: Boolean(remote?.imdbConfigured),
    tmdbConfigured: Boolean(remote?.tmdbConfigured),
    openAiConfigured: Boolean(remote?.openAiConfigured),
    openAiModel: String(remote?.openAiModel || ""),
    openAiModelLag: Number(remote?.openAiModelLag) || 2
  });
  delete settings.imdbCookie;
  delete settings.tmdbApiKey;
  delete settings.openAiApiKey;
  return settings;
}

export function ClearLegacyBrowserData() {
  localStorage.removeItem(Config.settingsKey);
  localStorage.removeItem(Config.storageKey);
  localStorage.removeItem(Config.storageKey + ":ratings-csv");
}

export function HasLegacyBrowserData(settings = ReadBrowserSettings()) {
  const state = localStorage.getItem(Config.storageKey);
  const csv = localStorage.getItem(Config.storageKey + ":ratings-csv");
  return Boolean(state || csv || settings.imdbCookie || settings.tmdbApiKey || settings.openAiApiKey);
}

export function ReadLegacyState() {
  try {
    return JSON.parse(localStorage.getItem(Config.storageKey) || "{}") || {};
  } catch {
    return {};
  }
}

export function ReadLegacyRatingsCsv() {
  return localStorage.getItem(Config.storageKey + ":ratings-csv") || "";
}

export function ValidateImdbCookie(value) {
  const normalized = NormalizeCookie(value);
  if (!/(?:^|;\s*)at-main=/.test(normalized))
    return { ok: false, error: "The IMDb connection is not signed in. Copy the full Cookie header containing at-main." };
  return { ok: true, value: normalized };
}

export function ValidateApiKey(value, label) {
  const normalized = NormalizeBearerValue(value);
  return normalized ? { ok: true, value: normalized } : { ok: false, error: `Paste your ${label} API key.` };
}

function NormalizeLegacySettings(settings) {
  return {
    imdbCookie: NormalizeCookie(settings?.imdbCookie || ""),
    tmdbApiKey: NormalizeBearerValue(settings?.tmdbApiKey || ""),
    openAiApiKey: NormalizeBearerValue(settings?.openAiApiKey || ""),
    openAiModel: String(settings?.openAiModel || "").trim(),
    openAiModelLag: Number(settings?.openAiModelLag) || 2
  };
}

function NormalizeCookie(value) {
  return StripQuotes(String(value || "").trim()).replace(/^cookie\s*:\s*/i, "").replace(/[\r\n]+/g, " ");
}

function NormalizeBearerValue(value) {
  return StripQuotes(String(value || "").trim()).replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function StripQuotes(value) {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted ? value.slice(1, -1) : value;
}
