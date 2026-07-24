import { randomUUID } from "node:crypto";
import { Qualified, RunTransaction } from "./db/transaction.mjs";

const ConnectionsTable = "ai_connections";
const SecretsTable = "user_secrets";
const PreferencesTable = "user_preferences";
const TestedStatus = "tested";
const LegacyAiSecretType = "ai";
const LegacyOpenAiSecretType = "openai";
const StringType = "string";
const LegacySecretTypes = Object.freeze([LegacyAiSecretType, LegacyOpenAiSecretType]);

export function CreateAiConnectionStore(pool, secretProtector) {
  return {
    ListAiConnections: async (userId) => await ListAiConnections(pool, userId),
    GetAiConnection: async (userId, connectionId) => await GetAiConnection(pool, userId, connectionId),
    ReadAiConnectionSecret: async (userId, connectionId) => await ReadAiConnectionSecret(pool, secretProtector, userId, connectionId),
    CreateAiConnection: async (userId, connection, apiKey) => await CreateAiConnection(pool, secretProtector, userId, connection, apiKey),
    UpdateAiConnection: async (userId, connectionId, connection, apiKey) => await UpdateAiConnection(pool, secretProtector, userId, connectionId, connection, apiKey),
    SetDefaultAiConnection: async (userId, connectionId) => await SetDefaultAiConnection(pool, userId, connectionId),
    DeleteAiConnection: async (userId, connectionId) => await DeleteAiConnection(pool, userId, connectionId),
    MigrateLegacyAiConnectionSecrets: async () => await MigrateLegacyAiConnectionSecrets(pool, secretProtector),
    FinalizeAiConnectionMigration: async () => await FinalizeAiConnectionMigration(pool)
  };
}

async function ListAiConnections(pool, userId) {
  const result = await pool.query(`${BuildListSql()} ORDER BY connections.is_default DESC, connections.created_at, connections.id`, [userId]);
  return result.rows.map(NormalizeConnectionRow);
}

async function GetAiConnection(pool, userId, connectionId) {
  const result = await pool.query(`${BuildListSql()} AND connections.id=$2`, [userId, connectionId]);
  return result.rows[0] ? NormalizeConnectionRow(result.rows[0]) : null;
}

function BuildListSql() {
  return `SELECT connections.*, EXISTS (SELECT 1 FROM ${Qualified(SecretsTable)} AS secrets WHERE secrets.user_id=connections.user_id AND secrets.secret_type='ai:' || connections.id::text) AS has_key FROM ${Qualified(ConnectionsTable)} AS connections WHERE connections.user_id=$1`;
}

function NormalizeConnectionRow(row) {
  return {
    id: row.id, providerId: row.provider_id, name: row.name, baseUrl: row.base_url,
    model: row.model_id, isDefault: Boolean(row.is_default), hasKey: Boolean(row.has_key),
    testStatus: row.test_status, lastTestedAt: row.last_tested_at, updatedAt: row.updated_at
  };
}

async function ReadAiConnectionSecret(pool, protector, userId, connectionId) {
  const secretType = BuildAiSecretType(connectionId);
  const result = await pool.query(BuildSecretSelectSql(), [userId, secretType]);
  return result.rows[0] ? await protector.Decrypt(result.rows[0], userId, secretType) : "";
}

function BuildSecretSelectSql() {
  return `SELECT ciphertext, iv, auth_tag AS "authTag", key_version AS "keyVersion" FROM ${Qualified(SecretsTable)} WHERE user_id=$1 AND secret_type=$2 LIMIT 1`;
}

async function CreateAiConnection(pool, protector, userId, connection, apiKey) {
  const id = randomUUID();
  const encrypted = apiKey ? await protector.Encrypt(apiKey, userId, BuildAiSecretType(id)) : null;
  await RunTransaction(pool, async (client) => await InsertConnection(client, userId, id, connection, encrypted));
  return await GetAiConnection(pool, userId, id);
}

async function InsertConnection(client, userId, id, connection, encrypted) {
  const existing = await LockConnections(client, userId);
  const isDefault = Boolean(connection.isDefault) || !existing.length;
  if (isDefault)
    await ClearDefault(client, userId);
  await client.query(BuildInsertConnectionSql(), BuildConnectionParameters(userId, id, connection, isDefault));
  if (encrypted)
    await UpsertEncryptedSecret(client, userId, BuildAiSecretType(id), encrypted);
}

