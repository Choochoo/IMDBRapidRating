import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BuildUserDataPath, MigrateLegacyFile } from "./user-data.mjs";

const SettingsEnvFile = "settings.env";

export function LoadLocalEnv(rootPath) {
  const envPath = BuildSettingsEnvPath(rootPath);
  if (!existsSync(envPath))
    return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/))
    LoadEnvLine(line);
}

export function IsDryRun() {
  return String(process.env.IMDB_DRY_RUN || "").toLowerCase() === "true";
}

function BuildSettingsEnvPath(rootPath) {
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
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted ? value.slice(1, -1) : value;
}
