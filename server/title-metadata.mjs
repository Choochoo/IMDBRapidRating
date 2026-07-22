import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BuildUserDataPath, EnsureUserDataParent, MigrateLegacyFile } from "./user-data.mjs";
import { NormalizeLanguageCode, NormalizeTmdbOrigin } from "../shared/title-filters.js";
import { CreateStreamingAvailabilityService } from "./streaming-availability.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CachePath = BuildTitleMetadataCachePath();
const TmdbApiUrl = "https://api.themoviedb.org/3";
const TmdbImageUrl = "https://image.tmdb.org/t/p/w342";
const DefaultStreamingCountry = "US";
const MovieMetadataTtlMilliseconds = 30 * 24 * 60 * 60 * 1000;
const ActiveTvMetadataTtlMilliseconds = 7 * 24 * 60 * 60 * 1000;
let CacheWriteTimer;
const MetadataCache = LoadMetadataCache();
const StreamingAvailabilityService = CreateStreamingAvailabilityService();

export async function GetTitleMetadata(titleId, options = {}) {
  const mediaType = options.mediaType === "tv" ? "tv" : "movie";
  const databaseMetadata = await ReadDatabaseMetadata(options.metadataStore, titleId, mediaType);
  const mergedCache = MergeCachedMetadata(databaseMetadata, MetadataCache[titleId], mediaType);
  const shouldMigrateLocalCache = Boolean(mergedCache && !mergedCache.metadataCheckedAt && HasMetadataPayload(mergedCache));
  const cached = shouldMigrateLocalCache ? { ...mergedCache, metadataCheckedAt: new Date().toISOString() } : mergedCache;
  const useCached = ShouldUseCachedMetadata(cached, options);
  const metadata = useCached
    ? cached
    : await LoadTitleMetadata(titleId, { ...options, mediaType }, cached);
  if (!useCached || shouldMigrateLocalCache || (!databaseMetadata?.metadataCheckedAt && metadata?.metadataCheckedAt))
    await PersistMetadata(metadata, options.metadataStore);
  const streamingAvailability = await ResolveStreamingAvailability(metadata, options);
  return Ok(BuildPublicMetadata(metadata, streamingAvailability));
}

async function LoadTitleMetadata(titleId, options, cached = {}) {
  const [tmdb, titlePage, suggestion] = await Promise.all([
    FetchTmdbMetadata(titleId, options, cached).catch(() => null),
    FetchTitlePageMetadata(titleId).catch(() => null),
    FetchSuggestionMetadata(titleId).catch(() => null)
  ]);
  return {
    titleId,
    mediaType: options.mediaType === "tv" ? "tv" : "movie",
    tmdbId: Number(tmdb?.tmdbId || cached?.tmdbId) || null,
    posterUrl: tmdb?.posterUrl || cached?.posterUrl || titlePage?.posterUrl || suggestion?.posterUrl || "",
    synopsis: tmdb?.synopsis || cached?.synopsis || titlePage?.synopsis || "",
    actors: FirstActorList(tmdb?.actors, cached?.actors, titlePage?.actors, suggestion?.actors),
    trailerUrl: FirstTrailerUrl(tmdb?.trailerUrl, cached?.trailerUrl, titlePage?.trailerUrl),
    seriesStatus: tmdb?.seriesStatus || cached?.seriesStatus || "",
    seasonCount: Number(tmdb?.seasonCount || cached?.seasonCount) || 0,
    episodeCount: Number(tmdb?.episodeCount || cached?.episodeCount) || 0,
    episodeRuntimeMinutes: Number(tmdb?.episodeRuntimeMinutes || cached?.episodeRuntimeMinutes) || 0,
    originCountries: Array.isArray(tmdb?.originCountries) ? tmdb.originCountries : Array.isArray(cached?.originCountries) ? cached.originCountries : [],
    originalLanguage: tmdb?.originalLanguage || cached?.originalLanguage || "",
    source: tmdb?.source || cached?.source || titlePage?.source || suggestion?.source || "",
    sourcePayload: IsRecord(tmdb?.sourcePayload) ? tmdb.sourcePayload : IsRecord(cached?.sourcePayload) ? cached.sourcePayload : {},
    metadataCheckedAt: new Date().toISOString(),
    streamingByCountry: IsRecord(cached?.streamingByCountry) ? cached.streamingByCountry : {}
  };
}