function BuildInsertConnectionSql() {
  return `INSERT INTO ${Qualified(ConnectionsTable)} (id, user_id, provider_id, name, base_url, model_id, is_default, test_status, last_tested_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now(),now())`;
}

function BuildConnectionParameters(userId, id, connection, isDefault) {
  return [id, userId, connection.providerId, connection.name, connection.baseUrl, connection.model, isDefault, TestedStatus];
}

async function UpdateAiConnection(pool, protector, userId, connectionId, connection, apiKey) {
  const encrypted = await ReadUpdatedEncryption(protector, userId, connectionId, apiKey);
  const found = await RunTransaction(pool, async (client) => await UpdateConnectionTransaction(client, userId, connectionId, connection, apiKey, encrypted));
  return found ? await GetAiConnection(pool, userId, connectionId) : null;
}

async function ReadUpdatedEncryption(protector, userId, connectionId, apiKey) {
  if (typeof apiKey !== StringType || !apiKey)
    return null;
  return await protector.Encrypt(apiKey, userId, BuildAiSecretType(connectionId));
}

async function UpdateConnectionTransaction(client, userId, connectionId, connection, apiKey, encrypted) {
  const existing = await LockConnections(client, userId);
  if (!existing.some((item) => item.id === connectionId))
    return false;
  if (connection.isDefault)
    await ClearDefault(client, userId);
  await client.query(BuildUpdateConnectionSql(), BuildUpdateParameters(userId, connectionId, connection));
  await ApplyUpdatedSecret(client, userId, connectionId, apiKey, encrypted);
  return true;
}

function BuildUpdateConnectionSql() {
  return `UPDATE ${Qualified(ConnectionsTable)} SET provider_id=$3, name=$4, base_url=$5, model_id=$6, is_default=CASE WHEN $7 THEN true ELSE is_default END, test_status=$8, last_tested_at=now(), updated_at=now() WHERE user_id=$1 AND id=$2`;
}

function BuildUpdateParameters(userId, connectionId, connection) {
  return [userId, connectionId, connection.providerId, connection.name, connection.baseUrl, connection.model, Boolean(connection.isDefault), TestedStatus];
}

async function ApplyUpdatedSecret(client, userId, connectionId, apiKey, encrypted) {
  if (typeof apiKey !== StringType)
    return;
  const secretType = BuildAiSecretType(connectionId);
  if (encrypted)
    return await UpsertEncryptedSecret(client, userId, secretType, encrypted);
  await client.query(`DELETE FROM ${Qualified(SecretsTable)} WHERE user_id=$1 AND secret_type=$2`, [userId, secretType]);
}

async function SetDefaultAiConnection(pool, userId, connectionId) {
  return await RunTransaction(pool, async (client) => await SetDefaultTransaction(client, userId, connectionId));
}

async function SetDefaultTransaction(client, userId, connectionId) {
  const existing = await LockConnections(client, userId);
  if (!existing.some((item) => item.id === connectionId))
    return false;
  await ClearDefault(client, userId);
  await client.query(`UPDATE ${Qualified(ConnectionsTable)} SET is_default=true, updated_at=now() WHERE user_id=$1 AND id=$2`, [userId, connectionId]);
  return true;
}

async function DeleteAiConnection(pool, userId, connectionId) {
  return await RunTransaction(pool, async (client) => await DeleteConnectionTransaction(client, userId, connectionId));
}

async function DeleteConnectionTransaction(client, userId, connectionId) {
  const existing = await LockConnections(client, userId);
  const deleted = existing.find((item) => item.id === connectionId);
  if (!deleted)
    return false;
  await client.query(`DELETE FROM ${Qualified(SecretsTable)} WHERE user_id=$1 AND secret_type=$2`, [userId, BuildAiSecretType(connectionId)]);
  await client.query(`DELETE FROM ${Qualified(ConnectionsTable)} WHERE user_id=$1 AND id=$2`, [userId, connectionId]);
  if (deleted.is_default)
    await ChooseReplacementDefault(client, userId, existing, connectionId);
  return true;
}

async function ChooseReplacementDefault(client, userId, existing, deletedId) {
  const replacement = existing.find((item) => item.id !== deletedId);
  if (replacement)
    await client.query(`UPDATE ${Qualified(ConnectionsTable)} SET is_default=true, updated_at=now() WHERE user_id=$1 AND id=$2`, [userId, replacement.id]);
}

