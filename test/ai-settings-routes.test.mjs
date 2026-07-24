import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { HashPassword } from "../server/auth.mjs";
import { RegisterApiRoutes } from "../server/routes.mjs";

const FutureModel = "future-model";
const ClaudeModel = "claude-future";
const AnthropicProvider = "anthropic";
const OpenAiProvider = "openai";
const OpenAiBaseUrl = "https://api.openai.com/v1";
const TestedStatus = "tested";
const CsrfHeader = "x-csrf-token";
const NewKey = "new-key-that-must-never-be-returned";
const ConnectionsPath = "/api/ai/connections";
const StatusPath = "/api/ai/status";
const ModelsPath = "/api/ai/models";
const Password = "correct horse battery staple";
const SavedKey = "saved-key-that-must-never-be-returned";
const SavedId = "a73dc93a-d4f2-4d16-bd66-943a40e0e7f8";
const NewId = "b84ed04b-e5f3-4e27-ad77-a54b51f1f809";

test("AI choices discover, test, save, switch defaults, and remove without returning keys", VerifyAiConnections);

async function VerifyAiConnections() {
  const scenario = await BuildScenario();
  const authenticated = await Login(scenario.app, scenario.user);
  await VerifyStatus(authenticated);
  await VerifyDiscovery(authenticated, scenario);
  await VerifyCreateAndDefault(authenticated, scenario);
  await VerifyRemoval(authenticated, scenario);
}

async function VerifyStatus(authenticated) {
  const response = await authenticated.agent.get(StatusPath).expect(200);
  assert.equal(response.body.connections[0].hasKey, true);
  assert.equal(response.body.defaultConnectionId, SavedId);
  assert.equal(response.body.providers.some((provider) => provider.id === AnthropicProvider), true);
  AssertNoSecrets(response.body);
}

async function VerifyDiscovery(authenticated, scenario) {
  const body = { providerId: OpenAiProvider, connectionId: SavedId, apiKey: "" };
  const response = await authenticated.agent.post(ModelsPath).set(CsrfHeader, authenticated.csrfToken).send(body).expect(200);
  assert.deepEqual(response.body.models, [{ id: FutureModel, name: FutureModel }]);
  assert.equal(scenario.state.discovery.apiKey, SavedKey);
  assert.equal(scenario.state.discovery.baseUrl, OpenAiBaseUrl);
}

async function VerifyCreateAndDefault(authenticated, scenario) {
  const body = { providerId: AnthropicProvider, apiKey: NewKey, model: ClaudeModel, name: "Claude for movies", isDefault: false };
  const created = await authenticated.agent.post(ConnectionsPath).set(CsrfHeader, authenticated.csrfToken).send(body).expect(201);
  assert.equal(created.body.connections.length, 2);
  assert.equal(scenario.state.tested.providerId, AnthropicProvider);
  assert.equal(scenario.secrets.get(NewId), NewKey);
  AssertNoSecrets(created.body);
  const changed = await authenticated.agent.put(`${ConnectionsPath}/${NewId}/default`).set(CsrfHeader, authenticated.csrfToken).send({}).expect(200);
  assert.equal(changed.body.defaultConnectionId, NewId);
}

async function VerifyRemoval(authenticated, scenario) {
  const removed = await authenticated.agent.delete(`${ConnectionsPath}/${NewId}`).set(CsrfHeader, authenticated.csrfToken).send({}).expect(200);
  assert.equal(removed.body.connections.length, 1);
  assert.equal(removed.body.defaultConnectionId, SavedId);
  assert.equal(scenario.secrets.has(NewId), false);
}

function AssertNoSecrets(payload) {
  const text = JSON.stringify(payload);
  assert.equal(text.includes(SavedKey), false);
  assert.equal(text.includes(NewKey), false);
  assert.equal(text.includes("apiKey"), false);
}

async function BuildScenario() {
  const user = { id: SavedId, email: "ai-user@example.com", passwordHash: await HashPassword(Password) };
  const connections = [BuildSavedConnection()];
  const secrets = new Map([[SavedId, SavedKey]]);
  const state = { discovery: null, tested: null };
  const store = BuildStore(user, connections, secrets);
  return { app: BuildApp(store, state), user, connections, secrets, state };
}

function BuildSavedConnection() {
  return {
    id: SavedId, providerId: OpenAiProvider, name: "OpenAI", baseUrl: OpenAiBaseUrl,
    model: "saved-model", isDefault: true, hasKey: true, testStatus: TestedStatus
  };
}

function BuildStore(user, connections, secrets) {
  return {
    findUserByEmail: async () => user,
    ListAiConnections: async () => connections.map((item) => ({ ...item })),
    GetAiConnection: async (_userId, id) => connections.find((item) => item.id === id) || null,
    ReadAiConnectionSecret: async (_userId, id) => secrets.get(id) || "",
    CreateAiConnection: async (_userId, connection, key) => CreateConnection(connections, secrets, connection, key),
    UpdateAiConnection: async (_userId, id, connection, key) => UpdateConnection(connections, secrets, id, connection, key),
    SetDefaultAiConnection: async (_userId, id) => SetDefault(connections, id),
    DeleteAiConnection: async (_userId, id) => DeleteConnection(connections, secrets, id)
  };
}

function CreateConnection(connections, secrets, connection, key) {
  const saved = { id: NewId, ...connection, isDefault: connection.isDefault || !connections.length, hasKey: Boolean(key), testStatus: TestedStatus };
  if (saved.isDefault)
    connections.forEach((item) => item.isDefault = false);
  connections.push(saved);
  if (key)
    secrets.set(saved.id, key);
  return saved;
}

function UpdateConnection(connections, secrets, id, connection, key) {
  const saved = connections.find((item) => item.id === id);
  if (!saved)
    return null;
  Object.assign(saved, connection, { hasKey: typeof key === "string" ? Boolean(key) : saved.hasKey });
  if (typeof key === "string")
    UpdateSecret(secrets, id, key);
  return saved;
}

function UpdateSecret(secrets, id, key) {
  if (key)
    secrets.set(id, key);
  else
    secrets.delete(id);
}

function SetDefault(connections, id) {
  if (!connections.some((item) => item.id === id))
    return false;
  connections.forEach((item) => item.isDefault = item.id === id);
  return true;
}

function DeleteConnection(connections, secrets, id) {
  const index = connections.findIndex((item) => item.id === id);
  if (index < 0)
    return false;
  const [removed] = connections.splice(index, 1);
  secrets.delete(id);
  if (removed.isDefault && connections[0])
    connections[0].isDefault = true;
  return true;
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
    store, pool: { query: async () => ({ rows: [] }) }, rootPath: process.cwd(),
    discoverAiModels: async (options) => CaptureDiscovery(state, options),
    testAiConnection: async (options) => CaptureTest(state, options)
  };
}

function CaptureDiscovery(state, options) {
  state.discovery = options;
  return { status: 200, payload: { ok: true, baseUrl: options.baseUrl, models: [{ id: FutureModel, name: FutureModel }] } };
}

function CaptureTest(state, options) {
  state.tested = options;
  const baseUrl = options.providerId === AnthropicProvider ? "https://api.anthropic.com/v1" : options.baseUrl;
  return { status: 200, payload: { ok: true, baseUrl, model: options.model } };
}

async function Login(app, user) {
  const agent = request.agent(app);
  const anonymous = await agent.get("/api/auth/session").expect(200);
  const login = await agent.post("/api/auth/login").set(CsrfHeader, anonymous.body.csrfToken).send({ email: user.email, password: Password }).expect(200);
  return { agent, csrfToken: login.body.csrfToken };
}
