import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GetImdbCookie } from "./env.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CachePath = path.join(RootPath, "cache", "title-metadata.json");
let CacheWriteTimer;
const MetadataCache = LoadMetadataCache();

export async function GetTitleMetadata(titleId) {
  if (MetadataCache[titleId])
    return Ok({ ok: true, ...MetadataCache[titleId] });
  const metadata = await LoadTitleMetadata(titleId);
  MetadataCache[titleId] = metadata;
  ScheduleCacheWrite();
  return Ok({ ok: true, ...metadata });
}

async function LoadTitleMetadata(titleId) {
  const titlePage = await FetchTitlePageMetadata(titleId).catch(() => null);
  const suggestion = await FetchSuggestionMetadata(titleId).catch(() => null);
  return {
    titleId,
    posterUrl: titlePage?.posterUrl || suggestion?.posterUrl || "",
    synopsis: titlePage?.synopsis || "",
    source: titlePage?.source || suggestion?.source || ""
  };
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
