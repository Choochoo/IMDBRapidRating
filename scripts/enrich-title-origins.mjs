import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CreateDatabase } from "../server/db/client.mjs";
import { RunMigrations } from "../server/db/migrate.mjs";
import { CreateTitleMetadataStore } from "../server/title-metadata-store.mjs";
import { BuildTmdbMetadata, NormalizeTmdbDetails } from "../server/title-metadata.mjs";
import { AddTmdbApiKey, BuildTmdbHeaders, TmdbApiUrl } from "../server/tmdb-request.mjs";
import { NormalizeTmdbOrigin } from "../shared/title-filters.js";
import { LoadLocalEnv } from "../server/env.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DataDir = path.join(RootPath, "data");
const CacheDir = path.join(RootPath, "cache");
const CachePath = path.join(CacheDir, "tmdb-title-origins.json");
const MatchedStatus = "matched";
const NotFoundStatus = "not-found";
const RetryAttempts = 5;
const RetryMaximumMilliseconds = 15_000;
const RetryBaseMilliseconds = 500;
const NegativeCacheTtlMilliseconds = 30 * 24 * 60 * 60 * 1000;
const CheckpointInterval = 250;
const DefaultConcurrency = 12;
const TextEncoding = "utf8";
const TvMediaType = "tv";
const EnglishLanguage = "en-US";
const UnauthorizedStatus = 401;
const ForbiddenStatus = 403;
const TooManyRequestsStatus = 429;
const ServerErrorStatus = 500;
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
  const { pool } = CreateDatabase();
  try {
    await RunEnrichment(pool, apiKey);
  } finally {
    await pool.end();
  }
}

async function RunEnrichment(pool, apiKey) {
  await RunMigrations(pool);
  const state = await BuildEnrichmentState(pool);
  ReportEnrichmentState(state);
  await EnrichPendingTitles(state.pending, state.cache, apiKey, state.store);
  ValidateHydrationComplete(state.catalogs, state.cache);
  ValidateCatalogOriginCoverage(state.catalogs, state.cache);
  await WriteCache(state.cache);
  await WriteCatalogs(state.catalogs, state.cache);
}

async function BuildEnrichmentState(pool) {
  const catalogs = await ReadCatalogs();
  const localCache = await ReadCache();
  const store = CreateTitleMetadataStore(pool);
  const titleReferences = BuildTitleReferences(catalogs);
  const databaseCache = await store.readHydrationState(titleReferences);
  const localImports = BuildLocalCacheImports(titleReferences, localCache, databaseCache);
  if (localImports.length)
    await store.upsertOrigins(localImports);
  const cache = { ...localCache, ...databaseCache };
  return { catalogs, store, databaseCache, localImports, cache, pending: BuildPendingTitles(catalogs, cache) };
}

function ReportEnrichmentState(state) {
  const cachedCount = Object.keys(state.databaseCache).length.toLocaleString();
  const importedCount = state.localImports.length.toLocaleString();
  const pendingCount = state.pending.length.toLocaleString();
  console.log(`PostgreSQL metadata cache has ${cachedCount} catalog titles; imported ${importedCount} local origins; ${pendingCount} need full TMDB metadata.`);
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
  } catch (error) {
    if (error?.code !== "ENOENT")
      console.warn(`TMDB origin cache read failed at ${CachePath}: ${error.message}`);
    return {};
  }
}

function BuildTitleReferences(catalogs) {
  return catalogs.flatMap((catalog) => catalog.titles.map((title) => ({ ttId: title.ttId, mediaType: catalog.mediaType })));
}

function BuildLocalCacheImports(titleReferences, localCache, databaseCache) {
  return titleReferences.flatMap((item) => {
    if (IsReusableCacheEntry(databaseCache[item.ttId], item.mediaType))
      return [];
    const entry = localCache[item.ttId];
    return IsReusableCacheEntry(entry, item.mediaType) ? [{ ttId: item.ttId, ...entry }] : [];
  });
}

export function BuildPendingTitles(catalogs, cache) {
  return catalogs.flatMap((catalog) => BuildCatalogPendingTitles(catalog, cache));
}

