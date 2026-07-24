import assert from "node:assert/strict";
import test from "node:test";
import { CreateAiConnectionStore } from "../server/ai-connection-store.mjs";

const ApiKey = "plain-api-key";
const ConnectionId = "11111111-1111-4111-8111-111111111111";
const UserId = "user-1";
const BeginTransaction = "BEGIN";
const CommitTransaction = "COMMIT";
const ConnectionOperation = "connection";
const SecretOperation = "secret";
const AiProvider = "openai";
const AiName = "My AI";
const AiModel = "live-model";
const LegacyAiType = "ai";
const DecryptOperation = "decrypt";
const EncryptOperation = "encrypt";
const EncryptedRecord = Object.freeze({ ciphertext: "cipher", iv: "iv", authTag: "tag", keyVersion: 2 });

test("AI connection creation encrypts the key and saves it in one transaction", VerifyEncryptedConnectionCreate);
test("legacy AI secrets are rebound to their connection before removal", VerifyLegacyConnectionMigration);

async function VerifyEncryptedConnectionCreate() {
  const scenario = BuildCreateScenario();
  const saved = await scenario.store.CreateAiConnection(UserId, BuildConnection(), ApiKey);
  assert.equal(saved.hasKey, true);
  assert.match(scenario.encryption.secretType, /^ai:[0-9a-f-]{36}$/);
  assert.deepEqual(ReadTransactionNames(scenario.calls), [BeginTransaction, ConnectionOperation, ConnectionOperation, SecretOperation, CommitTransaction]);
  assert.equal(JSON.stringify(scenario.calls).includes(ApiKey), false);
}

function BuildCreateScenario() {
  const calls = [];
  const encryption = {};
  const client = BuildCreateClient(calls);
  const pool = { connect: async () => client, query: async () => BuildSavedConnectionResult() };
  const protector = BuildProtector(encryption);
  return { calls, encryption, store: CreateAiConnectionStore(pool, protector) };
}

function BuildCreateClient(calls) {
  return {
    async query(sql, parameters = []) {
      if (/SELECT id, is_default/.test(sql))
        return { rows: [] };
      calls.push({ sql, parameters });
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
}

function BuildSavedConnectionResult() {
  return {
    rows: [{
      id: ConnectionId, provider_id: AiProvider, name: AiName, base_url: "",
      model_id: AiModel, is_default: true, has_key: true, test_status: "tested"
    }]
  };
}

function BuildConnection() {
  return { providerId: AiProvider, name: AiName, baseUrl: "", model: AiModel, isDefault: true };
}

function BuildProtector(encryption) {
  return {
    async Encrypt(value, userId, secretType) {
      Object.assign(encryption, { value, userId, secretType });
      return EncryptedRecord;
    }
  };
}

function ReadTransactionNames(calls) {
  return calls.map((call) => {
    if (call.sql === BeginTransaction || call.sql === CommitTransaction)
      return call.sql;
    return /INSERT INTO .*user_secrets/.test(call.sql) ? SecretOperation : ConnectionOperation;
  });
}

async function VerifyLegacyConnectionMigration() {
  const scenario = BuildMigrationScenario();
  const count = await scenario.store.MigrateLegacyAiConnectionSecrets();
  assert.equal(count, 1);
  assert.deepEqual(scenario.protectorCalls, [[DecryptOperation, LegacyAiType], [EncryptOperation, `${LegacyAiType}:${ConnectionId}`]]);
  assert.match(scenario.calls.at(-2).sql, /INSERT INTO .*user_secrets/);
  assert.match(scenario.calls.at(-1).sql, /DELETE FROM .*user_secrets/);
}

function BuildMigrationScenario() {
  const calls = [];
  const protectorCalls = [];
  const client = BuildMigrationClient(calls);
  const pool = { connect: async () => client, query: async () => BuildLegacyResult() };
  const protector = BuildMigrationProtector(protectorCalls);
  return { calls, protectorCalls, store: CreateAiConnectionStore(pool, protector) };
}

function BuildMigrationClient(calls) {
  return {
    async query(sql, parameters = []) {
      if (sql !== BeginTransaction && sql !== CommitTransaction)
        calls.push({ sql, parameters });
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
}

function BuildLegacyResult() {
  return {
    rows: [{
      user_id: UserId, secret_type: LegacyAiType, ciphertext: "old", iv: "old-iv",
      authTag: "old-tag", keyVersion: 1, connection_id: ConnectionId
    }]
  };
}

function BuildMigrationProtector(calls) {
  return {
    async Decrypt(_record, _userId, secretType) {
      calls.push([DecryptOperation, secretType]);
      return ApiKey;
    },
    async Encrypt(_value, _userId, secretType) {
      calls.push([EncryptOperation, secretType]);
      return EncryptedRecord;
    }
  };
}
