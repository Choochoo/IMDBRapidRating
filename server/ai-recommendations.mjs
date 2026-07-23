import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RequestAiChat } from "./ai-client.mjs";
import { NormalizeRecommendationQueue, SameRecommendation } from "./recommendation-queue.mjs";
import { HasActiveTitleFilters, IsTitleAllowed, NormalizeTitleFilters, NormalizeTitleOrigin } from "../shared/title-filters.js";

const MaximumRecommendationCount = 99;
const RecommendationAttempts = 3;
const MovieMediaType = "movie";
const TvMediaType = "tv";
const CombinedTasteValue = "both";
const FriendsTasteValue = "friends";
const FriendAudience = "friend";
const CurrentTasteValue = "current";
const MineTasteValue = "mine";
const OtherTasteValue = "other";
const MoviesLabel = "movies";
const TvLabel = "TV";
const TvSeriesLabel = "TV series";
const SchemaArrayType = "array";
const SchemaObjectType = "object";
const SpaceSeparator = " ";
const SchemaStringType = "string";
const TitleFieldName = "title";
const YearFieldName = "year";
const GenresFieldName = "genres";

export function GetAiStatus() {
  return {
    configured: false,
    model: "",
    baseUrl: "",
    endpoint: "/api/ai/recommendations"
  };
}

export async function GenerateAiRecommendations(rootPath, options = {}) {
  const count = ReadRecommendationCount(options.count);
  if (!count)
    return Fail(422, "INVALID_RECOMMENDATION_COUNT", "Choose between 1 and 99 recommendations.");
  if (!String(options.baseUrl || "").trim() || !String(options.model || "").trim())
    return Fail(422, "AI_CONNECTION_MISSING", "Connect an AI server and choose a model first.");
  const profile = BuildPreferenceProfile(options);
  if (!profile.payload.ok)
    return profile;
  return await GenerateUniqueRecommendations(rootPath, profile.payload.profile, { ...options, count });
}

async function GenerateUniqueRecommendations(rootPath, profile, options) {
  const state = { accepted: [], summary: "", model: "" };
  for (let attempt = 0; attempt < RecommendationAttempts && state.accepted.length < options.count; attempt++) {
    const result = await ReadRecommendationAttempt(rootPath, profile, options, state.accepted);
    if (!result.payload.ok)
      return result;
    ApplyRecommendationResult(state, result, options.count);
  }
  return Ok({ summary: state.summary || "Recommendations ready.", recommendations: state.accepted, model: state.model });
}

async function ReadRecommendationAttempt(rootPath, profile, options, accepted) {
  const remaining = options.count - accepted.length;
  const requestProfile = { ...profile, queue: [...profile.queue, ...accepted.map(ToProfileMovie)] };
  const result = await RequestCompatibleRecommendations(requestProfile, { ...options, count: remaining });
  if (!result.payload.ok)
    return result;
  return Ok({ ...result.payload, recommendations: EnrichRecommendationPayload(rootPath, result.payload, requestProfile).recommendations });
}

function ApplyRecommendationResult(state, result, limit) {
  state.summary ||= result.payload.summary || "";
  state.model = result.payload.model || state.model;
  for (const item of result.payload.recommendations) {
    if (state.accepted.length >= limit)
      break;
    if (!state.accepted.some((existing) => SameRecommendation(existing, item)))
      state.accepted.push(item);
  }
}

function BuildPreferenceProfile(options) {
  const profile = NormalizeProfile(options.profile);
  const mediaType = options.mediaType === TvMediaType ? TvMediaType : MovieMediaType;
  const ownRatings = NormalizeRatings(profile.ratings, mediaType);
  const friendRatings = NormalizeRatings(options.friendRatings, mediaType);
  const ratings = SelectAudienceRatings(ownRatings, friendRatings, options.tasteAudience);
  if (ratings.length < 5)
    return Fail(422, "NOT_ENOUGH_RATINGS", "Rate at least five titles in the selected taste source before asking for recommendations.");
  const ratedTargets = ReadRatedTargets(options, profile, ratings, mediaType);
  const exclusions = Array.isArray(options.targetExclusions) ? options.targetExclusions : profile.exclusions;
  const built = BuildProfile(ratings, ratedTargets, exclusions, options.queue, mediaType, options.filters, profile.tasteBasis);
  return Ok({ profile: { ...built, tasteAudience: NormalizeTasteAudience(options.tasteAudience) } });
}

function ReadRatedTargets(options, profile, ratings, mediaType) {
  if (Array.isArray(options.targetRatings))
    return options.targetRatings.map((rating) => NormalizeRating(rating, mediaType)).filter(Boolean);
  if (Array.isArray(profile.ratedTargets))
    return profile.ratedTargets;
  return ratings;
}

function NormalizeRatings(value, mediaType) {
  return (Array.isArray(value) ? value : []).map((rating) => NormalizeRating(rating, mediaType)).filter(Boolean);
}

