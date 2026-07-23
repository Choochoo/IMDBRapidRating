import assert from "node:assert/strict";
import test from "node:test";
import { CreateImdbRatingJobStore, ReconcileImdbUndoJob, UpsertPendingImdbJobs } from "../server/imdb-rating-job-store.mjs";
import { MergeAccountPayload } from "../src/app/account-state-merge.js";
import { ReadMediaPayload, WriteMediaPayload } from "../shared/media.js";

const MovieMediaType = "movie";
const TvMediaType = "tv";
const UserId = "user-1";
const HeatId = "tt0113277";
const BreakingBadId = "tt0903747";
const RatedStatus = "rated";
const PendingStatus = "pending";
const ProcessingStatus = "processing";
const FailedStatus = "failed";
const RateOperation = "rate";
const BeginCall = "BEGIN";
const CommitCall = "COMMIT";
const StateReadCall = "state-read";
const JobCall = "job";
const StateWriteCall = "state-write";
const RecommendationDeleteCall = "recommendation-delete";
const DispatchLockCall = "dispatch-lock";
const JobClaimCall = "job-claim";
const SlotReservationCall = "slot-reservation";
const StateLockCall = "state-lock";
const JobUpdateCall = "job-update";
const StateUpdateCall = "state-update";
const DispatchUpdateCall = "dispatch-update";
const ThrottleMessage = "Slow down";
const MaximumRps = "10";

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
  const rating = { ttId: HeatId, title: "Heat", status: RatedStatus, rating: 9 };
  const result = await store.QueueImdbRating(UserId, rating, MovieMediaType);
  assert.equal(result.record.submitStatus, PendingStatus);
  assert.equal(result.revision, 8);
  assert.deepEqual(calls.map(ClassifyQueueCall), [BeginCall, StateReadCall, JobCall, StateWriteCall, RecommendationDeleteCall, CommitCall]);
}

async function VerifyAtomicDeleteQueue() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildDeleteClient(calls) });
  const result = await store.QueueImdbDelete(UserId, HeatId, MovieMediaType);
  assert.equal(result.job.id, 4);
  assert.equal(result.revision, 9);
  assert.deepEqual(calls.map(ClassifyDeleteCall), [BeginCall, StateReadCall, JobCall, StateWriteCall, CommitCall]);
}

async function VerifyDeferredDeleteQueue() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildDeleteClient(calls) });
  const result = await store.QueueImdbDelete(UserId, HeatId, MovieMediaType, { deferAccountState: true });
  assert.equal(result.job.id, 4);
  assert.equal(result.revision, undefined);
  assert.deepEqual(calls.map(ClassifyDeleteCall), [BeginCall, JobCall, CommitCall]);
}

async function VerifySharedDispatchSlot() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildClaimClient(calls) });
  const claimed = await store.ClaimImdbRatingJob();
  assert.equal(claimed.job.ttId, HeatId);
  assert.deepEqual(calls.map(ClassifyClaimCall), [BeginCall, DispatchLockCall, JobClaimCall, SlotReservationCall, CommitCall]);
  assert.match(calls[3].sql, /interval '1 second'\/current_rps/);
}

async function VerifySharedThrottle() {
  const calls = [];
  const client = BuildThrottleClient(calls, 1);
  const store = CreateImdbRatingJobStore({ connect: async () => client });
  await store.ThrottleImdbRatingJob(RatingJob(), { status: 429, payload: { error: ThrottleMessage } }, 5000);
  const dispatch = calls.find((call) => /^UPDATE .*imdb_rating_dispatch_state/.test(call.sql));
  assert.match(dispatch.sql, /current_rps\/2/);
  assert.match(dispatch.sql, /next_attempt_at=GREATEST/);
  assert.deepEqual(dispatch.parameters, [5000]);
}

async function VerifyStaleSharedThrottle() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildThrottleClient(calls, 0) });
  const retried = await store.ThrottleImdbRatingJob(RatingJob(), { status: 429, payload: { error: ThrottleMessage } }, 5000);
  assert.equal(retried, false);
  assert.equal(calls.some((call) => /^UPDATE .*imdb_rating_dispatch_state/.test(call.sql)), true);
}

async function VerifyCompletionLockOrder() {
  const calls = [];
  const store = CreateImdbRatingJobStore({ connect: async () => BuildCompletionClient(calls) });
  await store.CompleteImdbRatingJob(RatingJob(), { status: 200, payload: { rating: 9 } });
  assert.deepEqual(calls.map(ClassifyCompletionCall), [BeginCall, DispatchLockCall, StateLockCall, JobUpdateCall, StateUpdateCall, DispatchUpdateCall, CommitCall]);
  const saved = JSON.parse(calls.find((call) => /UPDATE .*user_states/.test(call.sql)).parameters[1]);
  const submitted = ReadMediaPayload(saved, MovieMediaType).ratings.tt0113277;
  assert.equal(submitted.updatedAt, submitted.submittedAt);
}

async function VerifyAuthResume() {
  const calls = [];
  const payload = BuildFailedMediaPayload();
  const store = CreateImdbRatingJobStore({ connect: async () => BuildResumeClient(calls, payload) });
  const result = await store.ResumeImdbRatingJobs(UserId);
  const saved = JSON.parse(calls.find((call) => /UPDATE .*user_states/.test(call.sql)).parameters[1]);
  assert.deepEqual(result, { queued: 2, revision: 5 });
  assert.equal(ReadMediaPayload(saved, MovieMediaType).ratings.tt0113277.submitStatus, PendingStatus);
  assert.equal(ReadMediaPayload(saved, TvMediaType).ratings.tt0903747.submitStatus, PendingStatus);
  assert.ok(ReadMediaPayload(saved, MovieMediaType).ratings.tt0113277.updatedAt);
  assert.ok(ReadMediaPayload(saved, TvMediaType).ratings.tt0903747.updatedAt);
}

