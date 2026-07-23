import { ParseCsv, ToCsvRow } from "../../shared/csv.js";

const DiaryKind = "diary";
const ImportedStatus = "imported";
const LetterboxdExportName = "Letterboxd export";
const RatingsKind = "ratings";
const WatchedKind = "watched";
const WatchlistKind = "watchlist";
const Newline = "\n";
const PathSeparator = "/";
const SpaceSeparator = " ";
const LetterboxdFileKinds = {
  "ratings.csv": RatingsKind,
  "watched.csv": WatchedKind,
  "diary.csv": DiaryKind,
  "watchlist.csv": WatchlistKind
};
Object.freeze(LetterboxdFileKinds);

export function ImportLetterboxdCsvFiles(files, movieById, sourceName = LetterboxdExportName) {
  const state = CreateLetterboxdImportState(movieById);
  for (const file of files)
    ImportLetterboxdFile(state, file);
  EnsureRecognizedLetterboxdFiles(state.recognizedFiles);
  return BuildImportedLetterboxdState(state, sourceName);
}

function CreateLetterboxdImportState(movieById) {
  return {
    lookup: BuildMovieLookup(movieById),
    items: new Map(),
    recognizedFiles: [],
    importedRows: 0
  };
}

function ImportLetterboxdFile(state, file) {
  const kind = ReadLetterboxdFileKind(file.name);
  if (!kind)
    return;
  state.recognizedFiles.push(file.name);
  const rows = ParseCsv(String(file.text || ""));
  if (rows.length)
    ImportLetterboxdRows(state, rows, kind, file.name);
}

function ImportLetterboxdRows(state, rows, kind, sourceFile) {
  const indexes = ReadLetterboxdIndexes(rows[0]);
  for (const row of rows.slice(1))
    ImportLetterboxdRow(state, row, indexes, kind, sourceFile);
}

function ImportLetterboxdRow(state, row, indexes, kind, sourceFile) {
  const item = BuildLetterboxdItem(row, indexes, kind, state.lookup, sourceFile);
  if (!item)
    return;
  const key = CollectionItemKey(item);
  state.items.set(key, MergeLetterboxdItems(state.items.get(key), item));
  state.importedRows++;
}

function EnsureRecognizedLetterboxdFiles(files) {
  if (!files.length)
    throw new Error("The file does not contain Letterboxd ratings, watched, diary, or watchlist CSV data.");
}

function BuildImportedLetterboxdState(state, sourceName) {
  return {
    sourceName: String(sourceName || LetterboxdExportName),
    importedAt: new Date().toISOString(),
    files: state.recognizedFiles,
    importedRows: state.importedRows,
    items: [...state.items.values()]
  };
}

export function NormalizeLetterboxdState(value, movieById) {
  const source = value && typeof value === "object" ? value : {};
  const lookup = BuildMovieLookup(movieById);
  const items = NormalizeStoredLetterboxdItems(source.items, lookup);
  return {
    sourceName: String(source.sourceName || ""),
    importedAt: String(source.importedAt || ""),
    files: Array.isArray(source.files) ? source.files.map(String) : [],
    importedRows: Number(source.importedRows) || 0,
    items: [...items.values()]
  };
}

function NormalizeStoredLetterboxdItems(sourceItems, lookup) {
  const items = new Map();
  const rawItems = Array.isArray(sourceItems) ? sourceItems : [];
  for (const raw of rawItems)
    StoreNormalizedLetterboxdItem(items, raw, lookup);
  return items;
}

function StoreNormalizedLetterboxdItem(items, raw, lookup) {
  const item = NormalizeStoredLetterboxdItem(raw, lookup);
  if (!item)
    return;
  const key = CollectionItemKey(item);
  items.set(key, MergeLetterboxdItems(items.get(key), item));
}

export function ReconcileCollections(ratings, letterboxdState) {
  const collections = ReadReconcileCollections(ratings, letterboxdState);
  const plan = CreateReconciliationPlan();
  ReconcileLetterboxdItems(collections.letterboxdItems, collections.imdbByKey, plan);
  ReconcileImdbRecords(collections.imdbRecords, collections.letterboxdByKey, plan);
  return BuildReconciliationResult(collections, plan);
}

