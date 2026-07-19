import assert from "node:assert/strict";
import test from "node:test";
import { ReadActorNames } from "../server/title-metadata.mjs";

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
