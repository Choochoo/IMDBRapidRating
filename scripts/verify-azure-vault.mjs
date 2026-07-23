import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InitializeRuntimeEnvironment } from "../server/env.mjs";
import { CreateAzureKeyWrapper } from "../server/security/azure-key-wrapper.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RequiredRuntimeNames = Object.freeze(["POSTGRES_CONNECTION_STRING", "SESSION_SECRET", "TMDB_API_KEY"]);

async function Main() {
  process.env.IMDB_RAPID_RATER_HOME ||= path.join(RootPath, ".runtime");
  await InitializeRuntimeEnvironment(RootPath);
  ValidateRuntimeSecrets();
  await VerifyWrappingKey();
  console.log("Azure Key Vault verification passed without exposing secret values.");
}

function ValidateRuntimeSecrets() {
  for (const name of RequiredRuntimeNames) {
    if (!String(process.env[name] || "").trim())
      throw new Error(`Azure Key Vault did not provide ${name}.`);
  }
}

async function VerifyWrappingKey() {
  const expected = randomBytes(32);
  const wrapper = CreateAzureKeyWrapper();
  const wrapped = await wrapper.WrapKey(expected);
  const actual = await wrapper.UnwrapKey(wrapped);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Azure Key Vault wrap/unwrap verification failed.");
}

await Main();
