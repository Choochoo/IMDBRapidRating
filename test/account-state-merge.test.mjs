import assert from "node:assert/strict";
import test from "node:test";
import { MergeAccountPayload } from "../src/app/account-state-merge.js";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";
import { ReadMediaPayload } from "../shared/media.js";

const FirstTitleId = "tt0000001";
const SecondTitleId = "tt0000002";
const ThirdTitleId = "tt0000003";
const DecisionTitleId = "tt0074279";
const SubmitTitleId = "tt0113277";
const EarlyTimestamp = "2026-07-16T10:00:00.000Z";
const MiddleTimestamp = "2026-07-16T11:00:00.000Z";
const LateTimestamp = "2026-07-16T12:00:00.000Z";
const MovieMediaType = "movie";
const TvMediaType = "tv";
const TestUserEmail = "user@example.com";
const NotSeenStatus = "notSeen";
const FailedSubmitStatus = "failed";
const OtherRecommendationBasis = "other";
const NewLetterboxdExport = "new.zip";
const RemoteRatingsCsv = `Const,Your Rating\n${FirstTitleId},7`;
const IdleRefreshRatingsCsv = `Const,Your Rating\n${ThirdTitleId},9`;

test("an idle account refresh updates durable IMDb queue counts without a state revision", VerifyQueueCountRefresh);
test("equal rating timestamps preserve authoritative server submit state", VerifyRemoteTimestampTie);
test("account conflicts preserve ratings made on both devices", VerifyAccountConflictMerge);
test("newest decision for the same IMDb title wins during a device conflict", VerifyNewestDecision);
test("device conflicts retain recommendation exclusions and the newest Letterboxd import", VerifyRecommendationConflict);
test("account sync merges a stale device snapshot and retries with the current revision", VerifyStateSyncConflict);
test("an idle device refreshes its queue when another device saves", VerifyIdleDeviceRefresh);
test("movie and TV conflicts merge inside separate media namespaces", VerifyMediaNamespaceMerge);
test("the most recently changed filters win during a device conflict", VerifyNewestFilters);
test("the most recently changed recommendation basis wins per media section", VerifyNewestRecommendationBasis);

function VerifyAccountConflictMerge() {
  const remote = BuildRemoteAccountConflict();
  const local = BuildLocalAccountConflict();
  const merged = MergeAccountPayload(remote, local);
  const ratingIds = Object.keys(ReadMediaPayload(merged, MovieMediaType).ratings).sort();
  assert.deepEqual(ratingIds, [FirstTitleId, SecondTitleId]);
  assert.equal(merged.queueIds, undefined);
}

function BuildRemoteAccountConflict() {
  return {
    ratings: { [FirstTitleId]: Record(FirstTitleId, 7, EarlyTimestamp) },
    queueIds: [SecondTitleId, ThirdTitleId]
  };
}

function BuildLocalAccountConflict() {
  return {
    ratings: { [SecondTitleId]: Record(SecondTitleId, 8, MiddleTimestamp) },
    queueIds: [FirstTitleId, ThirdTitleId]
  };
}

function VerifyNewestDecision() {
  const remote = { ratings: { [DecisionTitleId]: Record(DecisionTitleId, 6, EarlyTimestamp) } };
  const local = { ratings: { [DecisionTitleId]: NotSeen(DecisionTitleId, LateTimestamp) } };
  const merged = MergeAccountPayload(remote, local);
  const rating = ReadMediaPayload(merged, MovieMediaType).ratings[DecisionTitleId];
  assert.equal(rating.status, NotSeenStatus);
  assert.equal(rating.rating, null);
}

function VerifyRecommendationConflict() {
  const remote = { recommendationExclusions: [{ ttId: FirstTitleId, title: "Remote", at: EarlyTimestamp }], letterboxd: { sourceName: NewLetterboxdExport, importedAt: LateTimestamp, items: [{ ttId: "tt1" }] } };
  const local = { recommendationExclusions: [{ ttId: SecondTitleId, title: "Local", at: MiddleTimestamp }], letterboxd: { sourceName: "old.zip", importedAt: "2026-07-16T09:00:00.000Z", items: [] } };
  const merged = MergeAccountPayload(remote, local);
  const media = ReadMediaPayload(merged, MovieMediaType);
  assert.equal(media.recommendationExclusions.length, 2);
  assert.equal(media.letterboxd.sourceName, NewLetterboxdExport);
}

async function VerifyStateSyncConflict() {
  const requests = [];
  const app = BuildStateSyncApp(requests);
  await app.PerformStateSync();
  VerifyStateSyncResult(app, requests);
}

function BuildStateSyncApp(requests) {
  const app = Object.create(RapidRaterApp.prototype);
  Object.assign(app, BuildStateSyncBase(), BuildStateSyncCallbacks(requests));
  return app;
}

function BuildStateSyncBase() {
  return {
    AccountPayload: { ratings: { [SecondTitleId]: Record(SecondTitleId, 8, MiddleTimestamp) } },
    AccountRevision: 4,
    RatingsCsvText: "",
    State: { mediaType: MovieMediaType },
    applied: null,
    toast: ""
  };
}

function BuildStateSyncCallbacks(requests) {
  return {
    ApplyMergedAccountPayload(payload) { this.applied = payload; },
    ShowToast(message) { this.toast = message; },
    async RequestJson(_url, _method, body) {
      requests.push(body);
      if (requests.length === 1)
        throw BuildStateConflictError();
      return { ok: true, revision: 6 };
    }
  };
}

