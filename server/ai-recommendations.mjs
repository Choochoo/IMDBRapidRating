import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ResolveOpenAiModel } from "./openai-models.mjs";

const OpenAiResponsesUrl = "https://api.openai.com/v1/responses";

export function GetAiStatus() {
  return {
    configured: false,
    model: "",
    modelLag: 2,
    endpoint: "/api/ai/recommendations"
  };
}

export async function GenerateAiRecommendations(rootPath, options = {}) {
  if (!ReadOpenAiApiKey(options))
    return Fail(422, "OPENAI_KEY_MISSING", "OpenAI API key is not configured.");
  const profile = BuildPreferenceProfile(options);
  if (!profile.payload.ok)
    return profile;
  const result = await RequestOpenAiRecommendations(profile.payload.profile, options);
  if (!result.payload.ok)
    return result;
  return Ok(EnrichRecommendationPayload(rootPath, result.payload, profile.payload.profile.exclusions));
}

function BuildPreferenceProfile(options) {
  const profile = NormalizeProfile(options.profile);
  const ratings = Array.isArray(profile.ratings) ? profile.ratings : [];
  if (ratings.length < 5)
    return Fail(422, "NOT_ENOUGH_RATINGS", "Import at least five rated IMDb rows before asking for recommendations.");
  return Ok({ profile: BuildProfile(ratings, profile.exclusions) });
}

function BuildProfile(ratings, exclusions) {
  return {
    ratings: OptimizeRatings(ratings.map(NormalizeRating).filter(Boolean)),
    exclusions: NormalizeExclusions(exclusions),
    ratingScale: "1-10",
    fieldsSent: ["title", "year", "genres", "rating", "excludedTitle", "excludedYear"]
  };
}

function OptimizeRatings(ratings) {
  return ratings.sort((left, right) => right.rating - left.rating);
}

async function RequestOpenAiRecommendations(profile, options) {
  const model = await ResolveOpenAiModel(options);
  const response = await fetch(OpenAiResponsesUrl, BuildOpenAiRequest(profile, options, model));
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    return Fail(response.status, "OPENAI_REQUEST_FAILED", ReadOpenAiError(payload, response.status));
  return Ok({ ...ParseRecommendationPayload(payload), model });
}

function BuildOpenAiRequest(profile, options, model) {
  return {
    method: "POST",
    headers: BuildOpenAiHeaders(options),
    body: JSON.stringify(BuildOpenAiBody(profile, options, model))
  };
}

function BuildOpenAiHeaders(options) {
  return {
    "authorization": `Bearer ${ReadOpenAiApiKey(options)}`,
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
  const exclusions = "Never recommend a movie listed in profile.exclusions; those are firm do-not-recommend choices.";
  const why = "Explain the taste pattern and cite rating evidence from the user's data.";
  const format = "Use 2-4 evidence lines naming rated titles, ratings, genres, or eras.";
  return [scope, criteria, exclusions, why, format, "Return only JSON matching the schema."].join(" ");
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

function EnrichRecommendationPayload(rootPath, payload, exclusions) {
  const movies = ReadMovieList(rootPath);
  const recommendations = ReadRecommendations(payload);
  const normalizedExclusions = NormalizeExclusions(exclusions);
  const enriched = recommendations.map((item) => EnrichRecommendation(item, movies));
  return { ...payload, recommendations: enriched.filter((item) => !IsExcludedRecommendation(item, normalizedExclusions)) };
}

function ReadMovieList(rootPath) {
  const filePath = path.join(rootPath, "data", "movies.json");
  if (!existsSync(filePath))
    return [];
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  return Array.isArray(payload.movies) ? payload.movies : [];
}

function ReadRecommendations(payload) {
  return Array.isArray(payload.recommendations) ? payload.recommendations : [];
}

function EnrichRecommendation(item, movies) {
  const movie = FindRecommendationMovie(item, movies);
  if (!movie)
    return { ...item, ttId: "" };
  return { ...item, ttId: movie.ttId, title: movie.title || item.title, year: movie.year || item.year };
}

function FindRecommendationMovie(item, movies) {
  const title = NormalizeMatchTitle(item.title);
  const year = Number(item.year) || null;
  return movies.find((movie) => IsRecommendationMovie(movie, title, year)) || null;
}

function IsRecommendationMovie(movie, title, year) {
  const titleMatches = NormalizeMatchTitle(movie.title) === title;
  if (!titleMatches)
    return false;
  if (!year || !movie.year)
    return true;
  return Number(movie.year) === year;
}

function NormalizeMatchTitle(value) {
  return CleanText(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function NormalizeExclusions(value) {
  if (!Array.isArray(value))
    return [];
  return value.map(NormalizeExclusion).filter(Boolean);
}

function NormalizeExclusion(item) {
  const title = CleanText(item?.title);
  if (!title)
    return null;
  return { title, year: Number(item?.year) || null };
}

function IsExcludedRecommendation(item, exclusions) {
  const title = NormalizeMatchTitle(item?.title);
  const year = Number(item?.year) || null;
  return exclusions.some((excluded) => {
    if (NormalizeMatchTitle(excluded.title) !== title)
      return false;
    return !excluded.year || !year || excluded.year === year;
  });
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

function NormalizeProfile(profile) {
  return profile && typeof profile === "object" ? profile : {};
}

function NormalizeRating(item) {
  const rating = Number(item?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10)
    return null;
  return {
    title: CleanText(item.title),
    year: Number(item.year) || null,
    genres: ReadGenres(item.genres),
    rating
  };
}

function ReadGenres(value) {
  if (Array.isArray(value))
    return value.filter(Boolean).map(CleanText).filter(Boolean);
  return CleanText(value).split(",").map(CleanText).filter(Boolean);
}

function ReadOpenAiApiKey(options) {
  return NormalizeBearerValue(options?.apiKey);
}

function NormalizeBearerValue(value) {
  return String(value || "").trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "");
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