function SelectAudienceRatings(ownRatings, friendRatings, audienceValue) {
  const audience = NormalizeTasteAudience(audienceValue);
  if (audience === FriendsTasteValue)
    return friendRatings;
  if (audience === CombinedTasteValue)
    return [...ownRatings, ...friendRatings];
  return ownRatings;
}

function BuildProfile(ratings, ratedTargets, exclusions, queue, mediaType, filters, tasteBasis) {
  return {
    mediaType,
    tasteBasis: NormalizeTasteBasis(tasteBasis),
    ratings: OptimizeRatings(ratings),
    ratedTargets: NormalizeProfileTitles(ratedTargets),
    exclusions: NormalizeExclusions(exclusions),
    queue: NormalizeRecommendationQueue(queue).map(ToProfileMovie),
    filters: BuildProfileFilters(filters),
    ratingScale: "1-10",
    fieldsSent: [TitleFieldName, YearFieldName, GenresFieldName, "rating", "sourceMediaType", "sourceAudience", "ratedTargetTitle", "ratedTargetYear", "queuedTitle", "queuedYear", "excludedTitle", "excludedYear", "filters", "tasteBasis", "tasteAudience"]
  };
}

function BuildProfileFilters(filters) {
  const { updatedAt, ...profileFilters } = NormalizeTitleFilters(filters);
  return profileFilters;
}

function OptimizeRatings(ratings) {
  return ratings.sort((left, right) => right.rating - left.rating);
}

async function RequestCompatibleRecommendations(profile, options) {
  const request = options.requestAiChat || RequestAiChat;
  const result = await request(options, BuildAiMessages(profile, options), ReadOutputTokenLimit(options.count));
  if (!result.payload.ok)
    return result;
  try {
    return Ok({ ...ParseRecommendationPayload(result.payload.content), model: result.payload.model || options.model });
  } catch {
    return Fail(502, "AI_RESPONSE_INVALID", "The AI server did not return the requested recommendation JSON.");
  }
}

function BuildAiMessages(profile, options) {
  return [
    { role: "system", content: BuildSystemPrompt(profile, options) },
    { role: "user", content: JSON.stringify(profile) }
  ];
}

function BuildSystemPrompt(profile, options) {
  const count = ReadRecommendationCount(options.count) || 9;
  const isTv = options.mediaType === TvMediaType;
  const scope = `Recommend ${count} ${isTv ? TvSeriesLabel : MoviesLabel} the user has not rated.`;
  const criteria = ReadRecommendationCriteria(isTv);
  const source = ReadTasteSource(profile, isTv);
  const evidence = `${source} Use profile.ratings only as taste evidence and use each sourceMediaType to interpret it. Regardless of the evidence source, return only ${isTv ? TvSeriesLabel : MoviesLabel}.`;
  const exclusions = "Never recommend anything already present in profile.ratedTargets, profile.queue, or profile.exclusions. ratedTargets are titles already rated in the requested section, the queue is that section's saved watchlist, and exclusions are that section's permanent do-not-recommend choices.";
  const filters = "Honor every profile.filters field exactly. A result must match its year, any selected genre, documentary mode, minimum IMDb rating, maximum runtime, included country or language lists, exclusions, Bollywood choice, and unknown-origin policy. Never use an unknown value to bypass a selected filter.";
  const why = "Explain the taste pattern and cite rating evidence from the user's data.";
  const format = "Use 2-4 evidence lines naming rated titles, ratings, genres, or eras.";
  const schema = `Return only JSON matching this schema: ${JSON.stringify(RecommendationSchema(count))}`;
  return [scope, criteria, evidence, exclusions, filters, why, format, schema].join(SpaceSeparator);
}

function ReadRecommendationCriteria(isTv) {
  if (isTv)
    return "Recommend whole series, not individual episodes or seasons. Consider title, premiere year, genre, series commitment, and user rating together.";
  return "Consider title, year, genre, and user rating together.";
}

function ReadTasteSource(profile, isTv) {
  if (profile.tasteAudience === FriendsTasteValue)
    return "The taste evidence comes from ratings shared by the user's selected friends.";
  if (profile.tasteAudience === CombinedTasteValue)
    return "The taste evidence combines the user's ratings with ratings shared by selected friends.";
  if (profile.tasteBasis === OtherTasteValue)
    return `The taste evidence comes from the user's ${isTv ? MovieMediaType : TvLabel} ratings.`;
  if (profile.tasteBasis === CombinedTasteValue)
    return "The taste evidence combines the user's movie and TV ratings.";
  return `The taste evidence comes from the user's ${isTv ? TvLabel : MovieMediaType} ratings.`;
}

function RecommendationSchema(count) {
  return {
    type: SchemaObjectType,
    additionalProperties: false,
    required: ["summary", "recommendations"],
    properties: RecommendationProperties(count)
  };
}

function RecommendationProperties(count) {
  return {
    summary: { type: SchemaStringType },
    recommendations: { type: SchemaArrayType, minItems: count, maxItems: count, items: RecommendationItemSchema() }
  };
}

function RecommendationItemSchema() {
  return {
    type: SchemaObjectType,
    additionalProperties: false,
    required: [TitleFieldName, YearFieldName, GenresFieldName, "originCountries", "originalLanguage", "why"],
    properties: RecommendationItemProperties()
  };
}

