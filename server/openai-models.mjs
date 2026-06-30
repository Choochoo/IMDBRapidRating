import { GetOpenAiApiKey, GetOpenAiModel, GetOpenAiModelLag } from "./env.mjs";

const OpenAiModelsUrl = "https://api.openai.com/v1/models";
const FallbackModel = "gpt-4.1-mini";
const ExcludedModelTokens = Object.freeze(["audio", "image", "realtime", "search", "speech", "transcribe", "tts"]);

export async function GetOpenAiModels() {
  if (!GetOpenAiApiKey())
    return Fail(422, "OPENAI_KEY_MISSING", "OpenAI API key is not configured.");
  const result = await FetchOpenAiModels();
  if (!result.payload.ok)
    return result;
  return Ok(BuildModelFeed(result.payload.models));
}

export async function ResolveOpenAiModel() {
  const explicit = GetOpenAiModel();
  if (explicit)
    return explicit;
  const result = await GetOpenAiModels();
  return result.payload.selectedModel || FallbackModel;
}

function BuildModelFeed(models) {
  const eligible = models.filter(IsEligibleModel).sort(CompareModels);
  return {
    selectedModel: SelectDefaultModel(eligible),
    explicitModel: GetOpenAiModel(),
    modelLag: GetOpenAiModelLag(),
    models: eligible.map(FormatModel)
  };
}

async function FetchOpenAiModels() {
  const response = await fetch(OpenAiModelsUrl, { headers: BuildHeaders() });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    return Fail(response.status, "OPENAI_MODELS_FAILED", ReadOpenAiError(payload, response.status));
  return Ok({ models: Array.isArray(payload?.data) ? payload.data : [] });
}

function BuildHeaders() {
  return {
    "authorization": `Bearer ${GetOpenAiApiKey()}`,
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

function SelectDefaultModel(models) {
  if (GetOpenAiModel())
    return GetOpenAiModel();
  if (!models.length)
    return FallbackModel;
  return models[Math.min(GetOpenAiModelLag(), models.length - 1)].id;
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
