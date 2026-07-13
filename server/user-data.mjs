import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const AppDataFolderName = "IMDb Rapid Rater";
const PosixAppDataFolderName = "imdb-rapid-rater";
const UserDataOverrideEnv = "IMDB_RAPID_RATER_HOME";

export function BuildUserDataPath(...segments) {
  return path.join(GetUserDataRoot(), ...segments);
}

export function GetUserDataRoot() {
  const override = ReadUserDataOverride();
  if (override)
    return override;
  if (process.platform === "win32")
    return path.join(ReadWindowsAppDataRoot(), AppDataFolderName);
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", AppDataFolderName);
  return path.join(ReadLinuxDataRoot(), PosixAppDataFolderName);
}

export function EnsureUserDataParent(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

export function MigrateLegacyFile(legacyPath, targetPath) {
  try {
    if (existsSync(targetPath) || !existsSync(legacyPath))
      return false;
    EnsureUserDataParent(targetPath);
    copyFileSync(legacyPath, targetPath);
    return true;
  } catch {
    return false;
  }
}

function ReadUserDataOverride() {
  const value = String(process.env[UserDataOverrideEnv] || "").trim();
  return value ? path.resolve(ExpandHomePath(value)) : "";
}

function ExpandHomePath(value) {
  if (value === "~")
    return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\"))
    return path.join(os.homedir(), value.slice(2));
  return value;
}

function ReadWindowsAppDataRoot() {
  return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
}

function ReadLinuxDataRoot() {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}