function ReadReconcileCollections(ratings, letterboxdState) {
  const imdbRecords = Object.values(ratings || {}).filter(IsRatedRecord);
  const allItems = letterboxdState?.items || [];
  const letterboxdItems = allItems.filter((item) => IsValidRating(item.rating));
  return {
    imdbRecords,
    letterboxdItems,
    watchedOnly: allItems.filter((item) => item.watched && !IsValidRating(item.rating)),
    imdbByKey: BuildCollectionMap(imdbRecords),
    letterboxdByKey: BuildCollectionMap(letterboxdItems)
  };
}

function CreateReconciliationPlan() {
  return {
    toImdb: [],
    toLetterboxd: [],
    conflicts: [],
    unmatched: [],
    matched: 0
  };
}

function ReconcileLetterboxdItems(items, imdbByKey, plan) {
  for (const item of items)
    ReconcileLetterboxdItem(item, imdbByKey, plan);
}

function ReconcileLetterboxdItem(item, imdbByKey, plan) {
  const record = FindCollectionMatch(item, imdbByKey);
  if (!record)
    return ReconcileMissingLetterboxdItem(item, plan);
  if (record.rating !== item.rating)
    return plan.conflicts.push(BuildRatingConflict(item, record));
  if (IsPresentOnImdb(record))
    plan.matched++;
  else
    plan.toImdb.push({ item, record });
}

function ReconcileMissingLetterboxdItem(item, plan) {
  if (item.ttId)
    plan.toImdb.push({ item, record: null });
  else
    plan.unmatched.push(item);
}

function BuildRatingConflict(item, record) {
  return {
    ttId: item.ttId || record.ttId,
    title: item.title || record.title,
    year: item.year || record.year,
    imdbRating: record.rating,
    letterboxdRating: item.rating
  };
}

function ReconcileImdbRecords(records, letterboxdByKey, plan) {
  for (const record of records) {
    const item = FindCollectionMatch(record, letterboxdByKey);
    if (!item || !IsValidRating(item.rating))
      plan.toLetterboxd.push(record);
  }
}

function BuildReconciliationResult(collections, plan) {
  return {
    imdbCount: collections.imdbRecords.filter(IsPresentOnImdb).length,
    databaseRatedCount: collections.imdbRecords.length,
    letterboxdCount: collections.letterboxdItems.length,
    matched: plan.matched,
    toImdb: plan.toImdb,
    toLetterboxd: plan.toLetterboxd,
    conflicts: plan.conflicts,
    unmatched: plan.unmatched,
    watchedOnly: collections.watchedOnly
  };
}

export function BuildLetterboxdCsvFiles(records, maxBytes = 950_000) {
  const header = ToCsvRow(["imdbID", "Title", "Year", "Rating10", "WatchedDate"]);
  const rows = BuildLetterboxdCsvRows(records);
  if (!rows.length)
    return [];
  const chunks = ChunkLetterboxdRows(header, rows, maxBytes);
  return BuildLetterboxdCsvOutputs(chunks);
}

function BuildLetterboxdCsvRows(records) {
  return records.filter(IsRatedRecord).sort(CompareCollectionDates).map(BuildLetterboxdCsvRow);
}

function BuildLetterboxdCsvRow(record) {
  return ToCsvRow([record.ttId, record.title || "", record.year || "", record.rating, ReadCalendarDate(record.at)]);
}

function ChunkLetterboxdRows(header, rows, maxBytes) {
  const chunks = [];
  let current = [header];
  for (const row of rows) {
    const candidate = [...current, row].join(Newline);
    if (ShouldStartLetterboxdChunk(current, candidate, maxBytes)) {
      chunks.push(current.join(Newline));
      current = [header, row];
      continue;
    }
    current.push(row);
  }
  chunks.push(current.join(Newline));
  return chunks;
}

function ShouldStartLetterboxdChunk(current, candidate, maxBytes) {
  return current.length > 1 && ByteLength(candidate) > maxBytes;
}

function BuildLetterboxdCsvOutputs(chunks) {
  return chunks.map((content, index) => BuildLetterboxdCsvOutput(content, index, chunks.length));
}

