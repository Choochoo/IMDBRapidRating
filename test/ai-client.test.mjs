import assert from "node:assert/strict";
import test from "node:test";
import { DiscoverAiModels, RequestAiChat, TestAiConnection, ValidateAiBaseUrl } from "../server/ai-client.mjs";

const PublicAddress = "93.184.216.34";
const PublicResolver = async () => [{ address: PublicAddress, family: 4 }];
const PrivateResolver = async () => [{ address: "127.0.0.1", family: 4 }];
const FutureModel = "future-model";
const ZetaModel = "zeta-model";
const EmbeddingModel = "embedding-model";
const AnthropicApiKey = "claude-key";
const AnthropicName = "Future Claude";
const AnthropicReply = "Claude reply";
const GeminiApiKey = "gemini-key";
const GeminiModel = "models/gemini-future";
const GeminiName = "Gemini Future";
const GeminiProvider = "gemini";
const GeminiReply = "Gemini reply";
const GenerateContentMethod = "generateContent";
const GetMethod = "GET";
const HelloMessage = "Hello";
const PageOneModel = "models/page-one";
const PageTwoModel = "models/page-two";
const PageToken = "page two";
const SystemRole = "system";
const UserRole = "user";
const TestAiBaseUrl = "https://ai.example.test/v1";
const LocalAiBaseUrl = "http://localhost:11434/v1";
const SuccessStatus = 200;

test("model discovery uses the server list without provider-specific filtering", VerifyModelDiscovery);
test("the selected discovered model is tested through chat completions", VerifySelectedModel);
test("a model absent from the live list cannot be saved", VerifyUnknownModel);
test("private and plain HTTP servers require an exact deployment allowlist", VerifyPrivateServerAllowlist);
test("custom base URLs reject embedded credentials, queries, and fragments", VerifyUnsafeBaseUrls);
test("Claude uses its live models and Messages API adapter", VerifyAnthropicAdapter);
test("Gemini lists generateContent models and uses its native content adapter", VerifyGeminiAdapter);
test("Gemini model discovery follows the provider's live pagination tokens", VerifyGeminiPagination);
test("Grok discovers only language models through the authenticated xAI endpoint", VerifyXaiAdapter);

async function VerifyModelDiscovery() {
  let received;
  const transport = async (url, address, request) => {
    received = { url, address, request };
    return { status: SuccessStatus, payload: { data: [{ id: ZetaModel }, { id: EmbeddingModel }, { id: ZetaModel }] } };
  };
  const result = await DiscoverAiModels({ baseUrl: "https://ai.example.test/v1/", resolve: PublicResolver, transport });

  assert.equal(result.status, SuccessStatus);
  assert.deepEqual(result.payload.models, [{ id: EmbeddingModel, name: EmbeddingModel }, { id: ZetaModel, name: ZetaModel }]);
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
    if (request.method === GetMethod)
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

async function VerifyAnthropicAdapter() {
  const calls = [];
  const transport = BuildAnthropicTransport(calls);
  const options = { providerId: "anthropic", apiKey: AnthropicApiKey, model: FutureModel, resolve: PublicResolver, transport };
  const models = await DiscoverAiModels(options);
  const chat = await RequestAiChat(options, [{ role: SystemRole, content: "System" }, { role: UserRole, content: HelloMessage }], 50);
  assert.deepEqual(models.payload.models, [{ id: FutureModel, name: AnthropicName }]);
  assert.equal(calls[0].request.headers["x-api-key"], AnthropicApiKey);
  assert.equal(calls[0].request.headers["anthropic-version"], "2023-06-01");
  assert.equal(calls[1].url.pathname, "/v1/messages");
  assert.deepEqual(JSON.parse(calls[1].request.body).system, "System");
  assert.equal(chat.payload.content, AnthropicReply);
}

function BuildAnthropicTransport(calls) {
  return async (url, _address, request) => {
    calls.push({ url, request });
    if (request.method === GetMethod)
      return { status: 200, payload: { data: [{ id: FutureModel, display_name: AnthropicName }] } };
    return { status: 200, payload: { model: FutureModel, content: [{ type: "text", text: AnthropicReply }] } };
  };
}

async function VerifyGeminiAdapter() {
  const calls = [];
  const transport = BuildGeminiTransport(calls);
  const options = { providerId: GeminiProvider, apiKey: GeminiApiKey, model: GeminiModel, resolve: PublicResolver, transport };
  const models = await DiscoverAiModels(options);
  const chat = await RequestAiChat(options, [{ role: UserRole, content: HelloMessage }], 30);
  assert.deepEqual(models.payload.models, [{ id: GeminiModel, name: GeminiName }]);
  assert.equal(calls[0].request.headers["x-goog-api-key"], GeminiApiKey);
  assert.equal(calls[1].url.pathname, "/v1beta/models/gemini-future:generateContent");
  assert.equal(JSON.parse(calls[1].request.body).contents[0].parts[0].text, HelloMessage);
  assert.equal(chat.payload.content, GeminiReply);
}

function BuildGeminiTransport(calls) {
  return async (url, _address, request) => {
    calls.push({ url, request });
    if (request.method === GetMethod)
      return { status: 200, payload: BuildGeminiModels() };
    return { status: 200, payload: { modelVersion: "gemini-future", candidates: [{ content: { parts: [{ text: GeminiReply }] } }] } };
  };
}

function BuildGeminiModels() {
  return {
    models: [
      { name: "models/embed-only", displayName: "Embed", supportedGenerationMethods: ["embedContent"] },
      { name: GeminiModel, displayName: GeminiName, supportedGenerationMethods: [GenerateContentMethod] }
    ]
  };
}

async function VerifyGeminiPagination() {
  const urls = [];
  const transport = async (url) => {
    urls.push(url);
    if (urls.length === 1)
      return { status: 200, payload: { models: [BuildGeminiModel(PageOneModel)], nextPageToken: PageToken } };
    return { status: 200, payload: { models: [BuildGeminiModel(PageTwoModel)] } };
  };
  const result = await DiscoverAiModels({ providerId: GeminiProvider, apiKey: GeminiApiKey, resolve: PublicResolver, transport });
  assert.deepEqual(result.payload.models.map((model) => model.id), [PageOneModel, PageTwoModel]);
  assert.equal(urls[1].searchParams.get("pageToken"), PageToken);
}

function BuildGeminiModel(name) {
  return { name, displayName: name, supportedGenerationMethods: [GenerateContentMethod] };
}

async function VerifyXaiAdapter() {
  let received;
  const transport = async (url, _address, request) => {
    received = { url, request };
    return { status: 200, payload: { models: [{ id: FutureModel }] } };
  };
  const result = await DiscoverAiModels({ providerId: "xai", apiKey: "grok-key", resolve: PublicResolver, transport });
  assert.equal(received.url.pathname, "/v1/language-models");
  assert.equal(received.request.headers.authorization, "Bearer grok-key");
  assert.deepEqual(result.payload.models, [{ id: FutureModel, name: FutureModel }]);
}
