import assert from "node:assert/strict";
import test from "node:test";
import { MergeAccountPayload } from "../src/app/account-state-merge.js";
import { RapidRaterApp } from "../src/app/rapid-rater-app.js";

test("account conflicts preserve ratings made on both devices", () => {
  const remote = {
    ratings: {
      tt0000001: Record("tt0000001", 7, "2026-07-16T10:00:00.000Z")
    },
    queueIds: ["tt0000002", "tt0000003"]
  };
  const local = {
    ratings: {
      tt0000002: Record("tt0000002", 8, "2026-07-16T11:00:00.000Z")
    },
    queueIds: ["tt0000001", "tt0000003"]
  };

  const merged = MergeAccountPayload(remote, local);
  assert.deepEqual(Object.keys(merged.ratings).sort(), ["tt0000001", "tt0000002"]);
  assert.equal(merged.queueIds, undefined);
});

test("newest decision for the same IMDb title wins during a device conflict", () => {
  const merged = MergeAccountPayload({
    ratings: { tt0074279: Record("tt0074279", 6, "2026-07-16T10:00:00.000Z") }
  }, {
    ratings: { tt0074279: NotSeen("tt0074279", "2026-07-16T12:00:00.000Z") }
  });

  assert.equal(merged.ratings.tt0074279.status, "notSeen");
  assert.equal(merged.ratings.tt0074279.rating, null);
});

test("device conflicts retain recommendation exclusions and the newest Letterboxd import", () => {
  const merged = MergeAccountPayload({
    recommendationExclusions: [{ ttId: "tt0000001", title: "Remote", at: "2026-07-16T10:00:00.000Z" }],
    letterboxd: { sourceName: "new.zip", importedAt: "2026-07-16T12:00:00.000Z", items: [{ ttId: "tt1" }] }
  }, {
    recommendationExclusions: [{ ttId: "tt0000002", title: "Local", at: "2026-07-16T11:00:00.000Z" }],
    letterboxd: { sourceName: "old.zip", importedAt: "2026-07-16T09:00:00.000Z", items: [] }
  });

  assert.equal(merged.recommendationExclusions.length, 2);
  assert.equal(merged.letterboxd.sourceName, "new.zip");
});

test("account sync merges a stale device snapshot and retries with the current revision", async () => {
  const requests = [];
  const app = Object.create(RapidRaterApp.prototype);
  Object.assign(app, {
    AccountPayload: { ratings: { tt0000002: Record("tt0000002", 8, "2026-07-16T11:00:00.000Z") } },
    AccountRevision: 4,
    RatingsCsvText: "",
    State: {},
    applied: null,
    toast: "",
    ApplyMergedAccountPayload(payload) { this.applied = payload; },
    ShowToast(message) { this.toast = message; },
    async RequestJson(_url, _method, body) {
      requests.push(body);
      if (requests.length === 1) {
        const error = new Error("Your account changed in another browser.");
        error.status = 409;
        error.payload = {
          current: {
            revision: 5,
            ratings_csv: "Const,Your Rating\ntt0000001,7",
            payload: { ratings: { tt0000001: Record("tt0000001", 7, "2026-07-16T10:00:00.000Z") } }
          }
        };
        throw error;
      }
      return { ok: true, revision: 6 };
    }
  });

  await app.PerformStateSync();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].revision, 4);
  assert.equal(requests[1].revision, 5);
  assert.deepEqual(Object.keys(requests[1].payload.ratings).sort(), ["tt0000001", "tt0000002"]);
  assert.equal(app.AccountRevision, 6);
  assert.match(app.toast, /combined and saved/i);
});

test("an idle device refreshes its queue when another device saves", async () => {
  const remotePayload = { ratings: { tt0000003: Record("tt0000003", 9, "2026-07-16T12:00:00.000Z") } };
  const app = Object.create(RapidRaterApp.prototype);
  Object.assign(app, {
    User: { email: "jared@example.com" },
    StateDirty: false,
    AccountRevision: 7,
    AccountPayload: { ratings: {} },
    RatingsCsvText: "",
    applied: null,
    toast: "",
    async FetchJson() {
      return { revision: 8, payload: remotePayload, ratingsCsv: "Const,Your Rating\ntt0000003,9" };
    },
    ApplyMergedAccountPayload(payload) { this.applied = payload; },
    ShowToast(message) { this.toast = message; }
  });

  const changed = await app.RefreshAccountStateFromServer();

  assert.equal(changed, true);
  assert.equal(app.AccountRevision, 8);
  assert.equal(app.applied.ratings.tt0000003.rating, 9);
  assert.match(app.toast, /other device/i);
});

function Record(ttId, rating, at) {
  return { ttId, status: "rated", rating, at, submitStatus: "submitted", submittedAt: at };
}

function NotSeen(ttId, at) {
  return { ttId, status: "notSeen", rating: null, at, submitStatus: "skipped", submittedAt: "" };
}
