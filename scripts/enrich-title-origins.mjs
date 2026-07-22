import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NormalizeTmdbOrigin } from "../shared/title-filters.js";
import { LoadLocalEnv } from "../server/env.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DataDir = path.join(RootPath, "data");
const CacheDir = path.join(RootPath, "cache");
const CachePath = path.join(CacheDir, "tmdb-title-origins.json");
const TmdbApiUrl = "https://api.themoviedb.org/3";
const MatchedStatus = "matched";
const NotFoundStatus = "not-found";
const RetryAttempts = 5;
const RetryMaximumMilliseconds = 15_000;
const RetryBaseMilliseconds = 500;
const CheckpointInterval = 250;
const DefaultConcurrency = 12;
const TextEncoding = "utf8";
const TvMediaType = "tv";
const EnglishLanguage = "en-US";
const CatalogDefinitions = [
  { mediaType: "movie", fileName: "movies.json", collectionKey: "movies" },
  { mediaType: TvMediaType, fileName: "shows.json", collectionKey: "shows" }
];
Object.freeze(CatalogDefinitions);

if (IsMainModule())
  await Main();

async function Main() {
  process.env.IMDB_RAPID_RATER_HOME ||= path.join(RootPath, ".runtime");
  LoadLocalEnv(RootPath);
  const apiKey = ReadApiKey();
  if (!apiKey)
    throw new Error("TMDB_BUILD_API_KEY is required to enrich title origins.");
  const catalogs = await ReadCatalogs();
  const cache = await ReadCache();
  const pending = BuildPendingTitles(catalogs, cache);
  console.log(`Origin cache has ${Object.keys(cache).length.toLocaleString()} titles; ${pending.length.toLocaleString()} need TMDB lookup.`);
  await EnrichPendingTitles(pending, cache, apiKey);
  ValidateCatalogOriginCoverage(catalogs, cache);
  await WriteCache(cache);
  await WriteCatalogs(catalogs, cache);
}

async function ReadCatalogs() {
  const catalogs = [];
  for (const definition of CatalogDefinitions) {
    const filePath = path.join(DataDir, definition.fileName);
    if (!existsSync(filePath))
      throw new Error(`${definition.fileName} is missing. Run npm run build:data first.`);
    const payload = JSON.parse(await readFile(filePath, TextEncoding));
    const titles = Array.isArray(payload[definition.collectionKey]) ? payload[definition.collectionKey] : [];
    catalogs.push({ ...definition, filePath, payload, titles });
  }
  return catalogs;
}

