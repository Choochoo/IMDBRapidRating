import { ParseCsv, ToCsvRow } from "../../shared/csv.js";
import { ToNumber } from "./util.js";

const MovieMediaType = "movie";
const TvMediaType = "tv";
const RatedStatus = "rated";
const ImportedStatus = "imported";
const NotConfiguredStatus = "notConfigured";
const PendingStatus = "pending";
const TitleFieldName = "title";
const YearFieldName = "year";

export function BuildRatingRecord(movie, rating, status, liveConfigured) {
  return {
    status,
    rating,
    title: movie.title,
    year: movie.year || "",
    ttId: movie.ttId,
    mediaType: movie.mediaType === TvMediaType ? TvMediaType : MovieMediaType,
    at: new Date().toISOString(),
    ...InitialSubmitState(status, rating, liveConfigured)
  };
}

export function InitialSubmitState(status, rating, liveConfigured) {
  if (status !== RatedStatus)
    return { submitStatus: "skipped", submitError: "", submittedAt: "" };
  if (!IsValidImdbRating(rating))
    return { submitStatus: "localOnly", submitError: "IMDb only accepts ratings from 1 to 10.", submittedAt: "" };
  if (!liveConfigured)
    return { submitStatus: NotConfiguredStatus, submitError: "IMDb sign-in is required in this browser.", submittedAt: "" };
  return { submitStatus: PendingStatus, submitError: "", submittedAt: "" };
}

export function CanSubmitLive(record, liveConfigured) {
  if (!record)
    return false;
  return record.status === RatedStatus && liveConfigured && IsValidImdbRating(record.rating);
}

export function IsRetryableImdbSubmit(record) {
  if (!record)
    return false;
  const isRetryableStatus = ["failed", NotConfiguredStatus, PendingStatus].includes(record.submitStatus);
  return IsValidRatedRecord(record) && isRetryableStatus && !IsCsvSyncFailure(record);
}

export function IsCsvSyncFailure(record) {
  return String(record?.submitError || "").startsWith("IMDb saved, but local ratings CSV did not update");
}

export function BuildRateRequest(record) {
  return {
    titleId: record.ttId,
    rating: record.rating,
    title: record.title || "",
    year: record.year || "",
    at: record.at || new Date().toISOString(),
    mediaType: record.mediaType === TvMediaType ? TvMediaType : MovieMediaType
  };
}

export function BuildAiPreferenceProfile(records, movieById, recommendationExclusions = []) {
  return {
    ratings: BuildAiRatings(records, movieById),
    exclusions: BuildAiExclusions(recommendationExclusions),
    ratingScale: "1-10",
    fieldsSent: [TitleFieldName, YearFieldName, "genres", "rating", "excludedTitle", "excludedYear"]
  };
}

export function ImportImdbCsv(text, ratings, movieById, options = {}) {
  const rows = ParseCsv(text);
  if (!rows.length)
    return BuildImportResult(0, 0, 0, false);
  const indexes = ReadCsvIndexes(rows[0]);
  if (indexes.constIndex < 0)
    throw new Error("The CSV does not include a Const column.");
  return SyncCsvRows(rows.slice(1), indexes, ratings, movieById, options);
}

export function BuildCsvText(records) {
  const rows = [BuildCsvHeader()];
  for (const record of SortedRatingRecords(records))
    rows.push(ExportCsvRecord(record));
  return rows.map(ToCsvRow).join("\n");
}

export function SortedRatingRecords(records) {
  return Object.values(records).sort(CompareRatingRecords);
}

function IsValidRatedRecord(record) {
  return IsRatedLikeRecord(record) && IsValidImdbRating(record.rating);
}

function IsRatedLikeRecord(record) {
  return record.status === RatedStatus || record.status === ImportedStatus;
}

function IsValidImdbRating(rating) {
  return Number.isInteger(rating) && rating >= 1 && rating <= 10;
}

function ReadCsvIndexes(headers) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return {
    constIndex: normalized.indexOf("const"),
    ratingIndex: normalized.indexOf("your rating"),
    titleIndex: normalized.indexOf(TitleFieldName),
    titleTypeIndex: normalized.indexOf("title type"),
    yearIndex: normalized.indexOf(YearFieldName),
    dateIndex: normalized.indexOf("date rated")
  };
}