async function LockConnections(client, userId) {
  const result = await client.query(`SELECT id, is_default FROM ${Qualified(ConnectionsTable)} WHERE user_id=$1 ORDER BY created_at, id FOR UPDATE`, [userId]);
  return result.rows;
}

async function ClearDefault(client, userId) {
  await client.query(`UPDATE ${Qualified(ConnectionsTable)} SET is_default=false WHERE user_id=$1 AND is_default`, [userId]);
}

async function UpsertEncryptedSecret(client, userId, secretType, encrypted) {
  const sql = `INSERT INTO ${Qualified(SecretsTable)} (user_id, secret_type, ciphertext, iv, auth_tag, key_version, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (user_id, secret_type) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv, auth_tag=EXCLUDED.auth_tag, key_version=EXCLUDED.key_version, updated_at=now()`;
  const values = [userId, secretType, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion];
  await client.query(sql, values);
}

async function MigrateLegacyAiConnectionSecrets(pool, protector) {
  const records = await ReadLegacySecretRecords(pool);
  for (const record of records)
    await MigrateLegacySecretRecord(pool, protector, record);
  return records.length;
}

async function ReadLegacySecretRecords(pool) {
  const sql = `SELECT DISTINCT ON (secrets.user_id) secrets.user_id, secrets.secret_type, secrets.ciphertext, secrets.iv, secrets.auth_tag AS "authTag", secrets.key_version AS "keyVersion", connections.id AS connection_id FROM ${Qualified(SecretsTable)} AS secrets JOIN ${Qualified(ConnectionsTable)} AS connections ON connections.user_id=secrets.user_id WHERE secrets.secret_type=ANY($1::text[]) ORDER BY secrets.user_id, CASE secrets.secret_type WHEN $2 THEN 0 ELSE 1 END`;
  return (await pool.query(sql, [LegacySecretTypes, LegacySecretTypes[0]])).rows;
}

async function MigrateLegacySecretRecord(pool, protector, record) {
  const value = await protector.Decrypt(record, record.user_id, record.secret_type);
  const newType = BuildAiSecretType(record.connection_id);
  const encrypted = await protector.Encrypt(value, record.user_id, newType);
  await RunTransaction(pool, async (client) => await ReplaceLegacySecrets(client, record.user_id, newType, encrypted));
}

async function ReplaceLegacySecrets(client, userId, newType, encrypted) {
  await UpsertEncryptedSecret(client, userId, newType, encrypted);
  await client.query(`DELETE FROM ${Qualified(SecretsTable)} WHERE user_id=$1 AND secret_type=ANY($2::text[])`, [userId, LegacySecretTypes]);
}

async function FinalizeAiConnectionMigration(pool) {
  const legacyCount = await CountLegacyAiSecrets(pool);
  if (legacyCount)
    throw new Error(`${legacyCount} legacy AI credentials could not be migrated.`);
  if (!await NeedsAiConstraintFinalization(pool))
    return false;
  await RunTransaction(pool, async (client) => await FinalizeAiSchema(client));
  return true;
}

async function CountLegacyAiSecrets(pool) {
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${Qualified(SecretsTable)} WHERE secret_type=ANY($1::text[])`, [LegacySecretTypes]);
  return Number(result.rows[0]?.count) || 0;
}

async function NeedsAiConstraintFinalization(pool) {
  const sql = `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='${Qualified(SecretsTable)}'::regclass AND conname='user_secrets_secret_type_check'`;
  const result = await pool.query(sql);
  return String(result.rows[0]?.definition || "").includes(LegacyOpenAiSecretType);
}

async function FinalizeAiSchema(client) {
  await client.query(`UPDATE ${Qualified(PreferencesTable)} SET ai_base_url='', ai_model='', ai_configured=false, open_ai_model=''`);
  await client.query(`ALTER TABLE ${Qualified(SecretsTable)} DROP CONSTRAINT user_secrets_secret_type_check`);
  await client.query(`ALTER TABLE ${Qualified(SecretsTable)} ADD CONSTRAINT user_secrets_secret_type_check CHECK (secret_type='imdb' OR secret_type ~ '^ai:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`);
}

function BuildAiSecretType(connectionId) {
  return `ai:${connectionId}`;
}
