import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { HashPassword } from "../server/auth.mjs";
import { RegisterApiRoutes } from "../server/routes.mjs";

const FutureModel = "future-model";
const CsrfHeader = "x-csrf-token";
const NewKey = "new-key";
const AiSettingsPath = "/api/ai/settings";
const AiStatusPath = "/api/ai/status";
const AiModelsPath = "/api/ai/models";
const SavedAiBaseUrl = "https://ai.example.test/v1";
const NewAiBaseUrl = "https://new-ai.example.test/v1";
const Password = "correct horse battery staple";
const AiSecretType = "ai";
const LegacyAiSecretType = "openai";
const SavedAiKey = "saved-key";
const StreamingCountry = "US";

test("AI settings discover, test, save, report, and remove one compatible connection", VerifyAiSettings);

async function VerifyAiSettings() {
  const scenario = await BuildScenario();
  const authenticated = await Login(scenario.app, scenario.user);
  await VerifyDiscovery(authenticated, scenario);
  await VerifySave(authenticated, scenario);
  await VerifyStatus(authenticated);
  await VerifyRemoval(authenticated, scenario);
}

async function VerifyDiscovery(authenticated, scenario) {
  const models = await authenticated.agent.post(AiModelsPath).set(CsrfHeader, authenticated.csrfToken).send({ baseUrl: SavedAiBaseUrl, apiKey: "" }).expect(200);
  assert.deepEqual(models.body.models, [{ id: FutureModel }]);
  assert.equal(scenario.ReadDiscovery().apiKey, SavedAiKey);
}

async function VerifySave(authenticated, scenario) {
  const saved = await authenticated.agent.put(AiSettingsPath).set(CsrfHeader, authenticated.csrfToken).send({ baseUrl: `${NewAiBaseUrl}/`, apiKey: NewKey, model: FutureModel }).expect(200);
  assert.equal(saved.body.configured, true);
  assert.equal(saved.body.hasApiKey, true);
  assert.equal(scenario.ReadTested().apiKey, NewKey);
  assert.deepEqual(scenario.preferences, BuildExpectedPreferences());
  assert.equal(scenario.secrets.get(AiSecretType), NewKey);
  assert.equal(scenario.secrets.has(LegacyAiSecretType), false);
}

async function VerifyStatus(authenticated) {
  const status = await authenticated.agent.get(AiStatusPath).expect(200);
  assert.equal(status.body.configured, true);
  assert.equal(status.body.model, FutureModel);
  assert.equal(status.body.hasApiKey, true);
}

async function VerifyRemoval(authenticated, scenario) {
  const removed = await authenticated.agent.delete(AiSettingsPath).set(CsrfHeader, authenticated.csrfToken).send({}).expect(200);
  assert.equal(removed.body.configured, false);
  assert.equal(scenario.preferences.aiConfigured, false);
  assert.equal(scenario.secrets.has(AiSecretType), false);
}

async function BuildScenario() {
  const user = {
    id: "a73dc93a-d4f2-4d16-bd66-943a40e0e7f8",
    email: "ai-user@example.com",
    passwordHash: await HashPassword(Password)
  };
  const preferences = BuildSavedPreferences();
  const secrets = new Map([[AiSecretType, SavedAiKey], [LegacyAiSecretType, "legacy-key"]]);
  const state = { discovery: null, tested: null };
  const store = BuildStore(user, preferences, secrets);
  const app = BuildApp(store, state);
  return { app, user, preferences, secrets, ReadDiscovery: () => state.discovery, ReadTested: () => state.tested };
}

function BuildSavedPreferences() {
  return {
    aiBaseUrl: SavedAiBaseUrl,
    aiModel: "saved-model",
    aiConfigured: true,
    streamingCountry: StreamingCountry
  };
}

function BuildExpectedPreferences() {
  return {
    aiBaseUrl: NewAiBaseUrl,
    aiModel: FutureModel,
    aiConfigured: true,
    streamingCountry: StreamingCountry
  };
}

function BuildStore(user, preferences, secrets) {
  return {
    findUserByEmail: async () => user,
    getBundle: async () => BuildBundle(preferences, secrets),
    getSecret: async (_userId, type) => secrets.get(type) || "",
    savePreferences: async (_userId, changes) => Object.assign(preferences, changes),
    putSecret: async (_userId, type, value) => secrets.set(type, value),
    deleteSecret: async (_userId, type) => secrets.delete(type)
  };
}

function BuildBundle(preferences, secrets) {
  const state = {
    payload: {},
    ratingsCsv: "",
    revision: 0
  };
  return {
    preferences,
    state,
    configured: new Set(secrets.keys())
  };
}

function BuildApp(store, state) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "a-secure-test-secret-that-is-long-enough", resave: false, saveUninitialized: false }));
  RegisterApiRoutes(app, BuildDependencies(store, state));
  return app;
}

function BuildDependencies(store, state) {
  return {
    store,
    pool: { query: async () => ({ rows: [] }) },
    rootPath: process.cwd(),
    discoverAiModels: async (options) => {
      state.discovery = options;
      return { status: 200, payload: { ok: true, baseUrl: options.baseUrl, models: [{ id: FutureModel }] } };
    },
    testAiConnection: async (options) => {
      state.tested = options;
      return { status: 200, payload: { ok: true, baseUrl: NewAiBaseUrl, model: options.model } };
    }
  };
}

async function Login(app, user) {
  const agent = request.agent(app);
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login").set(CsrfHeader, anonymous.body.csrfToken).send({ email: user.email, password: Password }).expect(200);
  return { agent, csrfToken: login.body.csrfToken };
}
