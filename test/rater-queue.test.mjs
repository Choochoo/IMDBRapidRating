import assert from "node:assert/strict";
import test from "node:test";
import { CalculatePoolVersion } from "../server/movie-pool.mjs";
import { ReconcileQueueIds } from "../server/rater-queue.mjs";
import { CreateRaterQueueStore } from "../server/rater-queue-store.mjs";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";
import { BuildState, BuildStoragePayload } from "../src/app/state.js";

const AccountSeed = "account-seed";
const ActionId = "20c61166-6fa0-4117-9828-c51d0e0861dd";
const MovieOneId = "tt0000001";
const MovieTwoId = "tt0000002";
const MovieThreeId = "tt0000003";
const MovieFourId = "tt0000004";
const NotSeenStatus = "notSeen";
const PendingStatus = "pending";
const PoolVersion = "pool-v1";
const RatedStatus = "rated";
const UserId = "user-1";

test("a server seed produces one stable queue on every device", VerifyStableSeed);
test("pool updates preserve the saved order, remove unavailable movies, and append additions", VerifyPoolUpdates);
test("movie pool identity hashes every ordered IMDb ID", VerifyPoolIdentity);
test("browser queue rebuilding never invents unsaved movies", VerifyBrowserQueue);
test("generic account saves cannot overwrite the authoritative queue", VerifyQueuePersistenceBoundary);
test("server queue filters are reversible and do not mark hidden titles as seen", VerifyReversibleFilters);
test("atomic decisions advance only the expected head and reject a stale device", VerifyAtomicDecisions);
test("quick ratings atomically save history and remove queue and watchlist entries", VerifyQuickRatings);

function VerifyStableSeed() {
  const pool = [MovieOneId, MovieTwoId, MovieThreeId, MovieFourId, "tt0000005"];
  const first = ReconcileQueueIds(null, pool, [], AccountSeed);
  const second = ReconcileQueueIds(null, pool, [], AccountSeed);

  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort(), [...pool].sort());
}

function VerifyPoolUpdates() {
  const saved = [MovieThreeId, MovieOneId, MovieTwoId];
  const pool = [MovieOneId, MovieTwoId, MovieThreeId, MovieFourId];
  const queue = ReconcileQueueIds(saved, pool, [MovieOneId], AccountSeed);

  assert.equal(queue[0], MovieThreeId);
  assert.equal(queue[1], MovieTwoId);
  assert.equal(queue.at(-1), MovieFourId);
  assert.equal(queue.includes(MovieOneId), false);
}

function VerifyPoolIdentity() {
  const original = CalculatePoolVersion([MovieOneId, MovieTwoId, MovieThreeId]);
  const changedMiddle = CalculatePoolVersion([MovieOneId, "tt9999999", MovieThreeId]);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.notEqual(original, changedMiddle);
}

function VerifyBrowserQueue() {
  const app = Object.create(RapidRaterApp.prototype);
  const movies = [Movie(MovieOneId), Movie(MovieTwoId), Movie(MovieThreeId)];
  app.State = {
    movies,
    movieById: new Map(movies.map((movie) => [movie.ttId, movie])),
    ratings: {},
    recommendationQueue: [],
    savedQueueIds: [MovieTwoId]
  };

  app.RebuildQueue();

  assert.deepEqual(app.State.queue.map((movie) => movie.ttId), [MovieTwoId]);
}

function VerifyQueuePersistenceBoundary() {
  const state = BuildState();
  state.savedQueueIds = [MovieOneId, MovieTwoId];
  state.queue = [Movie(MovieOneId), Movie(MovieTwoId)];
  const payload = BuildStoragePayload(state);

  assert.equal(payload.queueIds, undefined);
  assert.equal(payload.signature, undefined);
}

