export const TmdbApiUrl = "https://api.themoviedb.org/3";

export function AddTmdbApiKey(params, apiKey) {
  if (!IsTmdbBearerToken(apiKey))
    params.set("api_key", apiKey);
}

export function BuildTmdbHeaders(apiKey) {
  const headers = { accept: "application/json" };
  if (IsTmdbBearerToken(apiKey))
    headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

export function IsTmdbBearerToken(value) {
  return String(value || "").includes(".");
}
