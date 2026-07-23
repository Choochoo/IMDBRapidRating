import assert from "node:assert/strict";
import test from "node:test";
import { BuildPermissionStatements, ResolveRuntimeRole, ValidateRole } from "../scripts/sync-database-permissions.mjs";

const DatabaseName = "imdb_rapid_rater";
const RuntimeRole = "rapid_rater_app";
const CatalogBuilderRole = "catalog_builder";

test("runtime database permissions use the established application table owner", VerifyDiscoveredRuntimeRole);
test("an explicit runtime database role overrides ownership discovery", VerifyExplicitRuntimeRole);
test("permission synchronization quotes its schema and role", VerifyQuotedPermissions);
test("unsafe PostgreSQL runtime role names are rejected", VerifyUnsafeRoleRejection);

async function VerifyDiscoveredRuntimeRole() {
  const pool = BuildRolePool({ build_role: CatalogBuilderRole, runtime_role: RuntimeRole });
  const role = await ResolveRuntimeRole(pool, DatabaseName, "");
  assert.equal(role, RuntimeRole);
  assert.deepEqual(pool.parameters, [DatabaseName, "users"]);
}

async function VerifyExplicitRuntimeRole() {
  const pool = BuildRolePool({ build_role: CatalogBuilderRole, runtime_role: "other_role" });
  const role = await ResolveRuntimeRole(pool, DatabaseName, RuntimeRole);
  assert.equal(role, RuntimeRole);
  assert.equal(pool.calls, 0);
}

function VerifyQuotedPermissions() {
  const statements = BuildPermissionStatements(DatabaseName, RuntimeRole);
  assert.equal(statements.length, 4);
  assert.ok(statements.every((statement) => statement.includes('"imdb_rapid_rater"')));
  assert.ok(statements.every((statement) => statement.includes('"rapid_rater_app"')));
}

function VerifyUnsafeRoleRejection() {
  assert.throws(() => ValidateRole('runtime"; DROP SCHEMA public; --'), /valid PostgreSQL role name/);
}

function BuildRolePool(row) {
  return {
    calls: 0,
    parameters: null,
    async query(_sql, parameters) {
      this.calls += 1;
      this.parameters = parameters;
      return { rows: [row] };
    }
  };
}