async function VerifyReversibleFilters() {
  const database = FakeRaterDatabase();
  const store = CreateRaterQueueStore(database.pool);
  const titlePool = BuildFilteredTitlePool();
  database.state.payload = {
    media: { movie: { filters: { minYear: 2000, excludeBollywood: true }, ratings: {} }, tv: {} }
  };
  const filtered = await store.getRaterQueue(UserId, titlePool);
  assert.deepEqual(filtered.queueIds, [MovieTwoId]);
  assert.deepEqual(database.state.payload.media.movie.ratings, {});
  database.state.payload.media.movie.filters = {};
  const restored = await store.getRaterQueue(UserId, titlePool);
  assert.deepEqual([...restored.queueIds].sort(), [MovieOneId, MovieTwoId, MovieThreeId]);
}

function BuildFilteredTitlePool() {
  const titles = [
    { ttId: MovieOneId, year: 1990, originCountries: ["US"], originalLanguage: "en" },
    { ttId: MovieTwoId, year: 2015, originCountries: ["KR"], originalLanguage: "ko" },
    { ttId: MovieThreeId, year: 2020, originCountries: ["IN"], originalLanguage: "hi" }
  ];
  return { titles, ids: titles.map((title) => title.ttId), version: PoolVersion };
}

async function VerifyAtomicDecisions() {
  const database = FakeRaterDatabase();
  const store = CreateRaterQueueStore(database.pool);
  const record = BuildRatedRecord();
  const first = await store.commitRaterDecision(UserId, BuildRatedDecision(record));
  AssertFirstDecision(first, database);
  const duplicate = await store.commitRaterDecision(UserId, BuildRatedDecision(record));
  AssertDuplicateDecision(duplicate);
  const stale = await store.commitRaterDecision(UserId, BuildStaleDecision());
  AssertStaleDecision(stale, database);
}

function BuildRatedRecord() {
  return {
    ttId: MovieOneId,
    title: "One",
    status: RatedStatus,
    rating: 8,
    at: "2026-07-19T18:00:00.000Z",
    submitStatus: PendingStatus
  };
}

function BuildRatedDecision(record) {
  return {
    actionId: ActionId,
    expectedRevision: 4,
    kind: RatedStatus,
    ttId: record.ttId,
    record
  };
}

function AssertFirstDecision(first, database) {
  assert.equal(first.ok, true);
  assert.equal(first.queue.revision, 5);
  assert.deepEqual(first.queue.queueIds, [MovieTwoId, MovieThreeId]);
  assert.equal(database.state.payload.media.movie.ratings.tt0000001.rating, 8);
}

function AssertDuplicateDecision(duplicate) {
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.queue.revision, 5);
  assert.deepEqual(duplicate.queue.queueIds, [MovieTwoId, MovieThreeId]);
}

function BuildStaleDecision() {
  return {
    actionId: "f9a575eb-0a8e-4cda-bdf9-fc2587e12db0",
    expectedRevision: 4,
    kind: NotSeenStatus,
    ttId: MovieOneId,
    record: { ttId: MovieOneId, status: NotSeenStatus }
  };
}

function AssertStaleDecision(stale, database) {
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "QUEUE_CONFLICT");
  assert.equal(stale.current.revision, 5);
  assert.deepEqual(database.queue.queue_ids, [MovieTwoId, MovieThreeId]);
}

async function VerifyQuickRatings() {
  const database = FakeRaterDatabase();
  const store = CreateRaterQueueStore(database.pool);
  const record = BuildQuickRatingRecord();
  const decision = BuildQuickRatingDecision(record);
  const result = await store.CommitQuickRating(UserId, decision);
  assert.equal(result.ok, true);
  assert.equal(result.queue.revision, 5);
  assert.deepEqual(result.queue.queueIds, [MovieOneId, MovieThreeId]);
  assert.equal(database.state.payload.media.movie.ratings.tt0000002.rating, 9);
  assert.equal(database.state.payload.media.movie.history.at(-1).ttId, MovieTwoId);
  assert.deepEqual(database.deletedRecommendations, [MovieTwoId]);
}

function BuildQuickRatingRecord() {
  return {
    ttId: MovieTwoId,
    title: "Two",
    status: RatedStatus,
    rating: 9,
    at: "2026-07-22T20:00:00.000Z",
    submitStatus: PendingStatus
  };
}

