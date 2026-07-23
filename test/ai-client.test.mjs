import assert from "node:assert/strict";
import test from "node:test";
import { DiscoverAiModels, TestAiConnection, ValidateAiBaseUrl } from "../server/ai-client.mjs";

const PublicAddress = "93.184.216.34";
const PublicResolver = async () => [{ address: PublicAddress, family: 4 }];
const PrivateResolver = async () => [{ address: "127.0.0.1", family: 4 }];
const FutureModel = "future-model";
const ZetaModel = "zeta-model";
const EmbeddingModel = "embedding-model";
const TestAiBaseUrl = "https://ai.example.test/v1";
const LocalAiBaseUrl = "http://localhost:11434/v1";
const SuccessStatus = 200;

test("model discovery uses the server list without provider-specific filtering", VerifyModelDiscovery);
test("the selected discovered model is tested through chat completions", VerifySelectedModel);
test("a model absent from the live list cannot be saved", VerifyUnknownModel);
test("private and plain HTTP servers require an exact deployment allowlist", VerifyPrivateServerAllowlist);
test("custom base URLs reject embedded credentials, queries, and fragments", VerifyUnsafeBaseUrls);

async function VerifyModelDiscovery() {
  let received;
  const transport = async (url, address, request) => {
    received = { url, address, request };
    return { status: SuccessStatus, payload: { data: [{ id: ZetaModel }, { id: EmbeddingModel }, { id: ZetaModel }] } };
  };
  const result = await DiscoverAiModels({ baseUrl: "https://ai.example.test/v1/", resolve: PublicResolver, transport });

  assert.equal(result.status, SuccessStatus);
  assert.deepEqual(result.payload.models, [{ id: EmbeddingModel }, { id: ZetaModel }]);
  assert.equal(received.url.href, "https://ai.example.test/v1/models");
  assert.equal(received.address.address, PublicAddress);
  assert.equal(received.request.headers.authorization, undefined);
}

async function VerifySelectedModel() {
  const calls = [];
  const result = await TestAiConnection(BuildTestOptions(BuildModelTransport(calls)));
  AssertSelectedModel(result, calls);
}

function BuildModelTransport(calls) {
  return async (url, _address, request) => {
    calls.push({ url, request });
    if (request.method === "GET")
      return { status: SuccessStatus, payload: { data: [{ id: FutureModel }] } };
    return { status: SuccessStatus, payload: { model: FutureModel, choices: [{ message: { content: "ready" } }] } };
  };
}

function AssertSelectedModel(result, calls) {
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.model, FutureModel);
  assert.equal(calls[1].url.href, "https://ai.example.test/v1/chat/completions");
  assert.equal(calls[1].request.headers.authorization, "Bearer secret-key");
  assert.equal(JSON.parse(calls[1].request.body).model, FutureModel);
}

async function VerifyUnknownModel() {
  const transport = async () => ({ status: SuccessStatus, payload: { data: [{ id: "listed-model" }] } });
  const result = await TestAiConnection({ ...BuildTestOptions(transport), model: "typed-model" });
  assert.equal(result.status, 422);
  assert.equal(result.payload.code, "AI_MODEL_UNKNOWN");
}

async function VerifyPrivateServerAllowlist() {
  await assert.rejects(ValidateAiBaseUrl(LocalAiBaseUrl, { resolve: PrivateResolver }), /must be allowlisted/);
  const options = {
    resolve: PrivateResolver,
    allowedPrivateOrigins: "http://localhost:11434"
  };
  const allowed = await ValidateAiBaseUrl(`${LocalAiBaseUrl}/`, options);
  assert.equal(allowed.baseUrl, LocalAiBaseUrl);
}

async function VerifyUnsafeBaseUrls() {
  await assert.rejects(ValidateAiBaseUrl("https://user:pass@ai.example.test/v1", { resolve: PublicResolver }), /cannot contain credentials/);
  await assert.rejects(ValidateAiBaseUrl("https://ai.example.test/v1?target=internal", { resolve: PublicResolver }), /cannot contain credentials/);
}

function BuildTestOptions(transport) {
  return {
    baseUrl: TestAiBaseUrl,
    apiKey: "secret-key",
    model: FutureModel,
    resolve: PublicResolver,
    transport
  };
}
