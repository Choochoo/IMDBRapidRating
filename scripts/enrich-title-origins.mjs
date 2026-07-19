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
const CatalogDefinitions = Object.freeze([
  { mediaType: "movie", fileName: "movies.json", collectionKey: "movies" },
  { mediaType: "tv", fileName: "shows.json", collectionKey: "shows" }
]);

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
  await WriteCache(cache);
  await WriteCatalogs(catalogs, cache);
}

async function ReadCatalogs() {
  const catalogs = [];
  for (const definition of CatalogDefinitions) {
    const filePath = path.join(DataDir, definition.fileName);
    if (!existsSync(filePath))
      throw new Error(`${definition.fileName} is missing. Run npm run build:data first.`);
    const payload = JSON.parse(await readFile(filePath, "utf8"));
    const titles = Array.isArray(payload[definition.collectionKey]) ? payload[definition.collectionKey] : [];
    catalogs.push({ ...definition, filePath, payload, titles });
  }
  return catalogs;
}

async function ReadCache() {
  try {
    const payload = JSON.parse(await readFile(CachePath, "utf8"));
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function BuildPendingTitles(catalogs, cache) {
  return catalogs.flatMap((catalog) => catalog.titles
    .filter((title) => !IsReusableCacheEntry(cache[title.ttId], catalog.mediaType))
    .map((title) => ({ ttId: title.ttId, mediaType: catalog.mediaType })));
}

async function EnrichPendingTitles(pending, cache, apiKey) {
  const concurrency = ReadConcurrency();
  let nextIndex = 0;
  let completed = 0;
  let checkpoint = Promise.resolve();
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, pending.length)) }, async () => {
    while (nextIndex < pending.length) {
      const item = pending[nextIndex++];
      try {
        cache[item.ttId] = await FetchTitleOrigin(item, apiKey);
      } catch (error) {
        console.warn(`${item.ttId} origin lookup failed: ${error.message}`);
      }
      completed++;
      if (completed % 250 === 0) {
        console.log(`Resolved ${completed.toLocaleString()} of ${pending.length.toLocaleString()} origin lookups.`);
        checkpoint = checkpoint.then(() => WriteCache(cache));
        await checkpoint;
      }
    }
  });
  await Promise.all(workers);
  await checkpoint;
}

async function FetchTitleOrigin(item, apiKey) {
  const find = await FetchTmdbJson(BuildFindUrl(item.ttId, apiKey), apiKey);
  const result = PickFindResult(find, item.mediaType);
  const checkedAt = new Date().toISOString();
  if (!result)
    return { mediaType: item.mediaType, status: "not-found", tmdbId: null, originCountries: [], originalLanguage: "", checkedAt };
  const details = await FetchTmdbJson(BuildDetailsUrl(item.mediaType, result.id, apiKey), apiKey);
  return {
    mediaType: item.mediaType,
    status: "matched",
    tmdbId: Number(result.id),
    ...NormalizeTmdbOrigin(item.mediaType, result, details),
    checkedAt
  };
}

function PickFindResult(payload, mediaType) {
  const values = mediaType === "tv" ? payload?.tv_results : payload?.movie_results;
  return Array.isArray(values) ? values[0] || null : null;
}

async function FetchTmdbJson(url, apiKey) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, { headers: BuildHeaders(apiKey) });
      if (response.ok)
        return await response.json();
      lastError = new Error(`TMDB returned HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500)
        throw lastError;
      const retryAfter = Number(response.headers.get("retry-after"));
      await Delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(15_000, 500 * (2 ** attempt)));
    } catch (error) {
      lastError = error;
      if (attempt === 4)
        break;
      await Delay(Math.min(15_000, 500 * (2 ** attempt)));
    }
  }
  throw lastError || new Error("TMDB request failed.");
}

function BuildFindUrl(ttId, apiKey) {
  const params = new URLSearchParams({ external_source: "imdb_id", language: "en-US" });
  AddApiKey(params, apiKey);
  return `${TmdbApiUrl}/find/${encodeURIComponent(ttId)}?${params}`;
}

function BuildDetailsUrl(mediaType, id, apiKey) {
  const params = new URLSearchParams({ language: "en-US" });
  AddApiKey(params, apiKey);
  return `${TmdbApiUrl}/${mediaType}/${encodeURIComponent(id)}?${params}`;
}

function AddApiKey(params, apiKey) {
  if (!IsBearerToken(apiKey))
    params.set("api_key", apiKey);
}

function BuildHeaders(apiKey) {
  return IsBearerToken(apiKey) ? { accept: "application/json", authorization: `Bearer ${apiKey}` } : { accept: "application/json" };
}

function IsBearerToken(value) {
  return String(value || "").includes(".");
}

function IsReusableCacheEntry(entry, mediaType) {
  return entry?.mediaType === mediaType && ["matched", "not-found"].includes(entry?.status);
}

async function WriteCatalogs(catalogs, cache) {
  for (const catalog of catalogs) {
    let knownTitles = 0;
    const titles = catalog.titles.map((title) => {
      const entry = cache[title.ttId];
      if (!IsReusableCacheEntry(entry, catalog.mediaType))
        return title;
      if (entry.originCountries?.length || entry.originalLanguage)
        knownTitles++;
      return {
        ...title,
        originCountries: Array.isArray(entry.originCountries) ? entry.originCountries : [],
        originalLanguage: String(entry.originalLanguage || "")
      };
    });
    const payload = {
      ...catalog.payload,
      originMetadata: {
        source: "The Movie Database (TMDB)",
        generatedAt: new Date().toISOString(),
        knownTitles,
        totalTitles: titles.length
      },
      [catalog.collectionKey]: titles
    };
    await writeFile(catalog.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Wrote origin metadata for ${knownTitles.toLocaleString()} of ${titles.length.toLocaleString()} titles to ${catalog.fileName}.`);
  }
}

async function WriteCache(cache) {
  await mkdir(CacheDir, { recursive: true });
  const temporaryPath = `${CachePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporaryPath, CachePath);
}

function ReadApiKey() {
  return String(process.env.TMDB_BUILD_API_KEY || "").trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
}

function ReadConcurrency() {
  const value = Number(process.env.TMDB_ORIGIN_CONCURRENCY || 12);
  return Number.isInteger(value) && value >= 1 && value <= 24 ? value : 12;
}

function Delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function IsMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