function RecommendationItemProperties() {
  return {
    title: { type: SchemaStringType },
    year: { type: "integer" },
    genres: { type: SchemaArrayType, items: { type: SchemaStringType } },
    originCountries: { type: SchemaArrayType, items: { type: SchemaStringType, pattern: "^[A-Z]{2}$" } },
    originalLanguage: { type: SchemaStringType, pattern: "^[a-z]{2,3}$" },
    why: RecommendationWhySchema()
  };
}

function RecommendationWhySchema() {
  return {
    type: SchemaObjectType,
    additionalProperties: false,
    required: ["tasteMatch", "ratingEvidence"],
    properties: RecommendationWhyProperties()
  };
}

function RecommendationWhyProperties() {
  return {
    tasteMatch: { type: SchemaStringType },
    ratingEvidence: { type: SchemaArrayType, items: { type: SchemaStringType } }
  };
}

function ParseRecommendationPayload(value) {
  return JSON.parse(ExtractJsonText(value));
}

function EnrichRecommendationPayload(rootPath, payload, profile) {
  const titles = ReadTitleList(rootPath, profile.mediaType);
  const recommendations = ReadRecommendations(payload);
  const blocked = [...profile.ratedTargets, ...profile.queue, ...profile.exclusions];
  const unique = FilterRecommendations(recommendations, titles, blocked, profile.filters);
  return { ...payload, recommendations: NormalizeRecommendationQueue(unique) };
}

function FilterRecommendations(recommendations, titles, blocked, filters) {
  const unique = [];
  for (const recommendation of recommendations) {
    const matchedTitle = FindRecommendationMovie(recommendation, titles);
    const item = EnrichRecommendation(recommendation, matchedTitle);
    if (HasActiveTitleFilters(filters) && (!matchedTitle || !IsTitleAllowed(item, filters)))
      continue;
    if (blocked.some((existing) => SameRecommendation(existing, item)) || unique.some((existing) => SameRecommendation(existing, item)))
      continue;
    unique.push(item);
  }
  return unique;
}

function ReadTitleList(rootPath, mediaType = MovieMediaType) {
  const filePath = path.join(rootPath, "data", mediaType === TvMediaType ? "shows.json" : "movies.json");
  if (!existsSync(filePath))
    return [];
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  const titles = payload.movies || payload.shows || payload.titles;
  return Array.isArray(titles) ? titles : [];
}

function ReadRecommendations(payload) {
  return Array.isArray(payload.recommendations) ? payload.recommendations : [];
}

function EnrichRecommendation(item, movie) {
  if (!movie)
    return { ...item, ...NormalizeTitleOrigin(item), ttId: "" };
  const origin = ReadRecommendationOrigin(item, movie);
  return {
    ...item,
    ...movie,
    ...origin,
    ttId: movie.ttId,
    title: movie.title || item.title,
    year: movie.year || item.year,
    why: item.why
  };
}

function ReadRecommendationOrigin(item, movie) {
  const catalogOrigin = NormalizeTitleOrigin(movie);
  if (catalogOrigin.originCountries.length || catalogOrigin.originalLanguage)
    return catalogOrigin;
  return NormalizeTitleOrigin(item);
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
  return CleanText(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, SpaceSeparator).trim();
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

function ExtractJsonText(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end >= start ? text.slice(start, end + 1) : text;
}

function NormalizeProfile(profile) {
  return profile && typeof profile === SchemaObjectType ? profile : {};
}

function NormalizeRating(item, fallbackMediaType = MovieMediaType) {
  const rating = Number(item?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10)
    return null;
  const title = CleanText(item.title);
  if (!title)
    return null;
  const sourceMediaType = item?.sourceMediaType || item?.mediaType;
  const sourceAudience = item?.sourceAudience === FriendAudience ? FriendAudience : "self";
  return BuildNormalizedRating(item, title, rating, sourceMediaType, sourceAudience, fallbackMediaType);
}

function BuildNormalizedRating(item, title, rating, sourceMediaType, sourceAudience, fallbackMediaType) {
  return {
    title,
    year: Number(item.year) || null,
    genres: ReadGenres(item.genres),
    rating,
    sourceMediaType: sourceMediaType === TvMediaType || sourceMediaType === MovieMediaType ? sourceMediaType : fallbackMediaType,
    sourceAudience
  };
}

function NormalizeProfileTitles(value) {
  if (!Array.isArray(value))
    return [];
  return value.map(ToProfileMovie).filter((item) => item.title);
}

function NormalizeTasteBasis(value) {
  return [CurrentTasteValue, OtherTasteValue, CombinedTasteValue].includes(value) ? value : CurrentTasteValue;
}

function NormalizeTasteAudience(value) {
  return [MineTasteValue, FriendsTasteValue, CombinedTasteValue].includes(value) ? value : MineTasteValue;
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

function CleanText(value) {
  return String(value || "").replace(/\s+/g, SpaceSeparator).trim();
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
