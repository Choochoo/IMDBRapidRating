import assert from "node:assert/strict";
import test from "node:test";
import { GetTitleMetadata, NormalizeTrailerUrl, PickTmdbTrailerUrl, ReadActorNames } from "../server/title-metadata.mjs";

test("actor metadata accepts IMDb, TMDB, and text-shaped cast entries", () => {
  assert.deepEqual(ReadActorNames([
    { "@type": "Person", name: "Al Pacino" },
    { id: 380, name: "Robert De Niro" },
    "Val Kilmer",
    { name: "Jon Voight" }
  ]), ["Al Pacino", "Robert De Niro", "Val Kilmer"]);
});

test("actor metadata removes blank and duplicate names", () => {
  assert.deepEqual(ReadActorNames(["Amy Adams", "", {}, { name: "Amy Adams" }, { name: "Jeremy Renner" }]), ["Amy Adams", "Jeremy Renner"]);
});

test("TMDB trailer selection prefers an official trailer on YouTube", () => {
  const url = PickTmdbTrailerUrl([
    { site: "YouTube", key: "teaser", type: "Teaser", official: true },
    { site: "Vimeo", key: "ignored", type: "Trailer", official: true },
    { site: "YouTube", key: "official_trailer", type: "Trailer", official: true }
  ]);

  assert.equal(url, "https://www.youtube.com/watch?v=official_trailer");
});

test("trailer URLs reject non-web protocols", () => {
  assert.equal(NormalizeTrailerUrl("javascript:alert(1)"), "");
  assert.equal(NormalizeTrailerUrl("https://www.imdb.com/video/vi123"), "https://www.imdb.com/video/vi123");
});

test("fresh PostgreSQL metadata and streaming availability are reused without exposing the raw TMDB payload", async () => {
  let metadataWrites = 0;
  let receivedCachedAvailability;
  const cachedAvailability = {
    country: "US",
    fetchedAt: new Date().toISOString(),
    watchUrl: "https://www.themoviedb.org/movie/101/watch?locale=US",
    providers: [{ type: "subscription", id: 8, name: "Netflix", logoPath: "/netflix.jpg", displayPriority: 1 }]
  };
  const metadataStore = {
    async readOne() {
      return {
        titleId: "tt999999991",
        mediaType: "movie",
        status: "matched",
        tmdbId: 101,
        posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg",
        synopsis: "Stored locally.",
        actors: ["Actor One"],
        trailerUrl: "",
        seriesStatus: "",
        seasonCount: 0,
        episodeCount: 0,
        episodeRuntimeMinutes: 0,
        originCountries: ["US"],
        originalLanguage: "en",
        source: "tmdb",
        sourcePayload: { id: 101, credits: { cast: [{ name: "Actor One" }] } },
        metadataCheckedAt: new Date().toISOString(),
        streamingByCountry: { US: cachedAvailability }
      };
    },
    async upsertMetadata() {
      metadataWrites++;
    }
  };
  const streamingAvailabilityService = {
    async get({ cached }) {
      receivedCachedAvailability = cached;
      return { ...cached, stale: false };
    }
  };

  const result = await GetTitleMetadata("tt999999991", { mediaType: "movie", metadataStore, streamingAvailabilityService });

  assert.equal(result.payload.synopsis, "Stored locally.");
  assert.equal(result.payload.streamingAvailability.providers[0].name, "Netflix");
  assert.equal(receivedCachedAvailability, cachedAvailability);
  assert.equal(Object.hasOwn(result.payload, "sourcePayload"), false);
  assert.equal(metadataWrites, 0);
});
