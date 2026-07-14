import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { HashPassword } from "../server/auth.mjs";
import { RegisterApiRoutes } from "../server/routes.mjs";

test("login establishes an authenticated session and CSRF protects account writes", async () => {
  const user = { id: "8133d1c3-2620-42fa-85e6-6b6ec6204301", username: "jared", displayName: "Jared", passwordHash: await HashPassword("correct horse battery staple") };
  let saved = null;
  const store = {
    findUserByUsername: async (username) => username === "jared" ? user : null,
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
  await agent.post("/api/auth/login").send({ username: "jared", password: "correct horse battery staple" }).expect(403);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ username: "jared", password: "correct horse battery staple" })
    .expect(200);
  assert.equal(login.body.user.username, "jared");

  await agent.put("/api/account/state").send({ payload: {}, ratingsCsv: "", revision: 0 }).expect(403);
  await agent.put("/api/account/state")
    .set("x-csrf-token", login.body.csrfToken)
    .send({ payload: { ratings: {} }, ratingsCsv: "", revision: 0 })
    .expect(200);
  assert.deepEqual(saved.payload, { ratings: {} });
});

test("public registration validates input, creates account data, and signs the user in", async () => {
  const users = new Map();
  const store = {
    findUserByUsername: async (username) => users.get(username) || null,
    createUser: async ({ username, displayName, passwordHash }) => {
      const user = { id: "504cf9d4-7f91-4621-9c53-dcc27e13620c", username, displayName, passwordHash };
      users.set(username, user);
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
    .send({ username: "x", displayName: "X", password: "a sufficiently long password" })
    .expect(422);

  const created = await agent.post("/api/auth/register")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ username: "New_User", displayName: "New User", password: "a sufficiently long password" })
    .expect(201);
  assert.equal(created.body.user.username, "new_user");
  assert.notEqual(users.get("new_user").passwordHash, "a sufficiently long password");

  const session = await agent.get("/api/auth/session").expect(200);
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.user.displayName, "New User");
});

test("registration rejects missing CSRF and unavailable usernames", async () => {
  const existing = { id: "99d197c6-b299-4ee8-a223-616a4c5fb575", username: "taken", displayName: "Taken" };
  const store = {
    findUserByUsername: async (username) => username === "taken" ? existing : null,
    createUser: async () => { throw new Error("createUser should not run"); }
  };
  const agent = request.agent(BuildTestApp(store));
  await agent.post("/api/auth/register")
    .send({ username: "taken", displayName: "Taken", password: "a sufficiently long password" })
    .expect(403);
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const duplicate = await agent.post("/api/auth/register")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ username: "taken", displayName: "Taken", password: "a sufficiently long password" })
    .expect(409);
  assert.equal(duplicate.body.code, "USERNAME_UNAVAILABLE");
});

function BuildTestApp(store) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "a-secure-test-secret-that-is-long-enough", resave: false, saveUninitialized: false }));
  RegisterApiRoutes(app, { store, pool: { query: async () => ({ rows: [] }) }, rootPath: process.cwd() });
  return app;
}
