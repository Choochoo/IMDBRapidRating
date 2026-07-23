import assert from "node:assert/strict";
import test from "node:test";
import { CreateImdbRatingJobStore, ReconcileImdbUndoJob, UpsertPendingImdbJobs } from "../server/imdb-rating-job-store.mjs";
import { MergeAccountPayload } from "../src/app/account-state-merge.js";
import { ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";

test("an IMDb rating and account state are queued in one transaction", VerifyAtomicRatingQueue);
test("an IMDb delete and account state are queued in one transaction", VerifyAtomicDeleteQueue);
test("a deferred IMDb delete leaves account state to its enclosing workflow", VerifyDeferredDeleteQueue);
test("claiming a job reserves one shared dispatch slot at the configured rate", VerifySharedDispatchSlot);
test("a throttled IMDb job halves the shared dispatch rate", VerifySharedThrottle);
test("a stale throttled job still lowers the shared dispatch rate", VerifyStaleSharedThrottle);
test("worker completion locks dispatch and state before the job", VerifyCompletionLockOrder);
test("IMDb reconnect resumes failed jobs across movie and TV state", VerifyAuthResume);
test("bulk state reconciliation does not reactivate terminal IMDb jobs", VerifyTerminalJobPreservation);
test("IMDb failure timestamps defeat stale pending account state", VerifyFailureTimestampMerge);
test("undo creates a compensating delete after a job may have reached IMDb", VerifyCompensatingUndo);

async function VerifyAtomicRatingQueue() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildQueueClient(calls) });
  const rating = { ttId: "tt0113277", title: "Heat", status: "rated", rating: 9 };
  const result = await store.QueueImdbRating("user-1", rating, "movie");
  assert.equal(result.record.submitStatus, "pending");
  assert.equal(result.revision, 8);
  assert.deepEqual(calls.map(ClassifyQueueCall), ["BEGIN", "state-read", "job", "state-write", "recommendation-delete", "COMMIT"]);
}

async function VerifyAtomicDeleteQueue() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildDeleteClient(calls) });
  const result = await store.QueueImdbDelete("user-1", "tt0113277", "movie");
  assert.equal(result.job.id, 4);
  assert.equal(result.revision, 9);
  assert.deepEqual(calls.map(ClassifyDeleteCall), ["BEGIN", "state-read", "job", "state-write", "COMMIT"]);
}

async function VerifyDeferredDeleteQueue() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildDeleteClient(calls) });
  const result = await store.QueueImdbDelete("user-1", "tt0113277", "movie", { deferAccountState: true });
  assert.equal(result.job.id, 4);
  assert.equal(result.revision, undefined);
  assert.deepEqual(calls.map(ClassifyDeleteCall), ["BEGIN", "job", "COMMIT"]);
}

async function VerifySharedDispatchSlot() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildClaimClient(calls) });
  const claimed = await store.ClaimImdbRatingJob();
  assert.equal(claimed.job.ttId, "tt0113277");
  assert.deepEqual(calls.map(ClassifyClaimCall), ["BEGIN", "dispatch-lock", "job-claim", "slot-reservation", "COMMIT"]);
  assert.match(calls[3].sql, /interval '1 second'\/current_rps/);
}

async function VerifySharedThrottle() {
  const calls = [];
  const client = BuildThrottleClient(calls, 1);
  const store = CreateImdbRatingJobStore({ connect: async () => client });
  await store.ThrottleImdbRatingJob(RatingJob(), { status: 429, payload: { error: "Slow down" } }, 5000);
  const dispatch = calls.find((call) => /^UPDATE .*imdb_rating_dispatch_state/.test(call.sql));
  assert.match(dispatch.sql, /current_rps\/2/);
  assert.match(dispatch.sql, /next_attempt_at=GREATEST/);
  assert.deepEqual(dispatch.parameters, [5000]);
}

async function VerifyStaleSharedThrottle() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildThrottleClient(calls, 0) });
  const retried = await store.ThrottleImdbRatingJob(RatingJob(), { status: 429, payload: { error: "Slow down" } }, 5000);
  assert.equal(retried, false);
  assert.equal(calls.some((call) => /^UPDATE .*imdb_rating_dispatch_state/.test(call.sql)), true);
}

