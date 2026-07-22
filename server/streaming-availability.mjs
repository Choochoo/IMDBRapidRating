const TmdbApiUrl = "https://api.themoviedb.org/3";
const DefaultCountry = "US";
export const StreamingAvailabilityTtlMilliseconds = 12 * 60 * 60 * 1000;
const ProviderTypes = Object.freeze([
  ["subscription", "flatrate"],
  ["free", "free"],
  ["ads", "ads"],
  ["rent", "rent"],
  ["buy", "buy"]
]);
const SupportedProviderTypes = new Set(ProviderTypes.map(([type]) => type));

export function CreateStreamingAvailabilityService({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  ttlMilliseconds = StreamingAvailabilityTtlMilliseconds
} = {}) {
  const refreshes = new Map();
  return {
    async get({ mediaType, tmdbId, apiKey, country = DefaultCountry, cached, persist = async () => {} }) {
      const region = NormalizeCountry(country);
      const normalizedCached = NormalizeCachedAvailability(cached, region);
      if (IsStreamingAvailabilityFresh(normalizedCached, now(), ttlMilliseconds))
        return { ...normalizedCached, stale: false };
      if (!Number.isInteger(Number(tmdbId)) || !String(apiKey || "").trim())
        return normalizedCached ? { ...normalizedCached, stale: true } : null;
      const refreshKey = `${mediaType}:${tmdbId}:${region}`;
      const refresh = ReadOrCreateRefresh(refreshes, refreshKey, async () => {
        const availability = await FetchTmdbWatchProviders(mediaType, tmdbId, apiKey, region, { fetchImpl, now });
        await persist(availability);
        return { ...availability, stale: false };
      });
      if (!normalizedCached)
        return await refresh;
      refresh.catch(() => null);
      return { ...normalizedCached, stale: true };
    }
  };
}

export async function FetchTmdbWatchProviders(mediaType, tmdbId, apiKey, country = DefaultCountry, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const normalizedMediaType = mediaType === "tv" ? "tv" : "movie";
  const region = NormalizeCountry(country);
  const params = new URLSearchParams();
  if (!IsTmdbBearerToken(apiKey))
    params.set("api_key", apiKey);
  const query = params.size ? `?${params}` : "";
  const response = await fetchImpl(`${TmdbApiUrl}/${normalizedMediaType}/${encodeURIComponent(tmdbId)}/watch/providers${query}`, {
    headers: BuildTmdbHeaders(apiKey)
  });
  if (!response.ok)
    throw new Error(`TMDB watch providers returned HTTP ${response.status}.`);
  const payload = await response.json();
  const availability = payload?.results?.[region] || {};
  return {
    country: region,
    fetchedAt: now().toISOString(),
    watchUrl: NormalizeHttpUrl(availability.link),
    providers: NormalizeAvailabilityProviders(availability)
  };
}

export function NormalizeWatchProviders(type, providers) {
  if (!SupportedProviderTypes.has(type))
    return [];
  return (Array.isArray(providers) ? providers : []).flatMap((provider) => {
    const id = Number(provider?.provider_id);
    const name = String(provider?.provider_name || "").replace(/\s+/g, " ").trim();
    if (!Number.isInteger(id) || id < 1 || !name)
      return [];
    return [{
      type,
      id,
      name,
      logoPath: NormalizeLogoPath(provider?.logo_path),
      displayPriority: Math.max(0, Number(provider?.display_priority) || 0)
    }];
  });
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
  const providers = Array.isArray(value.providers) ? value.providers.flatMap((provider) => NormalizeWatchProviders(provider?.type, [{
    provider_id: provider?.id,
    provider_name: provider?.name,
    logo_path: provider?.logoPath,
    display_priority: provider?.displayPriority
  }])) : [];
  return {
    country,
    fetchedAt: String(value.fetchedAt || ""),
    watchUrl: NormalizeHttpUrl(value.watchUrl),
    providers
  };
}

function ReadOrCreateRefresh(refreshes, key, load) {
  if (refreshes.has(key))
    return refreshes.get(key);
  const refresh = Promise.resolve().then(load).finally(() => refreshes.delete(key));
  refreshes.set(key, refresh);
  return refresh;
}

function NormalizeCountry(value) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : DefaultCountry;
}

function NormalizeLogoPath(value) {
  const path = String(value || "").trim();
  return /^\/[a-z0-9._/-]+$/i.test(path) && !path.includes("..") ? path : "";
}

function NormalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function BuildTmdbHeaders(apiKey) {
  const headers = { accept: "application/json" };
  if (IsTmdbBearerToken(apiKey))
    headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function IsTmdbBearerToken(value) {
  return String(value || "").includes(".");
}
