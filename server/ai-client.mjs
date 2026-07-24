import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AiAdapterKinds, AiProviderKinds, ProviderRequiresKey, ReadProviderAdapter, ResolveAiBaseUrl } from "./ai-providers.mjs";

const MaximumResponseBytes = 2 * 1024 * 1024;
const MaximumModelPages = 20;
const RequestTimeoutMs = 20_000;
const InvalidUrlCode = "AI_URL_INVALID";
const UnreachableUrlCode = "AI_URL_UNREACHABLE";
const HttpProtocol = "http:";
const HttpsProtocol = "https:";
const JsonMediaType = "application/json";
const ModelsOperation = "models";
const ModelSelectionMessage = "Choose a model from the service's current model list.";
const ModelRequiredCode = "AI_MODEL_REQUIRED";
const AssistantRole = "assistant";
const SystemRole = "system";
const UserRole = "user";
const StringType = "string";
const UnresolvedServerMessage = "The AI server name could not be resolved.";
const AllowedHttpProtocols = Object.freeze([HttpProtocol, HttpsProtocol]);

export async function DiscoverAiModels(options = {}) {
  try {
    const response = await RequestAiModelPages(options);
    const models = NormalizeModels(response.items, ReadProviderAdapter(ReadProviderId(options)));
    if (!models.length)
      return Fail(422, "AI_MODELS_EMPTY", "This service did not return any usable models.");
    return Ok({ baseUrl: response.baseUrl, models });
  } catch (error) {
    return ClientFailure(error, "AI_MODELS_FAILED", "The model list could not be loaded.");
  }
}

async function RequestAiModelPages(options) {
  const state = { items: [], token: "", seen: new Set() };
  let response;
  for (let page = 0; page < MaximumModelPages; page++) {
    response = await RequestAiJson(options, ModelsOperation, undefined, state.token);
    state.items.push(...ReadModelSource(response.payload));
    if (!AdvanceModelPage(state, response.payload, ReadProviderId(options)))
      break;
  }
  return { baseUrl: response.baseUrl, items: state.items };
}

function AdvanceModelPage(state, payload, providerId) {
  const token = ReadNextModelToken(payload, providerId);
  if (!token || state.seen.has(token))
    return false;
  state.seen.add(token);
  state.token = token;
  return true;
}

function ReadNextModelToken(payload, providerId) {
  if (providerId === AiProviderKinds.Gemini)
    return String(payload?.nextPageToken || "");
  if (providerId === AiProviderKinds.Anthropic && payload?.has_more)
    return String(payload?.last_id || "");
  return "";
}

export async function TestAiConnection(options = {}) {
  const discovered = await DiscoverAiModels(options);
  if (!discovered.payload.ok)
    return discovered;
  const model = String(options.model || "").trim();
  if (!discovered.payload.models.some((item) => item.id === model))
    return Fail(422, "AI_MODEL_UNKNOWN", ModelSelectionMessage);
  return await TestDiscoveredModel(options, discovered.payload);
}

export async function RequestAiChat(options, messages, maxTokens) {
  try {
    const body = BuildChatBody(options, messages, maxTokens);
    const response = await RequestAiJson(options, "chat", body);
    const content = ReadChatContent(response.payload, ReadProviderAdapter(ReadProviderId(options)));
    if (!content)
      return Fail(502, "AI_RESPONSE_EMPTY", "The AI service returned an empty response.");
    return Ok({ content, model: ReadResponseModel(response.payload, options.model), response: response.payload });
  } catch (error) {
    return ClientFailure(error, "AI_REQUEST_FAILED", "The AI service could not complete the request.");
  }
}

export async function ValidateAiBaseUrl(value, options = {}) {
  const url = ParseBaseUrl(value);
  const allowed = ReadAllowedPrivateOrigins(options.allowedPrivateOrigins);
  const privateAllowed = allowed.has(url.origin);
  ValidateProtocol(url, privateAllowed);
  const addresses = await ResolveAddresses(ReadHostname(url), options.resolve);
  ValidateResolvedAddresses(addresses, privateAllowed);
  return { baseUrl: NormalizeBaseUrl(url), address: addresses[0] };
}

async function TestDiscoveredModel(options, discovered) {
  const messages = [{ role: "user", content: "Reply with the single word ready." }];
  const tested = await RequestAiChat({ ...options, baseUrl: discovered.baseUrl }, messages, 16);
  if (!tested.payload.ok)
    return tested;
  return Ok({ baseUrl: discovered.baseUrl, model: String(options.model).trim(), models: discovered.models });
}

