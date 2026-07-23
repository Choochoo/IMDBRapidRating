import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BuildUserDataPath, EnsureUserDataParent, MigrateLegacyFile } from "./user-data.mjs";
import { NormalizeLanguageCode, NormalizeTmdbOrigin } from "../shared/title-filters.js";
import { ReadStreamingCountry } from "../shared/streaming-country.js";
import { CreateStreamingAvailabilityService } from "./streaming-availability.mjs";
import { AddTmdbApiKey, BuildTmdbHeaders, TmdbApiUrl } from "./tmdb-request.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TmdbImageUrl = "https://image.tmdb.org/t/p/w342";
const MovieMediaType = "movie";
const TvMediaType = "tv";
const TmdbLanguage = "en-US";
const TmdbSource = "tmdb";
const ObjectType = "object";
const AcceptHeader = "accept";
const UserAgentHeader = "user-agent";
const MetadataTypeAttribute = "@type";
const TextEncoding = "utf8";
const CacheDirectoryName = "cache";
const MetadataCacheFileName = "title-metadata.json";
const CachePath = BuildTitleMetadataCachePath();
const MovieMetadataTtlMilliseconds = 30 * 24 * 60 * 60 * 1000;
const ActiveTvMetadataTtlMilliseconds = 7 * 24 * 60 * 60 * 1000;
const PrivateMetadataFields = Object.freeze(["status", "checkedAt", "sourcePayload", "streamingByCountry"]);
const MetadataRefreshes = new Map();
let CacheWriteTimer;
const MetadataCache = LoadMetadataCache();
const StreamingAvailabilityService = CreateStreamingAvailabilityService();

export async function GetTitleMetadata(titleId, options = {}) {
  const mediaType = options.mediaType === TvMediaType ? TvMediaType : MovieMediaType;
  const databaseMetadata = await ReadDatabaseMetadata(options.metadataStore, titleId, mediaType);
  const mergedCache = MergeCachedMetadata(databaseMetadata, MetadataCache[titleId], mediaType);
  const shouldMigrateLocalCache = ShouldStampLegacyTmdbMetadata(mergedCache);
  const cached = shouldMigrateLocalCache ? { ...mergedCache, metadataCheckedAt: new Date().toISOString() } : mergedCache;
  const useCached = ShouldUseCachedMetadata(cached, options);
  const metadata = useCached ? cached : await LoadTitleMetadataOnce(titleId, { ...options, mediaType }, cached);
  if (!useCached || shouldMigrateLocalCache || (!databaseMetadata?.metadataCheckedAt && metadata?.metadataCheckedAt))
    await PersistMetadata(metadata, options.metadataStore);
  const streamingAvailability = options.includeStreaming ? await ResolveStreamingAvailability(metadata, options) : null;
  return Ok(BuildPublicMetadata(metadata, streamingAvailability));
}

function ShouldStampLegacyTmdbMetadata(metadata) {
  return Boolean(metadata && metadata.source === TmdbSource && !metadata.metadataCheckedAt && HasMetadataPayload(metadata));
}

function LoadTitleMetadataOnce(titleId, options, cached) {
  const sourceKind = ReadTmdbApiKey(options) ? TmdbSource : "fallback";
  const key = `${options.mediaType}:${titleId}:${sourceKind}`;
  return ReadOrCreateMetadataRefresh(key, () => LoadTitleMetadata(titleId, options, cached));
}

function ReadOrCreateMetadataRefresh(key, load) {
  if (MetadataRefreshes.has(key))
    return MetadataRefreshes.get(key);
  const refresh = Promise.resolve().then(load).finally(() => MetadataRefreshes.delete(key));
  MetadataRefreshes.set(key, refresh);
  return refresh;
}

async function LoadTitleMetadata(titleId, options, cached = {}) {
  const [tmdb, titlePage, suggestion] = await LoadMetadataSources(titleId, options, cached);
  return {
    ...BuildMetadataIdentity(titleId, options, tmdb, cached),
    ...BuildVisualMetadata(tmdb, cached, titlePage, suggestion),
    ...BuildSeriesMetadata(tmdb, cached),
    ...BuildOriginMetadata(tmdb, cached),
    ...BuildMetadataProvenance(tmdb, cached, titlePage, suggestion),
    streamingByCountry: IsRecord(cached?.streamingByCountry) ? cached.streamingByCountry : {}
  };
}

