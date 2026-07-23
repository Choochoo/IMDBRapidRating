import path from "node:path";
import { fileURLToPath } from "node:url";
import { CreateDatabase } from "../server/db/client.mjs";
import { RunMigrations } from "../server/db/migrate.mjs";
import { InitializeRuntimeEnvironment } from "../server/env.mjs";
import { CountLegacySecrets, MigrateLegacySecrets } from "../server/security/secret-migration.mjs";
import { CreateSecretProtector } from "../server/security/secret-protector.mjs";

const RootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ExecuteArgument = "--execute";

async function Main() {
  process.env.IMDB_RAPID_RATER_HOME ||= path.join(RootPath, ".runtime");
  await InitializeRuntimeEnvironment(RootPath);
  const { pool, db } = CreateDatabase();
  await RunMigrationCommand(pool, db);
}

async function RunMigrationCommand(pool, db) {
  try {
    await RunMigrations(pool);
    const count = await CountLegacySecrets(pool);
    console.log(`Legacy encrypted secrets awaiting migration: ${count}.`);
    if (!process.argv.includes(ExecuteArgument))
      return console.log(`Preview only. Re-run with ${ExecuteArgument} to migrate.`);
    await ExecuteMigration(pool, CreateSecretProtector({ db }));
  } finally {
    await pool.end();
  }
}

async function ExecuteMigration(pool, secretProtector) {
  const result = await MigrateLegacySecrets({ pool, secretProtector, onProgress: (count) => console.log(`Migrated ${count} encrypted secrets.`) });
  console.log(`Azure Key Vault envelope migration complete: ${result.migrated} records migrated.`);
}

await Main();
