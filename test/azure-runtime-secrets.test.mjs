import assert from "node:assert/strict";
import test from "node:test";
import { LoadAzureRuntimeSecrets } from "../server/security/azure-runtime-secrets.mjs";

const RuntimeEnvironmentNameValues = [
  "POSTGRES_CONNECTION_STRING",
  "SESSION_SECRET",
  "TMDB_API_KEY",
  "DATA_ENCRYPTION_KEY"
];
const RuntimeEnvironmentNames = Object.freeze(RuntimeEnvironmentNameValues);
const VaultUrl = "https://rapid-rater.vault.azure.net";
const VaultMode = "vault";

test("vault mode loads runtime secrets without the retired legacy key", VerifyVaultSecrets);
test("dual mode temporarily loads the legacy encryption key", VerifyDualSecrets);
test("runtime secret loading rejects unsafe vault URLs", VerifyUnsafeVaultUrl);

async function VerifyVaultSecrets() {
  const previous = CaptureEnvironment();
  const requests = [];
  try {
    await LoadAzureRuntimeSecrets({ vaultUrl: VaultUrl, mode: VaultMode, client: BuildClient(requests) });
    VerifyVaultSecretValues(requests);
  } finally {
    RestoreEnvironment(previous);
  }
}

function VerifyVaultSecretValues(requests) {
  const expected = [
    "rapid-rater-postgres-connection-string",
    "rapid-rater-session-secret",
    "rapid-rater-tmdb-api-key"
  ];
  assert.deepEqual(requests, expected);
  assert.equal(process.env.SESSION_SECRET, "value-for-rapid-rater-session-secret");
}

async function VerifyDualSecrets() {
  const previous = CaptureEnvironment();
  const requests = [];
  try {
    await LoadAzureRuntimeSecrets({ vaultUrl: VaultUrl, mode: "dual", client: BuildClient(requests) });
    assert.equal(requests.at(-1), "rapid-rater-legacy-data-encryption-key");
    assert.equal(process.env.DATA_ENCRYPTION_KEY, "value-for-rapid-rater-legacy-data-encryption-key");
  } finally {
    RestoreEnvironment(previous);
  }
}

async function VerifyUnsafeVaultUrl() {
  await assert.rejects(LoadAzureRuntimeSecrets({ vaultUrl: "https://user:password@example.com/path", mode: VaultMode }), /must be an HTTPS vault origin/i);
}

function BuildClient(requests) {
  return {
    getSecret: async (name) => {
      requests.push(name);
      return { value: `value-for-${name}` };
    }
  };
}

function CaptureEnvironment() {
  return Object.fromEntries(RuntimeEnvironmentNames.map((name) => [name, process.env[name]]));
}

function RestoreEnvironment(previous) {
  for (const name of RuntimeEnvironmentNames) {
    if (previous[name] === undefined)
      delete process.env[name];
    else
      process.env[name] = previous[name];
  }
}