async function LoadMetadataSources(titleId, options, cached) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const tmdb = ReadTmdbApiKey(options) ? FetchTmdbMetadata(titleId, options, cached) : Promise.resolve(null);
  const sources = [{ name: "TMDB", promise: tmdb }, { name: "IMDb title page", promise: FetchTitlePageMetadata(titleId, fetchImpl) }, { name: "IMDb suggestion", promise: FetchSuggestionMetadata(titleId, fetchImpl) }];
  const results = await Promise.allSettled(sources.map((source) => source.promise));
  ReportMetadataSourceFailures(titleId, sources, results);
  return results.map(ReadSettledMetadata);
}

function ReportMetadataSourceFailures(titleId, sources, results) {
  for (let index = 0; index < results.length; index++) {
    if (results[index].status === "rejected")
      console.warn(`${titleId} ${sources[index].name} metadata failed: ${results[index].reason?.message || results[index].reason}`);
  }
}

function ReadSettledMetadata(result) {
  return result.status === "fulfilled" ? result.value : null;
}

function BuildMetadataIdentity(titleId, options, tmdb, cached) {
  return {
    titleId,
    mediaType: options.mediaType === TvMediaType ? TvMediaType : MovieMediaType,
    tmdbId: Number(tmdb?.tmdbId || cached?.tmdbId) || null
  };
}

function BuildVisualMetadata(tmdb, cached, titlePage, suggestion) {
  return {
    posterUrl: tmdb?.posterUrl || cached?.posterUrl || titlePage?.posterUrl || suggestion?.posterUrl || "",
    synopsis: tmdb?.synopsis || cached?.synopsis || titlePage?.synopsis || "",
    actors: FirstActorList(tmdb?.actors, cached?.actors, titlePage?.actors, suggestion?.actors),
    trailerUrl: FirstTrailerUrl(tmdb?.trailerUrl, cached?.trailerUrl, titlePage?.trailerUrl)
  };
}

function BuildSeriesMetadata(tmdb, cached) {
  return {
    seriesStatus: tmdb?.seriesStatus || cached?.seriesStatus || "",
    seasonCount: Number(tmdb?.seasonCount || cached?.seasonCount) || 0,
    episodeCount: Number(tmdb?.episodeCount || cached?.episodeCount) || 0,
    episodeRuntimeMinutes: Number(tmdb?.episodeRuntimeMinutes || cached?.episodeRuntimeMinutes) || 0
  };
}

function BuildOriginMetadata(tmdb, cached) {
  const cachedOrigins = Array.isArray(cached?.originCountries) ? cached.originCountries : [];
  return {
    originCountries: Array.isArray(tmdb?.originCountries) ? tmdb.originCountries : cachedOrigins,
    originalLanguage: tmdb?.originalLanguage || cached?.originalLanguage || ""
  };
}

function BuildMetadataProvenance(tmdb, cached, titlePage, suggestion) {
  return {
    source: tmdb?.source || cached?.source || titlePage?.source || suggestion?.source || "",
    sourcePayload: ReadPreferredSourcePayload(tmdb, cached),
    metadataCheckedAt: tmdb ? new Date().toISOString() : cached?.metadataCheckedAt || ""
  };
}

function ReadPreferredSourcePayload(primary, fallback) {
  if (IsRecord(primary?.sourcePayload))
    return primary.sourcePayload;
  return IsRecord(fallback?.sourcePayload) ? fallback.sourcePayload : {};
}

function ShouldUseCachedMetadata(metadata, options) {
  if (!metadata || !HasMetadataPayload(metadata))
    return false;
  if (!Array.isArray(metadata.actors))
    return false;
  if (typeof metadata.trailerUrl !== "string")
    return false;
  if (options.mediaType === TvMediaType && (metadata.mediaType !== TvMediaType || !("seriesStatus" in metadata)))
    return false;
  if (!ReadTmdbApiKey(options))
    return true;
  if (metadata.source !== TmdbSource || !metadata.metadataCheckedAt)
    return false;
  return IsMetadataFresh(metadata);
}

function IsMetadataFresh(metadata) {
  const checkedAt = new Date(metadata.metadataCheckedAt);
  const seriesStatus = String(metadata.seriesStatus || "").toLowerCase();
  const isActiveSeries = metadata.mediaType === TvMediaType && !["ended", "canceled"].includes(seriesStatus);
  const ttl = isActiveSeries ? ActiveTvMetadataTtlMilliseconds : MovieMetadataTtlMilliseconds;
  const age = Date.now() - checkedAt.getTime();
  return Number.isFinite(age) && age >= 0 && age < ttl;
}

function HasMetadataPayload(metadata) {
  const hasActors = Array.isArray(metadata?.actors) && metadata.actors.length;
  return Boolean(metadata?.metadataCheckedAt || metadata?.posterUrl || metadata?.synopsis || metadata?.trailerUrl || metadata?.source || hasActors);
}

