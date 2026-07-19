import assert from "node:assert/strict";
import test from "node:test";
import { NormalizeTrailerUrl, PickTmdbTrailerUrl, ReadActorNames } from "../server/title-metadata.mjs";

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
