import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { HashPassword } from "../server/auth.mjs";
import { RegisterApiRoutes } from "../server/routes.mjs";

const TestEmail = "user@example.com";
const TestPassword = "correct horse battery staple";
const AuthSessionPath = "/api/auth/session";
const AuthLoginPath = "/api/auth/login";
const CsrfHeader = "x-csrf-token";
const TestAiBaseUrl = "https://ai.example.test/v1";
const TestAiModel = "test-model";
const TestAiKey = "ai-key";
const AlternateAiConnectionId = "d95fe15c-f604-4f38-be88-b65c6202a910";
const AlternateAiBaseUrl = "https://alternate-ai.example.test/v1";
const AlternateAiModel = "alternate-model";
const AlternateAiKey = "alternate-key";
const AccountStatePath = "/api/account/state";
const AuthRegisterPath = "/api/auth/register";
const CrimeGenre = "Crime";
const DramaGenre = "Drama";
const GrumpyTitle = "Grumpy Old Men";
const GrumpyTitleId = "tt0107050";
const GrumpyTimestamp = "2026-07-16T20:00:00.000Z";
const HeatQueueKey = "heat|1995";
const HeatTitle = "Heat";
const HeatTitleId = "tt0113277";
const MovieMediaType = "movie";
const NewEmail = "New_User@Example.com";
const NewNormalizedEmail = "new_user@example.com";
const NewUsername = "new-viewer";
const PendingStatus = "pending";
const PoolVersion = "pool-v1";
const QuickRatingPath = "/api/rater/quick-rating";
const RatePath = "/api/rate";
const RatedStatus = "rated";
const RegistrationPassword = "12345678";
const SpeedTitle = "Speed";
const SpeedTitleId = "tt0111257";
const SpeedTimestamp = "2026-07-16T21:00:00.000Z";
const TakenEmail = "taken@example.com";
const ThiefTitle = "Thief";
const ThiefTitleId = "tt0083190";
const TvMediaType = "tv";

const TestMoviePool = {
  ids: [HeatTitleId, ThiefTitleId],
  titles: [
    { ttId: HeatTitleId, title: HeatTitle, year: 1995, genres: [CrimeGenre, DramaGenre] },
    { ttId: ThiefTitleId, title: ThiefTitle, year: 1981, genres: [CrimeGenre] }
  ],
  version: PoolVersion
};

test("email login establishes an authenticated session and CSRF protects account writes", VerifyEmailLogin);
test("logout destroys the authenticated session", VerifyLogout);
test("public registration validates input, creates account data, and signs the user in", VerifyRegistration);
test("registration reports an unavailable username separately from email", VerifyRegistrationUsernameConflict);
test("session bootstrap exposes optional public analytics configuration", VerifyAnalyticsBootstrap);

async function VerifyEmailLogin() {
  const user = await BuildTestUser("8133d1c3-2620-42fa-85e6-6b6ec6204301");
  const state = { saved: null };
  const session = await OpenTestSession(BuildStateStore(user, state));
  assert.equal(session.anonymous.body.authenticated, false);
  await session.agent.post(AuthLoginPath).send({ email: TestEmail, password: TestPassword }).expect(403);
  const login = await AuthenticateSession(session, user);
  await session.agent.put(AccountStatePath).send({ payload: {}, ratingsCsv: "", revision: 0 }).expect(403);
  await session.agent.put(AccountStatePath).set(CsrfHeader, login.body.csrfToken).send({ payload: { ratings: {} }, ratingsCsv: "", revision: 0 }).expect(200);
  assert.deepEqual(state.saved.payload, { ratings: {} });
}

async function VerifyAnalyticsBootstrap() {
  const analyticsConfig = { enabled: true, token: "phc_public_project_token", host: "https://us.i.posthog.com" };
  const response = await request(BuildTestApp({}, { analyticsConfig })).get(AuthSessionPath).expect(200);
  assert.deepEqual(response.body.analytics, analyticsConfig);
}

function BuildStateStore(user, state) {
  return {
    findUserByEmail: async (email) => email === TestEmail ? user : null,
    getBundle: async () => BuildEmptyBundle(),
    saveState: async (_userId, payload, ratingsCsv, revision) => {
      state.saved = { payload, ratingsCsv, revision };
      return { ok: true, revision: revision + 1 };
    }
  };
}

