import path from "node:path";
import { fileURLToPath } from "node:url";
import { CreateDatabase } from "../server/db/client.mjs";
import { ReadDatabaseSchema } from "../server/db/config.mjs";
import { LoadLocalEnv } from "../server/env.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RuntimeRoleVariable = "POSTGRES_RUNTIME_ROLE";
const ReferenceTable = "users";
const RolePattern = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;

export async function SynchronizeDatabasePermissions(pool, configuredRole = process.env[RuntimeRoleVariable], schema = ReadDatabaseSchema()) {
  const runtimeRole = await ResolveRuntimeRole(pool, schema, configuredRole);
  for (const statement of BuildPermissionStatements(schema, runtimeRole))
    await pool.query(statement);
  return runtimeRole;
}

export async function ResolveRuntimeRole(pool, schema, configuredRole) {
  if (String(configuredRole || "").trim())
    return ValidateRole(configuredRole);
  const result = await pool.query("SELECT current_user build_role, pg_get_userbyid(table_class.relowner) runtime_role FROM pg_class table_class JOIN pg_namespace table_schema ON table_schema.oid=table_class.relnamespace WHERE table_schema.nspname=$1 AND table_class.relname=$2", [schema, ReferenceTable]);
  const roles = result.rows[0] || {};
  if (roles.runtime_role && roles.runtime_role !== roles.build_role)
    return ValidateRole(roles.runtime_role);
  throw new Error(`${RuntimeRoleVariable} is required because the runtime PostgreSQL role could not be discovered.`);
}

export function BuildPermissionStatements(schema, runtimeRole) {
  const quotedSchema = QuoteIdentifier(schema);
  const quotedRole = QuoteIdentifier(ValidateRole(runtimeRole));
  return [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quotedSchema} TO ${quotedRole}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quotedSchema} TO ${quotedRole}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quotedSchema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quotedSchema} GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRole}`
  ];
}

export function ValidateRole(value) {
  const role = String(value || "").trim();
  if (!RolePattern.test(role))
    throw new Error(`${RuntimeRoleVariable} must be a valid PostgreSQL role name.`);
  return role;
}

function QuoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function Main() {
  process.env.IMDB_RAPID_RATER_HOME ||= path.join(RootPath, ".runtime");
  LoadLocalEnv(RootPath);
  const { pool } = CreateDatabase();
  try {
    const runtimeRole = await SynchronizeDatabasePermissions(pool);
    console.log(`PostgreSQL runtime permissions synchronized for ${runtimeRole}.`);
  } finally {
    await pool.end();
  }
}

function IsMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (IsMainModule())
  await Main();