function BuildLetterboxdCsvOutput(content, index, count) {
  return {
    name: count === 1 ? "upload-this-to-letterboxd.csv" : `upload-to-letterboxd-${String(index + 1).padStart(2, "0")}.csv`,
    content
  };
}

function ReadLetterboxdFileKind(name) {
  const baseName = String(name || "").replaceAll("\\", PathSeparator).split(PathSeparator).pop().toLowerCase();
  return LetterboxdFileKinds[baseName] || "";
}

function ReadLetterboxdIndexes(headers) {
  const normalized = headers.map((header) => String(header || "").trim().toLowerCase());
  return {
    title: FindHeader(normalized, ["name", "title"]),
    year: FindHeader(normalized, ["year"]),
    uri: FindHeader(normalized, ["letterboxd uri", "letterboxduri", "url"]),
    imdbId: FindHeader(normalized, ["imdb id", "imdbid", "const"]),
    rating: FindHeader(normalized, ["rating"]),
    rating10: FindHeader(normalized, ["rating10", "rating 10"]),
    date: FindHeader(normalized, ["watched date", "watcheddate", "date"])
  };
}

function FindHeader(headers, names) {
  return names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
}

function BuildLetterboxdItem(row, indexes, kind, lookup, sourceFile) {
  const identity = ResolveLetterboxdIdentity(row, indexes, lookup);
  if (!identity.title && !identity.ttId)
    return null;
  return BuildLetterboxdItemRecord(row, indexes, kind, identity, sourceFile);
}

function ResolveLetterboxdIdentity(row, indexes, lookup) {
  const title = ReadCell(row, indexes.title).replace(/\s+/g, SpaceSeparator).trim();
  const year = Number(ReadCell(row, indexes.year)) || null;
  const explicitId = NormalizeImdbId(ReadCell(row, indexes.imdbId));
  const movie = explicitId ? lookup.byId.get(explicitId) : FindMovieByTitle(title, year, lookup);
  return {
    ttId: explicitId || movie?.ttId || "",
    title: title || movie?.title || "",
    year: year || Number(movie?.year) || null
  };
}

function BuildLetterboxdItemRecord(row, indexes, kind, identity, sourceFile) {
  const date = ReadCalendarDate(ReadCell(row, indexes.date));
  return {
    ...identity,
    letterboxdUri: ReadCell(row, indexes.uri).trim(),
    rating: ReadLetterboxdRating(row, indexes),
    ...BuildLetterboxdActivity(kind, date),
    sourceFiles: [String(sourceFile || "")]
  };
}

function BuildLetterboxdActivity(kind, date) {
  return {
    watched: kind !== WatchlistKind,
    watchedAt: kind === DiaryKind || kind === WatchedKind ? date : "",
    ratedAt: kind === RatingsKind || kind === DiaryKind ? date : "",
    watchlist: kind === WatchlistKind
  };
}

function NormalizeStoredLetterboxdItem(raw, lookup) {
  const identity = ResolveStoredLetterboxdIdentity(raw, lookup);
  if (!identity.title && !identity.ttId)
    return null;
  return BuildNormalizedLetterboxdItem(raw, identity);
}

function ResolveStoredLetterboxdIdentity(raw, lookup) {
  const explicitId = NormalizeImdbId(raw?.ttId);
  const title = String(raw?.title || "").replace(/\s+/g, SpaceSeparator).trim();
  const year = Number(raw?.year) || null;
  const movie = explicitId ? lookup.byId.get(explicitId) : FindMovieByTitle(title, year, lookup);
  return {
    ttId: explicitId || movie?.ttId || "",
    title: title || movie?.title || "",
    year: year || Number(movie?.year) || null
  };
}

function BuildNormalizedLetterboxdItem(raw, identity) {
  return {
    ...identity,
    letterboxdUri: String(raw?.letterboxdUri || ""),
    rating: IsValidRating(Number(raw?.rating)) ? Number(raw.rating) : null,
    watched: Boolean(raw?.watched),
    watchedAt: ReadCalendarDate(raw?.watchedAt),
    ratedAt: ReadCalendarDate(raw?.ratedAt),
    watchlist: Boolean(raw?.watchlist),
    sourceFiles: Array.isArray(raw?.sourceFiles) ? raw.sourceFiles.map(String) : []
  };
}