async function VerifyLogout() {
  const user = await BuildTestUser("40c9da79-e7d1-4357-947a-85b1e21b1a75");
  const authenticated = await LoginTestUser({ findUserByEmail: async () => user }, user);
  await authenticated.agent.post("/api/auth/logout").set(CsrfHeader, authenticated.csrfToken).send({}).expect(200);
  const current = await authenticated.agent.get(AuthSessionPath).expect(200);
  assert.equal(current.body.authenticated, false);
}

async function VerifyRegistration() {
  const users = new Map();
  const session = await OpenTestSession(BuildRegistrationStore(users));
  assert.equal(session.anonymous.body.registrationEnabled, true);
  await session.agent.post(AuthRegisterPath).set(CsrfHeader, session.csrfToken).send({ email: "not-an-email", password: RegistrationPassword }).expect(422);
  const created = await session.agent.post(AuthRegisterPath).set(CsrfHeader, session.csrfToken).send({ handle: NewUsername, email: NewEmail, password: RegistrationPassword }).expect(201);
  AssertRegisteredUser(created, users);
  const current = await session.agent.get(AuthSessionPath).expect(200);
  assert.equal(current.body.authenticated, true);
  assert.equal(current.body.user.email, NewNormalizedEmail);
}

function BuildRegistrationStore(users) {
  return {
    findUserByEmail: async (email) => users.get(email) || null,
    createUser: async ({ email, passwordHash, handle }) => {
      const user = { id: "504cf9d4-7f91-4621-9c53-dcc27e13620c", email, passwordHash, handle };
      users.set(email, user);
      return user;
    },
    getBundle: async () => BuildEmptyBundle()
  };
}

function AssertRegisteredUser(created, users) {
  assert.equal(created.body.user.email, NewNormalizedEmail);
  assert.equal("username" in created.body.user, false);
  assert.equal("displayName" in created.body.user, false);
  assert.equal(users.get(NewNormalizedEmail).handle, NewUsername);
  assert.notEqual(users.get(NewNormalizedEmail).passwordHash, RegistrationPassword);
}

async function VerifyRegistrationUsernameConflict() {
  const error = Object.assign(new Error("duplicate username"), { code: "23505", constraint: "user_profiles_handle_unique" });
  const store = { findUserByEmail: async () => null, createUser: async () => Promise.reject(error) };
  const session = await OpenTestSession(store);
  const response = await session.agent.post(AuthRegisterPath).set(CsrfHeader, session.csrfToken).send({ handle: NewUsername, email: NewEmail, password: RegistrationPassword }).expect(409);
  assert.equal(response.body.code, "USERNAME_UNAVAILABLE");
}

test("registration rejects missing CSRF and unavailable email addresses", VerifyRegistrationRejection);

async function VerifyRegistrationRejection() {
  const existing = { id: "99d197c6-b299-4ee8-a223-616a4c5fb575", email: TakenEmail };
  const store = {
    findUserByEmail: async (email) => email === TakenEmail ? existing : null,
    createUser: async () => { throw new Error("createUser should not run"); }
  };
  const session = await OpenTestSession(store);
  await session.agent.post(AuthRegisterPath).send({ handle: NewUsername, email: TakenEmail, password: RegistrationPassword }).expect(403);
  const duplicate = await session.agent.post(AuthRegisterPath).set(CsrfHeader, session.csrfToken).send({ handle: NewUsername, email: TakenEmail, password: RegistrationPassword }).expect(409);
  assert.equal(duplicate.body.code, "EMAIL_UNAVAILABLE");
}

test("IMDb rating requests are persisted for background delivery", VerifyImdbPersistence);

async function VerifyImdbPersistence() {
  const user = await BuildTestUser("0ed7ef61-71e6-4c9b-92ba-76a680af3b2d");
  const state = { recorded: null, queuedDelete: null };
  const authenticated = await LoginTestUser(BuildImdbStore(user, state), user);
  const rated = await authenticated.agent.post(RatePath).set(CsrfHeader, authenticated.csrfToken).send(BuildImdbRating()).expect(202);
  AssertImdbRating(rated, state.recorded, user);
  const removed = await authenticated.agent.delete(RatePath).set(CsrfHeader, authenticated.csrfToken).send({ titleId: GrumpyTitleId }).expect(202);
  AssertImdbDelete(removed, state.queuedDelete, user);
}

