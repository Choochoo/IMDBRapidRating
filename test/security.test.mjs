import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import express from "express";
import request from "supertest";
import { BuildHelmetOptions, VerifyOrigin } from "../server/app.mjs";
import { ReadDatabaseSchema, ReadPostgresConfig } from "../server/db/config.mjs";
import { DecryptSecret, EncryptSecret, SafeTokenEquals } from "../server/security/secrets.mjs";

const AllowedOriginsEnvironment = "APP_ALLOWED_ORIGINS";
const AppOriginEnvironment = "APP_ORIGIN";
const AppOrigin = "http://app.example.test:5012";
const CspUpgradeDirective = "upgrade-insecure-requests";
const HostHeader = "Host";
const ImdbSecretType = "imdb";
const OriginHeader = "Origin";
const SameToken = "same";
const SchemaName = "imdb_rapid_rater";
const SensitiveValue = "sensitive-value";
const UserId = "user-1";
const WritePath = "/write";

test("encrypted account secrets round-trip and are bound to account and type", VerifyEncryptedSecrets);
test("constant-time token helper rejects empty and different tokens", VerifyTokenComparison);
test("Npgsql-style connection strings are supported without exposing credentials", VerifyNpgsqlConnection);
test("database schema names are strictly validated", VerifySchemaValidation);
test("HTTP origins do not upgrade assets to HTTPS-only security contexts", VerifyHelmetOptions);
test("same-origin requests and configured additional origins are accepted", VerifyConfiguredOrigins);
test("the request host is accepted without deployment configuration", VerifyRequestHost);

function VerifyEncryptedSecrets() {
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const encrypted = EncryptSecret(SensitiveValue, UserId, ImdbSecretType);
  assert.notEqual(encrypted.ciphertext, SensitiveValue);
  assert.equal(DecryptSecret(encrypted, UserId, ImdbSecretType), SensitiveValue);
  assert.throws(() => DecryptSecret(encrypted, "user-2", ImdbSecretType));
}

function VerifyTokenComparison() {
  assert.equal(SafeTokenEquals(SameToken, SameToken), true);
  assert.equal(SafeTokenEquals(SameToken, "other"), false);
  assert.equal(SafeTokenEquals("", ""), false);
}

function VerifyNpgsqlConnection() {
  process.env.POSTGRES_CONNECTION_STRING = "Host=db.internal;Port=5432;Database=rapid;Username=app;Password=secret";
  delete process.env.DATABASE_URL;
  const config = ReadPostgresConfig();
  assert.equal(config.host, "db.internal");
  assert.equal(config.database, "rapid");
  assert.equal(config.user, "app");
  assert.equal(config.password, "secret");
}

function VerifySchemaValidation() {
  process.env.RAPID_RATER_DB_SCHEMA = SchemaName;
  assert.equal(ReadDatabaseSchema(), SchemaName);
  process.env.RAPID_RATER_DB_SCHEMA = "public; drop schema public";
  assert.throws(() => ReadDatabaseSchema());
  delete process.env.RAPID_RATER_DB_SCHEMA;
}

function VerifyHelmetOptions() {
  const httpOptions = BuildHelmetOptions(false);
  assert.equal(httpOptions.contentSecurityPolicy.directives[CspUpgradeDirective], null);
  assert.equal(httpOptions.crossOriginOpenerPolicy, false);
  assert.equal(httpOptions.originAgentCluster, false);
  const httpsOptions = BuildHelmetOptions(true);
  assert.deepEqual(httpsOptions.contentSecurityPolicy.directives[CspUpgradeDirective], []);
  assert.equal(Object.hasOwn(httpsOptions, "crossOriginOpenerPolicy"), false);
  assert.equal(Object.hasOwn(httpsOptions, "originAgentCluster"), false);
}

async function VerifyConfiguredOrigins() {
  const previous = CaptureOriginEnvironment();
  process.env[AppOriginEnvironment] = `${AppOrigin}/`;
  process.env[AllowedOriginsEnvironment] = "http://alternate.example.test:5012, https://example.test/path";
  try {
    const app = BuildOriginApp();
    await ExpectOrigin(app, AppOrigin, 204);
    await ExpectOrigin(app, "http://alternate.example.test:5012", 204);
    await ExpectOrigin(app, "https://example.test", 204);
    await ExpectHostedOrigin(app, "ourfilmclub.duckdns.org:5012", "http://ourfilmclub.duckdns.org:5012", 204);
    await ExpectOrigin(app, "http://evil.example", 403);
  } finally {
    RestoreOriginEnvironment(previous);
  }
}

async function VerifyRequestHost() {
  const previous = CaptureOriginEnvironment();
  delete process.env[AppOriginEnvironment];
  delete process.env[AllowedOriginsEnvironment];
  try {
    await ExpectHostedOrigin(BuildOriginApp(), "app.example.test:5012", AppOrigin, 204);
  } finally {
    RestoreOriginEnvironment(previous);
  }
}

function BuildOriginApp() {
  const app = express();
  app.use(VerifyOrigin);
  app.post(WritePath, (_request, response) => response.sendStatus(204));
  return app;
}

async function ExpectOrigin(app, origin, status) {
  await request(app).post(WritePath).set(OriginHeader, origin).expect(status);
}

async function ExpectHostedOrigin(app, host, origin, status) {
  await request(app).post(WritePath).set(HostHeader, host).set(OriginHeader, origin).expect(status);
}

function CaptureOriginEnvironment() {
  return {
    origin: process.env[AppOriginEnvironment],
    allowed: process.env[AllowedOriginsEnvironment]
  };
}

function RestoreOriginEnvironment(previous) {
  RestoreEnvironment(AppOriginEnvironment, previous.origin);
  RestoreEnvironment(AllowedOriginsEnvironment, previous.allowed);
}

function RestoreEnvironment(name, value) {
  if (value === undefined)
    delete process.env[name];
  else
    process.env[name] = value;
}
