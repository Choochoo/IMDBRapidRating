import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BuildUserDataPath, MigrateLegacyFile } from "./user-data.mjs";
import { LoadAzureRuntimeSecrets } from "./security/azure-runtime-secrets.mjs";

const SettingsEnvFile = "settings.env";
const SettingsPathEnvironmentName = "RAPID_RATER_SETTINGS_PATH";
const DoubleQuote = "\"";
const SingleQuote = "'";

export function LoadLocalEnv(rootPath) {
  const envPath = BuildSettingsEnvPath(rootPath);
  if (!existsSync(envPath))
    return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/))
    LoadEnvLine(line);
}

export async function InitializeRuntimeEnvironment(rootPath) {
  LoadLocalEnv(rootPath);
  await LoadAzureRuntimeSecrets();
}

export function IsDryRun() {
  return String(process.env.IMDB_DRY_RUN || "").toLowerCase() === "true";
}

function BuildSettingsEnvPath(rootPath) {
  const configuredPath = String(process.env[SettingsPathEnvironmentName] || "").trim();
  if (configuredPath)
    return path.resolve(configuredPath);
  const envPath = BuildUserDataPath(SettingsEnvFile);
  if (rootPath)
    MigrateLegacyFile(path.join(rootPath, ".env.local"), envPath);
  return envPath;
}

function LoadEnvLine(line) {
  const trimmed = line.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.startsWith("#"))
    return;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex < 1)
    return;
  const key = trimmed.slice(0, equalsIndex).trim();
  const value = StripQuotes(trimmed.slice(equalsIndex + 1).trim());
  if (!process.env[key])
    process.env[key] = value;
}

function StripQuotes(value) {
  const quoted = (value.startsWith(DoubleQuote) && value.endsWith(DoubleQuote)) || (value.startsWith(SingleQuote) && value.endsWith(SingleQuote));
  return quoted ? value.slice(1, -1) : value;
}