function BuildImdbStore(user, state) {
  return {
    findUserByEmail: async () => user,
    QueueImdbRating: async (userId, record, mediaType) => {
      state.recorded = { userId, record, mediaType };
      return { revision: 17, job: { id: 41 } };
    },
    QueueImdbDelete: async (userId, ttId, mediaType, options) => {
      state.queuedDelete = { userId, ttId, mediaType, options };
      return { job: { id: 42 }, revision: 18 };
    }
  };
}

function BuildImdbRating() {
  return { titleId: GrumpyTitleId, rating: 8, title: GrumpyTitle, year: 1993, at: GrumpyTimestamp };
}

function AssertImdbRating(response, recorded, user) {
  assert.deepEqual([response.body.revision, response.body.queued, response.body.jobId], [17, true, 41]);
  assert.equal(recorded.userId, user.id);
  assert.deepEqual(recorded.record, BuildExpectedImdbRecord());
}

function BuildExpectedImdbRecord() {
  return {
    status: RatedStatus,
    rating: 8,
    title: GrumpyTitle,
    year: 1993,
    ttId: GrumpyTitleId,
    mediaType: MovieMediaType,
    at: GrumpyTimestamp,
    submitStatus: PendingStatus,
    submitError: "",
    submittedAt: ""
  };
}

function AssertImdbDelete(response, queuedDelete, user) {
  assert.equal(response.body.revision, 18);
  assert.equal(response.body.queued, true);
  assert.deepEqual(queuedDelete, { userId: user.id, ttId: GrumpyTitleId, mediaType: MovieMediaType, options: { deferAccountState: false } });
}

test("not-seen decisions are committed directly to account state", VerifyNotSeenDecision);

async function VerifyNotSeenDecision() {
  const user = await BuildTestUser("241c7a98-53a7-42b3-bde7-3fd3a27db9dc");
  const state = { recorded: null };
  const authenticated = await LoginTestUser(BuildNotSeenStore(user, state), user);
  const saved = await authenticated.agent.put("/api/account/not-seen").set(CsrfHeader, authenticated.csrfToken).send(BuildNotSeenBody()).expect(200);
  assert.equal(saved.body.revision, 23);
  assert.equal(state.recorded.userId, user.id);
  assert.deepEqual(state.recorded.record, BuildExpectedNotSeenRecord());
}

function BuildNotSeenStore(user, state) {
  return {
    findUserByEmail: async () => user,
    recordRating: async (userId, record, mediaType) => {
      state.recorded = { userId, record, mediaType };
      return 23;
    }
  };
}

function BuildNotSeenBody() {
  return { titleId: SpeedTitleId, title: SpeedTitle, year: 1994, at: SpeedTimestamp };
}

function BuildExpectedNotSeenRecord() {
  return {
    status: "notSeen",
    rating: null,
    title: SpeedTitle,
    year: 1994,
    ttId: SpeedTitleId,
    mediaType: MovieMediaType,
    at: SpeedTimestamp,
    submitStatus: "skipped",
    submitError: "",
    submittedAt: ""
  };
}

test("rater decisions require the current queue head and return the canonical next queue", VerifyRaterDecision);

async function VerifyRaterDecision() {
  const user = await BuildTestUser("d3039098-ed05-4740-bc99-b929927b0dd7");
  const initialQueue = { revision: 12, poolVersion: PoolVersion, queueIds: [HeatTitleId, ThiefTitleId] };
  const state = { received: null };
  const authenticated = await LoginTestUser(BuildRaterStore(user, initialQueue, state), user);
  const response = await authenticated.agent.put("/api/rater/decision").set(CsrfHeader, authenticated.csrfToken).send(BuildRaterDecision()).expect(200);
  AssertRaterDecision(state.received, response.body);
}