function VerifyStateSyncResult(app, requests) {
  assert.equal(requests.length, 2);
  assert.equal(requests[0].revision, 4);
  assert.equal(requests[1].revision, 5);
  const ratingIds = Object.keys(ReadMediaPayload(requests[1].payload, MovieMediaType).ratings).sort();
  assert.deepEqual(ratingIds, [FirstTitleId, SecondTitleId]);
  assert.equal(app.AccountRevision, 6);
  assert.match(app.toast, /combined and saved/i);
}

async function VerifyIdleDeviceRefresh() {
  const remotePayload = { ratings: { [ThirdTitleId]: Record(ThirdTitleId, 9, LateTimestamp) } };
  const app = BuildIdleRefreshApp(remotePayload);
  const changed = await app.RefreshAccountStateFromServer();
  assert.equal(changed, true);
  assert.equal(app.AccountRevision, 8);
  assert.equal(ReadMediaPayload(app.applied, MovieMediaType).ratings[ThirdTitleId].rating, 9);
  assert.match(app.toast, /other device/i);
}

function BuildIdleRefreshApp(remotePayload) {
  const app = Object.create(RapidRaterApp.prototype);
  Object.assign(app, BuildIdleRefreshBase(), BuildIdleRefreshCallbacks(remotePayload));
  return app;
}

function BuildIdleRefreshBase() {
  return {
    User: { email: TestUserEmail },
    StateDirty: false,
    AccountRevision: 7,
    AccountPayload: { ratings: {} },
    RatingsCsvText: "",
    applied: null,
    toast: ""
  };
}

function BuildIdleRefreshCallbacks(remotePayload) {
  return {
    async FetchJson() { return { revision: 8, payload: remotePayload, ratingsCsv: IdleRefreshRatingsCsv }; },
    ApplyMergedAccountPayload(payload) { this.applied = payload; },
    ShowToast(message) { this.toast = message; }
  };
}

function VerifyMediaNamespaceMerge() {
  const remote = { media: { movie: { ratings: { [FirstTitleId]: Record(FirstTitleId, 8, EarlyTimestamp) } }, tv: {} } };
  const local = { media: { movie: {}, tv: { ratings: { [SecondTitleId]: Record(SecondTitleId, 9, MiddleTimestamp) } } } };
  const merged = MergeAccountPayload(remote, local);
  assert.deepEqual(Object.keys(ReadMediaPayload(merged, MovieMediaType).ratings), [FirstTitleId]);
  assert.deepEqual(Object.keys(ReadMediaPayload(merged, TvMediaType).ratings), [SecondTitleId]);
}

function VerifyNewestFilters() {
  const remote = { media: { movie: { filters: { minYear: 1980, updatedAt: EarlyTimestamp } }, tv: {} } };
  const local = { media: { movie: { filters: { minYear: 2000, excludeBollywood: true, updatedAt: MiddleTimestamp } }, tv: {} } };
  const merged = MergeAccountPayload(remote, local);
  const filters = ReadMediaPayload(merged, MovieMediaType).filters;
  assert.equal(filters.minYear, 2000);
  assert.equal(filters.excludeBollywood, true);
}

function VerifyNewestRecommendationBasis() {
  const remote = { media: { movie: { recommendationBasis: { source: OtherRecommendationBasis, updatedAt: LateTimestamp } }, tv: {} } };
  const local = { media: { movie: { recommendationBasis: { source: "both", updatedAt: MiddleTimestamp } }, tv: {} } };
  const merged = MergeAccountPayload(remote, local);
  assert.equal(ReadMediaPayload(merged, MovieMediaType).recommendationBasis.source, OtherRecommendationBasis);
  assert.equal(ReadMediaPayload(merged, TvMediaType).recommendationBasis.source, "current");
}

async function VerifyQueueCountRefresh() {
  const app = Object.create(RapidRaterApp.prototype);
  app.User = { email: TestUserEmail };
  app.StateDirty = false;
  app.AccountRevision = 8;
  app.State = { live: { queueCounts: {} } };
  app.FetchJson = async () => ({ revision: 8, imdbQueue: { counts: { failed: 2 } } });
  app.UpdateStats = () => null;
  const changed = await app.RefreshAccountStateFromServer();
  assert.equal(changed, false);
  assert.deepEqual(app.State.live.queueCounts, { failed: 2 });
}

function VerifyRemoteTimestampTie() {
  const timestamp = "2026-07-22T20:00:00.000Z";
  const remote = { ratings: { [SubmitTitleId]: { ...Record(SubmitTitleId, 9, timestamp), submitStatus: FailedSubmitStatus } } };
  const local = { ratings: { [SubmitTitleId]: { ...Record(SubmitTitleId, 9, timestamp), submitStatus: "pending" } } };
  const merged = MergeAccountPayload(remote, local);
  assert.equal(ReadMediaPayload(merged, MovieMediaType).ratings[SubmitTitleId].submitStatus, FailedSubmitStatus);
}

function Record(ttId, rating, at) {
  return { ttId, status: "rated", rating, at, submitStatus: "submitted", submittedAt: at };
}

function BuildStateConflictError() {
  const error = new Error("Your account changed in another browser.");
  error.status = 409;
  const payload = { ratings: { [FirstTitleId]: Record(FirstTitleId, 7, EarlyTimestamp) } };
  error.payload = { current: { revision: 5, ratings_csv: RemoteRatingsCsv, payload } };
  return error;
}

function NotSeen(ttId, at) {
  return { ttId, status: NotSeenStatus, rating: null, at, submitStatus: "skipped", submittedAt: "" };
}
