import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { HashPassword } from "../server/auth.mjs";
import { RegisterApiRoutes } from "../server/routes.mjs";
import { DefaultKeyboardShortcuts } from "../shared/keyboard-shortcuts.js";

const CsrfHeader = "x-csrf-token";
const Password = "correct horse battery staple";
const PreferencesPath = "/api/account/preferences";
const StreamingCountry = "US";

test("account preferences save a complete keyboard shortcut map", VerifyShortcutPreferenceSave);
test("account preferences reject duplicate keyboard shortcut keys", VerifyDuplicateShortcutRejection);

async function VerifyShortcutPreferenceSave() {
  const scenario = await BuildScenario();
  const authenticated = await Login(scenario.app, scenario.user);
  const shortcuts = { ...DefaultKeyboardShortcuts, "rate-10": "z", skip: "0" };
  const response = await authenticated.agent.put(PreferencesPath).set(CsrfHeader, authenticated.csrfToken).send({ streamingCountry: StreamingCountry, keyboardShortcuts: shortcuts }).expect(200);
  assert.deepEqual(response.body.keyboardShortcuts, shortcuts);
  assert.deepEqual(scenario.ReadSaved().keyboardShortcuts, shortcuts);
}

async function VerifyDuplicateShortcutRejection() {
  const scenario = await BuildScenario();
  const authenticated = await Login(scenario.app, scenario.user);
  const shortcuts = { ...DefaultKeyboardShortcuts, skip: "1" };
  await authenticated.agent.put(PreferencesPath).set(CsrfHeader, authenticated.csrfToken).send({ streamingCountry: StreamingCountry, keyboardShortcuts: shortcuts }).expect(422);
  assert.equal(scenario.ReadSaved(), null);
}

async function BuildScenario() {
  const user = { id: "da7fe205-676d-4690-9f62-4a066e6d8bd0", email: "shortcut-user@example.com", passwordHash: await HashPassword(Password) };
  let saved = null;
  const store = {
    findUserByEmail: async () => user,
    savePreferences: async (_userId, value) => { saved = value; }
  };
  return { app: BuildApp(store), user, ReadSaved: () => saved };
}

function BuildApp(store) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "a-secure-test-secret-that-is-long-enough", resave: false, saveUninitialized: false }));
  RegisterApiRoutes(app, { store, pool: { query: async () => ({ rows: [] }) }, rootPath: process.cwd() });
  return app;
}

async function Login(app, user) {
  const agent = request.agent(app);
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const response = await agent.post("/api/auth/login").set(CsrfHeader, anonymous.body.csrfToken).send({ email: user.email, password: Password }).expect(200);
  return { agent, csrfToken: response.body.csrfToken };
}