function BuildRaterStore(user, initialQueue, state) {
  return {
    findUserByEmail: async () => user,
    getRaterQueue: async (_userId, mediaType, moviePool) => {
      assert.equal(mediaType, MovieMediaType);
      assert.equal(moviePool, TestMoviePool);
      return initialQueue;
    },
    commitRaterDecision: async (_userId, decision) => {
      state.received = decision;
      return BuildCommittedRaterDecision(decision);
    }
  };
}

function BuildCommittedRaterDecision(decision) {
  return {
    ok: true,
    duplicate: false,
    stateRevision: 21,
    record: decision.record,
    previous: null,
    queue: { revision: 13, poolVersion: PoolVersion, queueIds: [ThiefTitleId] }
  };
}

function BuildRaterDecision() {
  return {
    actionId: "4dd7a964-024b-441b-a83c-174cdf53f4db",
    expectedRevision: 12,
    kind: RatedStatus,
    titleId: HeatTitleId,
    title: HeatTitle,
    year: 1995,
    rating: 9,
    at: "2026-07-19T19:00:00.000Z"
  };
}

function AssertRaterDecision(received, response) {
  assert.equal(received.ttId, HeatTitleId);
  assert.equal(received.mediaType, MovieMediaType);
  assert.equal(received.expectedRevision, 12);
  assert.equal(received.record.submitStatus, PendingStatus);
  assert.equal(response.queue.revision, 13);
  assert.deepEqual(response.queue.queueIds, [ThiefTitleId]);
}

test("quick ratings use canonical catalog details and create a pending IMDb write", VerifyQuickRatingRoute);
test("quick ratings reject title IDs outside the selected catalog", VerifyUnknownQuickRating);

async function VerifyQuickRatingRoute() {
  const user = await BuildTestUser("9fdfd065-5aa8-49ec-9b7f-c17b28e8c221");
  const scenario = BuildQuickRatingScenario(user);
  const authenticated = await LoginTestUser(scenario.store, user);
  const body = { actionId: "496bf6a2-1fb2-4ad9-83d2-ed7685ea0b96", titleId: HeatTitleId, rating: 9, at: "2026-07-22T20:00:00.000Z" };
  const response = await authenticated.agent.put(QuickRatingPath).set(CsrfHeader, authenticated.csrfToken).send(body).expect(200);
  VerifyQuickRatingResult(scenario.ReadReceived(), response.body);
}

async function VerifyUnknownQuickRating() {
  const user = await BuildTestUser("667368a1-185b-4f4d-84ad-8b42d4330524");
  const store = { findUserByEmail: async () => user };
  const authenticated = await LoginTestUser(store, user);
  const body = { actionId: "304628ee-b652-4e27-931d-729946ab3a26", titleId: "tt9999999", rating: 8 };
  const response = await authenticated.agent.put(QuickRatingPath).set(CsrfHeader, authenticated.csrfToken).send(body).expect(404);
  assert.equal(response.body.code, "TITLE_NOT_FOUND");
}

function BuildQuickRatingScenario(user) {
  let received = null;
  const store = {
    findUserByEmail: async () => user,
    getRaterQueue: async () => ({ revision: 12, poolVersion: PoolVersion, queueIds: TestMoviePool.ids }),
    CommitQuickRating: async (_userId, decision) => {
      received = decision;
      return { ok: true, stateRevision: 24, record: decision.record, previous: null, queue: { revision: 13, poolVersion: PoolVersion, queueIds: [ThiefTitleId] } };
    },
    listRecommendationQueue: async () => []
  };
  return { store, ReadReceived: () => received };
}

async function LoginTestUser(store, user, dependencies = {}) {
  const opened = await OpenTestSession(store, dependencies);
  const login = await AuthenticateSession(opened, user);
  return { agent: opened.agent, csrfToken: login.body.csrfToken };
}

async function BuildTestUser(id) {
  return { id, email: TestEmail, passwordHash: await HashPassword(TestPassword) };
}

function BuildEmptyBundle() {
  return {
    preferences: {},
    state: {},
    ratingsCsv: "",
    revision: 0,
    configured: { imdb: false, ai: false }
  };
}

async function OpenTestSession(store, dependencies = {}) {
  const agent = request.agent(BuildTestApp(store, dependencies));
  const anonymous = await agent.get(AuthSessionPath).expect(200);
  return { agent, anonymous, csrfToken: anonymous.body.csrfToken };
}

