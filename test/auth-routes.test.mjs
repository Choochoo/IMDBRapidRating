import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { HashPassword } from "../server/auth.mjs";
import { RegisterApiRoutes } from "../server/routes.mjs";

const TestMoviePool = {
  ids: ["tt0113277", "tt0083190"],
  titles: [
    { ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime", "Drama"] },
    { ttId: "tt0083190", title: "Thief", year: 1981, genres: ["Crime"] }
  ],
  version: "pool-v1"
};

test("email login establishes an authenticated session and CSRF protects account writes", async () => {
  const user = { id: "8133d1c3-2620-42fa-85e6-6b6ec6204301", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  let saved = null;
  const store = {
    findUserByEmail: async (email) => email === "user@example.com" ? user : null,
    getBundle: async () => ({
      preferences: { openAiModel: "", openAiModelLag: 2 },
      state: { payload: {}, ratingsCsv: "", revision: 0 },
      configured: new Set()
    }),
    saveState: async (_userId, payload, ratingsCsv, revision) => {
      saved = { payload, ratingsCsv, revision };
      return { ok: true, revision: revision + 1 };
    }
  };
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "a-secure-test-secret-that-is-long-enough", resave: false, saveUninitialized: false }));
  RegisterApiRoutes(app, { store, pool: { query: async () => ({ rows: [] }) }, rootPath: process.cwd() });
  const agent = request.agent(app);

  const anonymous = await agent.get("/api/auth/session").expect(200);
  assert.equal(anonymous.body.authenticated, false);
  await agent.post("/api/auth/login").send({ email: "user@example.com", password: "correct horse battery staple" }).expect(403);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: "user@example.com", password: "correct horse battery staple" })
    .expect(200);
  assert.equal(login.body.user.email, "user@example.com");

  await agent.put("/api/account/state").send({ payload: {}, ratingsCsv: "", revision: 0 }).expect(403);
  await agent.put("/api/account/state")
    .set("x-csrf-token", login.body.csrfToken)
    .send({ payload: { ratings: {} }, ratingsCsv: "", revision: 0 })
    .expect(200);
  assert.deepEqual(saved.payload, { ratings: {} });
});

test("logout destroys the authenticated session", async () => {
  const user = { id: "40c9da79-e7d1-4357-947a-85b1e21b1a75", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  const agent = request.agent(BuildTestApp({
    findUserByEmail: async () => user
  }));
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: user.email, password: "correct horse battery staple" })
    .expect(200);

  await agent.post("/api/auth/logout")
    .set("x-csrf-token", login.body.csrfToken)
    .send({})
    .expect(200);

  const session = await agent.get("/api/auth/session").expect(200);
  assert.equal(session.body.authenticated, false);
});

test("public registration validates input, creates account data, and signs the user in", async () => {
  const users = new Map();
  const store = {
    findUserByEmail: async (email) => users.get(email) || null,
    createUser: async ({ email, passwordHash }) => {
      const user = { id: "504cf9d4-7f91-4621-9c53-dcc27e13620c", email, passwordHash };
      users.set(email, user);
      return user;
    },
    getBundle: async () => ({
      preferences: { openAiModel: "", openAiModelLag: 2 },
      state: { payload: {}, ratingsCsv: "", revision: 0 },
      configured: new Set()
    })
  };
  const app = BuildTestApp(store);
  const agent = request.agent(app);
  const anonymous = await agent.get("/api/auth/session").expect(200);
  assert.equal(anonymous.body.registrationEnabled, true);

  await agent.post("/api/auth/register")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: "not-an-email", password: "12345678" })
    .expect(422);

  const created = await agent.post("/api/auth/register")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: "New_User@Example.com", password: "12345678" })
    .expect(201);
  assert.equal(created.body.user.email, "new_user@example.com");
  assert.equal("username" in created.body.user, false);
  assert.equal("displayName" in created.body.user, false);
  assert.notEqual(users.get("new_user@example.com").passwordHash, "12345678");

  const session = await agent.get("/api/auth/session").expect(200);
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.user.email, "new_user@example.com");
});

test("registration rejects missing CSRF and unavailable email addresses", async () => {
  const existing = { id: "99d197c6-b299-4ee8-a223-616a4c5fb575", email: "taken@example.com" };
  const store = {
    findUserByEmail: async (email) => email === "taken@example.com" ? existing : null,
    createUser: async () => { throw new Error("createUser should not run"); }
  };
  const agent = request.agent(BuildTestApp(store));
  await agent.post("/api/auth/register")
    .send({ email: "taken@example.com", password: "12345678" })
    .expect(403);
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const duplicate = await agent.post("/api/auth/register")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: "taken@example.com", password: "12345678" })
    .expect(409);
  assert.equal(duplicate.body.code, "EMAIL_UNAVAILABLE");
});

