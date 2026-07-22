import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import test from "node:test";
import { RegisterApiRoutes } from "../server/routes.mjs";

const ValidTitleId = "tt0113277";
const InvalidTitleId = "tt9999999";
const CachedMetadata = Object.freeze({
  titleId: ValidTitleId,
  mediaType: "movie",
  tmdbId: 949,
  posterUrl: "poster",
  synopsis: "synopsis",
  actors: [],
  trailerUrl: "",
  source: "tmdb",
  sourcePayload: { id: 949 },
  metadataCheckedAt: new Date().toISOString(),
  streamingByCountry: {}
});

test("title metadata requests are limited to the selected catalog", VerifyCatalogValidation);

async function VerifyCatalogValidation() {
  const state = { reads: 0 };
  const app = BuildApp(state);
  await request(app).get(`/api/title/${InvalidTitleId}?media=movie`).expect(404);
  assert.equal(state.reads, 0);
  const response = await request(app).get(`/api/title/${ValidTitleId}?media=movie`).expect(200);
  assert.equal(response.body.titleId, ValidTitleId);
  assert.equal(state.reads, 1);
}

function BuildApp(state) {
  const app = express();
  app.use((requestMessage, _response, next) => {
    requestMessage.session = { userId: "user-1", email: "user@example.com" };
    next();
  });
  RegisterApiRoutes(app, BuildDependencies(state));
  return app;
}

function BuildDependencies(state) {
  return {
    store: { getSecret: async () => "" },
    pool: { query: async () => ({ rows: [] }) },
    rootPath: process.cwd(),
    readMoviePool: async () => ({ ids: [ValidTitleId] }),
    titleMetadataStore: { readOne: async () => ReadMetadata(state) },
    streamingAvailabilityService: { get: async () => null }
  };
}

function ReadMetadata(state) {
  state.reads++;
  return CachedMetadata;
}
