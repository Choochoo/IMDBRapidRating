import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { HandleRequest } from "../server/routes.mjs";
import { GetSettingsDirectory, GetTmdbApiKey, HasImdbAuthCookie, IsDryRun, LoadLocalEnv } from "../server/env.mjs";
import { SendText } from "../server/http.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

LoadLocalEnv(RootPath);

const Port = ReadPort();
const Server = createServer((request, response) => HandleServerRequest(request, response));

Server.on("error", (error) => HandleServerError(error));
Server.listen(Port, () => WriteStartupMessage());

function HandleServerError(error) {
  if (error.code !== "EADDRINUSE")
    throw error;
  console.error(`Port ${Port} is already in use. The app may already be running at http://localhost:${Port}`);
  console.error('Stop the existing server or run with a different port, for example: $env:PORT = "5200"; npm start');
  process.exit(1);
}

async function HandleServerRequest(request, response) {
  try {
    await HandleRequest(request, response, RootPath);
  } catch (error) {
    SendText(response, 500, error instanceof Error ? error.message : "Server error");
  }
}

function WriteStartupMessage() {
  const liveStatus = HasImdbAuthCookie() || IsDryRun() ? "configured" : "not configured";
  console.log(`IMDb Rapid Rater running at http://localhost:${Port}`);
  console.log(`Serving ${RootPath}`);
  console.log(`User data: ${GetSettingsDirectory()}`);
  console.log(`IMDb live write-back: ${liveStatus}`);
  console.log(`TMDB metadata: ${GetTmdbApiKey() ? "configured" : "not configured"}`);
}

function ReadPort() {
  return Number(process.env.PORT || 5012);
}
