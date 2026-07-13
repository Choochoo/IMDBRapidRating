import { ParseCsv, ToCsvRow } from "../../shared/csv.js";
import { ToNumber } from "./util.js";

export function BuildRatingRecord(movie, rating, status, liveConfigured) {
  return {
    status,
    rating,
    title: movie.title,
    year: movie.year || "",
    ttId: movie.ttId,
    at: new Date().toISOString(),
    ...InitialSubmitState(status, rating, liveConfigured)
  };
}

export function InitialSubmitState(status, rating, liveConfigured) {
  if (status !== "rated")
    return { submitStatus: "skipped", submitError: "", submittedAt: "" };
  if (!IsValidImdbRating(rating))
    return { submitStatus: "localOnly", submitError: "IMDb only accepts ratings from 1 to 10.", submittedAt: "" };
  if (!liveConfigured)
    return { submitStatus: "notConfigured", submitError: "Live IMDb cookie is not configured.", submittedAt: "" };
  return { submitStatus: "pending", submitError: "", submittedAt: "" };
}

export function CanSubmitLive(record, liveConfigured) {
  if (!record)
    return false;
  return record.status === "rated" && liveConfigured && IsValidImdbRating(record.rating);
}

export function IsRetryableImdbSubmit(record) {
  if (!record)
    return false;
  const isRetryableStatus = ["failed", "notConfigured", "pending"].includes(record.submitStatus);
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
    at: record.at || new Date().toISOString()
  };
}

export function ImportImdbCsv(text, ratings, movieById) {
  const rows = ParseCsv(text);
  if (!rows.length)
    return BuildImportResult(0, 0, 0, false);
  const indexes = ReadCsvIndexes(rows[0]);
  if (indexes.constIndex < 0)
    throw new Error("The CSV does not include a Const column.");
  return SyncCsvRows(rows.slice(1), indexes, ratings, movieById);
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
  return record.status === "rated" && IsValidImdbRating(record.rating);
}

function IsValidImdbRating(rating) {
  return Number.isInteger(rating) && rating >= 1 && rating <= 10;
}

function ReadCsvIndexes(headers) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return {
    constIndex: normalized.indexOf("const"),
    ratingIndex: normalized.indexOf("your rating"),
    titleIndex: normalized.indexOf("title"),
    yearIndex: normalized.indexOf("year"),
    dateIndex: normalized.indexOf("date rated")
  };
}

function SyncCsvRows(rows, indexes, ratings, movieById) {
  const nextImported = BuildImportedRatings(rows, indexes, movieById);
  const removed = RemoveStaleImportedRatings(ratings, nextImported);
  const applied = ApplyImportedRatings(ratings, nextImported);
  return BuildImportResult(nextImported.size, applied, removed, Boolean(applied || removed));
}

function BuildImportedRatings(rows, indexes, movieById) {
  const nextImported = new Map();
  for (const row of rows) {
    const imported = BuildImportedRatingFromRow(row, indexes, movieById);
    if (imported)
      nextImported.set(imported.ttId, imported);
  }
  return nextImported;
}

function BuildImportedRatingFromRow(row, indexes, movieById) {
  const ttId = (row[indexes.constIndex] || "").trim();
  if (!/^tt\d+$/.test(ttId))
    return null;
  return BuildImportedRating(ttId, row, indexes, movieById.get(ttId));
}

function RemoveStaleImportedRatings(ratings, nextImported) {
  let removed = 0;
  for (const [ttId, record] of Object.entries(ratings)) {
    if (record?.status !== "imported" || nextImported.has(ttId))
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
  return ratings[ttId]?.status === "rated";
}

function BuildImportResult(count, applied, removed, changed) {
  return { count, applied, removed, changed };
}

function BuildImportedRating(ttId, row, indexes, known) {
  return {
    status: "imported",
    rating: indexes.ratingIndex >= 0 ? ToNumber(row[indexes.ratingIndex]) : null,
    title: known?.title || row[indexes.titleIndex] || "",
    year: known?.year || ToNumber(row[indexes.yearIndex]) || "",
    ttId,
    at: row[indexes.dateIndex] || new Date().toISOString(),
    submitStatus: "imported",
    submitError: "",
    submittedAt: ""
  };
}

function BuildCsvHeader() {
  return ["Const", "Title", "Year", "Rating", "Status", "Submit Status", "Submit Error", "Submitted At", "Date Rated"];
}

function ExportCsvRecord(record) {
  return [
    record.ttId,
    record.title || "",
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
