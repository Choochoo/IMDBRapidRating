import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import test from "node:test";
import { RegisterApiRoutes } from "../server/routes.mjs";

const ValidTitleId = "tt0113277";
const InvalidTitleId = "tt9999999";
const MovieMediaType = "movie";
const CachedMetadataData = {
  titleId: ValidTitleId,
  mediaType: MovieMediaType,
  tmdbId: 949,
  posterUrl: "poster",
  synopsis: "synopsis",
  actors: [],
  trailerUrl: "",
  source: "tmdb",
  sourcePayload: { id: 949 },
  metadataCheckedAt: new Date().toISOString(),
  streamingByCountry: {}
};
const CachedMetadata = Object.freeze(CachedMetadataData);

test("title metadata requests are limited to the selected catalog", VerifyCatalogValidation);
test("title streaming requests use the account's saved country", VerifyStreamingCountry);

async function VerifyCatalogValidation() {
  const state = { reads: 0 };
  const app = BuildApp(state);
  await request(app).get(`/api/title/${InvalidTitleId}?media=${MovieMediaType}`).expect(404);
  assert.equal(state.reads, 0);
  const response = await request(app).get(`/api/title/${ValidTitleId}?media=${MovieMediaType}`).expect(200);
  assert.equal(response.body.titleId, ValidTitleId);
  assert.equal(state.reads, 1);
}

async function VerifyStreamingCountry() {
  const state = { reads: 0 };
  const app = BuildApp(state);
  const response = await request(app).get(`/api/title/${ValidTitleId}?media=${MovieMediaType}&streaming=1`).expect(200);
  assert.equal(state.streamingRequest.country, "CA");
  assert.equal(response.body.streamingAvailability.country, "CA");
}

function BuildApp(state) {
  const app = express();
  app.use(AddSession);
  RegisterApiRoutes(app, BuildDependencies(state));
  return app;
}

function AddSession(requestMessage, _response, next) {
  requestMessage.session = { userId: "user-1", email: "user@example.com" };
  next();
}

function BuildDependencies(state) {
  return {
    store: { getSecret: async () => "tmdb-key", getPreferences: async () => ({ streamingCountry: "CA" }) },
    pool: { query: async () => ({ rows: [] }) },
    rootPath: process.cwd(),
    readMoviePool: async () => ({ ids: [ValidTitleId] }),
    titleMetadataStore: { readOne: async () => ReadMetadata(state) },
    streamingAvailabilityService: { get: async (value) => ReadStreaming(state, value) }
  };
}

function ReadMetadata(state) {
  state.reads++;
  return CachedMetadata;
}

function ReadStreaming(state, requestValue) {
  state.streamingRequest = requestValue;
  return { country: requestValue.country, fetchedAt: new Date().toISOString(), watchUrl: "", providers: [] };
}