function BuildQuickRatingDecision(record) {
  return {
    actionId: "f136c85c-3516-45bb-a8d0-00fdf8d65da6",
    kind: RatedStatus,
    ttId: record.ttId,
    mediaType: "movie",
    record
  };
}

function Movie(ttId) {
  return { ttId, title: ttId };
}

const NoOp = () => undefined;

function FakeRaterDatabase() {
  const queue = {
    pool_version: PoolVersion,
    seed: "seed",
    queue_ids: [MovieOneId, MovieTwoId, MovieThreeId],
    revision: 4
  };
  const state = { payload: { ratings: {}, history: [] }, revision: 9 };
  const actions = new Map();
  const deletedRecommendations = [];
  const client = BuildFakeClient({ queue, state, actions, deletedRecommendations });
  return { queue, state, deletedRecommendations, pool: { connect: async () => client } };
}

function BuildFakeClient(database) {
  return {
    query: async (sql, parameters = []) => await QueryFakeDatabase(sql, parameters, database),
    release: NoOp
  };
}

async function QueryFakeDatabase(sql, parameters, database) {
  const selection = ReadFakeSelection(sql, parameters, database);
  if (selection)
    return selection;
  return ApplyFakeMutation(sql, parameters, database);
}

function ReadFakeSelection(sql, parameters, database) {
  if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql))
    return { rows: [], rowCount: 0 };
  if (/SELECT tt_id, result FROM/.test(sql))
    return ReadFakeAction(parameters, database.actions);
  if (/SELECT pool_version, seed, queue_ids, revision FROM/.test(sql))
    return { rows: [{ ...database.queue, queue_ids: [...database.queue.queue_ids] }], rowCount: 1 };
  if (/SELECT payload, revision FROM/.test(sql))
    return { rows: [{ payload: structuredClone(database.state.payload), revision: database.state.revision }], rowCount: 1 };
  if (/SELECT tt_id FROM/.test(sql))
    return { rows: [], rowCount: 0 };
  return null;
}

function ReadFakeAction(parameters, actions) {
  const action = actions.get(parameters[2]);
  return { rows: action ? [action] : [], rowCount: action ? 1 : 0 };
}

function ApplyFakeMutation(sql, parameters, database) {
  if (/UPDATE .*user_states/.test(sql))
    return UpdateFakeState(parameters, database.state);
  if (/UPDATE .*rater_queues/.test(sql))
    return UpdateFakeQueue(sql, parameters, database.queue);
  if (/DELETE FROM .*recommendation_queue/.test(sql))
    return DeleteFakeRecommendation(parameters, database.deletedRecommendations);
  if (/INSERT INTO .*imdb_rating_jobs/.test(sql))
    return { rows: [{ id: 1, generation: 1, status: PendingStatus }], rowCount: 1 };
  if (/INSERT INTO .*rater_actions/.test(sql))
    return InsertFakeAction(parameters, database.actions);
  throw new Error(`Unexpected SQL in fake database: ${sql}`);
}

function UpdateFakeState(parameters, state) {
  state.payload = JSON.parse(parameters[1]);
  state.revision++;
  return { rows: [{ revision: state.revision }], rowCount: 1 };
}

function UpdateFakeQueue(sql, parameters, queue) {
  const replacesPool = /SET pool_version=\$3, queue_ids=\$4/.test(sql);
  queue.pool_version = replacesPool ? parameters[2] : (parameters[3] || queue.pool_version);
  queue.queue_ids = JSON.parse(parameters[replacesPool ? 3 : 2]);
  queue.revision++;
  return { rows: [{ ...queue, queue_ids: [...queue.queue_ids] }], rowCount: 1 };
}

function DeleteFakeRecommendation(parameters, deletedRecommendations) {
  deletedRecommendations.push(parameters[2]);
  return { rows: [], rowCount: 1 };
}

function InsertFakeAction(parameters, actions) {
  actions.set(parameters[1], { tt_id: parameters[4], result: JSON.parse(parameters[5]) });
  return { rows: [], rowCount: 1 };
}
