const DefaultSchema = "imdb_rapid_rater";
const ApplicationName = "imdb-rapid-rater";
const RequireSslMode = "require";

export function ReadPostgresConfig() {
  const value = String(process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL || "").trim();
  if (!value)
    throw new Error("PostgreSQL is not configured. Set POSTGRES_CONNECTION_STRING.");
  if (/^postgres(?:ql)?:\/\//i.test(value))
    return { connectionString: value, application_name: ApplicationName };
  return ParseNpgsqlConnectionString(value);
}

export function ReadDatabaseSchema() {
  const value = String(process.env.RAPID_RATER_DB_SCHEMA || DefaultSchema).trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error("RAPID_RATER_DB_SCHEMA must contain only lowercase letters, digits, and underscores.");
  return value;
}

function ParseNpgsqlConnectionString(value) {
  const entries = Object.fromEntries(value.split(";").map(ParseEntry).filter(Boolean));
  const config = BuildPostgresConfig(entries);
  ValidatePostgresConfig(config);
  ApplySslConfig(config, entries.sslmode);
  return config;
}

function BuildPostgresConfig(entries) {
  return {
    host: entries.host,
    port: entries.port ? Number(entries.port) : 5432,
    database: entries.database,
    user: entries.username || entries["user id"] || entries.user,
    password: entries.password,
    application_name: ApplicationName
  };
}

function ValidatePostgresConfig(config) {
  if (!config.host || !config.database || !config.user || !config.password)
    throw new Error("PostgreSQL connection string must include Host, Database, Username, and Password.");
}

function ApplySslConfig(config, value) {
  const mode = value?.toLowerCase();
  if ([RequireSslMode, "verify-ca", "verify-full"].includes(mode))
    config.ssl = { rejectUnauthorized: mode !== RequireSslMode };
}

function ParseEntry(entry) {
  const index = entry.indexOf("=");
  if (index < 1)
    return null;
  return [entry.slice(0, index).trim().toLowerCase(), entry.slice(index + 1).trim()];
}
