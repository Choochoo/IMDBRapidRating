import assert from "node:assert/strict";
import test from "node:test";
import { BuildPermissionStatements, ResolveRuntimeRole, ValidateRole } from "../scripts/sync-database-permissions.mjs";

test("runtime database permissions use the established application table owner", async () => {
  const pool = BuildRolePool({ build_role: "catalog_builder", runtime_role: "rapid_rater_app" });
  const role = await ResolveRuntimeRole(pool, "imdb_rapid_rater", "");
  assert.equal(role, "rapid_rater_app");
  assert.deepEqual(pool.parameters, ["imdb_rapid_rater", "users"]);
});

test("an explicit runtime database role overrides ownership discovery", async () => {
  const pool = BuildRolePool({ build_role: "catalog_builder", runtime_role: "other_role" });
  const role = await ResolveRuntimeRole(pool, "imdb_rapid_rater", "rapid_rater_app");
  assert.equal(role, "rapid_rater_app");
  assert.equal(pool.calls, 0);
});

test("permission synchronization quotes its schema and role", () => {
  const statements = BuildPermissionStatements("imdb_rapid_rater", "rapid_rater_app");
  assert.equal(statements.length, 4);
  assert.ok(statements.every((statement) => statement.includes('"imdb_rapid_rater"')));
  assert.ok(statements.every((statement) => statement.includes('"rapid_rater_app"')));
});

test("unsafe PostgreSQL runtime role names are rejected", () => {
  assert.throws(() => ValidateRole('runtime"; DROP SCHEMA public; --'), /valid PostgreSQL role name/);
});

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
