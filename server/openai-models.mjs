const OpenAiModelsUrl = "https://api.openai.com/v1/models";
const FallbackModel = "gpt-4.1-mini";
const ExcludedModelTokens = Object.freeze(["audio", "image", "realtime", "search", "speech", "transcribe", "tts"]);

export async function GetOpenAiModels(options = {}) {
  if (!ReadOpenAiApiKey(options))
    return Fail(422, "OPENAI_KEY_MISSING", "OpenAI API key is not configured.");
  const result = await FetchOpenAiModels(options);
  if (!result.payload.ok)
    return result;
  return Ok(BuildModelFeed(result.payload.models, options));
}

export async function ResolveOpenAiModel(options = {}) {
  const explicit = ReadOpenAiModel(options);
  if (explicit)
    return explicit;
  const result = await GetOpenAiModels(options);
  return result.payload.selectedModel || FallbackModel;
}

function BuildModelFeed(models, options) {
  const eligible = models.filter(IsEligibleModel).sort(CompareModels);
  return {
    selectedModel: SelectDefaultModel(eligible, options),
    explicitModel: ReadOpenAiModel(options),
    modelLag: ReadOpenAiModelLag(options),
    models: eligible.map(FormatModel)
  };
}

async function FetchOpenAiModels(options) {
  const response = await fetch(OpenAiModelsUrl, { headers: BuildHeaders(options) });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    return Fail(response.status, "OPENAI_MODELS_FAILED", ReadOpenAiError(payload, response.status));
  return Ok({ models: Array.isArray(payload?.data) ? payload.data : [] });
}

function BuildHeaders(options) {
  return {
    "authorization": `Bearer ${ReadOpenAiApiKey(options)}`,
    "accept": "application/json"
  };
}

function IsEligibleModel(model) {
  const id = String(model?.id || "");
  return id.startsWith("gpt-") && !ExcludedModelTokens.some((token) => id.includes(token));
}

function CompareModels(left, right) {
  const createdDiff = Number(right.created || 0) - Number(left.created || 0);
  return createdDiff || String(right.id).localeCompare(String(left.id));
}

function SelectDefaultModel(models, options) {
  if (ReadOpenAiModel(options))
    return ReadOpenAiModel(options);
  if (!models.length)
    return FallbackModel;
  return models[Math.min(ReadOpenAiModelLag(options), models.length - 1)].id;
}

function FormatModel(model) {
  return {
    id: model.id,
    created: model.created || null,
    ownedBy: model.owned_by || ""
  };
}

function ReadOpenAiError(payload, status) {
  return payload?.error?.message || `OpenAI returned HTTP ${status}.`;
}

function ReadOpenAiApiKey(options) {
  return NormalizeBearerValue(options?.apiKey);
}

function ReadOpenAiModel(options) {
  return String(options?.model || "").trim();
}

function ReadOpenAiModelLag(options) {
  const value = Number(options?.modelLag || 2);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 2;
}

function NormalizeBearerValue(value) {
  return String(value || "").trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function Ok(payload) {
  return {
    status: 200,
    payload: { ok: true, ...payload }
  };
}

function Fail(status, code, error) {
  return {
    status,
    payload: { ok: false, code, error }
  };
}
