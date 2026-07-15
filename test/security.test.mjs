import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import express from "express";
import request from "supertest";
import { BuildHelmetOptions, VerifyOrigin } from "../server/app.mjs";
import { ReadDatabaseSchema, ReadPostgresConfig } from "../server/db/config.mjs";
import { DecryptSecret, EncryptSecret, SafeTokenEquals } from "../server/security/secrets.mjs";

test("encrypted account secrets round-trip and are bound to account and type", () => {
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const encrypted = EncryptSecret("sensitive-value", "user-1", "imdb");
  assert.notEqual(encrypted.ciphertext, "sensitive-value");
  assert.equal(DecryptSecret(encrypted, "user-1", "imdb"), "sensitive-value");
  assert.throws(() => DecryptSecret(encrypted, "user-2", "imdb"));
});

test("constant-time token helper rejects empty and different tokens", () => {
  assert.equal(SafeTokenEquals("same", "same"), true);
  assert.equal(SafeTokenEquals("same", "other"), false);
  assert.equal(SafeTokenEquals("", ""), false);
});

test("Npgsql-style connection strings are supported without exposing credentials", () => {
  process.env.POSTGRES_CONNECTION_STRING = "Host=db.internal;Port=5432;Database=rapid;Username=app;Password=secret";
  delete process.env.DATABASE_URL;
  const config = ReadPostgresConfig();
  assert.equal(config.host, "db.internal");
  assert.equal(config.database, "rapid");
  assert.equal(config.user, "app");
  assert.equal(config.password, "secret");
});

test("database schema names are strictly validated", () => {
  process.env.RAPID_RATER_DB_SCHEMA = "imdb_rapid_rater";
  assert.equal(ReadDatabaseSchema(), "imdb_rapid_rater");
  process.env.RAPID_RATER_DB_SCHEMA = "public; drop schema public";
  assert.throws(() => ReadDatabaseSchema());
  delete process.env.RAPID_RATER_DB_SCHEMA;
});

test("HTTP origins do not upgrade assets to HTTPS-only security contexts", () => {
  const httpOptions = BuildHelmetOptions(false);
  assert.equal(httpOptions.contentSecurityPolicy.directives["upgrade-insecure-requests"], null);
  assert.equal(httpOptions.crossOriginOpenerPolicy, false);
  assert.equal(httpOptions.originAgentCluster, false);

  const httpsOptions = BuildHelmetOptions(true);
  assert.deepEqual(httpsOptions.contentSecurityPolicy.directives["upgrade-insecure-requests"], []);
  assert.equal(Object.hasOwn(httpsOptions, "crossOriginOpenerPolicy"), false);
  assert.equal(Object.hasOwn(httpsOptions, "originAgentCluster"), false);
});

test("configured primary and additional HTTP origins are accepted", async () => {
  const previousOrigin = process.env.APP_ORIGIN;
  const previousAllowed = process.env.APP_ALLOWED_ORIGINS;
  process.env.APP_ORIGIN = "http://192.168.1.45:5012/";
  process.env.APP_ALLOWED_ORIGINS = "http://ourfilmclub.duckdns.org:5012, https://example.test/path";
  try {
    const app = express();
    app.use(VerifyOrigin);
    app.post("/write", (_request, response) => response.sendStatus(204));

    await request(app).post("/write").set("Origin", "http://192.168.1.45:5012").expect(204);
    await request(app).post("/write").set("Origin", "http://ourfilmclub.duckdns.org:5012").expect(204);
    await request(app).post("/write").set("Origin", "https://example.test").expect(204);
    await request(app).post("/write").set("Origin", "http://evil.example").expect(403);
  } finally {
    RestoreEnvironment("APP_ORIGIN", previousOrigin);
    RestoreEnvironment("APP_ALLOWED_ORIGINS", previousAllowed);
  }
});

test("the Film Club hostname is accepted without deployment configuration", async () => {
  const previousOrigin = process.env.APP_ORIGIN;
  const previousAllowed = process.env.APP_ALLOWED_ORIGINS;
  delete process.env.APP_ORIGIN;
  delete process.env.APP_ALLOWED_ORIGINS;
  try {
    const app = express();
    app.use(VerifyOrigin);
    app.post("/write", (_request, response) => response.sendStatus(204));
    await request(app).post("/write").set("Origin", "http://ourfilmclub.duckdns.org:5012").expect(204);
  } finally {
    RestoreEnvironment("APP_ORIGIN", previousOrigin);
    RestoreEnvironment("APP_ALLOWED_ORIGINS", previousAllowed);
  }
});

function RestoreEnvironment(name, value) {
  if (value === undefined)
    delete process.env[name];
  else
    process.env[name] = value;
}
