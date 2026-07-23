import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { HasActiveTitleFilters, IsTitleAllowed, NormalizeTitleOrigin } from "../shared/title-filters.js";

const Cache = new Map();
const MovieMediaType = "movie";
const TvMediaType = "tv";
const Utf8Encoding = "utf8";

export async function ReadMoviePool(rootPath) {
  return await ReadTitlePool(rootPath, MovieMediaType);
}

export async function ReadTitlePool(rootPath, mediaType = MovieMediaType) {
  const filePath = ReadTitlePoolPath(rootPath, mediaType);
  const file = await stat(filePath);
  const cached = Cache.get(filePath);
  if (cached?.modifiedAt === file.mtimeMs)
    return cached.value;
  return await LoadTitlePool(filePath, file.mtimeMs, mediaType);
}

function ReadTitlePoolPath(rootPath, mediaType) {
  const fileName = mediaType === TvMediaType ? "shows.json" : "movies.json";
  return path.join(rootPath, "data", fileName);
}

async function LoadTitlePool(filePath, modifiedAt, mediaType) {
  const raw = JSON.parse(await readFile(filePath, Utf8Encoding));
  const titles = NormalizeTitles(raw);
  const ids = titles.map((title) => title.ttId);
  ValidateTitlePool(ids, mediaType);
  const value = { titles, ids, version: ReadPoolVersion(raw.poolVersion, ids) };
  Cache.set(filePath, { modifiedAt, value });
  return value;
}

function ValidateTitlePool(ids, mediaType) {
  if (!ids.length)
    throw new Error(`The ${mediaType === TvMediaType ? "TV show" : MovieMediaType} pool does not contain any valid IMDb IDs.`);
}

export function CalculatePoolVersion(ids) {
  return createHash("sha256").update(ids.join("\n"), Utf8Encoding).digest("hex");
}

export function FilterTitlePool(pool, filters) {
  if (!HasActiveTitleFilters(filters))
    return pool;
  const titles = Array.isArray(pool?.titles) ? pool.titles.filter((title) => IsTitleAllowed(title, filters)) : [];
  const ids = titles.map((title) => title.ttId);
  return { ...pool, titles, ids, version: CalculatePoolVersion(ids) };
}

function NormalizeTitles(raw) {
  const titles = ReadTitleValues(raw);
  if (!Array.isArray(titles))
    return [];
  const seen = new Set();
  const normalized = [];
  for (const title of titles)
    AddNormalizedTitle(normalized, seen, title);
  return normalized;
}

function ReadTitleValues(raw) {
  return Array.isArray(raw) ? raw : raw?.movies || raw?.shows || raw?.titles;
}

function AddNormalizedTitle(normalized, seen, title) {
  const ttId = ReadTitleId(title);
  if (!ttId || seen.has(ttId))
    return;
  seen.add(ttId);
  normalized.push(NormalizeTitle(title, ttId));
}

function ReadTitleId(title) {
  const ttId = String(title?.ttId || title?.tconst || title?.id || "").trim();
  return /^tt\d+$/.test(ttId) ? ttId : "";
}

function NormalizeTitle(title, ttId) {
  const year = Number(title?.year || title?.startYear) || null;
  return { ...title, ttId, year, ...NormalizeTitleOrigin(title) };
}

function ReadPoolVersion(value, ids) {
  const version = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(version) ? version : CalculatePoolVersion(ids);
}
