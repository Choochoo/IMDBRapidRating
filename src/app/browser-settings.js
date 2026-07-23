import { Config } from "./config.js";
import { ReadStreamingCountry } from "../../shared/streaming-country.js";
import { NormalizeKeyboardShortcuts } from "../../shared/keyboard-shortcuts.js";
import { NormalizeHelpPreferences } from "../../shared/help-preferences.js";

const RatingsCsvStorageSuffix = ":ratings-csv";
const EmptyJsonObject = "{}";
const DoubleQuote = "\"";
const SingleQuote = "'";

export function ReadBrowserSettings() {
  try {
    return NormalizeLegacySettings(JSON.parse(localStorage.getItem(Config.settingsKey) || EmptyJsonObject));
  } catch {
    return NormalizeLegacySettings({});
  }
}

export function ApplyAccountSettings(settings, remote) {
  const accountSettings = {
    imdbConfigured: Boolean(remote?.imdbConfigured),
    aiConfigured: Boolean(remote?.aiConfigured),
    aiBaseUrl: String(remote?.aiBaseUrl || ""),
    aiModel: String(remote?.aiModel || ""),
    streamingCountry: ReadStreamingCountry(remote?.streamingCountry),
    keyboardShortcuts: NormalizeKeyboardShortcuts(remote?.keyboardShortcuts),
    helpPreferences: NormalizeHelpPreferences(remote?.helpPreferences)
  };
  Object.assign(settings, accountSettings);
  RemoveLegacySettings(settings);
  return settings;
}

function RemoveLegacySettings(settings) {
  delete settings.imdbCookie;
  delete settings.tmdbApiKey;
  delete settings.openAiApiKey;
}

export function BuildAccountPreferences(settings, changes = {}) {
  return {
    streamingCountry: ReadStreamingCountry(changes.streamingCountry ?? settings.streamingCountry),
    keyboardShortcuts: NormalizeKeyboardShortcuts(changes.keyboardShortcuts ?? settings.keyboardShortcuts),
    helpPreferences: NormalizeHelpPreferences(changes.helpPreferences ?? settings.helpPreferences)
  };
}

export function ClearLegacyBrowserData() {
  localStorage.removeItem(Config.settingsKey);
  localStorage.removeItem(Config.storageKey);
  localStorage.removeItem(Config.storageKey + RatingsCsvStorageSuffix);
}

export function HasLegacyBrowserData(settings = ReadBrowserSettings()) {
  const state = localStorage.getItem(Config.storageKey);
  const csv = localStorage.getItem(Config.storageKey + RatingsCsvStorageSuffix);
  return Boolean(state || csv || settings.imdbCookie || settings.tmdbApiKey || settings.openAiApiKey);
}

export function ReadLegacyState() {
  try {
    return JSON.parse(localStorage.getItem(Config.storageKey) || EmptyJsonObject) || {};
  } catch {
    return {};
  }
}

export function ReadLegacyRatingsCsv() {
  return localStorage.getItem(Config.storageKey + RatingsCsvStorageSuffix) || "";
}

export function ValidateImdbCookie(value) {
  const normalized = NormalizeCookie(value);
  if (!/(?:^|;\s*)at-main=/.test(normalized))
    return { ok: false, error: "The IMDb connection is not signed in. Copy the full Cookie header containing at-main." };
  return { ok: true, value: normalized };
}

function NormalizeLegacySettings(settings) {
  return {
    imdbCookie: NormalizeCookie(settings?.imdbCookie || ""),
    tmdbApiKey: NormalizeBearerValue(settings?.tmdbApiKey || ""),
    openAiApiKey: NormalizeBearerValue(settings?.openAiApiKey || ""),
    openAiModel: String(settings?.openAiModel || "").trim(),
    openAiModelLag: Number(settings?.openAiModelLag) || 2,
    streamingCountry: ReadStreamingCountry(settings?.streamingCountry),
    keyboardShortcuts: NormalizeKeyboardShortcuts(settings?.keyboardShortcuts),
    helpPreferences: NormalizeHelpPreferences(settings?.helpPreferences)
  };
}

function NormalizeCookie(value) {
  return StripQuotes(String(value || "").trim()).replace(/^cookie\s*:\s*/i, "").replace(/[\r\n]+/g, " ");
}

function NormalizeBearerValue(value) {
  return StripQuotes(String(value || "").trim()).replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function StripQuotes(value) {
  const quoted = (value.startsWith(DoubleQuote) && value.endsWith(DoubleQuote)) || (value.startsWith(SingleQuote) && value.endsWith(SingleQuote));
  return quoted ? value.slice(1, -1) : value;
}