async function AuthenticateSession(opened, user) {
  return opened.agent.post(AuthLoginPath).set(CsrfHeader, opened.csrfToken).send({ email: user.email, password: TestPassword }).expect(200);
}

function VerifyQuickRatingResult(received, response) {
  assert.equal(received.record.title, HeatTitle);
  assert.equal(received.record.year, 1995);
  assert.equal(received.record.rating, 9);
  assert.equal(received.record.submitStatus, PendingStatus);
  assert.deepEqual(response.queue.queueIds, [ThiefTitleId]);
  assert.deepEqual(response.recommendations, []);
}

test("the TV queue route selects the independent TV catalog and queue namespace", VerifyTvQueue);
test("generated picks append to the saved per-user recommendation queue", VerifyGeneratedPicks);
test("a rating-system movie can be added directly to the saved watchlist", VerifyWatchlistAppend);
test("don't recommend moves a saved pick into the account exclusion list", VerifyRecommendationExclusion);

async function VerifyTvQueue() {
  const user = await BuildTestUser("95c3cf3e-c6d8-4ba5-aec1-53f5870a6279");
  const tvPool = { ids: ["tt0903747"], version: "tv-pool-v1" };
  const state = { received: null };
  const authenticated = await LoginTestUser(BuildTvQueueStore(user, state), user, BuildTvQueueDependencies(tvPool));
  const response = await authenticated.agent.get("/api/rater/queue?media=tv").expect(200);
  assert.deepEqual(state.received, { userId: user.id, mediaType: TvMediaType, titlePool: tvPool });
  assert.deepEqual(response.body.queue.queueIds, tvPool.ids);
}

function BuildTvQueueStore(user, state) {
  return {
    findUserByEmail: async () => user,
    getRaterQueue: async (userId, mediaType, titlePool) => {
      state.received = { userId, mediaType, titlePool };
      return { revision: 3, poolVersion: titlePool.version, queueIds: titlePool.ids };
    }
  };
}

function BuildTvQueueDependencies(tvPool) {
  return {
    readTitlePool: async (_rootPath, mediaType) => {
      assert.equal(mediaType, TvMediaType);
      return tvPool;
    }
  };
}

async function VerifyGeneratedPicks() {
  const user = await BuildTestUser("3accb042-54e8-4e14-8eb5-8444d10433b4");
  const existing = { queueKey: HeatQueueKey, ttId: HeatTitleId, title: HeatTitle, year: 1995, genres: [CrimeGenre], why: { tasteMatch: CrimeGenre } };
  const generated = { queueKey: "thief|1981", ttId: ThiefTitleId, title: ThiefTitle, year: 1981, genres: [CrimeGenre], why: { tasteMatch: CrimeGenre } };
  const state = { queue: [existing], received: null };
  const dependencies = BuildGeneratedDependencies(generated, state);
  const authenticated = await LoginTestUser(BuildGeneratedStore(user, state), user, dependencies);
  const body = { count: 9, aiConnectionId: AlternateAiConnectionId, profile: { ratings: [{ title: "Collateral", year: 2004, genres: [CrimeGenre], rating: 9 }], exclusions: [] } };
  const response = await authenticated.agent.post("/api/ai/recommendations").set(CsrfHeader, authenticated.csrfToken).send(body).expect(200);
  AssertGeneratedPicks(state.received, response.body, existing, generated);
}

function BuildGeneratedStore(user, state) {
  return {
    findUserByEmail: async () => user,
    getBundle: async () => BuildConfiguredAiBundle(),
    ListAiConnections: async () => [BuildConfiguredAiConnection(user.id), BuildAlternateAiConnection()],
    ReadAiConnectionSecret: async (_userId, id) => id === AlternateAiConnectionId ? AlternateAiKey : TestAiKey,
    listRecommendationQueue: async () => [...state.queue],
    appendRecommendationQueue: async (_userId, items) => {
      state.queue.push(...items);
      return items;
    }
  };
}

function BuildConfiguredAiBundle() {
  return {
    preferences: {},
    state: { payload: {} }
  };
}