async function RequestAiJson(options, operation, body, pageToken = "") {
  ValidateProviderKey(options);
  const baseUrl = ResolveAiBaseUrl(ReadProviderId(options), options.baseUrl);
  const validated = await ValidateAiBaseUrl(baseUrl, options);
  const url = new URL(`${validated.baseUrl}${ReadOperationPath(options, operation, pageToken)}`);
  const request = BuildRequest(options, operation, body);
  const response = await (options.transport || ExecuteJsonRequest)(url, validated.address, request);
  if (response.status < 200 || response.status >= 300)
    throw RemoteRequestError(response);
  return { baseUrl: validated.baseUrl, payload: response.payload };
}

function ValidateProviderKey(options) {
  const providerId = ReadProviderId(options);
  if (ProviderRequiresKey(providerId) && !NormalizeApiKey(options.apiKey))
    throw new AiClientError(422, "AI_KEY_REQUIRED", "Paste your private access key first.");
}

function ReadOperationPath(options, operation, pageToken) {
  if (operation === ModelsOperation)
    return ReadModelsPath(ReadProviderId(options), pageToken);
  const adapter = ReadProviderAdapter(ReadProviderId(options));
  if (adapter === AiAdapterKinds.AnthropicAdapter)
    return "/messages";
  if (adapter === AiAdapterKinds.GeminiAdapter)
    return BuildGeminiModelPath(options.model);
  return "/chat/completions";
}

