import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CacheDir = path.join(RootPath, "cache");
const DataDir = path.join(RootPath, "data");
const SourceBase = "https://datasets.imdbws.com";
const Files = Object.freeze({
  basics: "title.basics.tsv.gz",
  ratings: "title.ratings.tsv.gz"
});
const Options = ReadOptions();

await mkdir(CacheDir, { recursive: true });
await mkdir(DataDir, { recursive: true });
await DownloadDataset(Files.basics);
await DownloadDataset(Files.ratings);

console.log(`Reading ratings with at least ${Options.minVotes.toLocaleString()} votes...`);
const Ratings = await ReadRatings(path.join(CacheDir, Files.ratings));
console.log(`Kept ${Ratings.size.toLocaleString()} rated titles.`);
console.log("Reading title basics and filtering feature films...");
const Movies = await ReadBasics(path.join(CacheDir, Files.basics), Ratings);
const OutputMovies = SortMovies(Movies).slice(0, Options.limit);
const OutputPath = path.join(DataDir, "movies.json");
await writeFile(OutputPath, `${JSON.stringify(BuildPayload(OutputMovies), null, 2)}\n`, "utf8");
console.log(`Wrote ${OutputMovies.length.toLocaleString()} movies to ${OutputPath}`);

async function DownloadDataset(fileName) {
  const outputPath = path.join(CacheDir, fileName);
  if (existsSync(outputPath) && !Options.refresh) {
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
  if (!tconst || !Number.isFinite(averageRating) || !Number.isFinite(numVotes))
    return null;
  if (numVotes < Options.minVotes)
    return null;
  return { tconst, averageRating, numVotes };
}

async function ReadBasics(filePath, ratings) {
  const movies = [];
  let header = null;
  for await (const columns of ReadTsvGzip(filePath)) {
    if (!header) {
      header = MakeHeaderMap(columns);
      continue;
    }
    AddMovieRow(movies, columns, header, ratings);
  }
  return movies;
}

function AddMovieRow(movies, columns, header, ratings) {
  const movie = ReadMovieRow(columns, header, ratings);
  if (!movie)
    return;
  movies.push(movie);
}

function ReadMovieRow(columns, header, ratings) {
  const tconst = columns[header.tconst];
  const rating = ratings.get(tconst);
  if (!IsMovieRow(columns, header, rating))
    return null;
  return BuildMovie(columns, header, rating, tconst);
}

function IsMovieRow(columns, header, rating) {
  if (!rating)
    return false;
  if (columns[header.titleType] !== "movie")
    return false;
  return columns[header.isAdult] === "0";
}

function BuildMovie(columns, header, rating, tconst) {
  const startYear = ParseNullableInt(columns[header.startYear]);
  const title = CleanValue(columns[header.primaryTitle]);
  if (!IsValidYear(startYear) || !title)
    return null;
  return {
    ttId: tconst,
    title,
    year: startYear,
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
  return {
    limit: ReadNumber(args, "limit", 12000),
    minVotes: ReadNumber(args, "minVotes", 2500),
    minYear: ReadNumber(args, "minYear", 1900),
    maxYear: ReadNumber(args, "maxYear", new Date().getFullYear() + 1),
    refresh: args.get("refresh") === "true"
  };
}

function ReadArgs() {
  const args = new Map();
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    args.set(key, value ?? "true");
  }
  return args;
}

function ReadNumber(args, name, defaultValue) {
  const value = Number(args.get(name) ?? defaultValue);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`Invalid --${name}`);
  return Math.floor(value);
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

function SortMovies(movies) {
  return movies.sort((left, right) => CompareMovies(left, right));
}

function CompareMovies(left, right) {
  const voteDiff = right.numVotes - left.numVotes;
  if (voteDiff !== 0)
    return voteDiff;
  return left.title.localeCompare(right.title);
}

function BuildPayload(movies) {
  return {
    generatedAt: new Date().toISOString(),
    source: BuildSourceMetadata(),
    movies
  };
}

function BuildSourceMetadata() {
  return {
    name: "IMDb Non-Commercial Datasets",
    url: SourceBase,
    files: Object.values(Files),
    filters: BuildSourceFilters(),
    credit: "Information courtesy of IMDb (https://www.imdb.com). Used with permission."
  };
}

function BuildSourceFilters() {
  return {
    titleType: "movie",
    isAdult: false,
    minVotes: Options.minVotes,
    minYear: Options.minYear,
    maxYear: Options.maxYear,
    limit: Options.limit
  };
}
