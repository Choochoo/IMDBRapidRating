import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ParseCsv, ToCsvRow } from "../shared/csv.js";
import { BuildUserDataPath, EnsureUserDataParent, MigrateLegacyFile } from "./user-data.mjs";

export const RatingsCsvMaxBytes = 10 * 1024 * 1024;

const RatingsCsvFile = "imdb-ratings.csv";
const DefaultHeaders = Object.freeze(["Const", "Your Rating", "Date Rated", "Title", "Title Type", "Year"]);

export function ReadSavedRatingsCsv(rootPath) {
  const filePath = BuildRatingsCsvPath(rootPath);
  if (!existsSync(filePath))
    return Fail(404, "RATINGS_CSV_MISSING", "No saved IMDb ratings CSV exists yet.");
  const csv = readFileSync(filePath, "utf8");
  return Ok({ csv, ...BuildCsvStatus(csv) });
}

export async function SaveRatingsCsv(rootPath, csvText) {
  const csv = NormalizeCsvText(csvText);
  const validationError = ValidateRatingsCsv(csv);
  if (validationError)
    return validationError;
  await WriteRatingsCsv(rootPath, csv);
  return Ok(BuildCsvStatus(csv));
}

export async function UpsertRatingsCsvRating(rootPath, record) {
  const rating = BuildRatingRecord(record);
  if (rating.error)
    return rating.error;
  const currentCsv = ReadExistingOrDefaultCsv(rootPath);
  const updatedCsv = BuildUpsertedCsv(currentCsv, rating);
  await WriteRatingsCsv(rootPath, updatedCsv);
  return Ok(BuildCsvStatus(updatedCsv));
}

export async function RemoveRatingsCsvRating(rootPath, ttId) {
  const title = BuildTitleRecord(ttId);
  if (title.error)
    return title.error;
  const currentCsv = ReadExistingOrDefaultCsv(rootPath);
  const updatedCsv = BuildRemovedCsv(currentCsv, title.ttId);
  await WriteRatingsCsv(rootPath, updatedCsv);
  return Ok(BuildCsvStatus(updatedCsv));
}

function BuildRatingsCsvPath(rootPath) {
  const filePath = BuildUserDataPath("ratings", RatingsCsvFile);
  if (rootPath)
    MigrateLegacyFile(path.join(rootPath, "data", RatingsCsvFile), filePath);
  return filePath;
}

function NormalizeCsvText(csvText) {
  return `${String(csvText || "").trim()}\n`;
}

function ValidateRatingsCsv(csv) {
  if (!csv.trim())
    return Fail(422, "RATINGS_CSV_EMPTY", "The IMDb ratings CSV is empty.");
  const rows = ParseCsv(csv);
  const indexes = BuildHeaderIndexes(rows[0] || []);
  if (indexes.constIndex < 0)
    return Fail(422, "RATINGS_CSV_MISSING_CONST", "The IMDb ratings CSV must include a Const column.");
  return null;
}

function ReadExistingOrDefaultCsv(rootPath) {
  const filePath = BuildRatingsCsvPath(rootPath);
  if (existsSync(filePath))
    return readFileSync(filePath, "utf8");
  return `${ToCsvRow(DefaultHeaders)}\n`;
}

function BuildUpsertedCsv(csv, record) {
  const rows = ParseCsv(csv);
  const headers = EnsureHeaders(rows[0] || DefaultHeaders);
  const indexes = BuildHeaderIndexes(headers);
  const dataRows = NormalizeDataRows(rows.slice(1), headers.length);
  const existing = dataRows.find((row) => row[indexes.constIndex] === record.ttId);
  if (existing)
    UpdateCsvRow(existing, indexes, record);
  else
    dataRows.push(BuildCsvRow(headers, indexes, record));
  return `${[headers, ...dataRows].map(ToCsvRow).join("\n")}\n`;
}

