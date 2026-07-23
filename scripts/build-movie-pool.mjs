import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { IsVoteCountEligible, MinimumVoteCount } from "./title-pool-policy.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CacheDir = path.join(RootPath, "cache");
const DataDir = path.join(RootPath, "data");
const SourceBase = "https://datasets.imdbws.com";
const MovieMediaType = "movie";
const TvMediaType = "tv";
const TextEncoding = "utf8";
const MovieCollectionKey = "movies";
const TvSeriesTitleType = "tvSeries";
const TvMiniSeriesTitleType = "tvMiniSeries";
const TrueValue = "true";
const FileValues = {
  basics: "title.basics.tsv.gz",
  ratings: "title.ratings.tsv.gz"
};
const Files = Object.freeze(FileValues);
const Options = ReadOptions();

await mkdir(CacheDir, { recursive: true });
await mkdir(DataDir, { recursive: true });
await DownloadDataset(Files.basics);
await DownloadDataset(Files.ratings);

console.log(`Reading ratings with at least ${MinimumVoteCount(Options).toLocaleString()} votes...`);
const Ratings = await ReadRatings(path.join(CacheDir, Files.ratings));
console.log(`Kept ${Ratings.size.toLocaleString()} rated titles.`);
console.log("Reading title basics and building separate movie and TV series pools...");
const Catalogs = await ReadBasics(path.join(CacheDir, Files.basics), Ratings);
await WriteCatalog(MovieMediaType, ApplyLimit(SortTitles(Catalogs.movie)));
await WriteCatalog(TvMediaType, ApplyLimit(SortTitles(Catalogs.tv)));

async function WriteCatalog(mediaType, titles) {
  const fileName = mediaType === TvMediaType ? "shows.json" : "movies.json";
  const outputPath = path.join(DataDir, fileName);
  await writeFile(outputPath, `${JSON.stringify(BuildPayload(titles, mediaType), null, 2)}\n`, TextEncoding);
  const label = mediaType === TvMediaType ? "TV shows" : MovieCollectionKey;
  console.log(`Wrote ${titles.length.toLocaleString()} ${label} to ${outputPath}`);
}

async function DownloadDataset(fileName) {
  const outputPath = path.join(CacheDir, fileName);
  const shouldUseCache = existsSync(outputPath) && !Options.refresh;
  if (shouldUseCache) {
    console.log(`Using cached ${fileName}`);
    return;
  }
  const response = await fetch(`${SourceBase}/${fileName}`);
  if (!response.ok || !response.body)
    throw new Error(`Failed to download ${fileName}: HTTP ${response.status}`);
  console.log(`Downloading ${SourceBase}/${fileName}`);
  await pipeline(response.body, createWriteStream(outputPath));
}

async function ReadRatings(filePath) {
  const result = new Map();
  let header = null;
  for await (const columns of ReadTsvGzip(filePath)) {
    if (!header) {
      header = MakeHeaderMap(columns);
      continue;
    }
    AddRatingRow(result, columns, header);
  }
  return result;
}

function AddRatingRow(result, columns, header) {
  const row = ReadRatingRow(columns, header);
  if (!row)
    return;
  result.set(row.tconst, BuildRating(row));
}

function BuildRating(row) {
  return {
    averageRating: row.averageRating,
    numVotes: row.numVotes
  };
}

function ReadRatingRow(columns, header) {
  const tconst = columns[header.tconst];
  const averageRating = Number(columns[header.averageRating]);
  const numVotes = Number(columns[header.numVotes]);
  const hasValidRating = Number.isFinite(averageRating);
  const hasValidVoteCount = Number.isFinite(numVotes);
  if (!tconst || !hasValidRating || !hasValidVoteCount)
    return null;
  if (numVotes < MinimumVoteCount(Options))
    return null;
  return { tconst, averageRating, numVotes };
}

async function ReadBasics(filePath, ratings) {
  const catalogs = { movie: [], tv: [] };
  let header = null;
  for await (const columns of ReadTsvGzip(filePath)) {
    if (!header) {
      header = MakeHeaderMap(columns);
      continue;
    }
    AddTitleRow(catalogs, columns, header, ratings);
  }
  return catalogs;
}

function AddTitleRow(catalogs, columns, header, ratings) {
  const title = ReadTitleRow(columns, header, ratings);
  if (!title)
    return;
  catalogs[title.mediaType].push(title);
}

function ReadTitleRow(columns, header, ratings) {
  const tconst = columns[header.tconst];
  const rating = ratings.get(tconst);
  const mediaType = ReadMediaType(columns[header.titleType]);
  if (!IsEligibleTitle(columns, header, rating, mediaType))
    return null;
  return BuildTitle(columns, header, rating, tconst, mediaType);
}

function IsEligibleTitle(columns, header, rating, mediaType) {
  if (!rating)
    return false;
  if (!mediaType)
    return false;
  return columns[header.isAdult] === "0";
}

