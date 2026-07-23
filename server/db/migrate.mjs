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
    await ApplyMigrations(client, schema, quoted);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ApplyMigrations(client, schema, quoted) {
  await PrepareMigrationSchema(client, schema, quoted);
  const applied = await ReadAppliedMigrations(client, quoted);
  const files = await ReadMigrationFiles();
  for (const file of files) {
    if (!applied.has(file))
      await ApplyMigrationFile(client, quoted, file);
  }
  await client.query("COMMIT");
}

async function PrepareMigrationSchema(client, schema, quoted) {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${schema}:migrations`]);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoted}`);
  await client.query(`CREATE TABLE IF NOT EXISTS ${quoted}.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
}

async function ReadAppliedMigrations(client, quoted) {
  const result = await client.query(`SELECT name FROM ${quoted}.schema_migrations`);
  return new Set(result.rows.map((row) => row.name));
}

async function ReadMigrationFiles() {
  return (await readdir(MigrationsPath)).filter((file) => file.endsWith(".sql")).sort();
}

async function ApplyMigrationFile(client, quoted, file) {
  const sql = (await readFile(path.join(MigrationsPath, file), "utf8")).replaceAll("{{schema}}", quoted);
  await client.query(sql);
  await client.query(`INSERT INTO ${quoted}.schema_migrations (name) VALUES ($1)`, [file]);
}

function QuoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
