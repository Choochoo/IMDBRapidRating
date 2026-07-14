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