async function FetchTmdbMetadata(titleId, options, cached) {
  const apiKey = ReadTmdbApiKey(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!apiKey)
    throw new Error("TMDB_API_KEY is not configured.");
  const knownTmdbId = Number(cached?.tmdbId);
  if (Number.isInteger(knownTmdbId) && knownTmdbId > 0)
    return FetchKnownTmdbMetadata(options.mediaType, knownTmdbId, apiKey, fetchImpl);
  return FetchFoundTmdbMetadata(titleId, options.mediaType, apiKey, fetchImpl);
}

async function FetchKnownTmdbMetadata(mediaType, tmdbId, apiKey, fetchImpl) {
  const extras = await FetchTmdbExtras(mediaType, tmdbId, apiKey, fetchImpl);
  return BuildTmdbMetadata(extras, extras, mediaType, tmdbId);
}

async function FetchFoundTmdbMetadata(titleId, mediaType, apiKey, fetchImpl) {
  const response = await fetchImpl(BuildTmdbFindUrl(titleId, apiKey), { headers: BuildTmdbHeaders(apiKey) });
  if (!response.ok)
    throw new Error(`TMDB returned HTTP ${response.status}.`);
  const payload = await response.json();
  const result = FindTmdbResult(payload, mediaType);
  if (!result)
    throw new Error("TMDB did not find this IMDb title.");
  const extras = await FetchTmdbExtras(result.mediaType, result.item.id, apiKey, fetchImpl);
  return BuildTmdbMetadata(result.item, extras, result.mediaType, Number(result.item.id));
}

function BuildTmdbFindUrl(titleId, apiKey) {
  const params = BuildTmdbFindParams(apiKey);
  return `${TmdbApiUrl}/find/${titleId}?${params}`;
}

function BuildTmdbFindParams(apiKey) {
  const params = new URLSearchParams({ external_source: "imdb_id", language: TmdbLanguage });
  AddTmdbApiKey(params, apiKey);
  return params;
}

function ReadTmdbApiKey(options) {
  return String(options?.tmdbApiKey || "").trim();
}

function FindTmdbResult(payload, expectedMediaType) {
  const values = expectedMediaType === TvMediaType ? payload?.tv_results : payload?.movie_results;
  if (!Array.isArray(values) || !values[0])
    return null;
  return { item: values[0], mediaType: expectedMediaType };
}

async function FetchTmdbExtras(mediaType, id, apiKey, fetchImpl = globalThis.fetch) {
  if (!Number.isInteger(Number(id)))
    return { actors: [], trailerUrl: "" };
  const params = new URLSearchParams({ language: TmdbLanguage, append_to_response: "credits,videos" });
  AddTmdbApiKey(params, apiKey);
  const response = await fetchImpl(`${TmdbApiUrl}/${mediaType}/${id}?${params}`, { headers: BuildTmdbHeaders(apiKey) });
  if (!response.ok)
    throw new Error(`TMDB details returned HTTP ${response.status}.`);
  const payload = await response.json();
  return NormalizeTmdbDetails(mediaType, payload);
}

export function NormalizeTmdbDetails(mediaType, payload) {
  return {
    ...NormalizeTmdbCoreDetails(payload),
    ...NormalizeTmdbSeriesDetails(payload),
    sourcePayload: IsRecord(payload) ? payload : {},
    ...NormalizeTmdbOrigin(mediaType, null, payload)
  };
}

function NormalizeTmdbCoreDetails(payload) {
  return {
    poster_path: payload?.poster_path || "",
    overview: CleanMetadataText(payload?.overview || ""),
    original_language: NormalizeLanguageCode(payload?.original_language),
    actors: ReadActorNames(payload?.credits?.cast),
    trailerUrl: PickTmdbTrailerUrl(payload?.videos?.results)
  };
}

function NormalizeTmdbSeriesDetails(payload) {
  return {
    seriesStatus: CleanMetadataText(payload?.status || ""),
    seasonCount: Number(payload?.number_of_seasons) || 0,
    episodeCount: Number(payload?.number_of_episodes) || 0,
    episodeRuntimeMinutes: ReadEpisodeRuntime(payload)
  };
}

export function BuildTmdbMetadata(item, extras, mediaType, tmdbId) {
  return {
    mediaType,
    tmdbId: Number(tmdbId) || null,
    ...BuildTmdbCoreMetadata(item, extras),
    ...BuildTmdbSeriesMetadata(extras),
    ...BuildTmdbOriginMetadata(item, extras),
    source: TmdbSource,
    sourcePayload: ReadTmdbSourcePayload(item, extras)
  };
}