async function VerifyCompletionLockOrder() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildCompletionClient(calls) });
  await store.CompleteImdbRatingJob(RatingJob(), { status: 200, payload: { rating: 9 } });
  assert.deepEqual(calls.map(ClassifyCompletionCall), ["BEGIN", "dispatch-lock", "state-lock", "job-update", "state-update", "dispatch-update", "COMMIT"]);
  const saved = JSON.parse(calls.find((call) => /UPDATE .*user_states/.test(call.sql)).parameters[1]);
  const submitted = ReadMediaPayload(saved, "movie").ratings.tt0113277;
  assert.equal(submitted.updatedAt, submitted.submittedAt);
}

async function VerifyAuthResume() {
  const calls = [];
  const payload = BuildFailedMediaPayload();
  const store = CreateImdbRatingJobStore({ connect: async () => BuildResumeClient(calls, payload) });
  const result = await store.ResumeImdbRatingJobs("user-1");
  const saved = JSON.parse(calls.find((call) => /UPDATE .*user_states/.test(call.sql)).parameters[1]);
  assert.deepEqual(result, { queued: 2, revision: 5 });
  assert.equal(ReadMediaPayload(saved, "movie").ratings.tt0113277.submitStatus, "pending");
  assert.equal(ReadMediaPayload(saved, "tv").ratings.tt0903747.submitStatus, "pending");
  assert.ok(ReadMediaPayload(saved, "movie").ratings.tt0113277.updatedAt);
  assert.ok(ReadMediaPayload(saved, "tv").ratings.tt0903747.updatedAt);
}

async function VerifyTerminalJobPreservation() {
  let statement = "";
  const client = { query: async (sql) => { statement = sql; return { rows: [], rowCount: 0 }; } };
  await UpsertPendingImdbJobs(client, "user-1", BuildPendingMediaPayload());
  assert.match(statement, /jobs\.status IN \('pending', 'processing'\) AND jobs\.payload IS DISTINCT/);
  assert.doesNotMatch(statement, /jobs\.status IN \('failed', 'auth_required'\)/);
}

async function VerifyFailureTimestampMerge() {
  const calls = [];
  const pending = BuildPendingMediaPayload();
  const store = CreateImdbRatingJobStore({ connect: async () => BuildFailureClient(calls, pending) });
  await store.FailImdbRatingJob(RatingJob(), { status: 404, payload: { error: "Not found" } });
  const server = JSON.parse(calls.find((call) => /UPDATE .*user_states/.test(call.sql)).parameters[1]);
  const merged = MergeAccountPayload(server, pending);
  assert.equal(ReadMediaPayload(merged, "movie").ratings.tt0113277.submitStatus, "failed");
}

async function VerifyCompensatingUndo() {
  const calls = [];
  const client = BuildUndoClient(calls);
  await ReconcileImdbUndoJob(client, "user-1", { ttId: "tt0113277", submitStatus: "pending" }, null, "movie");
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /operation, rating, payload/);
  assert.match(calls[1].sql, /'delete', NULL/);
}

function BuildQueueClient(calls) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/INSERT INTO .*imdb_rating_jobs/.test(sql))
        return { rows: [{ id: 3, generation: 1, status: "pending" }], rowCount: 1 };
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload: {}, revision: 7 }], rowCount: 1 };
      if (/UPDATE .*user_states/.test(sql))
        return { rows: [{ revision: 8 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
}

function BuildClaimClient(calls) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT maximum_rps/.test(sql))
        return { rows: [{ maximum_rps: "10", current_rps: "10", next_attempt_at: new Date(0), success_streak: 0 }], rowCount: 1 };
      if (/^WITH user_history/.test(sql))
        return { rows: [ClaimedJobRow()], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }, release() {}
  };
}

function BuildDeleteClient(calls) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload: BuildFailedMediaPayload(), revision: 8 }], rowCount: 1 };
      if (/INSERT INTO .*imdb_rating_jobs/.test(sql))
        return { rows: [{ id: 4, generation: 1, status: "pending" }], rowCount: 1 };
      return { rows: [{ revision: 9 }], rowCount: 1 };
    }, release() {}
  };
}

function BuildThrottleClient(calls, retryCount) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT maximum_rps/.test(sql))
        return { rows: [{ current_rps: "10" }], rowCount: 1 };
      if (/UPDATE .*imdb_rating_jobs/.test(sql))
        return { rows: [], rowCount: retryCount };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
}

