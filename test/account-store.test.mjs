import assert from "node:assert/strict";
import test from "node:test";
import { CreateAccountStore } from "../server/account-store.mjs";
import { ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";

const BeginTransaction = "BEGIN";
const CommitTransaction = "COMMIT";
const HeatQueueKey = "heat|1995";
const HeatTitle = "Heat";
const HeatTitleId = "tt0113277";
const MovieMediaType = "movie";
const QueryCall = "query";
const RatedStatus = "rated";
const UserId = "user-1";

test("account saves enqueue every pending IMDb rating in the same transaction", VerifyPendingRatingEnqueue);
test("successful IMDb writes update the matching PostgreSQL rating atomically", VerifyAtomicRatingWrites);
test("recommendation queue store appends, lists, and removes per-user picks", VerifyRecommendationQueueStore);
test("excluding a recommendation updates account state and removes the queue row in one transaction", VerifyRecommendationExclusion);

async function VerifyAtomicRatingWrites() {
  const scenario = BuildRatingScenario();
  const record = { ttId: "tt0107050", status: RatedStatus, rating: 8 };
  const savedRevision = await scenario.store.recordRating(UserId, record);
  const deletedRevision = await scenario.store.deleteRating(UserId, record.ttId);
  AssertRatingWrites(scenario, record, savedRevision, deletedRevision);
}

function BuildRatingScenario() {
  const calls = [];
  const state = { revision: 10, payload: {} };
  const client = BuildRatingClient(calls, state);
  const pool = { connect: async () => client };
  return { calls, state, store: CreateAccountStore({ db: {}, pool }) };
}

function BuildRatingClient(calls, state) {
  return {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload: state.payload, revision: state.revision }], rowCount: 1 };
      if (/^UPDATE/.test(sql)) {
        state.payload = JSON.parse(parameters[1]);
        return { rows: [{ revision: ++state.revision }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
}

function AssertRatingWrites(scenario, record, savedRevision, deletedRevision) {
  assert.equal(savedRevision, 11);
  assert.equal(deletedRevision, 12);
  const updates = scenario.calls.filter((call) => /^UPDATE/.test(call.sql));
  assert.equal(updates.length, 2);
  assert.equal(Object.keys(ReadMediaPayload(JSON.parse(updates[0].parameters[1]), MovieMediaType).ratings)[0], record.ttId);
  assert.deepEqual(ReadMediaPayload(scenario.state.payload, MovieMediaType).ratings, {});
}

async function VerifyRecommendationQueueStore() {
  const scenario = BuildRecommendationScenario();
  const listed = await scenario.store.listRecommendationQueue(UserId);
  const inserted = await scenario.store.appendRecommendationQueue(UserId, [scenario.saved]);
  const removed = await scenario.store.removeRecommendation(UserId, scenario.saved);
  AssertRecommendationStore(scenario, listed, inserted, removed);
}

function BuildRecommendationScenario() {
  const calls = [];
  const saved = { queueKey: HeatQueueKey, ttId: HeatTitleId, title: HeatTitle, year: 1995 };
  const pool = BuildRecommendationPool(calls, saved);
  return { calls, saved, store: CreateAccountStore({ db: {}, pool }) };
}

function BuildRecommendationPool(calls, saved) {
  return {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload: saved }], rowCount: 1 };
      if (/^INSERT INTO/.test(sql))
        return { rows: [{ payload: saved }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }
  };
}

function AssertRecommendationStore(scenario, listed, inserted, removed) {
  assert.deepEqual(listed, [scenario.saved]);
  assert.deepEqual(inserted, [scenario.saved]);
  assert.equal(removed, 1);
  assert.match(scenario.calls[0].sql, /ORDER BY id/);
  assert.match(scenario.calls[1].sql, /ON CONFLICT DO NOTHING/);
  assert.equal(scenario.calls[0].parameters[1], MovieMediaType);
  assert.deepEqual(JSON.parse(scenario.calls[1].parameters[2]), [BuildExpectedQueueRow(scenario.saved)]);
  assert.match(scenario.calls[2].sql, /DELETE FROM/);
}

function BuildExpectedQueueRow(saved) {
  return {
    itemKey: HeatQueueKey, ttId: HeatTitleId, title: HeatTitle, year: 1995,
    payload: { ...saved, mediaType: MovieMediaType }
  };
}

async function VerifyRecommendationExclusion() {
  const scenario = BuildExclusionScenario();
  const revision = await scenario.store.excludeRecommendation(UserId, scenario.exclusion);
  AssertRecommendationExclusion(scenario, revision);
}

function BuildExclusionScenario() {
  const calls = [];
  const state = { released: false };
  const client = BuildExclusionClient(calls, state);
  const pool = { connect: async () => client };
  const store = CreateAccountStore({ db: {}, pool });
  const exclusion = { queueKey: HeatQueueKey, ttId: HeatTitleId, title: HeatTitle, year: 1995 };
  return { calls, state, store, exclusion };
}

function BuildExclusionClient(calls, state) {
  return {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload: {}, revision: 40 }], rowCount: 1 };
      if (/^UPDATE/.test(sql))
        return { rows: [{ revision: 41 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() { state.released = true; }
  };
}

function AssertRecommendationExclusion(scenario, revision) {
  assert.equal(revision, 41);
  assert.equal(scenario.calls[0].sql, BeginTransaction);
  assert.match(scenario.calls[1].sql, /^SELECT payload/);
  assert.match(scenario.calls[2].sql, /^UPDATE/);
  assert.equal(ReadMediaPayload(JSON.parse(scenario.calls[2].parameters[1]), MovieMediaType).recommendationExclusions.length, 1);
  assert.match(scenario.calls[3].sql, /DELETE FROM/);
  assert.equal(scenario.calls[4].sql, CommitTransaction);
  assert.equal(scenario.state.released, true);
}

async function VerifyPendingRatingEnqueue() {
  const calls = [];
  const client = BuildPendingRatingClient(calls);
  const store = CreateAccountStore({ db: {}, pool: { connect: async () => client } });
  const rating = { ttId: HeatTitleId, status: RatedStatus, rating: 9, submitStatus: "pending" };
  const payload = WriteMediaPayload({}, MovieMediaType, { ratings: { [rating.ttId]: rating } });
  const result = await store.saveState(UserId, payload, "", 4);
  assert.deepEqual(result, { ok: true, revision: 5 });
  const insert = calls.find((call) => /INSERT INTO .*imdb_rating_jobs/.test(call.sql));
  assert.equal(JSON.parse(insert.parameters[1])[0].ttId, rating.ttId);
  assert.deepEqual(calls.map(ReadCallKind), [BeginTransaction, QueryCall, QueryCall, CommitTransaction]);
}

function ReadCallKind(call) {
  return call.sql === BeginTransaction || call.sql === CommitTransaction ? call.sql : QueryCall;
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
