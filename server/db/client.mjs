import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { ReadPostgresConfig } from "./config.mjs";

const { Pool } = pg;

export function CreateDatabase() {
  const pool = new Pool({ ...ReadPostgresConfig(), max: Number(process.env.POSTGRES_POOL_SIZE || 10) });
  pool.on("error", (error) => console.error("Unexpected PostgreSQL pool error", error.message));
  return { pool, db: drizzle(pool) };
}
