import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { RegisterApiRoutes } from "../server/routes.mjs";

const UserId = "12270331-c314-4b17-8a17-e5e179b2fd9d";
const CsrfToken = "queue-route-csrf-token";

test("saving an IMDb connection resumes every durable user job", VerifyConnectionResume);
test("the IMDb retry route requeues durable failed jobs", VerifyFailedJobRetry);

async function VerifyConnectionResume() {
  const saved = [];
  const store = BuildStore({ putSecret: async (...values) => saved.push(values), ResumeImdbRatingJobs: async () => ({ queued: 2, revision: 9 }) });
  const response = await request(BuildApp(store)).put("/api/account/secrets/imdb").set("x-csrf-token", CsrfToken).send({ value: "at-main=test-token" }).expect(200);
  assert.deepEqual(saved, [[UserId, "imdb", "at-main=test-token"]]);
  assert.equal(response.body.resumedJobs, 2);
  assert.equal(response.body.revision, 9);
}

async function VerifyFailedJobRetry() {
  const users = [];
  const store = BuildStore({ RetryFailedImdbRatingJobs: async (userId) => { users.push(userId); return { queued: 7, revision: 12 }; } });
  const response = await request(BuildApp(store)).post("/api/imdb/retry").set("x-csrf-token", CsrfToken).expect(200);
  assert.deepEqual(users, [UserId]);
  assert.equal(response.body.queued, 7);
  assert.equal(response.body.revision, 12);
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
