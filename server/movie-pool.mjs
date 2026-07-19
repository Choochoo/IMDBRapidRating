import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const Cache = new Map();

export async function ReadMoviePool(rootPath) {
  const filePath = path.join(rootPath, "data", "movies.json");
  const file = await stat(filePath);
  const cached = Cache.get(filePath);
  if (cached?.modifiedAt === file.mtimeMs)
    return cached.value;
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const ids = NormalizeMovieIds(raw);
  if (!ids.length)
    throw new Error("The movie pool does not contain any valid IMDb IDs.");
  const value = {
    ids,
    version: ReadPoolVersion(raw.poolVersion, ids)
  };
  Cache.set(filePath, { modifiedAt: file.mtimeMs, value });
  return value;
}

export function CalculatePoolVersion(ids) {
  return createHash("sha256").update(ids.join("\n"), "utf8").digest("hex");
}

function NormalizeMovieIds(raw) {
  const movies = Array.isArray(raw) ? raw : raw?.movies;
  if (!Array.isArray(movies))
    return [];
  const seen = new Set();
  const ids = [];
  for (const movie of movies) {
    const ttId = String(movie?.ttId || movie?.tconst || movie?.id || "").trim();
    if (!/^tt\d+$/.test(ttId) || seen.has(ttId))
      continue;
    seen.add(ttId);
    ids.push(ttId);
  }
  return ids;
}

function ReadPoolVersion(value, ids) {
  const version = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(version) ? version : CalculatePoolVersion(ids);
}