function BuildConfiguredAiConnection(id) {
  return {
    id, providerId: "custom", name: "Test AI", baseUrl: TestAiBaseUrl,
    model: TestAiModel, isDefault: true, hasKey: true, testStatus: "tested"
  };
}

function BuildAlternateAiConnection() {
  return {
    id: AlternateAiConnectionId, providerId: "custom", name: "Alternate AI", baseUrl: AlternateAiBaseUrl,
    model: AlternateAiModel, isDefault: false, hasKey: true, testStatus: "tested"
  };
}

function BuildGeneratedDependencies(generated, state) {
  return {
    generateAiRecommendations: async (_rootPath, options) => {
      state.received = options;
      return BuildGeneratedPayload(generated);
    }
  };
}

function BuildGeneratedPayload(generated) {
  return {
    status: 200,
    payload: {
      ok: true,
      summary: "A crime double feature.",
      recommendations: [generated]
    }
  };
}

function AssertGeneratedPicks(received, response, existing, generated) {
  assert.equal(received.count, 9);
  assert.equal(received.baseUrl, AlternateAiBaseUrl);
  assert.equal(received.model, AlternateAiModel);
  assert.equal(received.apiKey, AlternateAiKey);
  assert.deepEqual(received.queue, [existing]);
  assert.equal(response.addedCount, 1);
  assert.equal(response.requestedCount, 9);
  assert.deepEqual(response.recommendations, [existing, generated]);
}

async function VerifyWatchlistAppend() {
  const user = await BuildTestUser("c95c1ff0-325f-4f64-a763-669403435215");
  const state = { queue: [], appended: null };
  const authenticated = await LoginTestUser(BuildWatchlistStore(user, state), user);
  const body = { ttId: HeatTitleId, title: HeatTitle, year: 1995, genres: [CrimeGenre, DramaGenre] };
  const response = await authenticated.agent.put("/api/ai/recommendations/queue").set(CsrfHeader, authenticated.csrfToken).send(body).expect(200);
  AssertWatchlistAppend(state.appended, response.body, user);
}

function BuildWatchlistStore(user, state) {
  return {
    findUserByEmail: async () => user,
    listRecommendationQueue: async () => [...state.queue],
    appendRecommendationQueue: async (userId, items) => {
      state.appended = { userId, items };
      state.queue.push(...items);
      return items;
    }
  };
}

function AssertWatchlistAppend(appended, response, user) {
  assert.equal(appended.userId, user.id);
  assert.equal(response.addedCount, 1);
  assert.equal(response.count, 1);
  assert.equal(response.recommendation.source, "rating-system");
  assert.equal(response.recommendation.queueKey, HeatQueueKey);
  assert.equal(response.recommendation.why.tasteMatch, "Added from the rating queue.");
  assert.deepEqual(response.recommendations, appended.items);
}

async function VerifyRecommendationExclusion() {
  const user = await BuildTestUser("a772239d-a772-4489-8ddc-aa0f95071669");
  const state = { saved: null };
  const authenticated = await LoginTestUser(BuildExclusionStore(user, state), user);
  const body = { ttId: HeatTitleId, title: HeatTitle, year: 1995, at: "2026-07-16T22:00:00.000Z" };
  const response = await authenticated.agent.put("/api/account/recommendation-exclusions").set(CsrfHeader, authenticated.csrfToken).send(body).expect(200);
  assert.equal(response.body.revision, 31);
  assert.equal(state.saved.userId, user.id);
  assert.deepEqual(state.saved.exclusion, { ...body, queueKey: HeatQueueKey });
}

function BuildExclusionStore(user, state) {
  return {
    findUserByEmail: async () => user,
    excludeRecommendation: async (userId, exclusion) => {
      state.saved = { userId, exclusion };
      return 31;
    }
  };
}

function BuildTestApp(store, dependencies = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "a-secure-test-secret-that-is-long-enough", resave: false, saveUninitialized: false }));
  const routeDependencies = {
    store,
    pool: { query: async () => ({ rows: [] }) },
    rootPath: process.cwd(),
    readMoviePool: async () => TestMoviePool,
    ...dependencies
  };
  RegisterApiRoutes(app, routeDependencies);
  return app;
}