function BuildCompletionClient(calls) {
  const payload = WriteMediaPayload({}, "movie", { ratings: { tt0113277: { ttId: "tt0113277", status: "rated", rating: 9 } } });
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT maximum_rps/.test(sql))
        return { rows: [{ current_rps: "10" }], rowCount: 1 };
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload, revision: 4 }], rowCount: 1 };
      return { rows: [{ id: 3, revision: 5 }], rowCount: 1 };
    },
    release() {}
  };
}

function BuildResumeClient(calls, payload) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload, revision: 4 }], rowCount: 1 };
      if (/UPDATE .*imdb_rating_jobs/.test(sql))
        return { rows: ResumeJobRows(), rowCount: 2 };
      return { rows: [{ revision: 5 }], rowCount: 1 };
    },
    release() {}
  };
}

function BuildUndoClient(calls) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT status/.test(sql))
        return { rows: [{ status: "processing" }], rowCount: 1 };
      return { rows: [{ id: 3, generation: 2, status: "pending" }], rowCount: 1 };
    }
  };
}

function BuildFailureClient(calls, payload) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT payload/.test(sql))
        return { rows: [{ payload, revision: 4 }], rowCount: 1 };
      if (/UPDATE .*imdb_rating_jobs/.test(sql))
        return { rows: [{ id: 3 }], rowCount: 1 };
      return { rows: [{ revision: 5 }], rowCount: 1 };
    }, release() {}
  };
}

function ClassifyQueueCall(call) {
  if (["BEGIN", "COMMIT"].includes(call.sql))
    return call.sql;
  if (/INSERT INTO .*imdb_rating_jobs/.test(call.sql))
    return "job";
  if (/^SELECT payload/.test(call.sql))
    return "state-read";
  if (/UPDATE .*user_states/.test(call.sql))
    return "state-write";
  return "recommendation-delete";
}

function ClassifyCompletionCall(call) {
  if (["BEGIN", "COMMIT"].includes(call.sql))
    return call.sql;
  if (/^SELECT maximum_rps/.test(call.sql))
    return "dispatch-lock";
  if (/^SELECT payload/.test(call.sql))
    return "state-lock";
  if (/UPDATE .*imdb_rating_jobs/.test(call.sql))
    return "job-update";
  return /UPDATE .*user_states/.test(call.sql) ? "state-update" : "dispatch-update";
}

function ClassifyClaimCall(call) {
  if (["BEGIN", "COMMIT"].includes(call.sql))
    return call.sql;
  if (/^SELECT maximum_rps/.test(call.sql))
    return "dispatch-lock";
  return /^WITH user_history/.test(call.sql) ? "job-claim" : "slot-reservation";
}

function ClassifyDeleteCall(call) {
  if (["BEGIN", "COMMIT"].includes(call.sql))
    return call.sql;
  if (/^SELECT payload/.test(call.sql))
    return "state-read";
  return /INSERT INTO .*imdb_rating_jobs/.test(call.sql) ? "job" : "state-write";
}

function BuildFailedMediaPayload() {
  const movie = WriteMediaPayload({}, "movie", { ratings: { tt0113277: { ttId: "tt0113277", status: "rated", rating: 9, submitStatus: "failed" } } });
  return WriteMediaPayload(movie, "tv", { ratings: { tt0903747: { ttId: "tt0903747", status: "rated", rating: 10, submitStatus: "failed" } } });
}

function BuildPendingMediaPayload() {
  const timestamp = "2099-07-22T20:00:00.000Z";
  const record = { ttId: "tt0113277", status: "rated", rating: 9, submitStatus: "pending", at: timestamp, updatedAt: timestamp };
  return WriteMediaPayload({}, "movie", { ratings: { [record.ttId]: record } });
}

function ResumeJobRows() {
  return [
    { media_type: "movie", tt_id: "tt0113277", rating: 9, operation: "rate" },
    { media_type: "tv", tt_id: "tt0903747", rating: 10, operation: "rate" }
  ];
}

function ClaimedJobRow() {
  return { id: 3, user_id: "user-1", media_type: "movie", tt_id: "tt0113277", operation: "rate", rating: 9, payload: {}, generation: 1, attempt_count: 1 };
}

function RatingJob() {
  return { id: 3, generation: 1, operation: "rate", userId: "user-1", mediaType: "movie", ttId: "tt0113277", rating: 9 };
}