test("IMDb rating requests are persisted for background delivery", async () => {
  const user = { id: "0ed7ef61-71e6-4c9b-92ba-76a680af3b2d", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  let recorded = null;
  let queuedDelete = null;
  const store = {
    findUserByEmail: async () => user,
    QueueImdbRating: async (userId, record, mediaType) => {
      recorded = { userId, record, mediaType };
      return { revision: 17, job: { id: 41 } };
    },
    QueueImdbDelete: async (userId, ttId, mediaType, options) => {
      queuedDelete = { userId, ttId, mediaType, options };
      return { job: { id: 42 }, revision: 18 };
    }
  };
  const app = BuildTestApp(store);
  const agent = request.agent(app);
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: user.email, password: "correct horse battery staple" })
    .expect(200);

  const rated = await agent.post("/api/rate")
    .set("x-csrf-token", login.body.csrfToken)
    .send({ titleId: "tt0107050", rating: 8, title: "Grumpy Old Men", year: 1993, at: "2026-07-16T20:00:00.000Z" })
    .expect(202);
  assert.equal(rated.body.revision, 17);
  assert.equal(rated.body.queued, true);
  assert.equal(rated.body.jobId, 41);
  assert.equal(recorded.userId, user.id);
  assert.deepEqual(recorded.record, {
    status: "rated",
    rating: 8,
    title: "Grumpy Old Men",
    year: 1993,
    ttId: "tt0107050",
    mediaType: "movie",
    at: "2026-07-16T20:00:00.000Z",
    submitStatus: "pending",
    submitError: "",
    submittedAt: ""
  });

  const removed = await agent.delete("/api/rate")
    .set("x-csrf-token", login.body.csrfToken)
    .send({ titleId: "tt0107050" })
    .expect(202);
  assert.equal(removed.body.revision, 18);
  assert.equal(removed.body.queued, true);
  assert.deepEqual(queuedDelete, { userId: user.id, ttId: "tt0107050", mediaType: "movie", options: { deferAccountState: false } });
});

test("not-seen decisions are committed directly to account state", async () => {
  const user = { id: "241c7a98-53a7-42b3-bde7-3fd3a27db9dc", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  let recorded = null;
  const store = {
    findUserByEmail: async () => user,
    recordRating: async (userId, record, mediaType) => {
      recorded = { userId, record, mediaType };
      return 23;
    }
  };
  const agent = request.agent(BuildTestApp(store));
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: user.email, password: "correct horse battery staple" })
    .expect(200);

  const saved = await agent.put("/api/account/not-seen")
    .set("x-csrf-token", login.body.csrfToken)
    .send({ titleId: "tt0111257", title: "Speed", year: 1994, at: "2026-07-16T21:00:00.000Z" })
    .expect(200);

  assert.equal(saved.body.revision, 23);
  assert.equal(recorded.userId, user.id);
  assert.deepEqual(recorded.record, {
    status: "notSeen",
    rating: null,
    title: "Speed",
    year: 1994,
    ttId: "tt0111257",
    mediaType: "movie",
    at: "2026-07-16T21:00:00.000Z",
    submitStatus: "skipped",
    submitError: "",
    submittedAt: ""
  });
});

test("rater decisions require the current queue head and return the canonical next queue", async () => {
  const user = { id: "d3039098-ed05-4740-bc99-b929927b0dd7", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  const initialQueue = { revision: 12, poolVersion: "pool-v1", queueIds: ["tt0113277", "tt0083190"] };
  let received = null;
  const store = {
    findUserByEmail: async () => user,
    getRaterQueue: async (_userId, mediaType, moviePool) => {
      assert.equal(mediaType, "movie");
      assert.equal(moviePool, TestMoviePool);
      return initialQueue;
    },
    commitRaterDecision: async (_userId, decision) => {
      received = decision;
      return {
        ok: true,
        duplicate: false,
        stateRevision: 21,
        record: decision.record,
        previous: null,
        queue: { revision: 13, poolVersion: "pool-v1", queueIds: ["tt0083190"] }
      };
    }
  };
  const agent = request.agent(BuildTestApp(store));
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: user.email, password: "correct horse battery staple" })
    .expect(200);

  const response = await agent.put("/api/rater/decision")
    .set("x-csrf-token", login.body.csrfToken)
    .send({
      actionId: "4dd7a964-024b-441b-a83c-174cdf53f4db",
      expectedRevision: 12,
      kind: "rated",
      titleId: "tt0113277",
      title: "Heat",
      year: 1995,
      rating: 9,
      at: "2026-07-19T19:00:00.000Z"
    })
    .expect(200);

  assert.equal(received.ttId, "tt0113277");
  assert.equal(received.mediaType, "movie");
  assert.equal(received.expectedRevision, 12);
  assert.equal(received.record.submitStatus, "pending");
  assert.equal(response.body.queue.revision, 13);
  assert.deepEqual(response.body.queue.queueIds, ["tt0083190"]);
});

