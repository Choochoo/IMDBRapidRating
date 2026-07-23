import assert from "node:assert/strict";
import test from "node:test";
import { CreateAccountStore } from "../server/account-store.mjs";
import { ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";

test("account saves enqueue every pending IMDb rating in the same transaction", VerifyPendingRatingEnqueue);

test("successful IMDb writes update the matching PostgreSQL rating atomically", async () => {
  const calls = [];
  let revision = 10;
  let payload = {};
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload, revision }], rowCount: 1 };
      if (/^UPDATE/.test(sql)) {
        payload = JSON.parse(parameters[1]);
        return { rows: [{ revision: ++revision }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const pool = { connect: async () => client };
  const store = CreateAccountStore({ db: {}, pool });
  const record = { ttId: "tt0107050", status: "rated", rating: 8 };

  const savedRevision = await store.recordRating("user-1", record);
  const deletedRevision = await store.deleteRating("user-1", record.ttId);

  assert.equal(savedRevision, 11);
  assert.equal(deletedRevision, 12);
  const updates = calls.filter((call) => /^UPDATE/.test(call.sql));
  assert.equal(updates.length, 2);
  assert.equal(Object.keys(ReadMediaPayload(JSON.parse(updates[0].parameters[1]), "movie").ratings)[0], record.ttId);
  assert.deepEqual(ReadMediaPayload(payload, "movie").ratings, {});
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
  assert.equal(calls[0].parameters[1], "movie");
  assert.deepEqual(JSON.parse(calls[1].parameters[2]), [{ itemKey: "heat|1995", ttId: "tt0113277", title: "Heat", year: 1995, payload: { ...saved, mediaType: "movie" } }]);
  assert.match(calls[2].sql, /DELETE FROM/);
});

test("excluding a recommendation updates account state and removes the queue row in one transaction", async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload: {}, revision: 40 }], rowCount: 1 };
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
  assert.match(calls[1].sql, /^SELECT payload/);
  assert.match(calls[2].sql, /^UPDATE/);
  assert.equal(ReadMediaPayload(JSON.parse(calls[2].parameters[1]), "movie").recommendationExclusions.length, 1);
  assert.match(calls[3].sql, /DELETE FROM/);
  assert.equal(calls[4].sql, "COMMIT");
  assert.equal(released, true);
});

async function VerifyPendingRatingEnqueue() {
  const calls = [];
  const client = BuildPendingRatingClient(calls);
  const store = CreateAccountStore({ db: {}, pool: { connect: async () => client } });
  const rating = { ttId: "tt0113277", status: "rated", rating: 9, submitStatus: "pending" };
  const payload = WriteMediaPayload({}, "movie", { ratings: { [rating.ttId]: rating } });
  const result = await store.saveState("user-1", payload, "", 4);
  assert.deepEqual(result, { ok: true, revision: 5 });
  const insert = calls.find((call) => /INSERT INTO .*imdb_rating_jobs/.test(call.sql));
  assert.equal(JSON.parse(insert.parameters[1])[0].ttId, rating.ttId);
  assert.deepEqual(calls.map((call) => call.sql === "BEGIN" || call.sql === "COMMIT" ? call.sql : "query"), ["BEGIN", "query", "query", "COMMIT"]);
}

function BuildPendingRatingClient(calls) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/UPDATE .*user_states/.test(sql))
        return { rows: [{ revision: 5 }], rowCount: 1 };
      if (/INSERT INTO .*imdb_rating_jobs/.test(sql))
        return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
}
