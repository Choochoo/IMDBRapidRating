import { GenerateAiRecommendations, GetAiStatus } from "./ai-recommendations.mjs";
import { GetOpenAiModels } from "./openai-models.mjs";
import { DeleteImdbRating, GetImdbStatus, SubmitImdbRating } from "./imdb-ratings.mjs";
import { GetTitleMetadata } from "./title-metadata.mjs";
import { ReadJsonBody, SendJson } from "./http.mjs";
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
  if (HandleBrowserOnlyRoute(url, response))
    return true;
  if (await HandleAiRoute(url, request, response, rootPath))
    return true;
  return await HandleTitleRoute(url, request, response);
}

function HandleStatusRoute(url, request, response) {
  if (url.pathname === "/api/imdb/status" && request.method === "GET") {
    SendJson(response, 200, GetImdbStatus());
    return true;
  }
  if (url.pathname === "/api/ai/status" && request.method === "GET") {
    SendJson(response, 200, { ok: true, ...GetAiStatus() });
    return true;
  }
  return false;
}

async function HandleRateRoute(url, request, response, rootPath) {
  if (url.pathname !== "/api/rate")
    return false;
  if (request.method === "POST")
    return await HandleRate(request, response);
  if (request.method === "DELETE")
    return await HandleRateDelete(request, response);
  return false;
}

async function HandleRate(request, response) {
  const body = await ReadJsonRequest(request, response);
  if (!body)
    return true;
  const result = await SubmitImdbRating(body.titleId, body.rating, body.cookie);
  SendJson(response, result.status, result.payload);
  return true;
}

async function HandleRateDelete(request, response) {
  const body = await ReadJsonRequest(request, response);
  if (!body)
    return true;
  const result = await DeleteImdbRating(body.titleId, body.cookie);
  SendJson(response, result.status, result.payload);
  return true;
}

function HandleBrowserOnlyRoute(url, response) {
  if (!IsBrowserOnlyPath(url.pathname))
    return false;
  SendJson(response, 410, BrowserOnlyPayload());
  return true;
}

function IsBrowserOnlyPath(pathname) {
  return [
    "/api/imdb/cookie",
    "/api/imdb/login",
    "/api/imdb/ratings-csv",
    "/api/tmdb/key",
    "/api/ai/key",
    "/api/ai/model"
  ].includes(pathname);
}

function BrowserOnlyPayload() {
  return {
    ok: false,
    code: "BROWSER_ONLY",
    error: "Personal settings and ratings are stored in each browser, not on the server."
  };
}

async function HandleAiRoute(url, request, response, rootPath) {
  if (await HandleAiModelsRoute(url, request, response))
    return true;
  return await HandleAiRecommendationsRoute(url, request, response, rootPath);
}

async function HandleAiModelsRoute(url, request, response) {
  if (url.pathname !== "/api/ai/models" || request.method !== "GET")
    return false;
  const result = await GetOpenAiModels(ReadRequestApiOptions(request));
  SendJson(response, result.status, result.payload);
  return true;
}

async function HandleAiRecommendationsRoute(url, request, response, rootPath) {
  if (url.pathname !== "/api/ai/recommendations" || request.method !== "POST")
    return false;
  const body = await ReadJsonRequest(request, response);
  if (!body)
    return true;
  const result = await GenerateAiRecommendations(rootPath, body);
  SendJson(response, result.status, result.payload);
  return true;
}

function ReadRequestApiOptions(request) {
  return {
    apiKey: request.headers["x-openai-api-key"] || "",
    model: request.headers["x-openai-model"] || "",
    modelLag: request.headers["x-openai-model-lag"] || ""
  };
}

async function ReadJsonRequest(request, response) {
  return await ReadRequestBody(response, () => ReadJsonBody(request));
}

async function ReadRequestBody(response, readBody) {
  try {
    return await readBody();
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
  const result = await GetTitleMetadata(titleMetadataMatch[1], ReadRequestMetadataOptions(request));
  SendJson(response, result.status, result.payload);
  return true;
}

function ReadRequestMetadataOptions(request) {
  return {
    tmdbApiKey: request.headers["x-tmdb-api-key"] || ""
  };
}
