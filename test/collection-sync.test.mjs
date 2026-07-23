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

const DarkKnightId = "tt0468569";
const DarkKnightTitle = "The Dark Knight";
const ExportArchiveName = "export.zip";
const ImportedStatus = "imported";
const InceptionId = "tt1375666";
const InceptionTitle = "Inception";
const LetterboxdRatingsPath = "letterboxd/ratings.csv";
const MementoId = "tt0209144";
const MementoTitle = "Memento";
const RatingDate = "2026-07-01";
const RatingsFileName = "ratings.csv";
const ShawshankId = "tt0111161";
const ShawshankTitle = "The Shawshank Redemption";
const SyncFileName = "sync-01.csv";
const SyncFileText = "imdbID,Rating10\ntt0209144,9";
const MovieEntries = [
  [ShawshankId, { ttId: ShawshankId, title: ShawshankTitle, year: 1994 }],
  [DarkKnightId, { ttId: DarkKnightId, title: DarkKnightTitle, year: 2008 }],
  [MementoId, { ttId: MementoId, title: MementoTitle, year: 2000 }],
  [InceptionId, { ttId: InceptionId, title: InceptionTitle, year: 2010 }]
];
const Movies = new Map(MovieEntries);

test("Letterboxd export files merge and map title/year records to IMDb IDs", VerifyLetterboxdImport);
test("collection reconciliation creates a non-destructive union plan", VerifyCollectionReconciliation);
test("Letterboxd output uses exact IMDb IDs, 1-10 ratings, and bounded CSV chunks", VerifyLetterboxdOutput);
test("Letterboxd snapshots are included in the PostgreSQL account payload", VerifyLetterboxdPayload);
test("Letterboxd ZIP exports are read and multi-file sync downloads round-trip", VerifyLetterboxdArchive);

function VerifyLetterboxdImport() {
  const state = ImportLetterboxdCsvFiles(BuildImportFiles(), Movies, "letterboxd-export.zip");
  AssertImportedState(state);
}

function BuildImportFiles() {
  return [BuildRatingsImport(), BuildWatchedImport(), BuildWatchlistImport()];
}

function BuildRatingsImport() {
  return {
    name: RatingsFileName,
    text: `Date,Name,Year,Letterboxd URI,Rating\n${RatingDate},${ShawshankTitle},1994,https://boxd.it/2aHi,4.5`
  };
}

function BuildWatchedImport() {
  return {
    name: "watched.csv",
    text: `Date,Name,Year,Letterboxd URI\n2026-06-30,${ShawshankTitle},1994,https://boxd.it/2aHi`
  };
}

function BuildWatchlistImport() {
  return {
    name: "watchlist.csv",
    text: `Date,Name,Year,Letterboxd URI\n2026-07-02,${DarkKnightTitle},2008,https://boxd.it/2b0k`
  };
}

function AssertImportedState(state) {
  assert.equal(state.items.length, 2);
  const shawshank = state.items.find((item) => item.ttId === ShawshankId);
  assert.equal(shawshank.rating, 9);
  assert.equal(shawshank.watched, true);
  assert.equal(shawshank.watchedAt, "2026-06-30");
  const darkKnight = state.items.find((item) => item.ttId === DarkKnightId);
  assert.equal(darkKnight.watchlist, true);
  assert.equal(darkKnight.watched, false);
}

function VerifyCollectionReconciliation() {
  const ratings = {
    [DarkKnightId]: ImdbRecord(DarkKnightId, DarkKnightTitle, 2008, 8),
    [MementoId]: ImdbRecord(MementoId, MementoTitle, 2000, 9),
    [InceptionId]: ImdbRecord(InceptionId, InceptionTitle, 2010, 9)
  };
  const plan = ReconcileCollections(ratings, BuildLetterboxdState());
  AssertReconciliationPlan(plan);
}

function BuildLetterboxdState() {
  return { items: [
    LetterboxdRecord(ShawshankId, ShawshankTitle, 1994, 10),
    LetterboxdRecord(MementoId, MementoTitle, 2000, 9),
    LetterboxdRecord(InceptionId, InceptionTitle, 2010, 8),
    LetterboxdRecord("", "Unmatched Film", 2026, 7),
    { ...LetterboxdRecord("tt9999999", "Watched Only", 2025, null), watched: true }
  ] };
}

function AssertReconciliationPlan(plan) {
  assert.equal(plan.matched, 1);
  assert.deepEqual(plan.toImdb.map((entry) => entry.item.ttId), [ShawshankId]);
  assert.deepEqual(plan.toLetterboxd.map((record) => record.ttId), [DarkKnightId]);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.watchedOnly.length, 1);
}

function VerifyLetterboxdOutput() {
  const records = Array.from({ length: 8 }, (_, index) => ImdbRecord(`tt${String(index + 1).padStart(7, "0")}`, `A deliberately long movie title ${index}`, 2000 + index, index + 1));
  const files = BuildLetterboxdCsvFiles(records, 180);
  assert.ok(files.length > 1);
  for (const file of files) {
    assert.match(file.content, /^imdbID,Title,Year,Rating10,WatchedDate/);
    assert.ok(new TextEncoder().encode(file.content).byteLength <= 180);
  }
  assert.match(files[0].content, /tt0000001,A deliberately long movie title 0,2000,1,2026-07-01/);
}

function VerifyLetterboxdPayload() {
  const state = BuildState();
  state.letterboxd = BuildStoredLetterboxdState();
  const payload = BuildStoragePayload(state);
  assert.equal(payload.letterboxd.items.length, 1);
  assert.equal(payload.letterboxd.sourceName, ExportArchiveName);
}

function BuildStoredLetterboxdState() {
  return {
    sourceName: ExportArchiveName, importedAt: "2026-07-16T00:00:00.000Z",
    files: [RatingsFileName], importedRows: 1,
    items: [LetterboxdRecord(ShawshankId, ShawshankTitle, 1994, 10)]
  };
}

function VerifyLetterboxdArchive() {
  const sourceEntries = {
    [LetterboxdRatingsPath]: strToU8(`Date,Name,Year,Rating\n${RatingDate},${MementoTitle},2000,4.5`),
    "letterboxd/readme.txt": strToU8("ignored")
  };
  const source = zipSync(sourceEntries);
  const files = ReadLetterboxdArchive(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), { unzipSync, strFromU8 });
  assert.deepEqual(files.map((file) => file.name), [LetterboxdRatingsPath]);
  const download = BuildLetterboxdArchive(BuildSyncFiles(), { zipSync, strToU8 });
  const roundTrip = unzipSync(download.content);
  assert.equal(strFromU8(roundTrip[SyncFileName]), SyncFileText);
  assert.equal(download.type, "application/zip");
}

function BuildSyncFiles() {
  return [
    { name: SyncFileName, content: SyncFileText },
    { name: "sync-02.csv", content: `imdbID,Rating10\n${DarkKnightId},10` }
  ];
}

function ImdbRecord(ttId, title, year, rating) {
  return {
    ttId,
    title,
    year,
    rating,
    status: ImportedStatus,
    submitStatus: ImportedStatus,
    at: RatingDate
  };
}

function LetterboxdRecord(ttId, title, year, rating) {
  return { ttId, title, year, rating, watched: true, watchedAt: RatingDate, ratedAt: RatingDate };
}
