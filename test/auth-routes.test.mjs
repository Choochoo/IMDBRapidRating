import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { HashPassword } from "../server/auth.mjs";
import { RegisterApiRoutes } from "../server/routes.mjs";

test("email login establishes an authenticated session and CSRF protects account writes", async () => {
  const user = { id: "8133d1c3-2620-42fa-85e6-6b6ec6204301", email: "jared@example.com", passwordHash: await HashPassword("correct horse battery staple") };
  let saved = null;
  const store = {
    findUserByEmail: async (email) => email === "jared@example.com" ? user : null,
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
  await agent.post("/api/auth/login").send({ email: "jared@example.com", password: "correct horse battery staple" }).expect(403);
  const login = await agent.post("/api/auth/login")
    .set("x-csrf-token", anonymous.body.csrfToken)
    .send({ email: "jared@example.com", password: "correct horse battery staple" })
    .expect(200);
  assert.equal(login.body.user.email, "jared@example.com");

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

function BuildTestApp(store) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "a-secure-test-secret-that-is-long-enough", resave: false, saveUninitialized: false }));
  RegisterApiRoutes(app, { store, pool: { query: async () => ({ rows: [] }) }, rootPath: process.cwd() });
  return app;
}