async function VerifyTerminalJobPreservation() {
  let statement = "";
  const client = { query: async (sql) => { statement = sql; return { rows: [], rowCount: 0 }; } };
  await UpsertPendingImdbJobs(client, UserId, BuildPendingMediaPayload());
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
  assert.equal(ReadMediaPayload(merged, MovieMediaType).ratings.tt0113277.submitStatus, FailedStatus);
}

async function VerifyCompensatingUndo() {
  const calls = [];
  const client = BuildUndoClient(calls);
  await ReconcileImdbUndoJob(client, UserId, { ttId: HeatId, submitStatus: PendingStatus }, null, MovieMediaType);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /operation, rating, payload/);
  assert.match(calls[1].sql, /'delete', NULL/);
}

function BuildQueueClient(calls) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/INSERT INTO .*imdb_rating_jobs/.test(sql))
        return { rows: [{ id: 3, generation: 1, status: PendingStatus }], rowCount: 1 };
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
        return { rows: [{ maximum_rps: MaximumRps, current_rps: MaximumRps, next_attempt_at: new Date(0), success_streak: 0 }], rowCount: 1 };
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
        return { rows: [{ id: 4, generation: 1, status: PendingStatus }], rowCount: 1 };
      return { rows: [{ revision: 9 }], rowCount: 1 };
    }, release() {}
  };
}

function BuildThrottleClient(calls, retryCount) {
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT maximum_rps/.test(sql))
        return { rows: [{ current_rps: MaximumRps }], rowCount: 1 };
      if (/UPDATE .*imdb_rating_jobs/.test(sql))
        return { rows: [], rowCount: retryCount };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
}

function BuildCompletionClient(calls) {
  const payload = WriteMediaPayload({}, MovieMediaType, { ratings: { tt0113277: { ttId: HeatId, status: RatedStatus, rating: 9 } } });
  return {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^SELECT maximum_rps/.test(sql))
        return { rows: [{ current_rps: MaximumRps }], rowCount: 1 };
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
        return { rows: [{ status: ProcessingStatus }], rowCount: 1 };
      return { rows: [{ id: 3, generation: 2, status: PendingStatus }], rowCount: 1 };
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
  if ([BeginCall, CommitCall].includes(call.sql))
    return call.sql;
  if (/INSERT INTO .*imdb_rating_jobs/.test(call.sql))
    return JobCall;
  if (/^SELECT payload/.test(call.sql))
    return StateReadCall;
  if (/UPDATE .*user_states/.test(call.sql))
    return StateWriteCall;
  return RecommendationDeleteCall;
}

function ClassifyCompletionCall(call) {
  if ([BeginCall, CommitCall].includes(call.sql))
    return call.sql;
  if (/^SELECT maximum_rps/.test(call.sql))
    return DispatchLockCall;
  if (/^SELECT payload/.test(call.sql))
    return StateLockCall;
  if (/UPDATE .*imdb_rating_jobs/.test(call.sql))
    return JobUpdateCall;
  return /UPDATE .*user_states/.test(call.sql) ? StateUpdateCall : DispatchUpdateCall;
}

function ClassifyClaimCall(call) {
  if ([BeginCall, CommitCall].includes(call.sql))
    return call.sql;
  if (/^SELECT maximum_rps/.test(call.sql))
    return DispatchLockCall;
  return /^WITH user_history/.test(call.sql) ? JobClaimCall : SlotReservationCall;
}

function ClassifyDeleteCall(call) {
  if ([BeginCall, CommitCall].includes(call.sql))
    return call.sql;
  if (/^SELECT payload/.test(call.sql))
    return StateReadCall;
  return /INSERT INTO .*imdb_rating_jobs/.test(call.sql) ? JobCall : StateWriteCall;
}

function BuildFailedMediaPayload() {
  const movie = WriteMediaPayload({}, MovieMediaType, { ratings: { tt0113277: { ttId: HeatId, status: RatedStatus, rating: 9, submitStatus: FailedStatus } } });
  return WriteMediaPayload(movie, TvMediaType, { ratings: { tt0903747: { ttId: BreakingBadId, status: RatedStatus, rating: 10, submitStatus: FailedStatus } } });
}

function BuildPendingMediaPayload() {
  const timestamp = "2099-07-22T20:00:00.000Z";
  const record = { ttId: HeatId, status: RatedStatus, rating: 9, submitStatus: PendingStatus, at: timestamp, updatedAt: timestamp };
  return WriteMediaPayload({}, MovieMediaType, { ratings: { [record.ttId]: record } });
}

function ResumeJobRows() {
  return [
    { media_type: MovieMediaType, tt_id: HeatId, rating: 9, operation: RateOperation },
    { media_type: TvMediaType, tt_id: BreakingBadId, rating: 10, operation: RateOperation }
  ];
}

function ClaimedJobRow() {
  return { id: 3, user_id: UserId, media_type: MovieMediaType, tt_id: HeatId, operation: RateOperation, rating: 9, payload: {}, generation: 1, attempt_count: 1 };
}

function RatingJob() {
  return { id: 3, generation: 1, operation: RateOperation, userId: UserId, mediaType: MovieMediaType, ttId: HeatId, rating: 9 };
}
