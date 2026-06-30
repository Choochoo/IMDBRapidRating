import { GetImdbCookie, GetTmdbApiKey, HasImdbAuthCookie, IsDryRun } from "./env.mjs";

const GraphqlUrl = "https://api.graphql.imdb.com/";
const Mutation = "mutation UpdateTitleRating($rating: Int!, $titleId: ID!) { rateTitle(input: {rating: $rating, titleId: $titleId}) { rating { value __typename } __typename }}";

export function GetImdbStatus() {
  return {
    configured: HasImdbAuthCookie() || IsDryRun(),
    dryRun: IsDryRun(),
    tmdbConfigured: Boolean(GetTmdbApiKey()),
    endpoint: "/api/rate",
    ratingScale: "1-10"
  };
}

export async function SubmitImdbRating(titleId, rating) {
  const request = BuildRatingRequest(titleId, rating);
  if (request.error)
    return request.error;
  if (IsDryRun())
    return Ok(BuildDryRunPayload(request));
  if (!HasImdbAuthCookie())
    return Fail(503, "IMDB_COOKIE_MISSING", "Set IMDB_COOKIE in .env.local or the shell before starting the server.");
  return await PostRatingToImdb(request.titleId, request.rating);
}

function BuildRatingRequest(titleId, rating) {
  const normalizedTitleId = String(titleId || "").trim();
  const normalizedRating = Number(rating);
  if (!/^tt\d+$/.test(normalizedTitleId))
    return { error: Fail(400, "INVALID_TITLE_ID", "titleId must look like tt0111161.") };
  if (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 10)
    return { error: Fail(422, "INVALID_RATING", "IMDb only accepts ratings from 1 to 10.") };
  return { titleId: normalizedTitleId, rating: normalizedRating, error: null };
}

function BuildDryRunPayload(request) {
  return {
    ok: true,
    dryRun: true,
    titleId: request.titleId,
    rating: request.rating
  };
}

async function PostRatingToImdb(titleId, rating) {
  const response = await fetch(GraphqlUrl, { method: "POST", headers: BuildHeaders(titleId), body: JSON.stringify(BuildBody(titleId, rating)) });
  const payload = ParseMaybeJson(await response.text());
  const error = BuildImdbError(response, payload);
  if (error)
    return error;
  const writtenRating = payload?.data?.rateTitle?.rating?.value;
  if (writtenRating !== rating)
    return Fail(502, "IMDB_UNEXPECTED_RESPONSE", "IMDb did not echo the requested rating.");
  return Ok({ ok: true, titleId, rating: writtenRating });
}

function BuildHeaders(titleId) {
  return {
    "accept": "application/graphql+json, application/json",
    "content-type": "application/json",
    "cookie": GetImdbCookie(),
    "origin": "https://www.imdb.com",
    "referer": `https://www.imdb.com/title/${titleId}/`,
    "user-agent": "Mozilla/5.0 IMDb Rapid Rater local proxy"
  };
}

function BuildBody(titleId, rating) {
  return {
    operationName: "UpdateTitleRating",
    query: Mutation,
    variables: { rating, titleId }
  };
}

function BuildImdbError(response, payload) {
  if (response.status === 429)
    return Fail(429, "IMDB_RATE_LIMITED", "IMDb rate limited the request. Slow down and retry later.");
  if (!response.ok)
    return Fail(response.status, "IMDB_HTTP_ERROR", `IMDb returned HTTP ${response.status}.`);
  if (Array.isArray(payload?.errors) && payload.errors.length)
    return BuildGraphqlError(payload.errors);
  return null;
}

function BuildGraphqlError(errors) {
  const message = errors.map((item) => item.message).filter(Boolean).join("; ") || "IMDb returned a GraphQL error.";
  const isAuthError = /auth|sign.?in|login/i.test(message);
  const code = isAuthError ? "IMDB_AUTHENTICATION_FAILED" : "IMDB_GRAPHQL_ERROR";
  const status = isAuthError ? 401 : 502;
  return Fail(status, code, message);
}

function Ok(payload) {
  return {
    status: 200,
    payload
  };
}

function Fail(status, code, error) {
  return {
    status,
    payload: { ok: false, code, error }
  };
}

function ParseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
