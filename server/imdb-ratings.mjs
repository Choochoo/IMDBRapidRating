import { GetImdbCookie, GetTmdbApiKey, HasImdbAuthCookie, IsDryRun } from "./env.mjs";

const GraphqlUrl = "https://api.graphql.imdb.com/";
const RateMutation = "mutation UpdateTitleRating($rating: Int!, $titleId: ID!) { " +
  "rateTitle(input: {rating: $rating, titleId: $titleId}) { rating { value __typename } __typename }}";
const DeleteMutation = "mutation DeleteTitleRating($titleId: ID!) { " +
  "deleteTitleRating(input: {titleId: $titleId}) { __typename }}";

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
    return Fail(503, "IMDB_COOKIE_MISSING", "Save your IMDb cookie in the app or set IMDB_COOKIE before starting the server.");
  return await PostRatingToImdb(request.titleId, request.rating);
}

export async function DeleteImdbRating(titleId) {
  const request = BuildTitleRequest(titleId);
  if (request.error)
    return request.error;
  if (IsDryRun())
    return Ok(BuildDryRunDeletePayload(request));
  if (!HasImdbAuthCookie())
    return Fail(503, "IMDB_COOKIE_MISSING", "Set IMDB_COOKIE before deleting IMDb ratings.");
  return await DeleteRatingFromImdb(request.titleId);
}

function BuildRatingRequest(titleId, rating) {
  const request = BuildTitleRequest(titleId);
  if (request.error)
    return request;
  const normalizedRating = Number(rating);
  const isValidRating = Number.isInteger(normalizedRating) && normalizedRating >= 1 && normalizedRating <= 10;
  if (!isValidRating)
    return { error: Fail(422, "INVALID_RATING", "IMDb only accepts ratings from 1 to 10.") };
  return { ...request, rating: normalizedRating };
}

function BuildTitleRequest(titleId) {
  const normalizedTitleId = String(titleId || "").trim();
  if (!/^tt\d+$/.test(normalizedTitleId))
    return { error: Fail(400, "INVALID_TITLE_ID", "titleId must look like tt0111161.") };
  return { titleId: normalizedTitleId, error: null };
}

function BuildDryRunPayload(request) {
  return {
    ok: true,
    dryRun: true,
    titleId: request.titleId,
    rating: request.rating
  };
}

function BuildDryRunDeletePayload(request) {
  return {
    ok: true,
    dryRun: true,
    deleted: true,
    titleId: request.titleId
  };
}

async function PostRatingToImdb(titleId, rating) {
  const response = await fetch(GraphqlUrl, BuildRatingFetchOptions(titleId, rating));
  const payload = ParseMaybeJson(await response.text());
  const error = BuildImdbError(response, payload);
  if (error)
    return error;
  const writtenRating = payload?.data?.rateTitle?.rating?.value;
  if (writtenRating !== rating)
    return Fail(502, "IMDB_UNEXPECTED_RESPONSE", "IMDb did not echo the requested rating.");
  return Ok({ ok: true, titleId, rating: writtenRating });
}

async function DeleteRatingFromImdb(titleId) {
  const response = await fetch(GraphqlUrl, BuildDeleteFetchOptions(titleId));
  const payload = ParseMaybeJson(await response.text());
  const error = BuildImdbError(response, payload);
  if (error)
    return error;
  return Ok({ ok: true, titleId, deleted: true });
}

function BuildRatingFetchOptions(titleId, rating) {
  return {
    method: "POST",
    headers: BuildHeaders(titleId),
    body: JSON.stringify(BuildRateBody(titleId, rating))
  };
}

function BuildDeleteFetchOptions(titleId) {
  return {
    method: "POST",
    headers: BuildHeaders(titleId),
    body: JSON.stringify(BuildDeleteBody(titleId))
  };
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

function BuildRateBody(titleId, rating) {
  return {
    operationName: "UpdateTitleRating",
    query: RateMutation,
    variables: { rating, titleId }
  };
}

function BuildDeleteBody(titleId) {
  return {
    operationName: "DeleteTitleRating",
    query: DeleteMutation,
    variables: { titleId }
  };
}

function BuildImdbError(response, payload) {
  if (response.status === 429)
    return Fail(429, "IMDB_RATE_LIMITED", "IMDb rate limited the request. Slow down and retry later.");
  if (!response.ok)
    return Fail(response.status, "IMDB_HTTP_ERROR", `IMDb returned HTTP ${response.status}.`);
  const hasGraphqlErrors = Array.isArray(payload?.errors) && payload.errors.length;
  if (hasGraphqlErrors)
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
