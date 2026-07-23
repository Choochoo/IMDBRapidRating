import { Qualified } from "../db/transaction.mjs";
import { DualProtectionMode, LegacySecretVersion } from "./secret-protection-config.mjs";

const DefaultBatchSize = 50;
const UserSecretsTable = "user_secrets";

export async function CountLegacySecrets(pool) {
  const result = await pool.query(`SELECT count(*)::int count FROM ${Qualified(UserSecretsTable)} WHERE key_version=$1`, [LegacySecretVersion]);
  return Number(result.rows[0]?.count || 0);
}

export async function MigrateLegacySecrets({ pool, secretProtector, batchSize = DefaultBatchSize, onProgress = () => null }) {
  ValidateMigrationMode(secretProtector);
  let migrated = 0;
  for (;;) {
    const records = await ReadLegacyRecords(pool, batchSize);
    if (!records.length)
      return { migrated };
    migrated += await MigrateBatch(pool, secretProtector, records);
    onProgress(migrated);
  }
}

async function MigrateBatch(pool, secretProtector, records) {
  let migrated = 0;
  for (const record of records)
    migrated += await MigrateRecord(pool, secretProtector, record);
  return migrated;
}

async function MigrateRecord(pool, secretProtector, record) {
  const plaintext = await secretProtector.Decrypt(record, record.userId, record.secretType);
  const encrypted = await secretProtector.EncryptForVault(plaintext, record.userId, record.secretType);
  return await UpdateLegacyRecord(pool, record, encrypted);
}

async function ReadLegacyRecords(pool, batchSize) {
  const query = `SELECT user_id, secret_type, ciphertext, iv, auth_tag, key_version FROM ${Qualified(UserSecretsTable)} WHERE key_version=$1 ORDER BY user_id, secret_type LIMIT $2`;
  const result = await pool.query(query, [LegacySecretVersion, batchSize]);
  return result.rows.map(MapSecretRecord);
}

async function UpdateLegacyRecord(pool, record, encrypted) {
  const query = `UPDATE ${Qualified(UserSecretsTable)} SET ciphertext=$1, iv=$2, auth_tag=$3, key_version=$4, updated_at=now() WHERE user_id=$5 AND secret_type=$6 AND key_version=$7`;
  const values = [encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, record.userId, record.secretType, LegacySecretVersion];
  const result = await pool.query(query, values);
  return Number(result.rowCount) || 0;
}

function MapSecretRecord(row) {
  return {
    userId: row.user_id,
    secretType: row.secret_type,
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version
  };
}

function ValidateMigrationMode(secretProtector) {
  if (secretProtector?.Mode !== DualProtectionMode)
    throw new Error("Legacy secret migration requires SECRET_PROTECTION_MODE=dual.");
}