function BuildCatalogPendingTitles(catalog, cache) {
  const pending = [];
  for (const title of catalog.titles) {
    if (IsFullyHydratedCacheEntry(cache[title.ttId], catalog.mediaType))
      continue;
    pending.push({ ttId: title.ttId, mediaType: catalog.mediaType });
  }
  return pending;
}

async function EnrichPendingTitles(pending, cache, apiKey, originStore) {
  const concurrency = ReadConcurrency();
  const workerCount = Math.min(concurrency, Math.max(1, pending.length));
  const state = { nextIndex: 0, completed: 0, checkpoint: Promise.resolve(), pendingEntries: [] };
  const workers = Array.from({ length: workerCount }, () => RunOriginWorker(pending, cache, apiKey, originStore, state));
  await Promise.all(workers);
  await state.checkpoint;
  await FlushCheckpoint(cache, originStore, state);
}

async function RunOriginWorker(pending, cache, apiKey, originStore, state) {
  while (state.nextIndex < pending.length) {
    const item = pending[state.nextIndex++];
    const entry = await EnrichTitle(item, cache, apiKey);
    if (entry)
      state.pendingEntries.push({ ttId: item.ttId, ...entry });
    state.completed++;
    await WriteCheckpointIfNeeded(pending.length, cache, originStore, state);
  }
}

async function EnrichTitle(item, cache, apiKey) {
  try {
    const entry = await FetchTitleMetadata(item, cache[item.ttId], apiKey);
    cache[item.ttId] = BuildOriginCacheEntry(entry);
    return entry;
  } catch (error) {
    if (error.abortEnrichment)
      throw error;
    console.warn(`${item.ttId} metadata lookup failed: ${error.message}`);
    return null;
  }
}

async function WriteCheckpointIfNeeded(total, cache, originStore, state) {
  if (state.completed % CheckpointInterval !== 0)
    return;
  console.log(`Resolved ${state.completed.toLocaleString()} of ${total.toLocaleString()} origin lookups.`);
  await FlushCheckpoint(cache, originStore, state);
}

async function FlushCheckpoint(cache, originStore, state) {
  const entries = state.pendingEntries.splice(0);
  if (!entries.length)
    return;
  state.checkpoint = state.checkpoint.then(async () => {
    await PersistCheckpointEntries(originStore, entries);
    await WriteCache(cache);
  });
  await state.checkpoint;
}

async function PersistCheckpointEntries(store, entries) {
  const metadata = entries.filter((entry) => entry.status === MatchedStatus);
  const origins = entries.filter((entry) => entry.status === NotFoundStatus);
  await store.upsertMetadataBatch(metadata);
  await store.upsertOrigins(origins);
}

async function FetchTitleMetadata(item, cached, apiKey) {
  const result = await ResolveTmdbResult(item, cached, apiKey);
  const checkedAt = new Date().toISOString();
  if (!result)
    return { mediaType: item.mediaType, status: NotFoundStatus, tmdbId: null, originCountries: [], originalLanguage: "", checkedAt };
  const details = await FetchTmdbJson(BuildDetailsUrl(item.mediaType, result.id, apiKey), apiKey);
  const origin = BuildMatchedOrigin(item, result, details, checkedAt);
  const extras = NormalizeTmdbDetails(item.mediaType, details);
  return { titleId: item.ttId, ...origin, ...BuildTmdbMetadata(details, extras, item.mediaType, result.id), metadataCheckedAt: checkedAt };
}

async function ResolveTmdbResult(item, cached, apiKey) {
  const knownTmdbId = Number(cached?.tmdbId);
  if (Number.isInteger(knownTmdbId) && knownTmdbId > 0)
    return { id: knownTmdbId };
  const find = await FetchTmdbJson(BuildFindUrl(item.ttId, apiKey), apiKey);
  return PickFindResult(find, item.mediaType);
}

function BuildMatchedOrigin(item, result, details, checkedAt) {
  return {
    mediaType: item.mediaType,
    status: MatchedStatus,
    tmdbId: Number(result.id),
    ...NormalizeTmdbOrigin(item.mediaType, result, details),
    checkedAt
  };
}

