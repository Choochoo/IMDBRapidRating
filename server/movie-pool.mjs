import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { HasActiveTitleFilters, IsTitleAllowed, NormalizeTitleOrigin } from "../shared/title-filters.js";

const Cache = new Map();

export async function ReadMoviePool(rootPath) {
  return await ReadTitlePool(rootPath, "movie");
}

export async function ReadTitlePool(rootPath, mediaType = "movie") {
  const fileName = mediaType === "tv" ? "shows.json" : "movies.json";
  const filePath = path.join(rootPath, "data", fileName);
  const file = await stat(filePath);
  const cached = Cache.get(filePath);
  if (cached?.modifiedAt === file.mtimeMs)
    return cached.value;
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const titles = NormalizeTitles(raw);
  const ids = titles.map((title) => title.ttId);
  if (!ids.length)
    throw new Error(`The ${mediaType === "tv" ? "TV show" : "movie"} pool does not contain any valid IMDb IDs.`);
  const value = {
    titles,
    ids,
    version: ReadPoolVersion(raw.poolVersion, ids)
  };
  Cache.set(filePath, { modifiedAt: file.mtimeMs, value });
  return value;
}

export function CalculatePoolVersion(ids) {
  return createHash("sha256").update(ids.join("\n"), "utf8").digest("hex");
}

export function FilterTitlePool(pool, filters) {
  if (!HasActiveTitleFilters(filters))
    return pool;
  const titles = Array.isArray(pool?.titles) ? pool.titles.filter((title) => IsTitleAllowed(title, filters)) : [];
  const ids = titles.map((title) => title.ttId);
  return { ...pool, titles, ids, version: CalculatePoolVersion(ids) };
}

function NormalizeTitles(raw) {
  const titles = Array.isArray(raw) ? raw : raw?.movies || raw?.shows || raw?.titles;
  if (!Array.isArray(titles))
    return [];
  const seen = new Set();
  const normalized = [];
  for (const title of titles) {
    const ttId = String(title?.ttId || title?.tconst || title?.id || "").trim();
    if (!/^tt\d+$/.test(ttId) || seen.has(ttId))
      continue;
    seen.add(ttId);
    const year = Number(title?.year || title?.startYear) || null;
    normalized.push({ ...title, ttId, year, ...NormalizeTitleOrigin(title) });
  }
  return normalized;
}

function ReadPoolVersion(value, ids) {
  const version = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(version) ? version : CalculatePoolVersion(ids);
}
