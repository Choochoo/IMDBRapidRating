import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  BuildLetterboxdCsvFiles,
  ImportLetterboxdCsvFiles,
  ReconcileCollections
} from "../src/app/collection-sync.js";
import { BuildState, BuildStoragePayload } from "../src/app/state.js";
import { BuildLetterboxdArchive, ReadLetterboxdArchive } from "../src/app/letterboxd-zip.js";

const Movies = new Map([
  ["tt0111161", { ttId: "tt0111161", title: "The Shawshank Redemption", year: 1994 }],
  ["tt0468569", { ttId: "tt0468569", title: "The Dark Knight", year: 2008 }],
  ["tt0209144", { ttId: "tt0209144", title: "Memento", year: 2000 }],
  ["tt1375666", { ttId: "tt1375666", title: "Inception", year: 2010 }]
]);

test("Letterboxd export files merge and map title/year records to IMDb IDs", () => {
  const state = ImportLetterboxdCsvFiles([
    {
      name: "ratings.csv",
      text: "Date,Name,Year,Letterboxd URI,Rating\n2026-07-01,The Shawshank Redemption,1994,https://boxd.it/2aHi,4.5"
    },
    {
      name: "watched.csv",
      text: "Date,Name,Year,Letterboxd URI\n2026-06-30,The Shawshank Redemption,1994,https://boxd.it/2aHi"
    },
    {
      name: "watchlist.csv",
      text: "Date,Name,Year,Letterboxd URI\n2026-07-02,The Dark Knight,2008,https://boxd.it/2b0k"
    }
  ], Movies, "letterboxd-export.zip");

  assert.equal(state.items.length, 2);
  const shawshank = state.items.find((item) => item.ttId === "tt0111161");
  assert.equal(shawshank.rating, 9);
  assert.equal(shawshank.watched, true);
  assert.equal(shawshank.watchedAt, "2026-06-30");
  const darkKnight = state.items.find((item) => item.ttId === "tt0468569");
  assert.equal(darkKnight.watchlist, true);
  assert.equal(darkKnight.watched, false);
});

test("collection reconciliation creates a non-destructive union plan", () => {
  const ratings = {
    tt0468569: ImdbRecord("tt0468569", "The Dark Knight", 2008, 8),
    tt0209144: ImdbRecord("tt0209144", "Memento", 2000, 9),
    tt1375666: ImdbRecord("tt1375666", "Inception", 2010, 9)
  };
  const letterboxd = {
    items: [
      LetterboxdRecord("tt0111161", "The Shawshank Redemption", 1994, 10),
      LetterboxdRecord("tt0209144", "Memento", 2000, 9),
      LetterboxdRecord("tt1375666", "Inception", 2010, 8),
      LetterboxdRecord("", "Unmatched Film", 2026, 7),
      { ...LetterboxdRecord("tt9999999", "Watched Only", 2025, null), watched: true }
    ]
  };

  const plan = ReconcileCollections(ratings, letterboxd);
  assert.equal(plan.matched, 1);
  assert.deepEqual(plan.toImdb.map((entry) => entry.item.ttId), ["tt0111161"]);
  assert.deepEqual(plan.toLetterboxd.map((record) => record.ttId), ["tt0468569"]);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.watchedOnly.length, 1);
});

test("Letterboxd output uses exact IMDb IDs, 1-10 ratings, and bounded CSV chunks", () => {
  const records = Array.from({ length: 8 }, (_, index) => ImdbRecord(`tt${String(index + 1).padStart(7, "0")}`, `A deliberately long movie title ${index}`, 2000 + index, index + 1));
  const files = BuildLetterboxdCsvFiles(records, 180);
  assert.ok(files.length > 1);
  for (const file of files) {
    assert.match(file.content, /^imdbID,Title,Year,Rating10,WatchedDate/);
    assert.ok(new TextEncoder().encode(file.content).byteLength <= 180);
  }
  assert.match(files[0].content, /tt0000001,A deliberately long movie title 0,2000,1,2026-07-01/);
});

test("Letterboxd snapshots are included in the PostgreSQL account payload", () => {
  const state = BuildState();
  state.letterboxd = { sourceName: "export.zip", importedAt: "2026-07-16T00:00:00.000Z", files: ["ratings.csv"], importedRows: 1, items: [LetterboxdRecord("tt0111161", "The Shawshank Redemption", 1994, 10)] };
  const payload = BuildStoragePayload(state);
  assert.equal(payload.letterboxd.items.length, 1);
  assert.equal(payload.letterboxd.sourceName, "export.zip");
});

test("Letterboxd ZIP exports are read and multi-file sync downloads round-trip", () => {
  const source = zipSync({
    "letterboxd/ratings.csv": strToU8("Date,Name,Year,Rating\n2026-07-01,Memento,2000,4.5"),
    "letterboxd/readme.txt": strToU8("ignored")
  });
  const files = ReadLetterboxdArchive(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), { unzipSync, strFromU8 });
  assert.deepEqual(files.map((file) => file.name), ["letterboxd/ratings.csv"]);

  const download = BuildLetterboxdArchive([
    { name: "sync-01.csv", content: "imdbID,Rating10\ntt0209144,9" },
    { name: "sync-02.csv", content: "imdbID,Rating10\ntt0468569,10" }
  ], { zipSync, strToU8 });
  const roundTrip = unzipSync(download.content);
  assert.equal(strFromU8(roundTrip["sync-01.csv"]), "imdbID,Rating10\ntt0209144,9");
  assert.equal(download.type, "application/zip");
});

function ImdbRecord(ttId, title, year, rating) {
  return {
    ttId,
    title,
    year,
    rating,
    status: "imported",
    submitStatus: "imported",
    at: "2026-07-01"
  };
}

function LetterboxdRecord(ttId, title, year, rating) {
  return { ttId, title, year, rating, watched: true, watchedAt: "2026-07-01", ratedAt: "2026-07-01" };
}