function ReadMediaType(titleType) {
  if (titleType === MovieMediaType)
    return MovieMediaType;
  if (titleType === TvSeriesTitleType || titleType === TvMiniSeriesTitleType)
    return TvMediaType;
  return "";
}

function BuildTitle(columns, header, rating, tconst, mediaType) {
  const startYear = ParseNullableInt(columns[header.startYear]);
  const title = CleanValue(columns[header.primaryTitle]);
  const hasValidYear = IsValidYear(startYear);
  if (!hasValidYear || !title || !IsVoteCountEligible(startYear, rating.numVotes, Options))
    return null;
  return BuildTitlePayload(columns, header, rating, tconst, startYear, title, mediaType);
}

function BuildTitlePayload(columns, header, rating, tconst, startYear, title, mediaType) {
  return {
    ttId: tconst,
    title,
    year: startYear,
    endYear: mediaType === TvMediaType ? ParseNullableInt(columns[header.endYear]) : null,
    mediaType,
    titleType: columns[header.titleType],
    runtimeMinutes: ParseNullableInt(columns[header.runtimeMinutes]),
    genres: ReadGenres(columns[header.genres]),
    imdbRating: rating.averageRating,
    numVotes: rating.numVotes
  };
}

function IsValidYear(startYear) {
  return Boolean(startYear && startYear >= Options.minYear && startYear <= Options.maxYear);
}

function ReadGenres(value) {
  const clean = CleanValue(value);
  return clean ? clean.split(",").filter(Boolean) : [];
}

async function* ReadTsvGzip(filePath) {
  const input = createReadStream(filePath).pipe(zlib.createGunzip());
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader)
    yield line.split("\t");
}

function MakeHeaderMap(columns) {
  return Object.fromEntries(columns.map((name, index) => [name, index]));
}

function ReadOptions() {
  const args = ReadArgs();
  const currentYear = new Date().getFullYear();
  const recentYears = ReadNumber(args, "recentYears", 1);
  return {
    limit: ReadOptionalNumber(args, "limit"),
    minVotes: ReadNumber(args, "minVotes", 2500),
    recentMinVotes: ReadNumber(args, "recentMinVotes", 100),
    recentYears,
    recentYearCutoff: currentYear - recentYears,
    minYear: ReadNumber(args, "minYear", 1900),
    maxYear: ReadNumber(args, "maxYear", currentYear + 1),
    refresh: args.get("refresh") === TrueValue
  };
}

function ReadArgs() {
  const args = new Map();
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    args.set(key, value ?? TrueValue);
  }
  return args;
}

function ReadNumber(args, name, defaultValue) {
  const value = Number(args.get(name) ?? defaultValue);
  const isValidValue = Number.isFinite(value) && value >= 0;
  if (!isValidValue)
    throw new Error(`Invalid --${name}`);
  return Math.floor(value);
}

function ReadOptionalNumber(args, name) {
  if (!args.has(name))
    return null;
  return ReadNumber(args, name, 0);
}

function ParseNullableInt(value) {
  const clean = CleanValue(value);
  if (!clean)
    return null;
  const parsed = Number.parseInt(clean, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function CleanValue(value) {
  if (!value || value === "\\N")
    return null;
  return value.trim();
}

function SortTitles(titles) {
  return titles.sort((left, right) => CompareTitles(left, right));
}

function ApplyLimit(titles) {
  return Options.limit === null ? titles : titles.slice(0, Options.limit);
}

function CompareTitles(left, right) {
  const voteDiff = right.numVotes - left.numVotes;
  if (voteDiff !== 0)
    return voteDiff;
  return left.title.localeCompare(right.title);
}

function BuildPayload(titles, mediaType) {
  const collectionKey = mediaType === TvMediaType ? "shows" : MovieCollectionKey;
  return {
    generatedAt: new Date().toISOString(),
    poolVersion: createHash("sha256").update(titles.map((title) => title.ttId).join("\n"), TextEncoding).digest("hex"),
    mediaType,
    source: BuildSourceMetadata(mediaType),
    [collectionKey]: titles
  };
}

function BuildSourceMetadata(mediaType) {
  return {
    name: "IMDb Non-Commercial Datasets",
    url: SourceBase,
    files: Object.values(Files),
    filters: BuildSourceFilters(mediaType),
    credit: "Information courtesy of IMDb (https://www.imdb.com). Used with permission."
  };
}

function BuildSourceFilters(mediaType) {
  return {
    titleTypes: mediaType === TvMediaType ? [TvSeriesTitleType, TvMiniSeriesTitleType] : [MovieMediaType],
    isAdult: false,
    minVotes: Options.minVotes,
    recentMinVotes: Options.recentMinVotes,
    recentYears: Options.recentYears,
    recentYearCutoff: Options.recentYearCutoff,
    minYear: Options.minYear,
    maxYear: Options.maxYear,
    limit: Options.limit
  };
}
