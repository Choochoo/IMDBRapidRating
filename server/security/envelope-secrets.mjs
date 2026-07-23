import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EnvelopeSecretVersion } from "./secret-protection-config.mjs";

const Algorithm = "aes-256-gcm";
const DataKeyBytes = 32;
const IvBytes = 12;
const Base64Encoding = "base64";
const Utf8Encoding = "utf8";

export function GenerateDataKey() {
  return randomBytes(DataKeyBytes);
}

export function EncryptEnvelopeSecret(value, dataKey, userId, secretType) {
  ValidateDataKey(dataKey);
  const iv = randomBytes(IvBytes);
  const cipher = createCipheriv(Algorithm, dataKey, iv);
  cipher.setAAD(BuildAad(userId, secretType));
  const ciphertext = Buffer.concat([cipher.update(String(value), Utf8Encoding), cipher.final()]);
  return BuildEncryptedRecord(ciphertext, iv, cipher.getAuthTag());
}

export function DecryptEnvelopeSecret(record, dataKey, userId, secretType) {
  ValidateDataKey(dataKey);
  const decipher = createDecipheriv(Algorithm, dataKey, Buffer.from(record.iv, Base64Encoding));
  decipher.setAAD(BuildAad(userId, secretType));
  decipher.setAuthTag(Buffer.from(record.authTag, Base64Encoding));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, Base64Encoding)), decipher.final()]).toString(Utf8Encoding);
}

function BuildEncryptedRecord(ciphertext, iv, authTag) {
  return {
    ciphertext: ciphertext.toString(Base64Encoding),
    iv: iv.toString(Base64Encoding),
    authTag: authTag.toString(Base64Encoding),
    keyVersion: EnvelopeSecretVersion
  };
}

function BuildAad(userId, secretType) {
  return Buffer.from(`imdb-rapid-rater:${userId}:${secretType}:v${EnvelopeSecretVersion}`, Utf8Encoding);
}

function ValidateDataKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== DataKeyBytes)
    throw new Error("The envelope data key must contain exactly 32 bytes.");
}
