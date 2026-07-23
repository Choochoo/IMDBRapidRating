import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CreateApp } from "../server/app.mjs";
import { InitializeRuntimeEnvironment } from "../server/env.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.NODE_ENV ||= existsSync(path.join(RootPath, "dist", "index.html")) ? "production" : "development";
process.env.IMDB_RAPID_RATER_HOME ||= path.join(RootPath, ".runtime");
await InitializeRuntimeEnvironment(RootPath);
const Port = Number(process.env.PORT || 5012);
const { app, pool, imdbRatingWorker } = await CreateApp(RootPath);
const server = app.listen(Port, () => console.log(`IMDb Rapid Rater running at http://localhost:${Port}`));
server.on("error", HandleServerError);
process.on("SIGINT", () => Shutdown(0));
process.on("SIGTERM", () => Shutdown(0));

function HandleServerError(error) {
  if (error.code !== "EADDRINUSE")
    throw error;
  console.error(`Port ${Port} is already in use.`);
  process.exit(1);
}

async function Shutdown(exitCode) {
  server.close();
  await imdbRatingWorker.Stop();
  await pool.end();
  process.exit(exitCode);
}
