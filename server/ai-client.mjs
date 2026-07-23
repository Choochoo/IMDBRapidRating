import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MaximumResponseBytes = 2 * 1024 * 1024;
const RequestTimeoutMs = 20_000;
const ModelsPath = "/models";
const ChatCompletionsPath = "/chat/completions";
const InvalidUrlCode = "AI_URL_INVALID";
const UnreachableUrlCode = "AI_URL_UNREACHABLE";
const HttpProtocol = "http:";
const HttpsProtocol = "https:";
const JsonMediaType = "application/json";
const ErrorEvent = "error";
const StringType = "string";
const ModelSelectionMessage = "Choose a model from the server's model list.";
const UnreachableHostMessage = "The AI server name could not be resolved.";
const AllowedHttpProtocols = Object.freeze([HttpProtocol, HttpsProtocol]);

export async function DiscoverAiModels(options = {}) {
  try {
    const response = await RequestAiJson(options, ModelsPath, "GET");
    const models = NormalizeModels(response.payload);
    if (!models.length)
      return Fail(422, "AI_MODELS_EMPTY", "This server did not return any models.");
    return Ok({ baseUrl: response.baseUrl, models });
  } catch (error) {
    return ClientFailure(error, "AI_MODELS_FAILED", "The model list could not be loaded.");
  }
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
    const response = await RequestAiJson(options, ChatCompletionsPath, "POST", body);
    const content = ReadChatContent(response.payload);
    if (!content)
      return Fail(502, "AI_RESPONSE_EMPTY", "The AI server returned an empty response.");
    return Ok({ content, model: String(response.payload?.model || options.model), response: response.payload });
  } catch (error) {
    return ClientFailure(error, "AI_REQUEST_FAILED", "The AI server could not complete the request.");
  }
}

export async function ValidateAiBaseUrl(value, options = {}) {
  const url = ParseBaseUrl(value);
  const allowed = ReadAllowedPrivateOrigins(options.allowedPrivateOrigins);
  const privateAllowed = allowed.has(url.origin);
  if (url.protocol !== HttpsProtocol && !privateAllowed)
    throw new AiClientError(422, "AI_URL_HTTPS_REQUIRED", "Use an HTTPS URL. Private HTTP servers must be allowlisted by the administrator.");
  const addresses = await ResolveAddresses(ReadHostname(url), options.resolve);
  if (!privateAllowed && addresses.some((item) => IsBlockedAddress(item.address)))
    throw new AiClientError(422, "AI_URL_PRIVATE", "Private-network AI servers must be allowlisted by the administrator.");
  return { baseUrl: NormalizeBaseUrl(url), address: addresses[0] };
}

async function TestDiscoveredModel(options, discovered) {
  const messages = [{ role: "user", content: "Reply with the single word ready." }];
  const tested = await RequestAiChat({ ...options, baseUrl: discovered.baseUrl }, messages, 16);
  if (!tested.payload.ok)
    return tested;
  return Ok({ baseUrl: discovered.baseUrl, model: String(options.model).trim(), models: discovered.models });
}

async function RequestAiJson(options, suffix, method, body) {
  const validated = await ValidateAiBaseUrl(options.baseUrl, options);
  const url = new URL(`${validated.baseUrl}${suffix}`);
  const request = BuildRequest(method, body, options.apiKey);
  const transport = options.transport || ExecuteJsonRequest;
  const response = await transport(url, validated.address, request);
  if (response.status < 200 || response.status >= 300)
    throw RemoteRequestError(response);
  return { baseUrl: validated.baseUrl, payload: response.payload };
}

function ParseBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new AiClientError(422, InvalidUrlCode, "Enter a complete AI server URL, including https://.");
  }
  ValidateBaseUrlParts(url);
  return url;
}

function ValidateBaseUrlParts(url) {
  if (!AllowedHttpProtocols.includes(url.protocol))
    throw new AiClientError(422, "AI_URL_PROTOCOL", "The AI server URL must use HTTP or HTTPS.");
  if (url.username || url.password || url.search || url.hash)
    throw new AiClientError(422, InvalidUrlCode, "The AI server URL cannot contain credentials, a query, or a fragment.");
  if (!url.hostname || url.href.length > 2048)
    throw new AiClientError(422, InvalidUrlCode, "Enter a valid AI server URL.");
}

