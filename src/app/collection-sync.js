import { ParseCsv, ToCsvRow } from "../../shared/csv.js";

const LetterboxdFileKinds = Object.freeze({
  "ratings.csv": "ratings",
  "watched.csv": "watched",
  "diary.csv": "diary",
  "watchlist.csv": "watchlist"
});

export function ImportLetterboxdCsvFiles(files, movieById, sourceName = "Letterboxd export") {
  const lookup = BuildMovieLookup(movieById);
  const items = new Map();
  const recognizedFiles = [];
  let importedRows = 0;
  for (const file of files) {
    const kind = ReadLetterboxdFileKind(file.name);
    if (!kind)
      continue;
    recognizedFiles.push(file.name);
    const rows = ParseCsv(String(file.text || ""));
    if (!rows.length)
      continue;
    const indexes = ReadLetterboxdIndexes(rows[0]);
    for (const row of rows.slice(1)) {
      const item = BuildLetterboxdItem(row, indexes, kind, lookup, file.name);
      if (!item)
        continue;
      const key = CollectionItemKey(item);
      items.set(key, MergeLetterboxdItems(items.get(key), item));
      importedRows++;
    }
  }
  if (!recognizedFiles.length)
    throw new Error("The file does not contain Letterboxd ratings, watched, diary, or watchlist CSV data.");
  return {
    sourceName: String(sourceName || "Letterboxd export"),
    importedAt: new Date().toISOString(),
    files: recognizedFiles,
    importedRows,
    items: [...items.values()]
  };
}

export function NormalizeLetterboxdState(value, movieById) {
  const source = value && typeof value === "object" ? value : {};
  const lookup = BuildMovieLookup(movieById);
  const items = new Map();
  for (const raw of Array.isArray(source.items) ? source.items : []) {
    const item = NormalizeStoredLetterboxdItem(raw, lookup);
    if (item)
      items.set(CollectionItemKey(item), MergeLetterboxdItems(items.get(CollectionItemKey(item)), item));
  }
  return {
    sourceName: String(source.sourceName || ""),
    importedAt: String(source.importedAt || ""),
    files: Array.isArray(source.files) ? source.files.map(String) : [],
    importedRows: Number(source.importedRows) || 0,
    items: [...items.values()]
  };
}

export function ReconcileCollections(ratings, letterboxdState) {
  const imdbRecords = Object.values(ratings || {}).filter(IsRatedRecord);
  const letterboxdItems = (letterboxdState?.items || []).filter((item) => IsValidRating(item.rating));
  const watchedOnly = (letterboxdState?.items || []).filter((item) => item.watched && !IsValidRating(item.rating));
  const imdbByKey = BuildCollectionMap(imdbRecords);
  const letterboxdByKey = BuildCollectionMap(letterboxdItems);
  const toImdb = [];
  const toLetterboxd = [];
  const conflicts = [];
  const unmatched = [];
  let matched = 0;

  for (const item of letterboxdItems) {
    const record = FindCollectionMatch(item, imdbByKey);
    if (!record) {
      if (item.ttId)
        toImdb.push({ item, record: null });
      else
        unmatched.push(item);
      continue;
    }
    if (record.rating !== item.rating) {
      conflicts.push({ ttId: item.ttId || record.ttId, title: item.title || record.title, year: item.year || record.year, imdbRating: record.rating, letterboxdRating: item.rating });
      continue;
    }
    if (IsPresentOnImdb(record))
      matched++;
    else
      toImdb.push({ item, record });
  }

  for (const record of imdbRecords) {
    const item = FindCollectionMatch(record, letterboxdByKey);
    if (!item || !IsValidRating(item.rating))
      toLetterboxd.push(record);
  }

  return {
    imdbCount: imdbRecords.filter(IsPresentOnImdb).length,
    databaseRatedCount: imdbRecords.length,
    letterboxdCount: letterboxdItems.length,
    matched,
    toImdb,
    toLetterboxd,
    conflicts,
    unmatched,
    watchedOnly
  };
}

