import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { DecryptEnvelopeSecret, EncryptEnvelopeSecret } from "../server/security/envelope-secrets.mjs";
import { CreateSecretProtector } from "../server/security/secret-protector.mjs";

const ApiKey = "api-key";
const UserId = "user-1";
const AiSecretType = "ai";
const LegacyMode = "legacy";
const DualMode = "dual";
const VaultMode = "vault";
const LegacyKey = "legacy-key";
const DataEncryptionKeyName = "DATA_ENCRYPTION_KEY";
const Base64Encoding = "base64";

test("dual protection writes and reads Azure envelope records", VerifyDualProtection);
test("envelope encryption binds ciphertext to its user and secret type", VerifyEnvelopeBinding);
test("envelope encryption rejects modified ciphertext", VerifyModifiedCiphertext);
test("dual protection continues to read legacy records during migration", VerifyLegacyDualRead);
test("vault protection fails closed when a legacy record remains", VerifyVaultLegacyRejection);
test("legacy protection fails closed when an envelope record is encountered", VerifyLegacyEnvelopeRejection);

async function VerifyDualProtection() {
  const dataKey = randomBytes(32);
  const keyStore = BuildKeyStore(dataKey);
  const protector = CreateSecretProtector({ mode: DualMode, keyStore });
  const encrypted = await protector.Encrypt(ApiKey, UserId, AiSecretType);
  assert.equal(encrypted.keyVersion, 2);
  assert.equal(await protector.Decrypt(encrypted, UserId, AiSecretType), ApiKey);
}

function VerifyEnvelopeBinding() {
  const dataKey = randomBytes(32);
  const encrypted = EncryptEnvelopeSecret(ApiKey, dataKey, UserId, AiSecretType);
  assert.throws(() => DecryptEnvelopeSecret(encrypted, dataKey, "user-2", AiSecretType));
  assert.throws(() => DecryptEnvelopeSecret(encrypted, dataKey, UserId, "imdb"));
}

function VerifyModifiedCiphertext() {
  const dataKey = randomBytes(32);
  const encrypted = EncryptEnvelopeSecret(ApiKey, dataKey, UserId, AiSecretType);
  const ciphertext = Buffer.from(encrypted.ciphertext, Base64Encoding);
  ciphertext[0] ^= 1;
  assert.throws(() => DecryptEnvelopeSecret({ ...encrypted, ciphertext: ciphertext.toString(Base64Encoding) }, dataKey, UserId, AiSecretType));
}

async function VerifyLegacyDualRead() {
  const previousKey = process.env[DataEncryptionKeyName];
  process.env[DataEncryptionKeyName] = randomBytes(32).toString(Base64Encoding);
  try {
    const legacy = CreateSecretProtector({ mode: LegacyMode });
    const dual = CreateSecretProtector({ mode: DualMode, keyStore: BuildKeyStore(randomBytes(32)) });
    const encrypted = await legacy.Encrypt(LegacyKey, UserId, AiSecretType);
    assert.equal(await dual.Decrypt(encrypted, UserId, AiSecretType), LegacyKey);
  } finally {
    RestoreEnvironment(DataEncryptionKeyName, previousKey);
  }
}

async function VerifyVaultLegacyRejection() {
  const previousKey = process.env[DataEncryptionKeyName];
  process.env[DataEncryptionKeyName] = randomBytes(32).toString(Base64Encoding);
  try {
    const legacy = CreateSecretProtector({ mode: LegacyMode });
    const vault = CreateSecretProtector({ mode: VaultMode, keyStore: BuildKeyStore(randomBytes(32)) });
    const encrypted = await legacy.Encrypt(LegacyKey, UserId, AiSecretType);
    await assert.rejects(vault.Decrypt(encrypted, UserId, AiSecretType), /legacy encrypted secret remains/i);
  } finally {
    RestoreEnvironment(DataEncryptionKeyName, previousKey);
  }
}

async function VerifyLegacyEnvelopeRejection() {
  const protector = CreateSecretProtector({ mode: LegacyMode });
  await assert.rejects(protector.Decrypt({ keyVersion: 2 }, UserId, AiSecretType), /cannot be read in legacy protection mode/i);
}

function BuildKeyStore(dataKey) {
  return {
    GetOrCreateKey: async () => dataKey,
    ReadKey: async () => dataKey
  };
}

function RestoreEnvironment(name, value) {
  if (value === undefined)
    delete process.env[name];
  else
    process.env[name] = value;
}