function BuildRemovedCsv(csv, ttId) {
  const rows = ParseCsv(csv);
  const headers = EnsureHeaders(rows[0] || DefaultHeaders);
  const indexes = BuildHeaderIndexes(headers);
  const dataRows = NormalizeDataRows(rows.slice(1), headers.length);
  const keptRows = dataRows.filter((row) => row[indexes.constIndex] !== ttId);
  return `${[headers, ...keptRows].map(ToCsvRow).join("\n")}\n`;
}

function EnsureHeaders(headers) {
  const output = headers.slice();
  for (const header of DefaultHeaders) {
    if (!HasHeader(output, header))
      output.push(header);
  }
  return output;
}

function HasHeader(headers, header) {
  return headers.some((item) => item.trim().toLowerCase() === header.toLowerCase());
}

function BuildHeaderIndexes(headers) {
  return {
    constIndex: FindHeaderIndex(headers, "const"),
    ratingIndex: FindHeaderIndex(headers, "your rating"),
    dateIndex: FindHeaderIndex(headers, "date rated"),
    titleIndex: FindHeaderIndex(headers, "title"),
    titleTypeIndex: FindHeaderIndex(headers, "title type"),
    yearIndex: FindHeaderIndex(headers, "year")
  };
}

function FindHeaderIndex(headers, name) {
  return headers.findIndex((header) => header.trim().toLowerCase() === name);
}

function NormalizeDataRows(rows, length) {
  return rows.filter((row) => row.some(Boolean)).map((row) => PadRow(row, length));
}

function PadRow(row, length) {
  const output = row.slice();
  while (output.length < length)
    output.push("");
  return output;
}

function BuildCsvRow(headers, indexes, record) {
  const row = Array(headers.length).fill("");
  UpdateCsvRow(row, indexes, record);
  return row;
}

function UpdateCsvRow(row, indexes, record) {
  SetCsvValue(row, indexes.constIndex, record.ttId);
  SetCsvValue(row, indexes.ratingIndex, record.rating);
  SetCsvValue(row, indexes.dateIndex, FormatCsvDate(record.at));
  SetCsvValue(row, indexes.titleIndex, record.title);
  SetCsvValue(row, indexes.titleTypeIndex, record.mediaType === "tv" ? "TV Series" : "Movie");
  SetCsvValue(row, indexes.yearIndex, record.year);
}

function SetCsvValue(row, index, value) {
  if (index >= 0)
    row[index] = String(value ?? "");
}

function BuildRatingRecord(record) {
  const ttId = String(record?.ttId || "").trim();
  const rating = Number(record?.rating);
  const title = BuildTitleRecord(ttId);
  if (title.error)
    return title;
  const isValidRating = Number.isInteger(rating) && rating >= 1 && rating <= 10;
  if (!isValidRating)
    return { error: Fail(422, "INVALID_RATING", "IMDb CSV sync only accepts ratings from 1 to 10.") };
  return BuildValidRatingRecord(record, ttId, rating);
}

function BuildTitleRecord(ttId) {
  if (!/^tt\d+$/.test(ttId))
    return { error: Fail(400, "INVALID_TITLE_ID", "ttId must look like tt0111161.") };
  return { ttId, error: null };
}

function BuildValidRatingRecord(record, ttId, rating) {
  return {
    ttId,
    rating,
    title: String(record?.title || ""),
    mediaType: record?.mediaType === "tv" ? "tv" : "movie",
    year: record?.year || "",
    at: record?.at || new Date().toISOString()
  };
}

function FormatCsvDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime()))
    return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

async function WriteRatingsCsv(rootPath, csv) {
  const filePath = BuildRatingsCsvPath(rootPath);
  EnsureUserDataParent(filePath);
  await writeFile(filePath, csv, "utf8");
}

function BuildCsvStatus(csv) {
  const rows = ParseCsv(csv);
  const indexes = BuildHeaderIndexes(rows[0] || []);
  const count = rows.slice(1).filter((row) => /^tt\d+$/.test(row[indexes.constIndex] || "")).length;
  return { count, updatedAt: new Date().toISOString() };
}

function Ok(payload) {
  return {
    status: 200,
    payload: { ok: true, ...payload }
  };
}

function Fail(status, code, error) {
  return {
    status,
    payload: { ok: false, code, error }
  };
}
