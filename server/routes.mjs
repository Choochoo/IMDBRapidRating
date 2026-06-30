import { GetImdbStatus, SubmitImdbRating } from "./imdb-ratings.mjs";
import { GetTitleMetadata } from "./title-metadata.mjs";
import { SaveImdbCookie, SaveTmdbApiKey } from "./env.mjs";
import { RatingsCsvMaxBytes, ReadSavedRatingsCsv, SaveRatingsCsv, UpsertRatingsCsvRating } from "./ratings-csv.mjs";
import { ReadJsonBody, ReadTextBody, SendContent, SendJson } from "./http.mjs";
import { ServeStaticFile } from "./static-files.mjs";

export async function HandleRequest(request, response, rootPath) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (await HandleApiRoute(url, request, response, rootPath))
    return;
  await ServeStaticFile(url, response, rootPath);
}

async function HandleApiRoute(url, request, response, rootPath) {
  if (HandleStatusRoute(url, request, response))
    return true;
  if (await HandleRateRoute(url, request, response, rootPath))
    return true;
  if (await HandleCookieRoute(url, request, response, rootPath))
    return true;
  if (await HandleTmdbKeyRoute(url, request, response, rootPath))
    return true;
  if (await HandleRatingsCsvRoute(url, request, response, rootPath))
    return true;
  return await HandleTitleRoute(url, request, response);
}

function HandleStatusRoute(url, request, response) {
  if (url.pathname === "/api/imdb/status" && request.method === "GET") {
    SendJson(response, 200, GetImdbStatus());
    return true;
  }
  return false;
}

async function HandleRateRoute(url, request, response, rootPath) {
  if (url.pathname !== "/api/rate" || request.method !== "POST")
    return false;
  await HandleRate(request, response, rootPath);
  return true;
}

async function HandleCookieRoute(url, request, response, rootPath) {
  if (url.pathname !== "/api/imdb/cookie" || request.method !== "POST")
    return false;
  await HandleCookieSave(request, response, rootPath);
  return true;
}

async function HandleTmdbKeyRoute(url, request, response, rootPath) {
  if (url.pathname !== "/api/tmdb/key" || request.method !== "POST")
    return false;
  await HandleTmdbKeySave(request, response, rootPath);
  return true;
}

async function HandleRatingsCsvRoute(url, request, response, rootPath) {
  if (url.pathname !== "/api/imdb/ratings-csv")
    return false;
  if (request.method === "GET")
    return HandleRatingsCsvRead(response, rootPath);
  if (request.method === "PUT")
    return await HandleRatingsCsvSave(request, response, rootPath);
  return false;
}

async function HandleRate(request, response, rootPath) {
  const body = await ReadJsonRequest(request, response);
  if (!body)
    return;
  const result = await SubmitImdbRating(body.titleId, body.rating);
  const syncedResult = await SyncCsvAfterSubmit(rootPath, body, result);
  SendJson(response, syncedResult.status, syncedResult.payload);
}

async function SyncCsvAfterSubmit(rootPath, body, result) {
  if (!ShouldSyncCsvAfterSubmit(result))
    return result;
  try {
    return await TrySyncCsvAfterSubmit(rootPath, body, result);
  } catch (error) {
    return BuildCsvSyncFailure(error.message || "Unknown CSV sync error.");
  }
}

async function TrySyncCsvAfterSubmit(rootPath, body, result) {
  const csvResult = await UpsertRatingsCsvRating(rootPath, BuildCsvRatingRecord(body, result.payload));
  if (!csvResult.payload.ok)
    return BuildCsvSyncFailure(csvResult.payload.error);
  return result;
}

function ShouldSyncCsvAfterSubmit(result) {
  return result.payload?.ok && !result.payload?.dryRun;
}

function BuildCsvRatingRecord(body, payload) {
  return {
    ttId: payload.titleId,
    rating: payload.rating,
    title: body.title || "",
    year: body.year || "",
    at: body.at || new Date().toISOString()
  };
}

function BuildCsvSyncFailure(error) {
  return {
    status: 502,
    payload: BuildCsvSyncFailurePayload(error)
  };
}

function BuildCsvSyncFailurePayload(error) {
  return {
    ok: false,
    code: "RATING_CSV_SYNC_FAILED",
    error: `IMDb saved, but local ratings CSV did not update: ${error}`
  };
}

async function HandleCookieSave(request, response, rootPath) {
  const body = await ReadJsonRequest(request, response);
  if (!body)
    return;
  const result = await SaveImdbCookie(rootPath, body.cookie);
  SendJson(response, result.status, result.payload);
}

async function HandleTmdbKeySave(request, response, rootPath) {
  const body = await ReadJsonRequest(request, response);
  if (!body)
    return;
  const result = await SaveTmdbApiKey(rootPath, body.apiKey);
  SendJson(response, result.status, result.payload);
}

function HandleRatingsCsvRead(response, rootPath) {
  const result = ReadSavedRatingsCsv(rootPath);
  if (!result.payload.ok) {
    SendJson(response, result.status, result.payload);
    return true;
  }
  SendContent(response, 200, result.payload.csv, "text/csv;charset=utf-8");
  return true;
}

async function HandleRatingsCsvSave(request, response, rootPath) {
  const csv = await ReadCsvRequest(request, response);
  if (csv === null)
    return true;
  const result = await SaveRatingsCsv(rootPath, csv);
  SendJson(response, result.status, result.payload);
  return true;
}

async function ReadJsonRequest(request, response) {
  try {
    return await ReadJsonBody(request);
  } catch (error) {
    SendJson(response, error.statusCode || 400, BuildInvalidRequestPayload(error));
    return null;
  }
}

async function ReadCsvRequest(request, response) {
  try {
    return await ReadTextBody(request, RatingsCsvMaxBytes);
  } catch (error) {
    SendJson(response, error.statusCode || 400, BuildInvalidRequestPayload(error));
    return null;
  }
}

function BuildInvalidRequestPayload(error) {
  return {
    ok: false,
    code: "INVALID_REQUEST_BODY",
    error: error.message || "Request body must be JSON."
  };
}

async function HandleTitleRoute(url, request, response) {
  const titleMetadataMatch = url.pathname.match(/^\/api\/title\/(tt\d+)$/);
  if (!titleMetadataMatch || request.method !== "GET")
    return false;
  const result = await GetTitleMetadata(titleMetadataMatch[1]);
  SendJson(response, result.status, result.payload);
  return true;
}
