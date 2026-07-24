const OpenAiProviderId = "openai";
const AnthropicProviderId = "anthropic";
const GeminiProviderId = "gemini";
const XaiProviderId = "xai";
const OpenRouterProviderId = "openrouter";
const HomeProviderId = "home";
const CustomProviderId = "custom";
const OpenAiAdapter = OpenAiProviderId;
const AnthropicAdapter = AnthropicProviderId;
const GeminiAdapter = GeminiProviderId;
const CustomAdapter = CustomProviderId;

const ProviderDefinitions = Object.freeze([
  Provider(OpenAiProviderId, "ChatGPT / OpenAI", "Use models available to your OpenAI API account.", OpenAiAdapter, "https://api.openai.com/v1", "https://platform.openai.com/api-keys"),
  Provider(AnthropicProviderId, "Claude", "Use models available to your Claude API account.", AnthropicAdapter, "https://api.anthropic.com/v1", "https://console.anthropic.com/settings/keys"),
  Provider(GeminiProviderId, "Gemini", "Use models available through Google AI Studio.", GeminiAdapter, "https://generativelanguage.googleapis.com/v1beta", "https://aistudio.google.com/app/apikey"),
  Provider(XaiProviderId, "Grok", "Use models available to your xAI API account.", OpenAiAdapter, "https://api.x.ai/v1", "https://console.x.ai/"),
  Provider(OpenRouterProviderId, "OpenRouter", "Use OpenRouter's live catalog of available models.", OpenAiAdapter, "https://openrouter.ai/api/v1", "https://openrouter.ai/settings/keys"),
  Provider(HomeProviderId, "AI running at home", "Connect an OpenAI-compatible server on your private network.", CustomAdapter, "", ""),
  Provider(CustomProviderId, "Something else", "Connect any other OpenAI-compatible service.", CustomAdapter, "", "")
]);

const ProviderMap = new Map(ProviderDefinitions.map((provider) => [provider.id, provider]));

export const AiProviderIds = Object.freeze(ProviderDefinitions.map((provider) => provider.id));
export const AiProviderKinds = Object.freeze({ Anthropic: AnthropicProviderId, Gemini: GeminiProviderId, OpenAi: OpenAiProviderId, Xai: XaiProviderId });

export function ListAiProviders() {
  return ProviderDefinitions.map(ToPublicProvider);
}

export function ReadAiProvider(providerId) {
  return ProviderMap.get(String(providerId || "").trim()) || null;
}

export function ResolveAiBaseUrl(providerId, submittedUrl) {
  const provider = ReadRequiredProvider(providerId);
  return provider.customUrl ? String(submittedUrl || "").trim() : provider.baseUrl;
}

export function ReadProviderAdapter(providerId) {
  return ReadRequiredProvider(providerId).adapter;
}

export function ProviderRequiresKey(providerId) {
  return ReadRequiredProvider(providerId).keyRequired;
}

export function IsCustomAiProvider(providerId) {
  return ReadRequiredProvider(providerId).customUrl;
}

export function ReadProviderName(providerId) {
  return ReadRequiredProvider(providerId).name;
}

function Provider(id, name, description, adapter, baseUrl, keyHelpUrl) {
  const customUrl = adapter === CustomAdapter;
  return Object.freeze({ id, name, description, adapter, baseUrl, keyHelpUrl, customUrl, keyRequired: !customUrl });
}

function ToPublicProvider(provider) {
  const tutorial = BuildProviderTutorial(provider);
  return {
    id: provider.id, name: provider.name, description: provider.description,
    needsServerUrl: provider.customUrl, keyRequired: provider.keyRequired,
    keyHelpUrl: provider.keyHelpUrl, tutorial
  };
}

function BuildProviderTutorial(provider) {
  if (provider.customUrl)
    return ["Open your AI server's connection settings.", "Copy its OpenAI-compatible URL and access key, if it uses one.", "Return here and find its current models."];
  return [`Open ${provider.name}'s key page and sign in.`, "Create a private access key and copy it.", "Return here, paste it, and find your current models."];
}

function ReadRequiredProvider(providerId) {
  const provider = ReadAiProvider(providerId);
  if (!provider)
    throw new Error("Choose a supported AI service.");
  return provider;
}

export const AiAdapterKinds = Object.freeze({ OpenAiAdapter, AnthropicAdapter, GeminiAdapter, CustomAdapter });
