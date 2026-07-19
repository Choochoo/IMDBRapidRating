import { CleanText, FormatCount, NormalizeGenres, ToNumber } from "./util.js";
import { NormalizeTitleOrigin } from "../../shared/title-filters.js";

export function NormalizeMovieList(raw) {
  const list = Array.isArray(raw) ? raw : raw.movies || raw.shows || raw.titles;
  if (!Array.isArray(list))
    return [];
  const seen = new Set();
  return list.map((item) => NormalizeMovie(item, seen)).filter(Boolean);
}

export function MakeSignature(movies) {
  const first = movies[0]?.ttId || "";
  const last = movies[movies.length - 1]?.ttId || "";
  return `${first}:${movies.length}:${last}`;
}

export function DescribeSource(raw, label) {
  const count = NormalizeMovieList(raw).length;
  if (raw?.generatedAt)
    return raw?.mediaType === "tv" ? "TV show pool ready" : "Movie pool ready";
  return `${FormatCount(count)} ${label}`;
}

function NormalizeMovie(item, seen) {
  const ttId = String(item.ttId || item.tconst || item.const || item.id || "").trim();
  const isValidId = /^tt\d+$/.test(ttId);
  if (!isValidId || seen.has(ttId))
    return null;
  const title = CleanText(item.title || item.primaryTitle || item.Title || "");
  if (!title)
    return null;
  seen.add(ttId);
  return BuildMovieItem(item, ttId, title);
}

function BuildMovieItem(item, ttId, title) {
  const origin = NormalizeTitleOrigin(item);
  return {
    ttId,
    title,
    year: ToNumber(item.year || item.startYear || item.Year),
    endYear: ToNumber(item.endYear),
    mediaType: item.mediaType === "tv" ? "tv" : "movie",
    titleType: CleanText(item.titleType || ""),
    runtimeMinutes: ToNumber(item.runtimeMinutes || item.runtime),
    genres: NormalizeGenres(item.genres),
    ...origin,
    imdbRating: ToNumber(item.imdbRating || item.averageRating),
    numVotes: ToNumber(item.numVotes || item.votes)
  };
}
