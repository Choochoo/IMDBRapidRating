import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReadDatabaseSchema } from "./config.mjs";

const MigrationsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

export async function RunMigrations(pool) {
  const schema = ReadDatabaseSchema();
  const quoted = QuoteIdentifier(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${schema}:migrations`]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoted}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${quoted}.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query(`SELECT name FROM ${quoted}.schema_migrations`)).rows.map((row) => row.name));
    const files = (await readdir(MigrationsPath)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file))
        continue;
      const sql = (await readFile(path.join(MigrationsPath, file), "utf8")).replaceAll("{{schema}}", quoted);
      await client.query(sql);
      await client.query(`INSERT INTO ${quoted}.schema_migrations (name) VALUES ($1)`, [file]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function QuoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