function BuildOriginCacheEntry(entry) {
  return {
    mediaType: entry.mediaType,
    status: entry.status,
    tmdbId: entry.tmdbId,
    originCountries: entry.originCountries,
    originalLanguage: entry.originalLanguage,
    checkedAt: entry.checkedAt,
    metadataCheckedAt: entry.metadataCheckedAt || ""
  };
}

function PickFindResult(payload, mediaType) {
  const values = mediaType === TvMediaType ? payload?.tv_results : payload?.movie_results;
  if (!Array.isArray(values))
    return null;
  return values[0] || null;
}

export async function FetchTmdbJson(url, apiKey, fetchImpl = globalThis.fetch, delayImpl = Delay) {
  let lastError;
  for (let attempt = 0; attempt < RetryAttempts; attempt++) {
    const result = await RequestTmdbAttempt(url, apiKey, attempt, fetchImpl);
    if (Object.hasOwn(result, "payload"))
      return result.payload;
    lastError = result.error;
    if (!result.retryable)
      throw lastError;
    if (attempt < RetryAttempts - 1)
      await delayImpl(result.delay);
  }
  throw lastError || new Error("TMDB request failed.");
}

async function RequestTmdbAttempt(url, apiKey, attempt, fetchImpl) {
  try {
    const response = await fetchImpl(url, { headers: BuildTmdbHeaders(apiKey) });
    if (response.ok)
      return { payload: await response.json() };
    return BuildFailedRequest(response, attempt);
  } catch (error) {
    return { error, retryable: true, delay: BuildRetryDelay(attempt) };
  }
}

function BuildFailedRequest(response, attempt) {
  const error = BuildTmdbHttpError(response.status);
  if (response.status !== TooManyRequestsStatus && response.status < ServerErrorStatus)
    return { error, retryable: false, delay: 0 };
  const retryAfter = Number(response.headers.get("retry-after"));
  const hasRetryAfter = Number.isFinite(retryAfter) && retryAfter > 0;
  if (!hasRetryAfter)
    return { error, retryable: true, delay: BuildRetryDelay(attempt) };
  return { error, retryable: true, delay: retryAfter * 1000 };
}

function BuildTmdbHttpError(status) {
  const error = new Error(`TMDB returned HTTP ${status}`);
  error.abortEnrichment = status === UnauthorizedStatus || status === ForbiddenStatus;
  return error;
}

function BuildRetryDelay(attempt) {
  return Math.min(RetryMaximumMilliseconds, RetryBaseMilliseconds * (2 ** attempt));
}

function BuildFindUrl(ttId, apiKey) {
  const params = new URLSearchParams({ external_source: "imdb_id", language: EnglishLanguage });
  AddTmdbApiKey(params, apiKey);
  return `${TmdbApiUrl}/find/${encodeURIComponent(ttId)}?${params}`;
}

function BuildDetailsUrl(mediaType, id, apiKey) {
  const params = new URLSearchParams({ language: EnglishLanguage, append_to_response: "credits,videos" });
  AddTmdbApiKey(params, apiKey);
  return `${TmdbApiUrl}/${mediaType}/${encodeURIComponent(id)}?${params}`;
}

function IsReusableCacheEntry(entry, mediaType) {
  return entry?.mediaType === mediaType && [MatchedStatus, NotFoundStatus].includes(entry?.status);
}

function IsFullyHydratedCacheEntry(entry, mediaType) {
  if (!IsReusableCacheEntry(entry, mediaType))
    return false;
  if (entry.status === NotFoundStatus)
    return IsFreshNegativeCacheEntry(entry);
  return Number.isInteger(Number(entry.tmdbId)) && Boolean(entry.metadataCheckedAt);
}

function IsFreshNegativeCacheEntry(entry) {
  const age = Date.now() - Date.parse(entry.checkedAt || "");
  return Number.isFinite(age) && age >= 0 && age < NegativeCacheTtlMilliseconds;
}

export function ValidateHydrationComplete(catalogs, cache) {
  const unresolved = BuildPendingTitles(catalogs, cache);
  if (!unresolved.length)
    return;
  throw new Error(`TMDB metadata enrichment left ${unresolved.length.toLocaleString()} catalog titles unresolved; the saved checkpoint can resume them on the next run.`);
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