function MergeLetterboxdItems(current, next) {
  if (!current)
    return next;
  return {
    ...current,
    ...next,
    ...BuildMergedLetterboxdValues(current, next)
  };
}

function BuildMergedLetterboxdValues(current, next) {
  return {
    ttId: next.ttId || current.ttId,
    title: next.title || current.title,
    year: next.year || current.year,
    letterboxdUri: next.letterboxdUri || current.letterboxdUri,
    rating: IsValidRating(next.rating) ? next.rating : current.rating,
    watched: current.watched || next.watched,
    watchedAt: LatestDate(current.watchedAt, next.watchedAt),
    ratedAt: LatestDate(current.ratedAt, next.ratedAt),
    watchlist: current.watchlist || next.watchlist,
    sourceFiles: MergeSourceFiles(current.sourceFiles, next.sourceFiles)
  };
}

function MergeSourceFiles(current, next) {
  const files = [...(current || []), ...(next || [])].filter(Boolean);
  return [...new Set(files)];
}

function BuildMovieLookup(movieById) {
  const byId = movieById instanceof Map ? movieById : new Map();
  const byTitleYear = new Map();
  const byTitle = new Map();
  for (const movie of byId.values()) {
    AddLookupValue(byTitleYear, TitleYearKey(movie), movie);
    AddLookupValue(byTitle, NormalizeTitle(movie.title), movie);
  }
  return { byId, byTitleYear, byTitle };
}

function AddLookupValue(map, key, movie) {
  if (!key)
    return;
  const values = map.get(key) || [];
  values.push(movie);
  map.set(key, values);
}

function FindMovieByTitle(title, year, lookup) {
  const exact = lookup.byTitleYear.get(TitleYearKey({ title, year })) || [];
  if (exact.length === 1)
    return exact[0];
  const titleMatches = lookup.byTitle.get(NormalizeTitle(title)) || [];
  return titleMatches.length === 1 ? titleMatches[0] : null;
}

function BuildCollectionMap(items) {
  const map = new Map();
  for (const item of items) {
    for (const key of CollectionKeys(item)) {
      if (!map.has(key))
        map.set(key, item);
    }
  }
  return map;
}

function FindCollectionMatch(item, map) {
  for (const key of CollectionKeys(item)) {
    if (map.has(key))
      return map.get(key);
  }
  return null;
}

function CollectionKeys(item) {
  return [item?.ttId ? `id:${item.ttId}` : "", `title:${TitleYearKey(item)}`].filter(Boolean);
}

function CollectionItemKey(item) {
  return item.letterboxdUri ? `uri:${item.letterboxdUri}` : CollectionKeys(item)[0] || `title:${NormalizeTitle(item.title)}`;
}

function TitleYearKey(item) {
  const title = NormalizeTitle(item?.title);
  return title ? `${title}|${Number(item?.year) || ""}` : "";
}

function NormalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, SpaceSeparator).trim();
}

function NormalizeImdbId(value) {
  const id = String(value || "").trim();
  return /^tt\d+$/.test(id) ? id : "";
}

function ReadLetterboxdRating(row, indexes) {
  const rating10 = Number(ReadCell(row, indexes.rating10));
  if (IsValidRating(rating10))
    return rating10;
  const stars = Number(ReadCell(row, indexes.rating));
  const converted = stars * 2;
  return IsValidRating(converted) ? converted : null;
}

function ReadCell(row, index) {
  return index >= 0 ? String(row[index] || "") : "";
}

function IsRatedRecord(record) {
  const validStatus = record?.status === "rated" || record?.status === ImportedStatus;
  return validStatus && /^tt\d+$/.test(String(record?.ttId || "")) && IsValidRating(record?.rating);
}

function IsPresentOnImdb(record) {
  return record?.status === ImportedStatus || record?.submitStatus === "submitted";
}

function IsValidRating(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10;
}

function ReadCalendarDate(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function CompareCollectionDates(left, right) {
  return String(left?.at || "").localeCompare(String(right?.at || ""));
}

function LatestDate(left, right) {
  return String(left || "") > String(right || "") ? String(left || "") : String(right || "");
}

function ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
