import assert from "node:assert/strict";
import test from "node:test";
import { CreateAccountStore } from "../server/account-store.mjs";

test("successful IMDb writes update the matching PostgreSQL rating atomically", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [{ revision: calls.length + 10 }], rowCount: 1 };
    }
  };
  const store = CreateAccountStore({ db: {}, pool });
  const record = { ttId: "tt0107050", status: "rated", rating: 8 };

  const savedRevision = await store.recordRating("user-1", record);
  const deletedRevision = await store.deleteRating("user-1", record.ttId);

  assert.equal(savedRevision, 11);
  assert.equal(deletedRevision, 12);
  assert.match(calls[0].sql, /jsonb_build_object/);
  assert.match(calls[1].sql, /payload->'ratings'.*- \$2::text/);
  assert.deepEqual(calls[0].parameters, ["user-1", record.ttId, JSON.stringify(record)]);
  assert.deepEqual(calls[1].parameters, ["user-1", record.ttId]);
});

test("recommendation queue store appends, lists, and removes per-user picks", async () => {
  const calls = [];
  const saved = { queueKey: "heat|1995", ttId: "tt0113277", title: "Heat", year: 1995 };
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload: saved }], rowCount: 1 };
      if (/^INSERT INTO/.test(sql))
        return { rows: [{ payload: saved }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }
  };
  const store = CreateAccountStore({ db: {}, pool });

  const listed = await store.listRecommendationQueue("user-1");
  const inserted = await store.appendRecommendationQueue("user-1", [saved]);
  const removed = await store.removeRecommendation("user-1", saved);

  assert.deepEqual(listed, [saved]);
  assert.deepEqual(inserted, [saved]);
  assert.equal(removed, 1);
  assert.match(calls[0].sql, /ORDER BY id/);
  assert.match(calls[1].sql, /ON CONFLICT DO NOTHING/);
  assert.deepEqual(JSON.parse(calls[1].parameters[1]), [{ itemKey: "heat|1995", ttId: "tt0113277", title: "Heat", year: 1995, payload: saved }]);
  assert.match(calls[2].sql, /DELETE FROM/);
});

test("excluding a recommendation updates account state and removes the queue row in one transaction", async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/^UPDATE/.test(sql))
        return { rows: [{ revision: 41 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() { released = true; }
  };
  const store = CreateAccountStore({ db: {}, pool: { connect: async () => client } });
  const exclusion = { queueKey: "heat|1995", ttId: "tt0113277", title: "Heat", year: 1995 };

  const revision = await store.excludeRecommendation("user-1", exclusion);

  assert.equal(revision, 41);
  assert.equal(calls[0].sql, "BEGIN");
  assert.match(calls[1].sql, /recommendationExclusions/);
  assert.match(calls[2].sql, /DELETE FROM/);
  assert.equal(calls[3].sql, "COMMIT");
  assert.equal(released, true);
});
