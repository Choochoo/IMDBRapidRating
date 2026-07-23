import { AddTmdbApiKey, BuildTmdbHeaders, TmdbApiUrl } from "./tmdb-request.mjs";
import { DefaultStreamingCountry, ReadStreamingCountry } from "../shared/streaming-country.js";

const MovieMediaType = "movie";
const TvMediaType = "tv";
const FreeProviderType = "free";
const AdsProviderType = "ads";
const RentProviderType = "rent";
const BuyProviderType = "buy";
export const StreamingAvailabilityTtlMilliseconds = 12 * 60 * 60 * 1000;
const ProviderTypeEntries = [
  ["subscription", "flatrate"],
  [FreeProviderType, FreeProviderType],
  [AdsProviderType, AdsProviderType],
  [RentProviderType, RentProviderType],
  [BuyProviderType, BuyProviderType]
];
const ProviderTypes = Object.freeze(ProviderTypeEntries);
const SupportedProviderTypes = new Set(ProviderTypes.map(([type]) => type));

export function CreateStreamingAvailabilityService(options = {}) {
  const context = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    now: options.now || (() => new Date()),
    reportError: options.reportError || ReportAvailabilityRefreshFailure,
    ttlMilliseconds: options.ttlMilliseconds || StreamingAvailabilityTtlMilliseconds,
    refreshes: new Map()
  };
  return { get: (request) => GetStreamingAvailability(context, request) };
}

function GetStreamingAvailability(context, request) {
  const region = ReadStreamingCountry(request.country);
  const cached = NormalizeCachedAvailability(request.cached, region);
  if (IsStreamingAvailabilityFresh(cached, context.now(), context.ttlMilliseconds))
    return { ...cached, stale: false, refreshing: false };
  if (!CanRefreshAvailability(request))
    return cached ? { ...cached, stale: true, refreshing: false } : null;
  return ResolveAvailabilityRefresh(context, request, region, cached);
}

function CanRefreshAvailability(request) {
  return Number.isInteger(Number(request.tmdbId)) && Boolean(String(request.apiKey || "").trim());
}

function ResolveAvailabilityRefresh(context, request, region, cached) {
  const key = `${request.mediaType}:${request.tmdbId}:${region}`;
  const refresh = ReadOrCreateRefresh(context.refreshes, key, () => RefreshAvailability(context, request, region));
  if (!cached)
    return refresh;
  refresh.catch((error) => context.reportError(error, request));
  return { ...cached, stale: true, refreshing: true };
}

async function RefreshAvailability(context, request, region) {
  const availability = await FetchTmdbWatchProviders(request.mediaType, request.tmdbId, request.apiKey, region, context);
  if (request.persist)
    await request.persist(availability);
  return { ...availability, stale: false, refreshing: false };
}

export async function FetchTmdbWatchProviders(mediaType, tmdbId, apiKey, country = DefaultStreamingCountry, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const normalizedMediaType = mediaType === TvMediaType ? TvMediaType : MovieMediaType;
  const region = ReadStreamingCountry(country);
  const request = BuildWatchProviderRequest(normalizedMediaType, tmdbId, apiKey);
  const response = await fetchImpl(request.url, { headers: request.headers });
  if (!response.ok)
    throw new Error(`TMDB watch providers returned HTTP ${response.status}.`);
  const payload = await response.json();
  return BuildAvailability(payload?.results?.[region], region, now());
}

function BuildWatchProviderRequest(mediaType, tmdbId, apiKey) {
  const params = new URLSearchParams();
  AddTmdbApiKey(params, apiKey);
  const query = params.size ? `?${params}` : "";
  return { url: `${TmdbApiUrl}/${mediaType}/${encodeURIComponent(tmdbId)}/watch/providers${query}`, headers: BuildTmdbHeaders(apiKey) };
}

function BuildAvailability(value, region, fetchedAt) {
  const availability = value || {};
  return {
    country: region,
    fetchedAt: fetchedAt.toISOString(),
    watchUrl: NormalizeHttpUrl(availability.link),
    providers: NormalizeAvailabilityProviders(availability)
  };
}

export function NormalizeWatchProviders(type, providers) {
  if (!SupportedProviderTypes.has(type))
    return [];
  return (Array.isArray(providers) ? providers : []).flatMap((provider) => NormalizeWatchProvider(type, provider));
}

function NormalizeWatchProvider(type, provider) {
  const id = Number(provider?.provider_id);
  const name = String(provider?.provider_name || "").replace(/\s+/g, " ").trim();
  if (!Number.isInteger(id) || id < 1 || !name)
    return [];
  return [{ type, id, name, logoPath: NormalizeLogoPath(provider?.logo_path), displayPriority: Math.max(0, Number(provider?.display_priority) || 0) }];
}

export function IsStreamingAvailabilityFresh(availability, currentTime = new Date(), ttlMilliseconds = StreamingAvailabilityTtlMilliseconds) {
  const fetchedAt = new Date(availability?.fetchedAt || "");
  const age = currentTime.getTime() - fetchedAt.getTime();
  return Number.isFinite(age) && age >= 0 && age < ttlMilliseconds;
}

function NormalizeAvailabilityProviders(availability) {
  const providers = ProviderTypes.flatMap(([type, key]) => NormalizeWatchProviders(type, availability?.[key]));
  const unique = new Map();
  for (const provider of providers)
    unique.set(`${provider.type}:${provider.id}`, provider);
  return [...unique.values()].sort((left, right) => left.displayPriority - right.displayPriority || left.name.localeCompare(right.name));
}

function NormalizeCachedAvailability(value, country) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return null;
  const providers = Array.isArray(value.providers) ? value.providers.flatMap(NormalizeCachedProvider) : [];
  return {
    country,
    fetchedAt: String(value.fetchedAt || ""),
    watchUrl: NormalizeHttpUrl(value.watchUrl),
    providers
  };
}

function NormalizeCachedProvider(provider) {
  const value = { provider_id: provider?.id, provider_name: provider?.name, logo_path: provider?.logoPath, display_priority: provider?.displayPriority };
  return NormalizeWatchProviders(provider?.type, [value]);
}

function ReadOrCreateRefresh(refreshes, key, load) {
  if (refreshes.has(key))
    return refreshes.get(key);
  const refresh = Promise.resolve().then(load).finally(() => refreshes.delete(key));
  refreshes.set(key, refresh);
  return refresh;
}

function NormalizeLogoPath(value) {
  const path = String(value || "").trim();
  return /^\/[a-z0-9._/-]+$/i.test(path) && !path.includes("..") ? path : "";
}

function NormalizeHttpUrl(value) {
  const rawUrl = String(value || "");
  if (!URL.canParse(rawUrl))
    return "";
  const url = new URL(rawUrl);
  return ["http:", "https:"].includes(url.protocol) ? url.href : "";
}

function ReportAvailabilityRefreshFailure(error, request) {
  console.warn(`${request.mediaType}:${request.tmdbId} streaming refresh failed: ${error.message}`);
}