async function ReadCache() {
  try {
    const payload = JSON.parse(await readFile(CachePath, TextEncoding));
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function BuildPendingTitles(catalogs, cache) {
  return catalogs.flatMap((catalog) => BuildCatalogPendingTitles(catalog, cache));
}

function BuildCatalogPendingTitles(catalog, cache) {
  const pending = [];
  for (const title of catalog.titles) {
    if (IsReusableCacheEntry(cache[title.ttId], catalog.mediaType))
      continue;
    pending.push({ ttId: title.ttId, mediaType: catalog.mediaType });
  }
  return pending;
}

async function EnrichPendingTitles(pending, cache, apiKey) {
  const concurrency = ReadConcurrency();
  const workerCount = Math.min(concurrency, Math.max(1, pending.length));
  const state = { nextIndex: 0, completed: 0, checkpoint: Promise.resolve() };
  const workers = Array.from({ length: workerCount }, () => RunOriginWorker(pending, cache, apiKey, state));
  await Promise.all(workers);
  await state.checkpoint;
}

async function RunOriginWorker(pending, cache, apiKey, state) {
  while (state.nextIndex < pending.length) {
    const item = pending[state.nextIndex++];
    await EnrichTitle(item, cache, apiKey);
    state.completed++;
    await WriteCheckpointIfNeeded(pending.length, cache, state);
  }
}

async function EnrichTitle(item, cache, apiKey) {
  try {
    cache[item.ttId] = await FetchTitleOrigin(item, apiKey);
  } catch (error) {
    console.warn(`${item.ttId} origin lookup failed: ${error.message}`);
  }
}

async function WriteCheckpointIfNeeded(total, cache, state) {
  if (state.completed % CheckpointInterval !== 0)
    return;
  console.log(`Resolved ${state.completed.toLocaleString()} of ${total.toLocaleString()} origin lookups.`);
  state.checkpoint = state.checkpoint.then(() => WriteCache(cache));
  await state.checkpoint;
}

async function FetchTitleOrigin(item, apiKey) {
  const find = await FetchTmdbJson(BuildFindUrl(item.ttId, apiKey), apiKey);
  const result = PickFindResult(find, item.mediaType);
  const checkedAt = new Date().toISOString();
  if (!result)
    return { mediaType: item.mediaType, status: NotFoundStatus, tmdbId: null, originCountries: [], originalLanguage: "", checkedAt };
  const details = await FetchTmdbJson(BuildDetailsUrl(item.mediaType, result.id, apiKey), apiKey);
  return {
    mediaType: item.mediaType,
    status: MatchedStatus,
    tmdbId: Number(result.id),
    ...NormalizeTmdbOrigin(item.mediaType, result, details),
    checkedAt
  };
}

function PickFindResult(payload, mediaType) {
  const values = mediaType === TvMediaType ? payload?.tv_results : payload?.movie_results;
  if (!Array.isArray(values))
    return null;
  return values[0] || null;
}

async function FetchTmdbJson(url, apiKey) {
  let lastError;
  for (let attempt = 0; attempt < RetryAttempts; attempt++) {
    const result = await RequestTmdbAttempt(url, apiKey, attempt);
    if (Object.hasOwn(result, "payload"))
      return result.payload;
    lastError = result.error;
    if (attempt < RetryAttempts - 1)
      await Delay(result.delay);
  }
  throw lastError || new Error("TMDB request failed.");
}

async function RequestTmdbAttempt(url, apiKey, attempt) {
  try {
    const response = await fetch(url, { headers: BuildHeaders(apiKey) });
    if (response.ok)
      return { payload: await response.json() };
    return BuildFailedRequest(response, attempt);
  } catch (error) {
    return { error, delay: BuildRetryDelay(attempt) };
  }
}

function BuildFailedRequest(response, attempt) {
  const error = new Error(`TMDB returned HTTP ${response.status}`);
  if (response.status !== 429 && response.status < 500)
    return { error, delay: BuildRetryDelay(attempt) };
  const retryAfter = Number(response.headers.get("retry-after"));
  const hasRetryAfter = Number.isFinite(retryAfter) && retryAfter > 0;
  if (!hasRetryAfter)
    return { error, delay: BuildRetryDelay(attempt) };
  return { error, delay: retryAfter * 1000 };
}

function BuildRetryDelay(attempt) {
  return Math.min(RetryMaximumMilliseconds, RetryBaseMilliseconds * (2 ** attempt));
}

function BuildFindUrl(ttId, apiKey) {
  const params = new URLSearchParams({ external_source: "imdb_id", language: EnglishLanguage });
  AddApiKey(params, apiKey);
  return `${TmdbApiUrl}/find/${encodeURIComponent(ttId)}?${params}`;
}

function BuildDetailsUrl(mediaType, id, apiKey) {
  const params = new URLSearchParams({ language: EnglishLanguage });
  AddApiKey(params, apiKey);
  return `${TmdbApiUrl}/${mediaType}/${encodeURIComponent(id)}?${params}`;
}

function AddApiKey(params, apiKey) {
  if (!IsBearerToken(apiKey))
    params.set("api_key", apiKey);
}

function BuildHeaders(apiKey) {
  const headers = { accept: "application/json" };
  if (!IsBearerToken(apiKey))
    return headers;
  return { ...headers, authorization: `Bearer ${apiKey}` };
}

function IsBearerToken(value) {
  return String(value || "").includes(".");
}

function IsReusableCacheEntry(entry, mediaType) {
  return entry?.mediaType === mediaType && [MatchedStatus, NotFoundStatus].includes(entry?.status);
}

export function ValidateCatalogOriginCoverage(catalogs, cache) {
  for (const catalog of catalogs) {
    if (!catalog.titles.length)
      continue;
    const knownTitles = catalog.titles.filter((title) => HasKnownOrigin(cache[title.ttId], catalog.mediaType)).length;
    if (!knownTitles)
      throw new Error(`TMDB origin enrichment produced no usable ${catalog.mediaType} metadata; refusing to write an empty filter catalog.`);
  }
}

function HasKnownOrigin(entry, mediaType) {
  return IsReusableCacheEntry(entry, mediaType) && (entry.originCountries?.length || entry.originalLanguage);
}

async function WriteCatalogs(catalogs, cache) {
  for (const catalog of catalogs) {
    const enriched = BuildEnrichedCatalog(catalog, cache);
    await writeFile(catalog.filePath, `${JSON.stringify(enriched.payload, null, 2)}\n`, TextEncoding);
    console.log(`Wrote origin metadata for ${enriched.knownTitles.toLocaleString()} of ${enriched.titles.length.toLocaleString()} titles to ${catalog.fileName}.`);
  }
}

function BuildEnrichedCatalog(catalog, cache) {
  const state = { knownTitles: 0 };
  const titles = catalog.titles.map((title) => EnrichCatalogTitle(title, catalog.mediaType, cache, state));
  return {
    titles,
    knownTitles: state.knownTitles,
    payload: BuildCatalogPayload(catalog, titles, state.knownTitles)
  };
}

function EnrichCatalogTitle(title, mediaType, cache, state) {
  const entry = cache[title.ttId];
  if (!IsReusableCacheEntry(entry, mediaType))
    return title;
  if (entry.originCountries?.length || entry.originalLanguage)
    state.knownTitles++;
  return {
    ...title,
    originCountries: Array.isArray(entry.originCountries) ? entry.originCountries : [],
    originalLanguage: String(entry.originalLanguage || "")
  };
}

function BuildCatalogPayload(catalog, titles, knownTitles) {
  return {
    ...catalog.payload,
    originMetadata: {
      source: "The Movie Database (TMDB)",
      generatedAt: new Date().toISOString(),
      knownTitles,
      totalTitles: titles.length
    },
    [catalog.collectionKey]: titles
  };
}

async function WriteCache(cache) {
  await mkdir(CacheDir, { recursive: true });
  const temporaryPath = `${CachePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, TextEncoding);
  await rename(temporaryPath, CachePath);
}

function ReadApiKey() {
  return String(process.env.TMDB_BUILD_API_KEY || "").trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function ReadConcurrency() {
  const value = Number(process.env.TMDB_ORIGIN_CONCURRENCY || DefaultConcurrency);
  if (!Number.isInteger(value) || value < 1 || value > 24)
    return DefaultConcurrency;
  return value;
}

function Delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function IsMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