function ShouldUseCachedMetadata(metadata, options) {
  if (!metadata || !HasMetadataPayload(metadata))
    return false;
  if (!Array.isArray(metadata.actors))
    return false;
  if (typeof metadata.trailerUrl !== "string")
    return false;
  if (options.mediaType === "tv" && (metadata.mediaType !== "tv" || !("seriesStatus" in metadata)))
    return false;
  if (!ReadTmdbApiKey(options))
    return true;
  if (!metadata.synopsis || !metadata.posterUrl)
    return false;
  if (!metadata.metadataCheckedAt)
    return true;
  const checkedAt = new Date(metadata.metadataCheckedAt);
  const seriesStatus = String(metadata.seriesStatus || "").toLowerCase();
  const ttl = metadata.mediaType === "tv" && !["ended", "canceled"].includes(seriesStatus)
    ? ActiveTvMetadataTtlMilliseconds
    : MovieMetadataTtlMilliseconds;
  const age = Date.now() - checkedAt.getTime();
  return Number.isFinite(age) && age >= 0 && age < ttl;
}

function HasMetadataPayload(metadata) {
  return Boolean(
    metadata?.metadataCheckedAt
    || metadata?.posterUrl
    || metadata?.synopsis
    || metadata?.trailerUrl
    || metadata?.source
    || (Array.isArray(metadata?.actors) && metadata.actors.length)
  );
}

async function FetchTmdbMetadata(titleId, options, cached) {
  const apiKey = ReadTmdbApiKey(options);
  if (!apiKey)
    throw new Error("TMDB_API_KEY is not configured.");
  const knownTmdbId = Number(cached?.tmdbId);
  if (Number.isInteger(knownTmdbId) && knownTmdbId > 0) {
    const extras = await FetchTmdbExtras(options.mediaType, knownTmdbId, apiKey);
    return BuildTmdbMetadata(extras, extras, options.mediaType, knownTmdbId);
  }
  const response = await fetch(BuildTmdbFindUrl(titleId, apiKey), { headers: BuildTmdbHeaders(apiKey) });
  if (!response.ok)
    throw new Error(`TMDB returned HTTP ${response.status}.`);
  const payload = await response.json();
  const result = FindTmdbResult(payload, options.mediaType);
  if (!result)
    throw new Error("TMDB did not find this IMDb title.");
  const extras = await FetchTmdbExtras(result.mediaType, result.item.id, apiKey).catch(() => ({ actors: [], trailerUrl: "" }));
  return BuildTmdbMetadata(result.item, extras, result.mediaType, Number(result.item.id));
}

function BuildTmdbFindUrl(titleId, apiKey) {
  const params = BuildTmdbFindParams(apiKey);
  return `${TmdbApiUrl}/find/${titleId}?${params}`;
}

function BuildTmdbFindParams(apiKey) {
  const params = new URLSearchParams({ external_source: "imdb_id", language: "en-US" });
  if (!IsTmdbBearerToken(apiKey))
    params.set("api_key", apiKey);
  return params;
}

