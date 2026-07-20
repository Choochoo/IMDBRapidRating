import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import test from "node:test";
import { RegisterStaticRoutes } from "../server/app.mjs";

test("browser module graph can load the shared CSV helper", async () => {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  const response = await request(app).get("/shared/csv.js").expect(200);
  assert.match(response.text, /export function ParseCsv/);
  assert.match(response.headers["content-type"], /javascript/);
});

test("browser module graph can load the shared media helper", async () => {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  const response = await request(app).get("/shared/media.js").expect(200);
  assert.match(response.text, /export function NormalizeMediaType/);
  assert.match(response.headers["content-type"], /javascript/);
});

test("browser module graph can load the shared title filter helper", async () => {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  const response = await request(app).get("/shared/title-filters.js").expect(200);
  assert.match(response.text, /export function IsTitleAllowed/);
  assert.match(response.headers["content-type"], /javascript/);
});

test("browser module graph can load the recommendation basis helper", async () => {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  const response = await request(app).get("/shared/recommendation-basis.js").expect(200);
  assert.match(response.text, /export function NormalizeRecommendationBasis/);
  assert.match(response.headers["content-type"], /javascript/);
});

test("browser can load the local ZIP implementation without a CDN", async () => {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  const response = await request(app).get("/vendor/fflate.js").expect(200);
  assert.match(response.text, /function unzipSync/);
  assert.match(response.headers["content-type"], /javascript/);
});

test("each top-level view has a refreshable browser route", async () => {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());

  for (const path of ["/login", "/rate", "/wishlist", "/sync", "/movies/rate", "/movies/wishlist", "/movies/sync", "/tv/rate", "/tv/wishlist"]) {
    const response = await request(app).get(path).expect(200);
    assert.match(response.text, /<title>IMDb Rapid Rater<\/title>/);
    assert.match(response.text, /<base href="\/">/);
    assert.match(response.text, /src="\/src\/app\.js"/);
    assert.match(response.headers["content-type"], /html/);
  }
});

test("trailing slashes redirect to asset-safe view URLs", async () => {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());

  const response = await request(app).get("/wishlist/").expect(308);
  assert.equal(response.headers.location, "/wishlist");
});
