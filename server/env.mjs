import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export function LoadLocalEnv(rootPath) {
  const envPath = path.join(rootPath, ".env.local");
  if (!existsSync(envPath))
    return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/))
    LoadEnvLine(line);
}

export function GetImdbCookie() {
  const cookie = EnvValue("IMDB_COOKIE");
  if (!cookie)
    return "";
  return NormalizeCookieHeader(cookie);
}

export function GetTmdbApiKey() {
  return NormalizeTmdbApiKey(EnvValue("TMDB_API_KEY"));
}

export function HasImdbAuthCookie() {
  return /(?:^|;\s*)at-main=/.test(GetImdbCookie());
}

export async function SaveImdbCookie(rootPath, cookie) {
  const normalizedCookie = NormalizeCookieHeader(String(cookie || ""));
  const validationError = ValidateImdbCookie(normalizedCookie);
  if (validationError)
    return validationError;
  await SaveEnvValue(rootPath, "IMDB_COOKIE", normalizedCookie);
  process.env.IMDB_COOKIE = normalizedCookie;
  return CookieSaveOk();
}

export async function SaveTmdbApiKey(rootPath, apiKey) {
  const normalizedKey = NormalizeTmdbApiKey(apiKey);
  if (!normalizedKey)
    return TmdbSaveFail(422, "TMDB_KEY_MISSING", "Paste your TMDB API key.");
  await SaveEnvValue(rootPath, "TMDB_API_KEY", normalizedKey);
  process.env.TMDB_API_KEY = normalizedKey;
  return TmdbSaveOk();
}

export function IsDryRun() {
  return process.env.IMDB_DRY_RUN === "true";
}

function LoadEnvLine(line) {
  const trimmedLine = line.trim();
  if (!trimmedLine || trimmedLine.startsWith("#"))
    return;
  const equalsIndex = trimmedLine.indexOf("=");
  if (equalsIndex < 1)
    return;
  const key = trimmedLine.slice(0, equalsIndex).trim();
  const value = StripWrappingQuotes(trimmedLine.slice(equalsIndex + 1).trim());
  if (!process.env[key])
    process.env[key] = value;
}

function EnvValue(key) {
  const exactValue = process.env[key];
  if (exactValue)
    return StripWrappingQuotes(exactValue.trim());
  const actualKey = FindEnvironmentKey(key);
  return actualKey ? StripWrappingQuotes(process.env[actualKey].trim()) : "";
}

function FindEnvironmentKey(key) {
  return Object.keys(process.env).find((name) => name.toLowerCase() === key.toLowerCase());
}

function ValidateImdbCookie(cookie) {
  if (!cookie)
    return CookieSaveFail(422, "COOKIE_MISSING", "Paste the full Cookie request-header value from a signed-in IMDb page.");
  if (!/(?:^|;\s*)at-main=/.test(cookie))
    return CookieSaveFail(422, "COOKIE_NOT_SIGNED_IN", "That cookie does not include at-main. Copy the full Cookie header while signed into IMDb.");
  return null;
}

function ReadEnvContent(envPath) {
  return existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
}

async function SaveEnvValue(rootPath, key, value) {
  const envPath = path.join(rootPath, ".env.local");
  const content = BuildUpdatedEnvContent(ReadEnvContent(envPath), key, value);
  await writeFile(envPath, content, "utf8");
}

function BuildUpdatedEnvContent(content, key, value) {
  const lines = content ? content.split(/\r?\n/) : BuildDefaultEnvLines();
  const updated = ReplaceEnvLine(lines, key, `${key}=${value}`);
  return `${EnsureDryRunLine(updated).join("\n").replace(/\n+$/u, "")}\n`;
}

function BuildDefaultEnvLines() {
  return ["# Local IMDb Rapid Rater settings.", "IMDB_COOKIE=", "IMDB_DRY_RUN=false", "TMDB_API_KEY="];
}

function ReplaceEnvLine(lines, key, replacement) {
  const index = lines.findIndex((line) => line.trim().toLowerCase().startsWith(`${key.toLowerCase()}=`));
  if (index < 0)
    return [replacement, ...lines];
  return lines.map((line, lineIndex) => lineIndex === index ? replacement : line);
}

function EnsureDryRunLine(lines) {
  const hasDryRun = lines.some((line) => line.trim().toLowerCase().startsWith("imdb_dry_run="));
  return hasDryRun ? lines : [...lines, "IMDB_DRY_RUN=false"];
}

function CookieSaveOk() {
  return {
    status: 200,
    payload: { ok: true, configured: HasImdbAuthCookie(), dryRun: IsDryRun() }
  };
}

function CookieSaveFail(status, code, error) {
  return {
    status,
    payload: { ok: false, code, error }
  };
}

function TmdbSaveOk() {
  return {
    status: 200,
    payload: { ok: true, tmdbConfigured: Boolean(GetTmdbApiKey()) }
  };
}

function TmdbSaveFail(status, code, error) {
  return {
    status,
    payload: { ok: false, code, error }
  };
}

function NormalizeCookieHeader(value) {
  return StripWrappingQuotes(value.trim()).replace(/^cookie\s*:\s*/i, "").replace(/[\r\n]+/g, " ");
}

function NormalizeTmdbApiKey(value) {
  return StripWrappingQuotes(String(value || "").trim()).replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function StripWrappingQuotes(value) {
  const hasDoubleQuotes = value.startsWith("\"") && value.endsWith("\"");
  const hasSingleQuotes = value.startsWith("'") && value.endsWith("'");
  if (hasDoubleQuotes || hasSingleQuotes)
    return value.slice(1, -1);
  return value;
}
