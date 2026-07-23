import assert from "node:assert/strict";
import test from "node:test";
import { CreateImdbRatingWorker } from "../server/imdb-rating-worker.mjs";

const ImdbCookie = "cookie";

test("the IMDb worker configures a global ten request per second ceiling", VerifyConfiguredRate);
test("the IMDb worker honors a dispatch wait below its empty-queue delay", VerifyDispatchWait);
test("queued ratings complete only after IMDb confirms the write", VerifySuccessfulRating);
test("HTTP 429 throttles globally while HTTP 404 fails only its job", VerifyFailureClassification);

async function VerifyConfiguredRate() {
  let configured = 0;
  const store = BuildStore({ ConfigureImdbDispatchRate: async (rate) => { configured = rate; }, ClaimImdbRatingJob: async () => ({ job: null, waitMs: 250 }) });
  const worker = CreateImdbRatingWorker({ store, maximumRps: 10, concurrency: 1 });
  await worker.Start();
  await worker.Stop();
  assert.equal(configured, 10);
}

async function VerifyDispatchWait() {
  const store = BuildStore({ ClaimImdbRatingJob: async () => ({ job: null, waitMs: 100 }) });
  const worker = CreateImdbRatingWorker({ store });
  assert.equal(await worker.ProcessNext(), 100);
}

async function VerifySuccessfulRating() {
  const calls = [];
  const job = RatingJob();
  const store = BuildStore({ ClaimImdbRatingJob: async () => ({ job, waitMs: 0 }), CompleteImdbRatingJob: async (completed, result) => calls.push({ completed, result }) });
  const submit = async (ttId, rating, cookie) => ({ status: 200, payload: { ok: true, titleId: ttId, rating, cookieSeen: cookie } });
  const worker = CreateImdbRatingWorker({ store, submitImdbRating: submit });
  await worker.ProcessNext();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].completed, job);
  assert.equal(calls[0].result.payload.cookieSeen, ImdbCookie);
}

async function VerifyFailureClassification() {
  const throttled = [];
  const failed = [];
  const store = BuildStore({ ThrottleImdbRatingJob: async (...values) => throttled.push(values), FailImdbRatingJob: async (...values) => failed.push(values) });
  const worker = CreateImdbRatingWorker({ store, random: () => 0 });
  await worker.HandleResult(RatingJob(), { status: 429, payload: { ok: false, retryAfterMs: 5000 } });
  await worker.HandleResult(RatingJob(), { status: 404, payload: { ok: false, error: "Not found" } });
  await worker.HandleResult(RatingJob(), { status: 403, payload: { ok: false, error: "Forbidden" } });
  assert.equal(throttled.length, 1);
  assert.equal(throttled[0][2], 5000);
  assert.equal(failed.length, 2);
  assert.deepEqual(failed[0][2], { authRequired: false });
  assert.deepEqual(failed[1][2], { authRequired: true });
}

function BuildStore(overrides = {}) {
  return {
    ConfigureImdbDispatchRate: async () => null,
    ClaimImdbRatingJob: async () => ({ job: null, waitMs: 250 }),
    getSecret: async () => ImdbCookie,
    CompleteImdbRatingJob: async () => null,
    RetryImdbRatingJob: async () => null,
    ThrottleImdbRatingJob: async () => null,
    FailImdbRatingJob: async () => null,
    ...overrides
  };
}

function RatingJob() {
  return { id: 1, userId: "user-1", mediaType: "movie", ttId: "tt0113277", operation: "rate", rating: 9, generation: 1, attemptCount: 1 };
}
