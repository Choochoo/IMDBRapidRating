import { SecretClient } from "@azure/keyvault-secrets";
import { CreateAzureCredential } from "./azure-credential.mjs";
import { DualProtectionMode, ReadSecretProtectionMode } from "./secret-protection-config.mjs";

const RuntimeSecretMappingValues = [
  { environmentName: "POSTGRES_CONNECTION_STRING", secretName: "rapid-rater-postgres-connection-string" },
  { environmentName: "SESSION_SECRET", secretName: "rapid-rater-session-secret" },
  { environmentName: "TMDB_API_KEY", secretName: "rapid-rater-tmdb-api-key" }
];
const RuntimeSecretMappings = Object.freeze(RuntimeSecretMappingValues);
const LegacyKeyMapping = Object.freeze({ environmentName: "DATA_ENCRYPTION_KEY", secretName: "rapid-rater-legacy-data-encryption-key" });

export async function LoadAzureRuntimeSecrets(options = {}) {
  const vaultUrl = ReadVaultUrl(options.vaultUrl);
  if (!vaultUrl)
    return false;
  const client = options.client || new SecretClient(vaultUrl, CreateAzureCredential(options));
  const mappings = BuildRequiredMappings(options.mode);
  for (const mapping of mappings)
    process.env[mapping.environmentName] = await ReadSecretValue(client, mapping.secretName);
  return true;
}

function BuildRequiredMappings(mode) {
  const protectionMode = ReadSecretProtectionMode(mode);
  if (protectionMode !== DualProtectionMode)
    return RuntimeSecretMappings;
  return [...RuntimeSecretMappings, LegacyKeyMapping];
}

async function ReadSecretValue(client, secretName) {
  const secret = await client.getSecret(secretName);
  if (!String(secret.value || "").trim())
    throw new Error(`Azure Key Vault secret '${secretName}' is empty.`);
  return secret.value;
}

function ReadVaultUrl(value = process.env.AZURE_KEY_VAULT_URL) {
  const source = String(value || "").trim();
  if (!source)
    return "";
  const url = new URL(source);
  const hasInvalidProtocol = url.protocol !== "https:";
  const hasCredentials = Boolean(url.username || url.password);
  const hasExtraLocation = Boolean(url.search || url.hash || url.pathname !== "/");
  if (hasInvalidProtocol || hasCredentials || hasExtraLocation)
    throw new Error("AZURE_KEY_VAULT_URL must be an HTTPS vault origin without credentials, paths, queries, or fragments.");
  return url.toString().replace(/\/$/, "");
}