function SyncCsvRows(rows, indexes, ratings, movieById, options) {
  const nextImported = BuildImportedRatings(rows, indexes, movieById, options);
  const removed = RemoveStaleImportedRatings(ratings, nextImported);
  const applied = ApplyImportedRatings(ratings, nextImported);
  return BuildImportResult(nextImported.size, applied, removed, Boolean(applied || removed));
}

function BuildImportedRatings(rows, indexes, movieById, options) {
  const nextImported = new Map();
  for (const row of rows) {
    const imported = BuildImportedRatingFromRow(row, indexes, movieById, options);
    if (imported)
      nextImported.set(imported.ttId, imported);
  }
  return nextImported;
}

function BuildImportedRatingFromRow(row, indexes, movieById, options) {
  const ttId = (row[indexes.constIndex] || "").trim();
  if (!/^tt\d+$/.test(ttId))
    return null;
  if (!ShouldImportTitle(ttId, row, indexes, movieById, options))
    return null;
  return BuildImportedRating(ttId, row, indexes, movieById.get(ttId), options.mediaType);
}

function ShouldImportTitle(ttId, row, indexes, movieById, options) {
  const mediaType = options.mediaType === TvMediaType ? TvMediaType : MovieMediaType;
  if (movieById.has(ttId))
    return true;
  if (options.otherTitleIds?.has(ttId))
    return false;
  if (indexes.titleTypeIndex < 0)
    return mediaType === MovieMediaType;
  const titleType = String(row[indexes.titleTypeIndex] || "").toLowerCase().replace(/[^a-z]/g, "");
  if (mediaType === TvMediaType)
    return titleType === "tvseries" || titleType === "tvminiseries";
  return titleType === MovieMediaType;
}

function RemoveStaleImportedRatings(ratings, nextImported) {
  let removed = 0;
  for (const [ttId, record] of Object.entries(ratings)) {
    if (record?.status !== ImportedStatus || nextImported.has(ttId))
      continue;
    delete ratings[ttId];
    removed++;
  }
  return removed;
}

function ApplyImportedRatings(ratings, nextImported) {
  let applied = 0;
  for (const [ttId, imported] of nextImported) {
    if (ShouldKeepExistingRating(ratings, ttId))
      continue;
    ratings[ttId] = imported;
    applied++;
  }
  return applied;
}

function ShouldKeepExistingRating(ratings, ttId) {
  return ratings[ttId]?.status === RatedStatus;
}

function BuildImportResult(count, applied, removed, changed) {
  return { count, applied, removed, changed };
}

function BuildImportedRating(ttId, row, indexes, known, mediaType) {
  return {
    status: ImportedStatus,
    rating: indexes.ratingIndex >= 0 ? ToNumber(row[indexes.ratingIndex]) : null,
    title: known?.title || row[indexes.titleIndex] || "",
    year: known?.year || ToNumber(row[indexes.yearIndex]) || "",
    ttId,
    mediaType: mediaType === TvMediaType ? TvMediaType : MovieMediaType,
    at: row[indexes.dateIndex] || new Date().toISOString(),
    submitStatus: ImportedStatus,
    submitError: "",
    submittedAt: ""
  };
}

function BuildCsvHeader() {
  return ["Const", "Title", "Media Type", "Year", "Rating", "Status", "Submit Status", "Submit Error", "Submitted At", "Date Rated"];
}

function ExportCsvRecord(record) {
  return [
    record.ttId,
    record.title || "",
    record.mediaType || MovieMediaType,
    record.year || "",
    record.rating ?? "",
    record.status,
    record.submitStatus || "",
    record.submitError || "",
    record.submittedAt || "",
    record.at || ""
  ];
}

function CompareRatingRecords(left, right) {
  return String(left.at || "").localeCompare(String(right.at || ""));
}

function BuildAiRatings(records, movieById) {
  return SortedRatingRecords(records).map((record) => BuildAiRating(record, movieById)).filter(Boolean);
}

function BuildAiExclusions(exclusions) {
  const normalized = exclusions.map(BuildAiExclusion);
  return normalized.filter((item) => item.title);
}

function BuildAiExclusion(item) {
  return {
    title: String(item?.title || "").trim(),
    year: Number(item?.year) || null
  };
}

function BuildAiRating(record, movieById) {
  if (!IsValidRatedRecord(record))
    return null;
  const movie = movieById.get(record.ttId) || {};
  return {
    title: record.title || movie.title || "",
    year: record.year || movie.year || null,
    genres: movie.genres || [],
    rating: record.rating
  };
}