async function ResolveAddresses(hostname, resolver = lookup) {
  try {
    const records = await resolver(hostname, { all: true, verbatim: true });
    const addresses = Array.isArray(records) ? records : [records];
    if (addresses.length)
      return addresses;
  } catch {
    throw new AiClientError(422, UnreachableUrlCode, UnreachableHostMessage);
  }
  throw new AiClientError(422, UnreachableUrlCode, UnreachableHostMessage);
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
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
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

function BuildRequest(method, body, apiKey) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = { "accept": JsonMediaType, "user-agent": "IMDb-Rapid-Rater/1.0" };
  if (text)
    Object.assign(headers, { "content-type": JsonMediaType, "content-length": Buffer.byteLength(text) });
  const key = NormalizeApiKey(apiKey);
  if (key)
    headers.authorization = `Bearer ${key}`;
  return { method, headers, body: text };
}

function BuildChatBody(options, messages, maxTokens) {
  const model = String(options?.model || "").trim();
  if (!model)
    throw new AiClientError(422, "AI_MODEL_REQUIRED", ModelSelectionMessage);
  return {
    model,
    messages: Array.isArray(messages) ? messages : [],
    max_tokens: Math.max(1, Math.floor(Number(maxTokens) || 16))
  };
}

function ExecuteJsonRequest(url, address, request) {
  return new Promise((resolve, reject) => SendNodeRequest(url, address, request, resolve, reject));
}

function SendNodeRequest(url, address, request, resolve, reject) {
  const client = url.protocol === HttpsProtocol ? https : http;
  const outgoing = client.request(BuildNodeRequest(url, address, request), (response) => ReadNodeResponse(response, resolve, reject));
  outgoing.setTimeout(RequestTimeoutMs, () => outgoing.destroy(new Error("The AI server timed out.")));
  outgoing.on(ErrorEvent, reject);
  if (request.body)
    outgoing.write(request.body);
  outgoing.end();
}

function BuildNodeRequest(url, address, request) {
  return {
    protocol: url.protocol,
    hostname: ReadHostname(url),
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: request.method,
    headers: request.headers,
    lookup: (_hostname, _options, callback) => callback(null, address.address, address.family)
  };
}

function ReadNodeResponse(response, resolve, reject) {
  const state = { chunks: [], size: 0 };
  response.on("data", (chunk) => AppendNodeResponseChunk(response, state, chunk));
  response.on(ErrorEvent, reject);
  response.on("end", () => ResolveNodeResponse(response, state.chunks, resolve, reject));
}

function AppendNodeResponseChunk(response, state, chunk) {
  state.size += chunk.length;
  if (state.size > MaximumResponseBytes)
    response.destroy(new Error("The AI server response was too large."));
  else
    state.chunks.push(chunk);
}

function ResolveNodeResponse(response, chunks, resolve, reject) {
  try {
    const text = Buffer.concat(chunks).toString("utf8");
    resolve({ status: Number(response.statusCode) || 502, payload: text ? JSON.parse(text) : null });
  } catch {
    reject(new AiClientError(502, "AI_RESPONSE_INVALID", "The AI server did not return valid JSON."));
  }
}

function NormalizeModels(payload) {
  const source = ReadModelSource(payload);
  const models = source.map(NormalizeModel).filter(Boolean);
  const unique = new Map(models.map((model) => [model.id, model]));
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function ReadModelSource(payload) {
  if (Array.isArray(payload?.data))
    return payload.data;
  if (Array.isArray(payload?.models))
    return payload.models;
  return [];
}

function NormalizeModel(value) {
  const id = String(typeof value === StringType ? value : value?.id || "").trim();
  if (!id || id.length > 512)
    return null;
  return { id };
}

function ReadChatContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === StringType)
    return content.trim();
  if (!Array.isArray(content))
    return "";
  return content.map((part) => String(part?.text || "")).join("").trim();
}

function NormalizeApiKey(value) {
  return String(value || "").trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function RemoteRequestError(response) {
  const message = response.payload?.error?.message || `The AI server returned HTTP ${response.status}.`;
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
