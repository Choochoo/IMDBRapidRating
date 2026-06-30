import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GetImdbCookie, GetTmdbApiKey } from "./env.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CachePath = path.join(RootPath, "cache", "title-metadata.json");
const TmdbApiUrl = "https://api.themoviedb.org/3";
const TmdbImageUrl = "https://image.tmdb.org/t/p/w342";
let CacheWriteTimer;
const MetadataCache = LoadMetadataCache();

export async function GetTitleMetadata(titleId) {
  if (ShouldUseCachedMetadata(MetadataCache[titleId]))
    return Ok({ ok: true, ...MetadataCache[titleId] });
  const metadata = await LoadTitleMetadata(titleId);
  MetadataCache[titleId] = metadata;
  ScheduleCacheWrite();
  return Ok({ ok: true, ...metadata });
}

async function LoadTitleMetadata(titleId) {
  const tmdb = await FetchTmdbMetadata(titleId).catch(() => null);
  const titlePage = await FetchTitlePageMetadata(titleId).catch(() => null);
  const suggestion = await FetchSuggestionMetadata(titleId).catch(() => null);
  return {
    titleId,
    posterUrl: tmdb?.posterUrl || titlePage?.posterUrl || suggestion?.posterUrl || "",
    synopsis: tmdb?.synopsis || titlePage?.synopsis || "",
    source: tmdb?.source || titlePage?.source || suggestion?.source || ""
  };
}

function ShouldUseCachedMetadata(metadata) {
  if (!metadata)
    return false;
  if (metadata.synopsis && metadata.posterUrl)
    return true;
  return !GetTmdbApiKey();
}

async function FetchTmdbMetadata(titleId) {
  const apiKey = GetTmdbApiKey();
  if (!apiKey)
    throw new Error("TMDB_API_KEY is not configured.");
  const response = await fetch(BuildTmdbFindUrl(titleId, apiKey), { headers: BuildTmdbHeaders(apiKey) });
  if (!response.ok)
    throw new Error(`TMDB returned HTTP ${response.status}.`);
  const payload = await response.json();
  const item = FindTmdbResult(payload);
  if (!item)
    throw new Error("TMDB did not find this IMDb title.");
  return BuildTmdbMetadata(item);
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

function IsTmdbBearerToken(apiKey) {
  return String(apiKey || "").includes(".");
}

function FindTmdbResult(payload) {
  const movies = Array.isArray(payload?.movie_results) ? payload.movie_results : [];
  const shows = Array.isArray(payload?.tv_results) ? payload.tv_results : [];
  return movies[0] || shows[0] || null;
}

function BuildTmdbMetadata(item) {
  return {
    posterUrl: BuildTmdbPosterUrl(item.poster_path),
    synopsis: CleanMetadataText(item.overview || ""),
    source: "tmdb"
  };
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
    source: "imdb-title-page"
  };
}

async function FetchSuggestionMetadata(titleId) {
  const response = await fetch(`https://v3.sg.media-imdb.com/suggestion/t/${titleId}.json`, { headers: { "accept": "application/json", "user-agent": "Mozilla/5.0" } });
  if (!response.ok)
    throw new Error(`IMDb suggestion endpoint returned HTTP ${response.status}.`);
  const payload = await response.json();
  const item = Array.isArray(payload?.d) ? payload.d.find((entry) => entry.id === titleId) : null;
  return {
    posterUrl: NormalizeImageUrl(item?.i?.imageUrl || ""),
    synopsis: "",
    source: "imdb-suggestion"
  };
}

function BuildTitleHeaders() {
  return {
    "accept": "text/html,application/xhtml+xml",
    "accept-language": "en-US,en;q=0.9",
    "cookie": GetImdbCookie(),
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
  return String(value || "").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
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
  await mkdir(path.dirname(CachePath), { recursive: true });
  await writeFile(CachePath, `${JSON.stringify(MetadataCache, null, 2)}\n`, "utf8");
}

function Ok(payload) {
  return {
    status: 200,
    payload
  };
}