function ReadModelsPath(providerId, pageToken) {
  if (providerId === AiProviderKinds.Xai)
    return "/language-models";
  if (providerId === AiProviderKinds.Gemini)
    return `/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
  if (providerId === AiProviderKinds.Anthropic)
    return `/models?limit=1000${pageToken ? `&after_id=${encodeURIComponent(pageToken)}` : ""}`;
  return "/models";
}

function BuildGeminiModelPath(model) {
  const id = String(model || "").trim().replace(/^models\//, "");
  if (!id)
    throw new AiClientError(422, ModelRequiredCode, ModelSelectionMessage);
  return `/models/${encodeURIComponent(id)}:generateContent`;
}

function BuildRequest(options, operation, body) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = BuildProviderHeaders(options);
  Object.assign(headers, { accept: JsonMediaType, "user-agent": "IMDb-Rapid-Rater/1.0" });
  if (text)
    Object.assign(headers, { "content-type": JsonMediaType, "content-length": Buffer.byteLength(text) });
  return { method: operation === ModelsOperation ? "GET" : "POST", headers, body: text };
}

function BuildProviderHeaders(options) {
  const key = NormalizeApiKey(options.apiKey);
  const adapter = ReadProviderAdapter(ReadProviderId(options));
  if (!key)
    return {};
  if (adapter === AiAdapterKinds.AnthropicAdapter)
    return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  if (adapter === AiAdapterKinds.GeminiAdapter)
    return { "x-goog-api-key": key };
  return { authorization: `Bearer ${key}` };
}

function BuildChatBody(options, messages, maxTokens) {
  const model = ReadRequiredModel(options.model);
  const adapter = ReadProviderAdapter(ReadProviderId(options));
  if (adapter === AiAdapterKinds.AnthropicAdapter)
    return BuildAnthropicBody(model, messages, maxTokens);
  if (adapter === AiAdapterKinds.GeminiAdapter)
    return BuildGeminiBody(messages, maxTokens);
  return BuildOpenAiBody(ReadProviderId(options), model, messages, maxTokens);
}

function BuildAnthropicBody(model, messages, maxTokens) {
  const system = ReadSystemText(messages);
  const body = { model, max_tokens: NormalizeTokenLimit(maxTokens), messages: ReadConversationMessages(messages) };
  return system ? { ...body, system } : body;
}

function BuildGeminiBody(messages, maxTokens) {
  const system = ReadSystemText(messages);
  const contents = ReadConversationMessages(messages).map(ToGeminiMessage);
  const body = { contents, generationConfig: { maxOutputTokens: NormalizeTokenLimit(maxTokens) } };
  return system ? { ...body, systemInstruction: { parts: [{ text: system }] } } : body;
}

function BuildOpenAiBody(providerId, model, messages, maxTokens) {
  const body = { model, messages: Array.isArray(messages) ? messages : [] };
  const tokenField = providerId === "openai" ? "max_completion_tokens" : "max_tokens";
  return { ...body, [tokenField]: NormalizeTokenLimit(maxTokens) };
}

function ReadSystemText(messages) {
  return (Array.isArray(messages) ? messages : []).filter((message) => message?.role === SystemRole).map((message) => String(message.content || "")).join("\n").trim();
}

function ReadConversationMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter((message) => message?.role !== SystemRole).map(NormalizeConversationMessage);
}

function NormalizeConversationMessage(message) {
  const role = message?.role === AssistantRole ? AssistantRole : UserRole;
  return { role, content: String(message?.content || "") };
}

function ToGeminiMessage(message) {
  const role = message.role === AssistantRole ? "model" : UserRole;
  return { role, parts: [{ text: message.content }] };
}

function NormalizeModels(payload, adapter) {
  const source = Array.isArray(payload) ? payload : ReadModelSource(payload);
  const models = source.filter((value) => IsUsableModel(value, adapter)).map(NormalizeModel).filter(Boolean);
  const unique = new Map(models.map((model) => [model.id, model]));
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function ReadModelSource(payload) {
  if (Array.isArray(payload?.data))
    return payload.data;
  return Array.isArray(payload?.models) ? payload.models : [];
}

function IsUsableModel(value, adapter) {
  if (adapter !== AiAdapterKinds.GeminiAdapter)
    return true;
  const methods = value?.supportedGenerationMethods || value?.supportedActions;
  return Array.isArray(methods) && methods.includes("generateContent");
}

function NormalizeModel(value) {
  const id = ReadModelId(value);
  if (!id || id.length > 512)
    return null;
  const name = String(value?.displayName || value?.display_name || value?.name || id).trim().slice(0, 512);
  return { id, name: name || id };
}

function ReadModelId(value) {
  if (typeof value === StringType)
    return value.trim();
  return String(value?.id || value?.name || "").trim();
}

function ReadChatContent(payload, adapter) {
  if (adapter === AiAdapterKinds.AnthropicAdapter)
    return ReadTextParts(payload?.content);
  if (adapter === AiAdapterKinds.GeminiAdapter)
    return ReadTextParts(payload?.candidates?.[0]?.content?.parts);
  return ReadOpenAiContent(payload);
}

function ReadOpenAiContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === StringType)
    return content.trim();
  return ReadTextParts(content);
}

function ReadTextParts(parts) {
  if (!Array.isArray(parts))
    return "";
  return parts.map((part) => String(part?.text || "")).join("").trim();
}

function ReadResponseModel(payload, fallback) {
  return String(payload?.model || payload?.modelVersion || fallback || "").trim();
}

function ReadProviderId(options) {
  return String(options?.providerId || "custom").trim();
}

function ReadRequiredModel(value) {
  const model = String(value || "").trim();
  if (!model)
    throw new AiClientError(422, ModelRequiredCode, ModelSelectionMessage);
  return model;
}

function NormalizeTokenLimit(value) {
  return Math.max(1, Math.floor(Number(value) || 16));
}

function ParseBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    ValidateBaseUrlParts(url);
    return url;
  } catch (error) {
    if (error instanceof AiClientError)
      throw error;
    throw new AiClientError(422, InvalidUrlCode, "Enter a complete AI server URL, including https://.");
  }
}

function ValidateBaseUrlParts(url) {
  if (!AllowedHttpProtocols.includes(url.protocol))
    throw new AiClientError(422, "AI_URL_PROTOCOL", "The AI server URL must use HTTP or HTTPS.");
  if (url.username || url.password || url.search || url.hash)
    throw new AiClientError(422, InvalidUrlCode, "The AI server URL cannot contain credentials, a query, or a fragment.");
  if (!url.hostname || url.href.length > 2048)
    throw new AiClientError(422, InvalidUrlCode, "Enter a valid AI server URL.");
}

function ValidateProtocol(url, privateAllowed) {
  if (url.protocol !== HttpsProtocol && !privateAllowed)
    throw new AiClientError(422, "AI_URL_HTTPS_REQUIRED", "Use HTTPS. A private HTTP server must be allowlisted by the administrator.");
}

function ValidateResolvedAddresses(addresses, privateAllowed) {
  if (!privateAllowed && addresses.some((item) => IsBlockedAddress(item.address)))
    throw new AiClientError(422, "AI_URL_PRIVATE", "Private-network AI servers must be allowlisted by the administrator.");
}

async function ResolveAddresses(hostname, resolver = lookup) {
  try {
    const records = await resolver(hostname, { all: true, verbatim: true });
    const addresses = Array.isArray(records) ? records : [records];
    if (addresses.length)
      return addresses;
  } catch {
    throw new AiClientError(422, UnreachableUrlCode, UnresolvedServerMessage);
  }
  throw new AiClientError(422, UnreachableUrlCode, UnresolvedServerMessage);
}

function NormalizeBaseUrl(url) {
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname === "/" ? "" : pathname}`;
}