test("quick ratings use canonical catalog details and create a pending IMDb write", VerifyQuickRatingRoute);
test("quick ratings reject title IDs outside the selected catalog", VerifyUnknownQuickRating);

async function VerifyQuickRatingRoute() {
  const user = { id: "9fdfd065-5aa8-49ec-9b7f-c17b28e8c221", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  const scenario = BuildQuickRatingScenario(user);
  const authenticated = await LoginTestUser(scenario.store, user);
  const body = { actionId: "496bf6a2-1fb2-4ad9-83d2-ed7685ea0b96", titleId: "tt0113277", rating: 9, at: "2026-07-22T20:00:00.000Z" };
  const response = await authenticated.agent.put("/api/rater/quick-rating").set("x-csrf-token", authenticated.csrfToken).send(body).expect(200);
  VerifyQuickRatingResult(scenario.ReadReceived(), response.body);
}

async function VerifyUnknownQuickRating() {
  const user = { id: "667368a1-185b-4f4d-84ad-8b42d4330524", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  const store = { findUserByEmail: async () => user };
  const authenticated = await LoginTestUser(store, user);
  const body = { actionId: "304628ee-b652-4e27-931d-729946ab3a26", titleId: "tt9999999", rating: 8 };
  const response = await authenticated.agent.put("/api/rater/quick-rating").set("x-csrf-token", authenticated.csrfToken).send(body).expect(404);
  assert.equal(response.body.code, "TITLE_NOT_FOUND");
}

function BuildQuickRatingScenario(user) {
  let received = null;
  const store = {
    findUserByEmail: async () => user,
    getRaterQueue: async () => ({ revision: 12, poolVersion: "pool-v1", queueIds: TestMoviePool.ids }),
    CommitQuickRating: async (_userId, decision) => {
      received = decision;
      return { ok: true, stateRevision: 24, record: decision.record, previous: null, queue: { revision: 13, poolVersion: "pool-v1", queueIds: ["tt0083190"] } };
    },
    listRecommendationQueue: async () => []
  };
  return { store, ReadReceived: () => received };
}

async function LoginTestUser(store, user) {
  const agent = request.agent(BuildTestApp(store));
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login").set("x-csrf-token", anonymous.body.csrfToken).send({ email: user.email, password: "correct horse battery staple" }).expect(200);
  return { agent, csrfToken: login.body.csrfToken };
}

function VerifyQuickRatingResult(received, response) {
  assert.equal(received.record.title, "Heat");
  assert.equal(received.record.year, 1995);
  assert.equal(received.record.rating, 9);
  assert.equal(received.record.submitStatus, "pending");
  assert.deepEqual(response.queue.queueIds, ["tt0083190"]);
  assert.deepEqual(response.recommendations, []);
}

test("the TV queue route selects the independent TV catalog and queue namespace", async () => {
  const user = { id: "95c3cf3e-c6d8-4ba5-aec1-53f5870a6279", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  const tvPool = { ids: ["tt0903747"], version: "tv-pool-v1" };
  let received = null;
  const store = {
    findUserByEmail: async () => user,
    getRaterQueue: async (userId, mediaType, titlePool) => {
      received = { userId, mediaType, titlePool };
      return { revision: 3, poolVersion: titlePool.version, queueIds: titlePool.ids };
    }
  };
  const agent = request.agent(BuildTestApp(store, {
    readTitlePool: async (_rootPath, mediaType) => {
      assert.equal(mediaType, "tv");
      return tvPool;
    }
  }));
  const anonymous = await agent.get("/api/auth/session").expect(200);
  await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: user.email, password: "correct horse battery staple" })
    .expect(200);

  const response = await agent.get("/api/rater/queue?media=tv").expect(200);

  assert.deepEqual(received, { userId: user.id, mediaType: "tv", titlePool: tvPool });
  assert.deepEqual(response.body.queue.queueIds, ["tt0903747"]);
});

test("generated picks append to the saved per-user recommendation queue", async () => {
  const user = { id: "3accb042-54e8-4e14-8eb5-8444d10433b4", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  const existing = { queueKey: "heat|1995", ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime"], why: { tasteMatch: "Crime" } };
  const generated = { queueKey: "thief|1981", ttId: "tt0083190", title: "Thief", year: 1981, genres: ["Crime"], why: { tasteMatch: "Crime" } };
  const queue = [existing];
  let received = null;
  const store = {
    findUserByEmail: async () => user,
    getBundle: async () => ({ preferences: { openAiModel: "gpt-test", openAiModelLag: 2 } }),
    getSecret: async () => "openai-key",
    listRecommendationQueue: async () => [...queue],
    appendRecommendationQueue: async (_userId, items) => {
      queue.push(...items);
      return items;
    }
  };
  const app = BuildTestApp(store, {
    generateAiRecommendations: async (_rootPath, options) => {
      received = options;
      return { status: 200, payload: { ok: true, summary: "A crime double feature.", recommendations: [generated] } };
    }
  });
  const agent = request.agent(app);
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: user.email, password: "correct horse battery staple" })
    .expect(200);

  const response = await agent.post("/api/ai/recommendations")
    .set("x-csrf-token", login.body.csrfToken)
    .send({ count: 9, profile: { ratings: [{ title: "Collateral", year: 2004, genres: ["Crime"], rating: 9 }], exclusions: [] } })
    .expect(200);

  assert.equal(received.count, 9);
  assert.deepEqual(received.queue, [existing]);
  assert.equal(response.body.addedCount, 1);
  assert.equal(response.body.requestedCount, 9);
  assert.deepEqual(response.body.recommendations, [existing, generated]);
});

test("a rating-system movie can be added directly to the saved watchlist", async () => {
  const user = { id: "c95c1ff0-325f-4f64-a763-669403435215", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  const queue = [];
  let appended = null;
  const store = {
    findUserByEmail: async () => user,
    listRecommendationQueue: async () => [...queue],
    appendRecommendationQueue: async (userId, items) => {
      appended = { userId, items };
      queue.push(...items);
      return items;
    }
  };
  const agent = request.agent(BuildTestApp(store));
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: user.email, password: "correct horse battery staple" })
    .expect(200);

  const response = await agent.put("/api/ai/recommendations/queue")
    .set("x-csrf-token", login.body.csrfToken)
    .send({ ttId: "tt0113277", title: "Heat", year: 1995, genres: ["Crime", "Drama"] })
    .expect(200);

  assert.equal(appended.userId, user.id);
  assert.equal(response.body.addedCount, 1);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.recommendation.source, "rating-system");
  assert.equal(response.body.recommendation.queueKey, "heat|1995");
  assert.equal(response.body.recommendation.why.tasteMatch, "Added from the rating queue.");
  assert.deepEqual(response.body.recommendations, appended.items);
});

