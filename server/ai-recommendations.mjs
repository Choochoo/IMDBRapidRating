import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { GetOpenAiApiKey, GetOpenAiModel, GetOpenAiModelLag } from "./env.mjs";
import { ResolveOpenAiModel } from "./openai-models.mjs";
import { ReadSavedRatingsCsv } from "./ratings-csv.mjs";
import { ParseCsv } from "../shared/csv.js";

const OpenAiResponsesUrl = "https://api.openai.com/v1/responses";
const MaxPreferenceItems = 500;

export function GetAiStatus() {
  return {
    configured: Boolean(GetOpenAiApiKey()),
    model: GetOpenAiModel(),
    modelLag: GetOpenAiModelLag(),
    endpoint: "/api/ai/recommendations"
  };
}

export async function GenerateAiRecommendations(rootPath, options = {}) {
  if (!GetOpenAiApiKey())
    return Fail(422, "OPENAI_KEY_MISSING", "OpenAI API key is not configured.");
  const profile = BuildPreferenceProfile(rootPath);
  if (!profile.payload.ok)
    return profile;
  return await RequestOpenAiRecommendations(profile.payload.profile, options);
}

function BuildPreferenceProfile(rootPath) {
  const csvResult = ReadSavedRatingsCsv(rootPath);
  if (!csvResult.payload.ok)
    return csvResult;
  const movies = ReadMovieLookup(rootPath);
  const ratings = BuildRatedMovies(csvResult.payload.csv, movies);
  if (ratings.length < 5)
    return Fail(422, "NOT_ENOUGH_RATINGS", "Import at least five rated IMDb rows before asking for recommendations.");
  return Ok({ profile: BuildProfile(ratings) });
}

function ReadMovieLookup(rootPath) {
  const filePath = path.join(rootPath, "data", "movies.json");
  if (!existsSync(filePath))
    return new Map();
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  return new Map((payload.movies || []).map((movie) => [movie.ttId, movie]));
}

function BuildRatedMovies(csv, movies) {
  const rows = ParseCsv(csv);
  const indexes = BuildCsvIndexes(rows[0] || []);
  return rows.slice(1).map((row) => BuildRatedMovie(row, indexes, movies)).filter(Boolean);
}

function BuildCsvIndexes(headers) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return {
    constIndex: normalized.indexOf("const"),
    ratingIndex: normalized.indexOf("your rating"),
    titleIndex: normalized.indexOf("title"),
    yearIndex: normalized.indexOf("year"),
    genreIndex: normalized.indexOf("genres")
  };
}

function BuildRatedMovie(row, indexes, movies) {
  const rating = Number(row[indexes.ratingIndex]);
  const isValidRating = Number.isInteger(rating) && rating >= 1 && rating <= 10;
  if (!isValidRating)
    return null;
  const known = movies.get(row[indexes.constIndex]);
  return BuildAiMovie(row, indexes, known, rating);
}

function BuildAiMovie(row, indexes, known, rating) {
  return {
    title: CleanText(known?.title || row[indexes.titleIndex]),
    year: known?.year || Number(row[indexes.yearIndex]) || null,
    genres: ReadGenres(known?.genres || row[indexes.genreIndex]),
    rating
  };
}

function BuildProfile(ratings) {
  return {
    ratings: OptimizeRatings(ratings),
    ratingScale: "1-10",
    fieldsSent: ["title", "year", "genres", "rating"]
  };
}

function OptimizeRatings(ratings) {
  return ratings.sort((left, right) => right.rating - left.rating).slice(0, MaxPreferenceItems);
}

async function RequestOpenAiRecommendations(profile, options) {
  const model = await ResolveOpenAiModel();
  const response = await fetch(OpenAiResponsesUrl, BuildOpenAiRequest(profile, options, model));
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    return Fail(response.status, "OPENAI_REQUEST_FAILED", ReadOpenAiError(payload, response.status));
  return Ok({ ...ParseRecommendationPayload(payload), model });
}

function BuildOpenAiRequest(profile, options, model) {
  return {
    method: "POST",
    headers: BuildOpenAiHeaders(),
    body: JSON.stringify(BuildOpenAiBody(profile, options, model))
  };
}

function BuildOpenAiHeaders() {
  return {
    "authorization": `Bearer ${GetOpenAiApiKey()}`,
    "content-type": "application/json"
  };
}

function BuildOpenAiBody(profile, options, model) {
  return {
    model,
    input: BuildOpenAiInput(profile, options),
    text: { format: BuildRecommendationSchema() },
    max_output_tokens: 3200
  };
}

function BuildOpenAiInput(profile, options) {
  return [
    { role: "system", content: BuildSystemPrompt(options) },
    { role: "user", content: JSON.stringify(profile) }
  ];
}

function BuildSystemPrompt(options) {
  const count = Number(options.count) || 12;
  const scope = `Recommend ${count} movies the user has not rated.`;
  const criteria = "Consider title, year, genre, and user rating together.";
  const why = "Explain the taste pattern and cite rating evidence from the user's data.";
  const format = "Use 2-4 evidence lines naming rated titles, ratings, genres, or eras.";
  return [scope, criteria, why, format, "Return only JSON matching the schema."].join(" ");
}

function BuildRecommendationSchema() {
  return {
    type: "json_schema",
    name: "movie_recommendations",
    strict: true,
    schema: RecommendationSchema()
  };
}

function RecommendationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "recommendations"],
    properties: RecommendationProperties()
  };
}

function RecommendationProperties() {
  return {
    summary: { type: "string" },
    recommendations: { type: "array", items: RecommendationItemSchema() }
  };
}

function RecommendationItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "year", "genres", "why"],
    properties: RecommendationItemProperties()
  };
}

function RecommendationItemProperties() {
  return {
    title: { type: "string" },
    year: { type: "integer" },
    genres: { type: "array", items: { type: "string" } },
    why: RecommendationWhySchema()
  };
}

function RecommendationWhySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["tasteMatch", "ratingEvidence"],
    properties: RecommendationWhyProperties()
  };
}

function RecommendationWhyProperties() {
  return {
    tasteMatch: { type: "string" },
    ratingEvidence: { type: "array", items: { type: "string" } }
  };
}

function ParseRecommendationPayload(payload) {
  const text = ExtractResponseText(payload);
  return JSON.parse(text);
}

function ExtractResponseText(payload) {
  if (payload?.output_text)
    return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const content = output.flatMap((item) => item.content || []);
  const text = content.map((item) => item.text || "");
  return text.join("");
}

function ReadOpenAiError(payload, status) {
  return payload?.error?.message || `OpenAI returned HTTP ${status}.`;
}

function ReadGenres(value) {
  if (Array.isArray(value))
    return value.filter(Boolean).map(CleanText).filter(Boolean);
  return CleanText(value).split(",").map(CleanText).filter(Boolean);
}

function CleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
