import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ResolveOpenAiModel } from "./openai-models.mjs";
import { NormalizeRecommendationQueue, SameRecommendation } from "./recommendation-queue.mjs";

const OpenAiResponsesUrl = "https://api.openai.com/v1/responses";
const MaximumRecommendationCount = 99;
const RecommendationAttempts = 3;

export function GetAiStatus() {
  return {
    configured: false,
    model: "",
    modelLag: 2,
    endpoint: "/api/ai/recommendations"
  };
}

export async function GenerateAiRecommendations(rootPath, options = {}) {
  const count = ReadRecommendationCount(options.count);
  if (!count)
    return Fail(422, "INVALID_RECOMMENDATION_COUNT", "Choose between 1 and 99 recommendations.");
  if (!ReadOpenAiApiKey(options))
    return Fail(422, "OPENAI_KEY_MISSING", "OpenAI API key is not configured.");
  const profile = BuildPreferenceProfile(options);
  if (!profile.payload.ok)
    return profile;
  return await GenerateUniqueRecommendations(rootPath, profile.payload.profile, { ...options, count });
}

async function GenerateUniqueRecommendations(rootPath, profile, options) {
  const accepted = [];
  let summary = "";
  let model = "";
  for (let attempt = 0; attempt < RecommendationAttempts && accepted.length < options.count; attempt++) {
    const remaining = options.count - accepted.length;
    const requestProfile = { ...profile, queue: [...profile.queue, ...accepted.map(ToProfileMovie)] };
    const result = await RequestOpenAiRecommendations(requestProfile, { ...options, count: remaining });
    if (!result.payload.ok)
      return result;
    summary ||= result.payload.summary || "";
    model = result.payload.model || model;
    const enriched = EnrichRecommendationPayload(rootPath, result.payload, requestProfile);
    for (const item of enriched.recommendations) {
      if (accepted.length >= options.count)
        break;
      if (accepted.some((existing) => SameRecommendation(existing, item)))
        continue;
      accepted.push(item);
    }
  }
  return Ok({ summary: summary || "Recommendations ready.", recommendations: accepted, model });
}

function BuildPreferenceProfile(options) {
  const profile = NormalizeProfile(options.profile);
  const ratings = Array.isArray(profile.ratings) ? profile.ratings : [];
  if (ratings.length < 5)
    return Fail(422, "NOT_ENOUGH_RATINGS", "Import at least five rated IMDb rows before asking for recommendations.");
  return Ok({ profile: BuildProfile(ratings, profile.exclusions, options.queue) });
}

function BuildProfile(ratings, exclusions, queue) {
  return {
    ratings: OptimizeRatings(ratings.map(NormalizeRating).filter(Boolean)),
    exclusions: NormalizeExclusions(exclusions),
    queue: NormalizeRecommendationQueue(queue).map(ToProfileMovie),
    ratingScale: "1-10",
    fieldsSent: ["title", "year", "genres", "rating", "queuedTitle", "queuedYear", "excludedTitle", "excludedYear"]
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
    text: { format: BuildRecommendationSchema(options.count) },
    max_output_tokens: ReadOutputTokenLimit(options.count)
  };
}

function BuildOpenAiInput(profile, options) {
  return [
    { role: "system", content: BuildSystemPrompt(options) },
    { role: "user", content: JSON.stringify(profile) }
  ];
}

function BuildSystemPrompt(options) {
  const count = ReadRecommendationCount(options.count) || 9;
  const scope = `Recommend ${count} movies the user has not rated.`;
  const criteria = "Consider title, year, genre, and user rating together.";
  const exclusions = "Never recommend anything already present in profile.ratings, profile.queue, or profile.exclusions. The queue is the user's saved watchlist and exclusions are permanent do-not-recommend choices.";
  const why = "Explain the taste pattern and cite rating evidence from the user's data.";
  const format = "Use 2-4 evidence lines naming rated titles, ratings, genres, or eras.";
  return [scope, criteria, exclusions, why, format, "Return only JSON matching the schema."].join(" ");
}

function BuildRecommendationSchema(count) {
  return {
    type: "json_schema",
    name: "movie_recommendations",
    strict: true,
    schema: RecommendationSchema(count)
  };
}

function RecommendationSchema(count) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "recommendations"],
    properties: RecommendationProperties(count)
  };
}

function RecommendationProperties(count) {
  return {
    summary: { type: "string" },
    recommendations: { type: "array", minItems: count, maxItems: count, items: RecommendationItemSchema() }
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

function EnrichRecommendationPayload(rootPath, payload, profile) {
  const movies = ReadMovieList(rootPath);
  const recommendations = ReadRecommendations(payload);
  const blocked = [...profile.ratings, ...profile.queue, ...profile.exclusions];
  const unique = [];
  const enriched = recommendations.map((item) => EnrichRecommendation(item, movies));
  for (const item of enriched) {
    if (blocked.some((existing) => SameRecommendation(existing, item)) || unique.some((existing) => SameRecommendation(existing, item)))
      continue;
    unique.push(item);
  }
  return { ...payload, recommendations: NormalizeRecommendationQueue(unique) };
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

function ToProfileMovie(value) {
  return {
    title: CleanText(value?.title),
    year: Number(value?.year) || null
  };
}

export function ReadRecommendationCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MaximumRecommendationCount ? count : 0;
}

export function ReadOutputTokenLimit(value) {
  const count = ReadRecommendationCount(value) || 9;
  return Math.min(30_000, Math.max(3_200, 800 + count * 280));
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
