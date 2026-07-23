import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { RegisterApiRoutes } from "../server/routes.mjs";

const UserId = "12270331-c314-4b17-8a17-e5e179b2fd9d";
const CsrfToken = "queue-route-csrf-token";
const CsrfHeader = "x-csrf-token";
const ImdbCookie = "at-main=test-token";

test("saving an IMDb connection resumes every durable user job", VerifyConnectionResume);
test("the IMDb retry route requeues durable failed jobs", VerifyFailedJobRetry);
test("TMDB is not accepted as a per-user credential", VerifyTmdbCredentialRejected);

async function VerifyConnectionResume() {
  const saved = [];
  const store = BuildStore({ putSecret: async (...values) => saved.push(values), ResumeImdbRatingJobs: async () => ({ queued: 2, revision: 9 }) });
  const response = await request(BuildApp(store)).put("/api/account/secrets/imdb").set(CsrfHeader, CsrfToken).send({ value: ImdbCookie }).expect(200);
  assert.deepEqual(saved, [[UserId, "imdb", ImdbCookie]]);
  assert.equal(response.body.resumedJobs, 2);
  assert.equal(response.body.revision, 9);
}

async function VerifyFailedJobRetry() {
  const users = [];
  const store = BuildStore({ RetryFailedImdbRatingJobs: async (userId) => { users.push(userId); return { queued: 7, revision: 12 }; } });
  const response = await request(BuildApp(store)).post("/api/imdb/retry").set(CsrfHeader, CsrfToken).expect(200);
  assert.deepEqual(users, [UserId]);
  assert.equal(response.body.queued, 7);
  assert.equal(response.body.revision, 12);
}

async function VerifyTmdbCredentialRejected() {
  const saved = [];
  const store = BuildStore({ putSecret: async (...values) => saved.push(values) });
  await request(BuildApp(store)).put("/api/account/secrets/tmdb").set(CsrfHeader, CsrfToken).send({ value: "user-key" }).expect(404);
  assert.deepEqual(saved, []);
}

function BuildApp(store) {
  const app = express();
  app.use(express.json());
  app.use(AttachTestSession);
  RegisterApiRoutes(app, { store, pool: { query: async () => ({ rows: [] }) }, rootPath: process.cwd() });
  return app;
}

function AttachTestSession(requestMessage, _response, next) {
  requestMessage.session = { userId: UserId, email: "user@example.com", csrfToken: CsrfToken };
  next();
}

function BuildStore(overrides) {
  return {
    putSecret: async () => null,
    ResumeImdbRatingJobs: async () => ({ queued: 0, revision: 0 }),
    RetryFailedImdbRatingJobs: async () => ({ queued: 0, revision: 0 }),
    ...overrides
  };
}
