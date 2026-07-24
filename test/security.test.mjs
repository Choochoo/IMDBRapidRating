import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import express from "express";
import request from "supertest";
import { ApplyCorsPolicy, BuildHelmetOptions, VerifyOrigin } from "../server/app.mjs";
import { ReadDatabaseSchema, ReadPostgresConfig } from "../server/db/config.mjs";
import { DecryptSecret, EncryptSecret, SafeTokenEquals } from "../server/security/secrets.mjs";

const AllowedOriginsEnvironment = "APP_ALLOWED_ORIGINS";
const AccessControlAllowCredentialsHeader = "access-control-allow-credentials";
const AccessControlAllowHeadersHeader = "access-control-allow-headers";
const AccessControlAllowMethodsHeader = "access-control-allow-methods";
const AccessControlAllowOriginHeader = "access-control-allow-origin";
const AccessControlRequestMethodHeader = "Access-Control-Request-Method";
const AdminOrigin = "https://admin.rapidrater.io";
const AnalyticsOrigin = "https://us.i.posthog.com";
const AppOriginEnvironment = "APP_ORIGIN";
const AppOrigin = "http://app.example.test:5012";
const CspUpgradeDirective = "upgrade-insecure-requests";
const DevelopmentEnvironment = "development";
const HostHeader = "Host";
const ImdbSecretType = "imdb";
const NodeEnvironment = "NODE_ENV";
const OriginHeader = "Origin";
const PostMethod = "POST";
const ProductionEnvironment = "production";
const ProductionOrigin = "https://rapidrater.io";
const ProductionWwwOrigin = "https://www.rapidrater.io";
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
test("production CORS allows only rapidrater.io and www.rapidrater.io", VerifyProductionCorsPolicy);
test("production write requests allow only rapidrater.io and www.rapidrater.io", VerifyProductionOrigins);
test("the development request host is accepted without deployment configuration", VerifyDevelopmentRequestHost);

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
  const analyticsOptions = BuildHelmetOptions(true, AnalyticsOrigin);
  assert.deepEqual(analyticsOptions.contentSecurityPolicy.directives.connectSrc, ["'self'", AnalyticsOrigin]);
}

async function VerifyConfiguredOrigins() {
  const previous = CaptureOriginEnvironment();
  ConfigureDevelopmentOrigins();
  try {
    await ExpectConfiguredOrigins();
  } finally {
    RestoreOriginEnvironment(previous);
  }
}

function ConfigureDevelopmentOrigins() {
  process.env[NodeEnvironment] = DevelopmentEnvironment;
  process.env[AppOriginEnvironment] = `${AppOrigin}/`;
  process.env[AllowedOriginsEnvironment] = "http://alternate.example.test:5012, https://example.test/path";
}

async function ExpectConfiguredOrigins() {
  const app = BuildOriginApp();
  await ExpectOrigin(app, AppOrigin, 204);
  await ExpectOrigin(app, "http://alternate.example.test:5012", 204);
  await ExpectOrigin(app, "https://example.test", 204);
  await ExpectHostedOrigin(app, "ourfilmclub.duckdns.org:5012", "http://ourfilmclub.duckdns.org:5012", 204);
  await ExpectOrigin(app, "http://evil.example", 403);
}

async function VerifyProductionCorsPolicy() {
  const previous = CaptureOriginEnvironment();
  process.env[NodeEnvironment] = ProductionEnvironment;
  try {
    await ExpectAllowedPreflight(BuildOriginApp(), ProductionOrigin);
    await ExpectAllowedPreflight(BuildOriginApp(), ProductionWwwOrigin);
    await ExpectPreflight(BuildOriginApp(), AdminOrigin, 403);
  } finally {
    RestoreOriginEnvironment(previous);
  }
}

async function ExpectAllowedPreflight(app, origin) {
  const response = await ExpectPreflight(app, origin, 204);
  assert.equal(response.headers[AccessControlAllowOriginHeader], origin);
  assert.equal(response.headers[AccessControlAllowCredentialsHeader], "true");
  assert.match(response.headers[AccessControlAllowHeadersHeader], /X-CSRF-Token/i);
  assert.match(response.headers[AccessControlAllowMethodsHeader], /POST/);
}

async function VerifyProductionOrigins() {
  const previous = CaptureOriginEnvironment();
  process.env[NodeEnvironment] = ProductionEnvironment;
  process.env[AppOriginEnvironment] = AppOrigin;
  process.env[AllowedOriginsEnvironment] = AdminOrigin;
  try {
    const app = BuildOriginApp();
    await ExpectOrigin(app, ProductionOrigin, 204);
    await ExpectOrigin(app, ProductionWwwOrigin, 204);
    await ExpectRejectedProductionOrigins(app);
    await ExpectHostedOrigin(app, "attacker.example", ProductionOrigin, 204);
  } finally {
    RestoreOriginEnvironment(previous);
  }
}

async function ExpectRejectedProductionOrigins(app) {
  await ExpectOrigin(app, "http://rapidrater.io", 403);
  await ExpectOrigin(app, "https://rapidrater.io.evil.example", 403);
  await ExpectOrigin(app, AppOrigin, 403);
  await ExpectOrigin(app, AdminOrigin, 403);
}

async function VerifyDevelopmentRequestHost() {
  const previous = CaptureOriginEnvironment();
  process.env[NodeEnvironment] = DevelopmentEnvironment;
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
  app.use(ApplyCorsPolicy);
  app.use(VerifyOrigin);
  app.post(WritePath, (_request, response) => response.sendStatus(204));
  return app;
}

async function ExpectPreflight(app, origin, status) {
  return await request(app).options(WritePath).set(OriginHeader, origin).set(AccessControlRequestMethodHeader, PostMethod).expect(status);
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
    allowed: process.env[AllowedOriginsEnvironment],
    environment: process.env[NodeEnvironment]
  };
}

function RestoreOriginEnvironment(previous) {
  RestoreEnvironment(AppOriginEnvironment, previous.origin);
  RestoreEnvironment(AllowedOriginsEnvironment, previous.allowed);
  RestoreEnvironment(NodeEnvironment, previous.environment);
}

function RestoreEnvironment(name, value) {
  if (value === undefined)
    delete process.env[name];
  else
    process.env[name] = value;
}
