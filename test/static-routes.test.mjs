import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import test from "node:test";
import { RegisterStaticRoutes } from "../server/app.mjs";

const ContentTypeHeader = "content-type";
const JavaScriptContentType = /javascript/;
const WishlistPath = "/wishlist";
const ModuleRouteCaseValues = [
  ["shared CSV helper", "/shared/csv.js", /export function ParseCsv/],
  ["shared media helper", "/shared/media.js", /export function NormalizeMediaType/],
  ["shared title filter helper", "/shared/title-filters.js", /export function IsTitleAllowed/],
  ["recommendation basis helper", "/shared/recommendation-basis.js", /export function NormalizeRecommendationBasis/],
  ["keyboard shortcut helper", "/shared/keyboard-shortcuts.js", /export function NormalizeKeyboardShortcuts/],
  ["local ZIP implementation without a CDN", "/vendor/fflate.js", /function unzipSync/]
];
const ModuleRouteCases = Object.freeze(ModuleRouteCaseValues);

for (const [name, path, exportPattern] of ModuleRouteCases)
  test(`browser module graph can load the ${name}`, () => VerifyBrowserModule(path, exportPattern));

async function VerifyBrowserModule(path, exportPattern) {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  const response = await request(app).get(path).expect(200);
  assert.match(response.text, exportPattern);
  assert.match(response.headers[ContentTypeHeader], JavaScriptContentType);
}

test("each top-level view has a refreshable browser route", VerifyViewRoutes);
test("trailing slashes redirect to asset-safe view URLs", VerifyTrailingSlashRedirect);

async function VerifyViewRoutes() {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  for (const path of ["/login", "/rate", WishlistPath, "/sync", "/settings", "/settings/shortcuts", "/settings/ai", "/movies/rate", "/movies/wishlist", "/movies/sync", "/tv/rate", "/tv/wishlist"]) {
    const response = await request(app).get(path).expect(200);
    assert.match(response.text, /<title>IMDb Rapid Rater<\/title>/);
    assert.match(response.text, /<base href="\/">/);
    assert.match(response.text, /src="\/src\/app\.js"/);
    assert.match(response.headers[ContentTypeHeader], /html/);
  }
}

async function VerifyTrailingSlashRedirect() {
  const app = express();
  RegisterStaticRoutes(app, process.cwd());
  const response = await request(app).get("/wishlist/").expect(308);
  assert.equal(response.headers.location, WishlistPath);
}