export function BuildLetterboxdCsvFiles(records, maxBytes = 950_000) {
  const header = ToCsvRow(["imdbID", "Title", "Year", "Rating10", "WatchedDate"]);
  const rows = records.filter(IsRatedRecord).sort(CompareCollectionDates).map((record) => ToCsvRow([
    record.ttId,
    record.title || "",
    record.year || "",
    record.rating,
    ReadCalendarDate(record.at)
  ]));
  if (!rows.length)
    return [];
  const chunks = [];
  let current = [header];
  for (const row of rows) {
    const candidate = [...current, row].join("\n");
    if (current.length > 1 && ByteLength(candidate) > maxBytes) {
      chunks.push(current.join("\n"));
      current = [header, row];
    } else {
      current.push(row);
    }
  }
  chunks.push(current.join("\n"));
  return chunks.map((content, index) => ({
    name: chunks.length === 1 ? "upload-this-to-letterboxd.csv" : `upload-to-letterboxd-${String(index + 1).padStart(2, "0")}.csv`,
    content
  }));
}

function ReadLetterboxdFileKind(name) {
  const baseName = String(name || "").replaceAll("\\", "/").split("/").pop().toLowerCase();
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
  const title = ReadCell(row, indexes.title).replace(/\s+/g, " ").trim();
  const year = Number(ReadCell(row, indexes.year)) || null;
  const explicitId = NormalizeImdbId(ReadCell(row, indexes.imdbId));
  const movie = explicitId ? lookup.byId.get(explicitId) : FindMovieByTitle(title, year, lookup);
  const ttId = explicitId || movie?.ttId || "";
  const resolvedTitle = title || movie?.title || "";
  if (!resolvedTitle && !ttId)
    return null;
  const date = ReadCalendarDate(ReadCell(row, indexes.date));
  return {
    ttId,
    title: resolvedTitle,
    year: year || Number(movie?.year) || null,
    letterboxdUri: ReadCell(row, indexes.uri).trim(),
    rating: ReadLetterboxdRating(row, indexes),
    watched: kind !== "watchlist",
    watchedAt: kind === "diary" || kind === "watched" ? date : "",
    ratedAt: kind === "ratings" || kind === "diary" ? date : "",
    watchlist: kind === "watchlist",
    sourceFiles: [String(sourceFile || "")]
  };
}

function NormalizeStoredLetterboxdItem(raw, lookup) {
  const explicitId = NormalizeImdbId(raw?.ttId);
  const title = String(raw?.title || "").replace(/\s+/g, " ").trim();
  const year = Number(raw?.year) || null;
  const movie = explicitId ? lookup.byId.get(explicitId) : FindMovieByTitle(title, year, lookup);
  const ttId = explicitId || movie?.ttId || "";
  if (!title && !movie?.title && !ttId)
    return null;
  return {
    ttId,
    title: title || movie?.title || "",
    year: year || Number(movie?.year) || null,
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
    ttId: next.ttId || current.ttId,
    title: next.title || current.title,
    year: next.year || current.year,
    letterboxdUri: next.letterboxdUri || current.letterboxdUri,
    rating: IsValidRating(next.rating) ? next.rating : current.rating,
    watched: current.watched || next.watched,
    watchedAt: LatestDate(current.watchedAt, next.watchedAt),
    ratedAt: LatestDate(current.ratedAt, next.ratedAt),
    watchlist: current.watchlist || next.watchlist,
    sourceFiles: [...new Set([...(current.sourceFiles || []), ...(next.sourceFiles || [])].filter(Boolean))]
  };
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
  return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
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
  const validStatus = record?.status === "rated" || record?.status === "imported";
  return validStatus && /^tt\d+$/.test(String(record?.ttId || "")) && IsValidRating(record?.rating);
}

function IsPresentOnImdb(record) {
  return record?.status === "imported" || record?.submitStatus === "submitted";
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