function BuildTmdbHeaders(apiKey) {
  const headers = { "accept": "application/json" };
  if (IsTmdbBearerToken(apiKey))
    headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function ReadTmdbApiKey(options) {
  return String(options?.tmdbApiKey || "").trim();
}

function IsTmdbBearerToken(apiKey) {
  return String(apiKey || "").includes(".");
}

function FindTmdbResult(payload, expectedMediaType) {
  const movies = Array.isArray(payload?.movie_results) ? payload.movie_results : [];
  const shows = Array.isArray(payload?.tv_results) ? payload.tv_results : [];
  if (expectedMediaType === "tv" && shows[0])
    return { item: shows[0], mediaType: "tv" };
  if (expectedMediaType === "movie" && movies[0])
    return { item: movies[0], mediaType: "movie" };
  if (movies[0])
    return { item: movies[0], mediaType: "movie" };
  if (shows[0])
    return { item: shows[0], mediaType: "tv" };
  return null;
}

async function FetchTmdbExtras(mediaType, id, apiKey) {
  if (!Number.isInteger(Number(id)))
    return { actors: [], trailerUrl: "" };
  const params = new URLSearchParams({ language: "en-US", append_to_response: "credits,videos" });
  if (!IsTmdbBearerToken(apiKey))
    params.set("api_key", apiKey);
  const response = await fetch(`${TmdbApiUrl}/${mediaType}/${id}?${params}`, { headers: BuildTmdbHeaders(apiKey) });
  if (!response.ok)
    throw new Error(`TMDB details returned HTTP ${response.status}.`);
  const payload = await response.json();
  return {
    poster_path: payload?.poster_path || "",
    overview: CleanMetadataText(payload?.overview || ""),
    original_language: NormalizeLanguageCode(payload?.original_language),
    actors: ReadActorNames(payload?.credits?.cast),
    trailerUrl: PickTmdbTrailerUrl(payload?.videos?.results),
    seriesStatus: CleanMetadataText(payload?.status || ""),
    seasonCount: Number(payload?.number_of_seasons) || 0,
    episodeCount: Number(payload?.number_of_episodes) || 0,
    episodeRuntimeMinutes: ReadEpisodeRuntime(payload),
    sourcePayload: payload,
    ...NormalizeTmdbOrigin(mediaType, null, payload)
  };
}

function BuildTmdbMetadata(item, extras, mediaType, tmdbId) {
  return {
    mediaType,
    tmdbId: Number(tmdbId) || null,
    posterUrl: BuildTmdbPosterUrl(extras.poster_path || item.poster_path),
    synopsis: CleanMetadataText(extras.overview || item.overview || ""),
    actors: ReadActorNames(extras.actors),
    trailerUrl: NormalizeTrailerUrl(extras.trailerUrl),
    seriesStatus: extras.seriesStatus || "",
    seasonCount: Number(extras.seasonCount) || 0,
    episodeCount: Number(extras.episodeCount) || 0,
    episodeRuntimeMinutes: Number(extras.episodeRuntimeMinutes) || 0,
    originCountries: Array.isArray(extras.originCountries) ? extras.originCountries : [],
    originalLanguage: extras.originalLanguage || NormalizeLanguageCode(item.original_language),
    source: "tmdb",
    sourcePayload: IsRecord(extras.sourcePayload) ? extras.sourcePayload : IsRecord(item) ? item : {}
  };
}

function ReadEpisodeRuntime(payload) {
  const runtimes = Array.isArray(payload?.episode_run_time) ? payload.episode_run_time : [];
  const value = runtimes.map(Number).find((runtime) => Number.isFinite(runtime) && runtime > 0);
  return value || Number(payload?.last_episode_to_air?.runtime) || 0;
}

function BuildTmdbPosterUrl(posterPath) {
  const cleanPath = String(posterPath || "").trim();
  return cleanPath.startsWith("/") ? `${TmdbImageUrl}${cleanPath}` : "";
}

async function FetchTitlePageMetadata(titleId) {
  const response = await fetch(`https://www.imdb.com/title/${titleId}/`, { headers: BuildTitleHeaders() });
  const html = await response.text();
  if (!response.ok || !html)
    throw new Error(`IMDb title page returned HTTP ${response.status}.`);
  const jsonLd = ExtractJsonLd(html);
  return {
    posterUrl: NormalizeImageUrl(jsonLd?.image || ""),
    synopsis: CleanMetadataText(jsonLd?.description || ""),
    actors: ReadActorNames(jsonLd?.actor),
    trailerUrl: ReadImdbTrailerUrl(jsonLd?.trailer),
    source: "imdb-title-page"
  };
}

async function FetchSuggestionMetadata(titleId) {
  const response = await fetch(BuildSuggestionUrl(titleId), { headers: BuildSuggestionHeaders() });
  if (!response.ok)
    throw new Error(`IMDb suggestion endpoint returned HTTP ${response.status}.`);
  const payload = await response.json();
  const item = Array.isArray(payload?.d) ? payload.d.find((entry) => entry.id === titleId) : null;
  return {
    posterUrl: NormalizeImageUrl(item?.i?.imageUrl || ""),
    synopsis: "",
    actors: ReadActorNames(String(item?.s || "").split(",")),
    trailerUrl: "",
    source: "imdb-suggestion"
  };
}

export function ReadActorNames(value) {
  const actors = Array.isArray(value) ? value : value ? [value] : [];
  const names = [];
  for (const actor of actors) {
    const rawName = actor && typeof actor === "object" ? actor.name : actor;
    const name = CleanMetadataText(rawName);
    if (name && !names.includes(name))
      names.push(name);
    if (names.length === 3)
      break;
  }
  return names;
}

export function PickTmdbTrailerUrl(value) {
  const videos = Array.isArray(value) ? value : [];
  const candidates = videos
    .filter((video) => String(video?.site || "").toLowerCase() === "youtube" && /^[a-z0-9_-]+$/i.test(String(video?.key || "")))
    .map((video, index) => ({ video, index, score: ScoreTmdbTrailer(video) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const key = String(candidates[0]?.video?.key || "");
  return key ? `https://www.youtube.com/watch?v=${encodeURIComponent(key)}` : "";
}

export function NormalizeTrailerUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function ScoreTmdbTrailer(video) {
  const type = String(video?.type || "").toLowerCase();
  const name = String(video?.name || "").toLowerCase();
  return (type === "trailer" ? 100 : type === "teaser" ? 50 : 0)
    + (video?.official ? 25 : 0)
    + (name.includes("official") ? 10 : 0);
}

function ReadImdbTrailerUrl(value) {
  const trailer = value && typeof value === "object" ? value : {};
  return FirstTrailerUrl(trailer.url, trailer.embedUrl, trailer.contentUrl);
}

function FirstTrailerUrl(...values) {
  for (const value of values) {
    const url = NormalizeTrailerUrl(value);
    if (url)
      return url;
  }
  return "";
}

function FirstActorList(...values) {
  for (const value of values) {
    const actors = ReadActorNames(value);
    if (actors.length)
      return actors;
  }
  return [];
}

function BuildSuggestionUrl(titleId) {
  return `https://v3.sg.media-imdb.com/suggestion/t/${titleId}.json`;
}

function BuildSuggestionHeaders() {
  return {
    "accept": "application/json",
    "user-agent": "Mozilla/5.0"
  };
}

async function ReadDatabaseMetadata(store, titleId, mediaType) {
  if (!store?.readOne)
    return null;
  try {
    return await store.readOne(titleId, mediaType);
  } catch (error) {
    console.warn(`${titleId} PostgreSQL metadata read failed: ${error.message}`);
    return null;
  }
}

function MergeCachedMetadata(databaseMetadata, localMetadata, mediaType) {
  if (!databaseMetadata && !localMetadata)
    return null;
  const database = databaseMetadata || {};
  const local = localMetadata || {};
  return {
    ...local,
    ...database,
    titleId: database.titleId || local.titleId || "",
    mediaType,
    tmdbId: Number(database.tmdbId || local.tmdbId) || null,
    posterUrl: database.posterUrl || local.posterUrl || "",
    synopsis: database.synopsis || local.synopsis || "",
    actors: FirstActorList(database.actors, local.actors),
    trailerUrl: FirstTrailerUrl(database.trailerUrl, local.trailerUrl),
    seriesStatus: database.seriesStatus || local.seriesStatus || "",
    seasonCount: Number(database.seasonCount || local.seasonCount) || 0,
    episodeCount: Number(database.episodeCount || local.episodeCount) || 0,
    episodeRuntimeMinutes: Number(database.episodeRuntimeMinutes || local.episodeRuntimeMinutes) || 0,
    originCountries: Array.isArray(database.originCountries) && database.originCountries.length ? database.originCountries : Array.isArray(local.originCountries) ? local.originCountries : [],
    originalLanguage: database.originalLanguage || local.originalLanguage || "",
    source: database.source || local.source || "",
    metadataCheckedAt: database.metadataCheckedAt || local.metadataCheckedAt || "",
    sourcePayload: IsRecord(database.sourcePayload) && Object.keys(database.sourcePayload).length ? database.sourcePayload : IsRecord(local.sourcePayload) ? local.sourcePayload : {},
    streamingByCountry: {
      ...(IsRecord(local.streamingByCountry) ? local.streamingByCountry : {}),
      ...(IsRecord(database.streamingByCountry) ? database.streamingByCountry : {})
    }
  };
}

async function PersistMetadata(metadata, store) {
  if (!metadata?.titleId)
    return;
  MetadataCache[metadata.titleId] = metadata;
  ScheduleCacheWrite();
  if (!store?.upsertMetadata)
    return;
  try {
    await store.upsertMetadata(metadata);
  } catch (error) {
    console.warn(`${metadata.titleId} PostgreSQL metadata write failed: ${error.message}`);
  }
}

async function ResolveStreamingAvailability(metadata, options) {
  const country = NormalizeStreamingCountry(options.streamingCountry || DefaultStreamingCountry);
  const cached = IsRecord(metadata?.streamingByCountry) ? metadata.streamingByCountry[country] : null;
  const service = options.streamingAvailabilityService || StreamingAvailabilityService;
  if (!service?.get)
    return cached || null;
  try {
    return await service.get({
      mediaType: metadata.mediaType,
      tmdbId: metadata.tmdbId,
      apiKey: ReadTmdbApiKey(options),
      country,
      cached,
      persist: (availability) => PersistStreamingAvailability(metadata, country, availability, options.metadataStore)
    });
  } catch (error) {
    console.warn(`${metadata.titleId} streaming availability failed: ${error.message}`);
    return cached ? { ...cached, stale: true } : null;
  }
}

async function PersistStreamingAvailability(metadata, country, availability, store) {
  const current = MetadataCache[metadata.titleId] || metadata;
  current.streamingByCountry = { ...(IsRecord(current.streamingByCountry) ? current.streamingByCountry : {}), [country]: availability };
  MetadataCache[metadata.titleId] = current;
  ScheduleCacheWrite();
  if (!store?.updateStreaming)
    return;
  try {
    await store.updateStreaming(metadata.titleId, metadata.mediaType, country, availability);
  } catch (error) {
    console.warn(`${metadata.titleId} PostgreSQL streaming write failed: ${error.message}`);
  }
}

function BuildPublicMetadata(metadata, streamingAvailability) {
  const { status: _status, checkedAt: _checkedAt, sourcePayload: _sourcePayload, streamingByCountry: _streamingByCountry, ...payload } = metadata;
  return { ok: true, ...payload, streamingAvailability };
}

function NormalizeStreamingCountry(value) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : DefaultStreamingCountry;
}

function IsRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function BuildTitleHeaders() {
  return {
    "accept": "text/html,application/xhtml+xml",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
  };
}

function ExtractJsonLd(html) {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of matches) {
    const metadata = ParseJsonLdBlock(match[1]);
    if (metadata)
      return metadata;
  }
  return null;
}

function ParseJsonLdBlock(block) {
  try {
    const parsed = JSON.parse(DecodeHtmlEntities(block).trim());
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return FindTitleMetadataItem(items);
  } catch {
    return null;
  }
}

function FindTitleMetadataItem(items) {
  return items.find((item) => IsTitleMetadataItem(item)) || null;
}

function IsTitleMetadataItem(item) {
  const isMovie = item?.["@type"] === "Movie";
  const isSeries = item?.["@type"] === "TVSeries";
  const hasMetadata = Boolean(item?.description || item?.image);
  return isMovie || isSeries || hasMetadata;
}

function NormalizeImageUrl(url) {
  const clean = CleanMetadataText(url);
  if (!clean)
    return "";
  return clean.replace(/\._V1(?:_[^.]*)?\.jpg$/i, "._V1_FMjpg_UX360_.jpg");
}

function CleanMetadataText(value) {
  return DecodeHtmlEntities(String(value || "")).replace(/\s+/g, " ").trim();
}

function DecodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function LoadMetadataCache() {
  try {
    if (!existsSync(CachePath))
      return {};
    const parsed = JSON.parse(readFileSync(CachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function ScheduleCacheWrite() {
  clearTimeout(CacheWriteTimer);
  CacheWriteTimer = setTimeout(() => WriteMetadataCache().catch(() => null), 500);
}

async function WriteMetadataCache() {
  EnsureUserDataParent(CachePath);
  await writeFile(CachePath, `${JSON.stringify(MetadataCache, null, 2)}\n`, "utf8");
}

function BuildTitleMetadataCachePath() {
  const cachePath = BuildUserDataPath("cache", "title-metadata.json");
  MigrateLegacyFile(path.join(RootPath, "cache", "title-metadata.json"), cachePath);
  return cachePath;
}

function Ok(payload) {
  return {
    status: 200,
    payload
  };
}