function ReadHostname(url) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function ReadAllowedPrivateOrigins(value = process.env.AI_ALLOWED_PRIVATE_ORIGINS) {
  const origins = String(value || "").split(",").map(NormalizeAllowedOrigin).filter(Boolean);
  return new Set(origins);
}

function NormalizeAllowedOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    return AllowedHttpProtocols.includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

function IsBlockedAddress(address) {
  const kind = isIP(address);
  if (kind === 4)
    return IsBlockedIpv4(address);
  if (kind === 6)
    return IsBlockedIpv6(address);
  return true;
}

function IsBlockedIpv4(address) {
  const [a, b] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224)
    return true;
  if (a === 100 && b >= 64 && b <= 127)
    return true;
  if (a === 169 && b === 254)
    return true;
  if (a === 172 && b >= 16 && b <= 31)
    return true;
  return IsBlockedIpv4Range(a, b);
}

function IsBlockedIpv4Range(a, b) {
  if (a === 192 && [0, 168].includes(b))
    return true;
  if (a === 198 && [18, 19, 51].includes(b))
    return true;
  return a === 203 && b === 0;
}

function IsBlockedIpv6(address) {
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:"))
    return IsBlockedAddress(value.slice(7));
  if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd"))
    return true;
  return /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("2001:db8");
}

function NormalizeApiKey(value) {
  return String(value || "").trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function ExecuteJsonRequest(url, address, request) {
  return new Promise((resolve, reject) => SendNodeRequest(url, address, request, resolve, reject));
}

function SendNodeRequest(url, address, request, resolve, reject) {
  const client = url.protocol === HttpsProtocol ? https : http;
  const outgoing = client.request(BuildNodeRequest(url, address, request), (response) => ReadNodeResponse(response, resolve, reject));
  outgoing.setTimeout(RequestTimeoutMs, () => outgoing.destroy(new Error("The AI service timed out.")));
  outgoing.on("error", reject);
  if (request.body)
    outgoing.write(request.body);
  outgoing.end();
}

function BuildNodeRequest(url, address, request) {
  return {
    protocol: url.protocol, hostname: ReadHostname(url), port: url.port || undefined,
    path: `${url.pathname}${url.search}`, method: request.method, headers: request.headers,
    lookup: (_hostname, _options, callback) => callback(null, address.address, address.family)
  };
}

function ReadNodeResponse(response, resolve, reject) {
  const state = { chunks: [], size: 0 };
  response.on("data", (chunk) => AppendNodeResponseChunk(response, state, chunk));
  response.on("error", reject);
  response.on("end", () => ResolveNodeResponse(response, state.chunks, resolve, reject));
}

function AppendNodeResponseChunk(response, state, chunk) {
  state.size += chunk.length;
  if (state.size > MaximumResponseBytes)
    response.destroy(new Error("The AI service response was too large."));
  else
    state.chunks.push(chunk);
}

function ResolveNodeResponse(response, chunks, resolve, reject) {
  try {
    const text = Buffer.concat(chunks).toString("utf8");
    resolve({ status: Number(response.statusCode) || 502, payload: text ? JSON.parse(text) : null });
  } catch {
    reject(new AiClientError(502, "AI_RESPONSE_INVALID", "The AI service did not return valid JSON."));
  }
}

function RemoteRequestError(response) {
  const error = response.payload?.error;
  const message = error?.message || error?.error?.message || `The AI service returned HTTP ${response.status}.`;
  return new AiClientError(response.status, "AI_REMOTE_ERROR", message);
}

function ClientFailure(error, code, fallback) {
  const status = Number(error?.status);
  return Fail(status >= 400 && status <= 599 ? status : 502, error?.code || code, error?.message || fallback);
}

function Ok(payload) {
  return { status: 200, payload: { ok: true, ...payload } };
}

function Fail(status, code, error) {
  return { status, payload: { ok: false, code, error } };
}

class AiClientError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
