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
  if (rows.length < 2)
    return 0;
  const indexes = ReadCsvIndexes(rows[0]);
  if (indexes.constIndex < 0)
    throw new Error("The CSV does not include a Const column.");
  return ImportCsvRows(rows.slice(1), indexes, ratings, movieById);
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

function ImportCsvRows(rows, indexes, ratings, movieById) {
  let imported = 0;
  for (const row of rows) {
    if (ImportCsvRow(row, indexes, ratings, movieById))
      imported++;
  }
  return imported;
}

function ImportCsvRow(row, indexes, ratings, movieById) {
  const ttId = (row[indexes.constIndex] || "").trim();
  if (!/^tt\d+$/.test(ttId))
    return false;
  if (ShouldKeepExistingRating(ratings, ttId))
    return false;
  ratings[ttId] = BuildImportedRating(ttId, row, indexes, movieById.get(ttId));
  return true;
}

function ShouldKeepExistingRating(ratings, ttId) {
  return ratings[ttId]?.status === "rated";
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
