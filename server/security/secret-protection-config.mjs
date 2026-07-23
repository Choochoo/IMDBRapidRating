import { HasEncryptionKey } from "./secrets.mjs";

export const LegacyProtectionMode = "legacy";
export const DualProtectionMode = "dual";
export const VaultProtectionMode = "vault";
export const LegacySecretVersion = 1;
export const EnvelopeSecretVersion = 2;

const ProtectionModes = new Set([LegacyProtectionMode, DualProtectionMode, VaultProtectionMode]);

export function ReadSecretProtectionMode(value = process.env.SECRET_PROTECTION_MODE) {
  const mode = String(value || LegacyProtectionMode).trim().toLowerCase();
  if (!ProtectionModes.has(mode))
    throw new Error("SECRET_PROTECTION_MODE must be legacy, dual, or vault.");
  return mode;
}

export function ReadAzureKeyVaultKeyId(value = process.env.AZURE_KEY_VAULT_KEY_ID) {
  const keyId = String(value || "").trim();
  if (!keyId)
    throw new Error("AZURE_KEY_VAULT_KEY_ID is required for dual or vault protection.");
  return NormalizeAzureKeyVaultKeyId(keyId);
}

export function ReadManagedIdentityClientId(value = process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID) {
  return String(value || "").trim();
}

export function HasSecretProtectionConfiguration() {
  const mode = ReadSecretProtectionMode();
  if (mode === LegacyProtectionMode)
    return HasEncryptionKey();
  ReadAzureKeyVaultKeyId();
  return mode === VaultProtectionMode || HasEncryptionKey();
}

function NormalizeAzureKeyVaultKeyId(value) {
  const url = new URL(value);
  const isKeyPath = /^\/keys\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !isKeyPath)
    throw new Error("AZURE_KEY_VAULT_KEY_ID must be a valid HTTPS Azure Key Vault key identifier.");
  return url.toString().replace(/\/$/, "");
}