test("don't recommend moves a saved pick into the account exclusion list", async () => {
  const user = { id: "a772239d-a772-4489-8ddc-aa0f95071669", email: "user@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  let saved = null;
  const store = {
    findUserByEmail: async () => user,
    excludeRecommendation: async (userId, exclusion) => {
      saved = { userId, exclusion };
      return 31;
    }
  };
  const agent = request.agent(BuildTestApp(store));
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: user.email, password: "correct horse battery staple" })
    .expect(200);

  const response = await agent.put("/api/account/recommendation-exclusions")
    .set("x-csrf-token", login.body.csrfToken)
    .send({ ttId: "tt0113277", title: "Heat", year: 1995, at: "2026-07-16T22:00:00.000Z" })
    .expect(200);

  assert.equal(response.body.revision, 31);
  assert.equal(saved.userId, user.id);
  assert.deepEqual(saved.exclusion, {
    ttId: "tt0113277",
    title: "Heat",
    year: 1995,
    at: "2026-07-16T22:00:00.000Z",
    queueKey: "heat|1995"
  });
});

function BuildTestApp(store, dependencies = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "a-secure-test-secret-that-is-long-enough", resave: false, saveUninitialized: false }));
  RegisterApiRoutes(app, {
    store,
    pool: { query: async () => ({ rows: [] }) },
    rootPath: process.cwd(),
    readMoviePool: async () => TestMoviePool,
    ...dependencies
  });
  return app;
}