function ReadTmdbSourcePayload(item, extras) {
  if (IsRecord(extras.sourcePayload))
    return extras.sourcePayload;
  return IsRecord(item) ? item : {};
}

function BuildTmdbCoreMetadata(item, extras) {
  return {
    posterUrl: BuildTmdbPosterUrl(extras.poster_path || item.poster_path),
    synopsis: CleanMetadataText(extras.overview || item.overview || ""),
    actors: ReadActorNames(extras.actors),
    trailerUrl: NormalizeTrailerUrl(extras.trailerUrl)
  };
}

function BuildTmdbSeriesMetadata(extras) {
  return {
    seriesStatus: extras.seriesStatus || "",
    seasonCount: Number(extras.seasonCount) || 0,
    episodeCount: Number(extras.episodeCount) || 0,
    episodeRuntimeMinutes: Number(extras.episodeRuntimeMinutes) || 0
  };
}

function BuildTmdbOriginMetadata(item, extras) {
  return {
    originCountries: Array.isArray(extras.originCountries) ? extras.originCountries : [],
    originalLanguage: extras.originalLanguage || NormalizeLanguageCode(item.original_language)
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

async function FetchTitlePageMetadata(titleId, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`https://www.imdb.com/title/${titleId}/`, { headers: BuildTitleHeaders() });
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

async function FetchSuggestionMetadata(titleId, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(BuildSuggestionUrl(titleId), { headers: BuildSuggestionHeaders() });
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
    const rawName = actor && typeof actor === ObjectType ? actor.name : actor;
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
  const youtubeVideos = videos.filter((video) => String(video?.site || "").toLowerCase() === "youtube" && /^[a-z0-9_-]+$/i.test(String(video?.key || "")));
  const candidates = youtubeVideos.map((video, index) => ({ video, index, score: ScoreTmdbTrailer(video) }));
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  const key = String(candidates[0]?.video?.key || "");
  return key ? `https://www.youtube.com/watch?v=${encodeURIComponent(key)}` : "";
}

export function NormalizeTrailerUrl(value) {
  const rawUrl = String(value || "");
  if (!URL.canParse(rawUrl))
    return "";
  const url = new URL(rawUrl);
  return ["http:", "https:"].includes(url.protocol) ? url.href : "";
}

function ScoreTmdbTrailer(video) {
  const type = String(video?.type || "").toLowerCase();
  const name = String(video?.name || "").toLowerCase();
  let score = { trailer: 100, teaser: 50 }[type] || 0;
  if (video?.official)
    score += 25;
  if (name.includes("official"))
    score += 10;
  return score;
}

function ReadImdbTrailerUrl(value) {
  const trailer = value && typeof value === ObjectType ? value : {};
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
    [AcceptHeader]: "application/json",
    [UserAgentHeader]: "Mozilla/5.0"
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
    ...BuildMergedIdentity(database, local, mediaType),
    ...BuildMergedVisualMetadata(database, local),
    ...BuildMergedSeriesMetadata(database, local),
    ...BuildMergedProvenance(database, local),
    streamingByCountry: MergeStreamingCountries(database, local)
  };
}

function BuildMergedIdentity(database, local, mediaType) {
  return {
    titleId: database.titleId || local.titleId || "",
    mediaType,
    tmdbId: Number(database.tmdbId || local.tmdbId) || null,
    originCountries: ReadMergedOrigins(database, local),
    originalLanguage: database.originalLanguage || local.originalLanguage || ""
  };
}

function BuildMergedVisualMetadata(database, local) {
  return {
    posterUrl: database.posterUrl || local.posterUrl || "",
    synopsis: database.synopsis || local.synopsis || "",
    actors: FirstActorList(database.actors, local.actors),
    trailerUrl: FirstTrailerUrl(database.trailerUrl, local.trailerUrl)
  };
}

function BuildMergedSeriesMetadata(database, local) {
  return {
    seriesStatus: database.seriesStatus || local.seriesStatus || "",
    seasonCount: Number(database.seasonCount || local.seasonCount) || 0,
    episodeCount: Number(database.episodeCount || local.episodeCount) || 0,
    episodeRuntimeMinutes: Number(database.episodeRuntimeMinutes || local.episodeRuntimeMinutes) || 0
  };
}

function BuildMergedProvenance(database, local) {
  const databasePayload = IsRecord(database.sourcePayload) && Object.keys(database.sourcePayload).length;
  return {
    source: database.source || local.source || "",
    metadataCheckedAt: database.metadataCheckedAt || local.metadataCheckedAt || "",
    sourcePayload: databasePayload ? database.sourcePayload : ReadLocalSourcePayload(local)
  };
}

function ReadLocalSourcePayload(metadata) {
  return IsRecord(metadata.sourcePayload) ? metadata.sourcePayload : {};
}

function ReadMergedOrigins(database, local) {
  if (Array.isArray(database.originCountries) && database.originCountries.length)
    return database.originCountries;
  return Array.isArray(local.originCountries) ? local.originCountries : [];
}

function MergeStreamingCountries(database, local) {
  return { ...(IsRecord(local.streamingByCountry) ? local.streamingByCountry : {}), ...(IsRecord(database.streamingByCountry) ? database.streamingByCountry : {}) };
}

async function PersistMetadata(metadata, store) {
  if (!metadata?.titleId)
    return;
  MetadataCache[metadata.titleId] = BuildLocalMetadataEntry(metadata);
  ScheduleCacheWrite();
  if (!store?.upsertMetadata)
    return;
  try {
    await store.upsertMetadata(metadata);
  } catch (error) {
    console.warn(`${metadata.titleId} PostgreSQL metadata write failed: ${error.message}`);
  }
}

function BuildLocalMetadataEntry(metadata) {
  const entry = { ...metadata };
  delete entry.sourcePayload;
  return entry;
}

async function ResolveStreamingAvailability(metadata, options) {
  const country = ReadStreamingCountry(options.streamingCountry);
  const cached = IsRecord(metadata?.streamingByCountry) ? metadata.streamingByCountry[country] : null;
  const service = options.streamingAvailabilityService || StreamingAvailabilityService;
  if (!service?.get)
    return cached || null;
  try {
    return await service.get(BuildStreamingRequest(metadata, options, country, cached));
  } catch (error) {
    console.warn(`${metadata.titleId} streaming availability failed: ${error.message}`);
    return cached ? { ...cached, stale: true } : null;
  }
}

function BuildStreamingRequest(metadata, options, country, cached) {
  return {
    mediaType: metadata.mediaType,
    tmdbId: metadata.tmdbId,
    apiKey: ReadTmdbApiKey(options),
    country,
    cached,
    persist: (availability) => PersistStreamingAvailability(metadata, country, availability, options.metadataStore)
  };
}

async function PersistStreamingAvailability(metadata, country, availability, store) {
  const current = BuildLocalMetadataEntry(MetadataCache[metadata.titleId] || metadata);
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
  const payload = { ...metadata };
  for (const field of PrivateMetadataFields)
    delete payload[field];
  return { ok: true, ...payload, streamingAvailability };
}

function IsRecord(value) {
  return value && typeof value === ObjectType && !Array.isArray(value);
}

function BuildTitleHeaders() {
  return {
    [AcceptHeader]: "text/html,application/xhtml+xml",
    "accept-language": "en-US,en;q=0.9",
    [UserAgentHeader]: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
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
  const isMovie = item?.[MetadataTypeAttribute] === "Movie";
  const isSeries = item?.[MetadataTypeAttribute] === "TVSeries";
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
  let decoded = String(value || "");
  decoded = decoded.replace(/&quot;/g, "\"");
  decoded = decoded.replace(/&#39;|&apos;/g, "'");
  decoded = decoded.replace(/&amp;/g, "&");
  decoded = decoded.replace(/&lt;/g, "<");
  return decoded.replace(/&gt;/g, ">");
}

function LoadMetadataCache() {
  if (!existsSync(CachePath))
    return {};
  try {
    const parsed = JSON.parse(readFileSync(CachePath, TextEncoding));
    return parsed && typeof parsed === ObjectType ? parsed : {};
  } catch (error) {
    console.warn(`Title metadata cache read failed at ${CachePath}: ${error.message}`);
    return {};
  }
}

function ScheduleCacheWrite() {
  clearTimeout(CacheWriteTimer);
  CacheWriteTimer = setTimeout(() => WriteMetadataCache().catch(ReportMetadataCacheWriteFailure), 500);
}

function ReportMetadataCacheWriteFailure(error) {
  console.warn(`Title metadata cache write failed at ${CachePath}: ${error.message}`);
}

async function WriteMetadataCache() {
  EnsureUserDataParent(CachePath);
  const temporaryPath = `${CachePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(MetadataCache, null, 2)}\n`, TextEncoding);
  await rename(temporaryPath, CachePath);
}

function BuildTitleMetadataCachePath() {
  const cachePath = BuildUserDataPath(CacheDirectoryName, MetadataCacheFileName);
  MigrateLegacyFile(path.join(RootPath, CacheDirectoryName, MetadataCacheFileName), cachePath);
  return cachePath;
}

function Ok(payload) {
  return {
    status: 200,
    payload
  };
}
