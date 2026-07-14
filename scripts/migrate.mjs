import { CreateDatabase } from "../server/db/client.mjs";
import { RunMigrations } from "../server/db/migrate.mjs";
import { LoadLocalEnv } from "../server/env.mjs";
import path from "node:path";

process.env.IMDB_RAPID_RATER_HOME ||= path.join(process.cwd(), ".runtime");
LoadLocalEnv(process.cwd());
const { pool } = CreateDatabase();
try {
  await RunMigrations(pool);
  console.log("PostgreSQL migrations applied.");
} finally {
  await pool.end();
}
