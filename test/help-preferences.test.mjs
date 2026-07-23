import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import test from "node:test";
import { CreateAccountStore } from "../server/account-store.mjs";
import { HashPassword } from "../server/auth.mjs";
import { RegisterApiRoutes } from "../server/routes.mjs";
import { ApplyAccountSettings, BuildAccountPreferences } from "../src/app/browser-settings.js";
import { DefaultKeyboardShortcuts } from "../shared/keyboard-shortcuts.js";
import { BuildDefaultHelpPreferences, HelpReminderShowLimit, NormalizeHelpPreferences, ValidateHelpPreferences } from "../shared/help-preferences.js";

const ReminderId = "imdb-import";
const LastShownAt = "2026-07-23T17:00:00.000Z";
const SnoozedUntil = "2026-07-30T17:00:00.000Z";
const AlternateCountry = "CA";
const CsrfHeader = "x-csrf-token";
const Password = "correct horse battery staple";
const StreamingCountry = "US";
const UserId = "user-1";

test("help preferences normalize reminder history and reject unsafe values", VerifyHelpPreferenceModel);
test("missing account preference rows receive fresh help preference defaults", VerifyAccountStoreDefaults);
test("browser account preference requests preserve help reminder history", VerifyBrowserPreferenceMapping);
test("account preference routes validate, save, and return help reminder history", VerifyPreferenceRoute);
test("account preference routes reject invalid help reminder history", VerifyInvalidPreferenceRoute);

function VerifyHelpPreferenceModel() {
  assert.deepEqual(NormalizeHelpPreferences(null), BuildDefaultHelpPreferences());
  const preferences = BuildHelpPreferences();
  assert.deepEqual(NormalizeHelpPreferences(preferences), preferences);
  const invalid = BuildHelpPreferences(HelpReminderShowLimit + 1);
  assert.equal(ValidateHelpPreferences(invalid).ok, false);
  invalid.reminders[ReminderId] = { shownCount: 1, lastShownAt: "2026", snoozedUntil: "" };
  assert.equal(ValidateHelpPreferences(invalid).ok, false);
  assert.deepEqual(NormalizeHelpPreferences(invalid), BuildDefaultHelpPreferences());
}

async function VerifyAccountStoreDefaults() {
  const db = BuildEmptyPreferenceDatabase();
  const store = CreateAccountStore({ db, pool: {} });
  const first = await store.getPreferences(UserId);
  first.helpPreferences.enabled = false;
  const second = await store.getPreferences(UserId);
  assert.deepEqual(second.helpPreferences, BuildDefaultHelpPreferences());
}

function VerifyBrowserPreferenceMapping() {
  const helpPreferences = BuildHelpPreferences();
  const settings = ApplyAccountSettings({}, { streamingCountry: StreamingCountry, keyboardShortcuts: DefaultKeyboardShortcuts, helpPreferences });
  const requestBody = BuildAccountPreferences(settings, { streamingCountry: AlternateCountry });
  assert.deepEqual(settings.helpPreferences, helpPreferences);
  assert.deepEqual(requestBody.helpPreferences, helpPreferences);
  assert.equal(requestBody.streamingCountry, AlternateCountry);
}

async function VerifyPreferenceRoute() {
  const scenario = await BuildRouteScenario(BuildDefaultHelpPreferences());
  const authenticated = await Login(scenario.app, scenario.user);
  const helpPreferences = BuildHelpPreferences();
  const response = await SavePreferences(authenticated, helpPreferences, 200);
  assert.deepEqual(response.body.helpPreferences, helpPreferences);
  assert.deepEqual(scenario.ReadSaved().helpPreferences, helpPreferences);
  const bundle = await authenticated.agent.get("/api/account/state").expect(200);
  assert.deepEqual(bundle.body.settings.helpPreferences, helpPreferences);
}

async function VerifyInvalidPreferenceRoute() {
  const scenario = await BuildRouteScenario(BuildDefaultHelpPreferences());
  const authenticated = await Login(scenario.app, scenario.user);
  await SavePreferences(authenticated, BuildHelpPreferences(HelpReminderShowLimit + 1), 422);
  assert.equal(scenario.ReadSaved(), null);
}

function BuildHelpPreferences(shownCount = 1) {
  return {
    enabled: true,
    reminders: {
      [ReminderId]: { shownCount, lastShownAt: LastShownAt, snoozedUntil: SnoozedUntil }
    }
  };
}

function BuildEmptyPreferenceDatabase() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] })
      })
    })
  };
}

async function BuildRouteScenario(helpPreferences) {
  const user = { id: "b0ec80b3-a74f-4d06-b5c6-04ed0c9d8a60", email: "help@example.com", passwordHash: await HashPassword(Password) };
  let saved = null;
  const preferences = { streamingCountry: StreamingCountry, keyboardShortcuts: DefaultKeyboardShortcuts, helpPreferences };
  const store = {
    findUserByEmail: async () => user,
    getBundle: async () => ({ preferences, state: { payload: {}, ratingsCsv: "", revision: 0 }, configured: new Set() }),
    savePreferences: async (_userId, value) => { saved = value; Object.assign(preferences, value); }
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

async function SavePreferences(authenticated, helpPreferences, status) {
  const body = { streamingCountry: StreamingCountry, keyboardShortcuts: DefaultKeyboardShortcuts, helpPreferences };
  return await authenticated.agent.put("/api/account/preferences").set(CsrfHeader, authenticated.csrfToken).send(body).expect(status);
}
