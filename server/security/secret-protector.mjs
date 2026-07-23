import { CreateUserDataKeyStore } from "../user-data-key-store.mjs";
import { CreateAzureKeyWrapper } from "./azure-key-wrapper.mjs";
import { DecryptEnvelopeSecret, EncryptEnvelopeSecret } from "./envelope-secrets.mjs";
import { DecryptSecret, EncryptSecret } from "./secrets.mjs";
import { DualProtectionMode, EnvelopeSecretVersion, LegacyProtectionMode, LegacySecretVersion, ReadSecretProtectionMode, VaultProtectionMode } from "./secret-protection-config.mjs";

export function CreateSecretProtector(options = {}) {
  const mode = ReadSecretProtectionMode(options.mode);
  const keyStore = CreateConfiguredKeyStore(options, mode);
  return new SecretProtector(mode, keyStore);
}

class SecretProtector {
  constructor(mode, keyStore) {
    this.Mode = mode;
    this.KeyStore = keyStore;
  }

  async Encrypt(value, userId, secretType) {
    if (this.Mode === LegacyProtectionMode)
      return EncryptSecret(value, userId, secretType);
    return await this.EncryptForVault(value, userId, secretType);
  }

  async EncryptForVault(value, userId, secretType) {
    if (!this.KeyStore)
      throw new Error("Azure Key Vault protection is not configured.");
    const dataKey = await this.KeyStore.GetOrCreateKey(userId);
    return EncryptEnvelopeSecret(value, dataKey, userId, secretType);
  }

  async Decrypt(record, userId, secretType) {
    const version = Number(record?.keyVersion);
    if (version === LegacySecretVersion)
      return this.DecryptLegacy(record, userId, secretType);
    if (version !== EnvelopeSecretVersion)
      throw new Error("Unsupported encrypted-secret key version.");
    if (!this.KeyStore)
      throw new Error("An Azure envelope secret cannot be read in legacy protection mode.");
    const dataKey = await this.KeyStore.ReadKey(userId);
    return DecryptEnvelopeSecret(record, dataKey, userId, secretType);
  }

  DecryptLegacy(record, userId, secretType) {
    if (this.Mode === VaultProtectionMode)
      throw new Error("A legacy encrypted secret remains after the Azure Key Vault migration.");
    return DecryptSecret(record, userId, secretType);
  }
}

function CreateConfiguredKeyStore(options, mode) {
  if (mode === LegacyProtectionMode)
    return null;
  if (options.keyStore)
    return options.keyStore;
  if (!options.db)
    throw new Error("A database connection is required for Azure Key Vault protection.");
  return CreateUserDataKeyStore(options.db, options.keyWrapper || CreateAzureKeyWrapper(options.azure));
}

export function IsMigrationMode(value = process.env.SECRET_PROTECTION_MODE) {
  return ReadSecretProtectionMode(value) === DualProtectionMode;
}
