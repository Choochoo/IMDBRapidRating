import assert from "node:assert/strict";
import test from "node:test";
import { CalculatePoolVersion } from "../server/movie-pool.mjs";
import { ReconcileQueueIds } from "../server/rater-queue.mjs";
import { CreateRaterQueueStore } from "../server/rater-queue-store.mjs";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";
import { BuildState, BuildStoragePayload } from "../src/app/state.js";

test("a server seed produces one stable queue on every device", () => {
  const pool = ["tt0000001", "tt0000002", "tt0000003", "tt0000004", "tt0000005"];
  const first = ReconcileQueueIds(null, pool, [], "account-seed");
  const second = ReconcileQueueIds(null, pool, [], "account-seed");

  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort(), [...pool].sort());
});

test("pool updates preserve the saved order, remove unavailable movies, and append additions", () => {
  const saved = ["tt0000003", "tt0000001", "tt0000002"];
  const pool = ["tt0000001", "tt0000002", "tt0000003", "tt0000004"];
  const queue = ReconcileQueueIds(saved, pool, ["tt0000001"], "account-seed");

  assert.equal(queue[0], "tt0000003");
  assert.equal(queue[1], "tt0000002");
  assert.equal(queue.at(-1), "tt0000004");
  assert.equal(queue.includes("tt0000001"), false);
});

test("movie pool identity hashes every ordered IMDb ID", () => {
  const original = CalculatePoolVersion(["tt0000001", "tt0000002", "tt0000003"]);
  const changedMiddle = CalculatePoolVersion(["tt0000001", "tt9999999", "tt0000003"]);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.notEqual(original, changedMiddle);
});

test("browser queue rebuilding never invents unsaved movies", () => {
  const app = Object.create(RapidRaterApp.prototype);
  const movies = [Movie("tt0000001"), Movie("tt0000002"), Movie("tt0000003")];
  app.State = {
    movies,
    movieById: new Map(movies.map((movie) => [movie.ttId, movie])),
    ratings: {},
    recommendationQueue: [],
    savedQueueIds: ["tt0000002"]
  };

  app.RebuildQueue();

  assert.deepEqual(app.State.queue.map((movie) => movie.ttId), ["tt0000002"]);
});

test("generic account saves cannot overwrite the authoritative queue", () => {
  const state = BuildState();
  state.savedQueueIds = ["tt0000001", "tt0000002"];
  state.queue = [Movie("tt0000001"), Movie("tt0000002")];
  const payload = BuildStoragePayload(state);

  assert.equal(payload.queueIds, undefined);
  assert.equal(payload.signature, undefined);
});

test("atomic decisions advance only the expected head and reject a stale device", async () => {
  const database = FakeRaterDatabase();
  const store = CreateRaterQueueStore(database.pool);
  const record = { ttId: "tt0000001", title: "One", status: "rated", rating: 8, at: "2026-07-19T18:00:00.000Z", submitStatus: "pending" };
  const first = await store.commitRaterDecision("user-1", {
    actionId: "20c61166-6fa0-4117-9828-c51d0e0861dd",
    expectedRevision: 4,
    kind: "rated",
    ttId: record.ttId,
    record
  });

  assert.equal(first.ok, true);
  assert.equal(first.queue.revision, 5);
  assert.deepEqual(first.queue.queueIds, ["tt0000002", "tt0000003"]);
  assert.equal(database.state.payload.ratings.tt0000001.rating, 8);

  const duplicate = await store.commitRaterDecision("user-1", {
    actionId: "20c61166-6fa0-4117-9828-c51d0e0861dd",
    expectedRevision: 4,
    kind: "rated",
    ttId: record.ttId,
    record
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.queue.revision, 5);
  assert.deepEqual(duplicate.queue.queueIds, ["tt0000002", "tt0000003"]);

  const stale = await store.commitRaterDecision("user-1", {
    actionId: "f9a575eb-0a8e-4cda-bdf9-fc2587e12db0",
    expectedRevision: 4,
    kind: "notSeen",
    ttId: "tt0000001",
    record: { ttId: "tt0000001", status: "notSeen" }
  });

  assert.equal(stale.ok, false);
  assert.equal(stale.code, "QUEUE_CONFLICT");
  assert.equal(stale.current.revision, 5);
  assert.deepEqual(database.queue.queue_ids, ["tt0000002", "tt0000003"]);
});

function Movie(ttId) {
  return { ttId, title: ttId };
}

function FakeRaterDatabase() {
  const queue = { pool_version: "pool-v1", seed: "seed", queue_ids: ["tt0000001", "tt0000002", "tt0000003"], revision: 4 };
  const state = { payload: { ratings: {}, history: [] }, revision: 9 };
  const actions = new Map();
  const client = {
    async query(sql, parameters = []) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql))
        return { rows: [], rowCount: 0 };
      if (/SELECT tt_id, result FROM/.test(sql)) {
        const action = actions.get(parameters[1]);
        return { rows: action ? [action] : [], rowCount: action ? 1 : 0 };
      }
      if (/SELECT pool_version, seed, queue_ids, revision FROM/.test(sql))
        return { rows: [{ ...queue, queue_ids: [...queue.queue_ids] }], rowCount: 1 };
      if (/SELECT payload, revision FROM/.test(sql))
        return { rows: [{ payload: structuredClone(state.payload), revision: state.revision }], rowCount: 1 };
      if (/UPDATE .*user_states/.test(sql)) {
        state.payload = JSON.parse(parameters[1]);
        state.revision++;
        return { rows: [{ revision: state.revision }], rowCount: 1 };
      }
      if (/UPDATE .*rater_queues/.test(sql)) {
        queue.queue_ids = JSON.parse(parameters[1]);
        queue.revision++;
        return { rows: [{ ...queue, queue_ids: [...queue.queue_ids] }], rowCount: 1 };
      }
      if (/INSERT INTO .*rater_actions/.test(sql)) {
        actions.set(parameters[1], { tt_id: parameters[3], result: JSON.parse(parameters[4]) });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in fake database: ${sql}`);
    },
    release() {}
  };
  return { queue, state, pool: { connect: async () => client } };
}
