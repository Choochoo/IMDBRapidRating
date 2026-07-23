import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const Algorithm = "aes-256-gcm";
const KeyVersion = 1;
const TextEncoding = "utf8";
const Base64Encoding = "base64";

export function EncryptSecret(value, userId, secretType) {
  const key = ReadEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(Algorithm, key, iv);
  cipher.setAAD(BuildAad(userId, secretType));
  const ciphertext = Buffer.concat([cipher.update(String(value), TextEncoding), cipher.final()]);
  return {
    ciphertext: ciphertext.toString(Base64Encoding),
    iv: iv.toString(Base64Encoding),
    authTag: cipher.getAuthTag().toString(Base64Encoding),
    keyVersion: KeyVersion
  };
}

export function DecryptSecret(record, userId, secretType) {
  if (!record)
    return "";
  if (Number(record.keyVersion) !== KeyVersion)
    throw new Error("Unsupported encrypted-secret key version.");
  const decipher = createDecipheriv(Algorithm, ReadEncryptionKey(), Buffer.from(record.iv, Base64Encoding));
  decipher.setAAD(BuildAad(userId, secretType));
  decipher.setAuthTag(Buffer.from(record.authTag, Base64Encoding));
  const ciphertext = Buffer.from(record.ciphertext, Base64Encoding);
  const chunks = [decipher.update(ciphertext), decipher.final()];
  return Buffer.concat(chunks).toString(TextEncoding);
}

export function HasEncryptionKey() {
  try {
    ReadEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function SafeTokenEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function ReadEncryptionKey() {
  const value = String(process.env.DATA_ENCRYPTION_KEY || "").trim();
  const buffer = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, Base64Encoding);
  if (buffer.length !== 32)
    throw new Error("DATA_ENCRYPTION_KEY must be a base64 or hexadecimal 32-byte key.");
  return buffer;
}

function BuildAad(userId, secretType) {
  return Buffer.from(`imdb-rapid-rater:${userId}:${secretType}:v${KeyVersion}`, TextEncoding);
}
