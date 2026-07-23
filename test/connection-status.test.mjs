import assert from "node:assert/strict";
import test from "node:test";
import { StatusUiFeature } from "../src/app/features/status-ui.js";

test("durable queue failures remain visible when another failure status is absent", VerifyPartialQueueCounts);

test("connection circle is gray while service checks are incomplete", () => {
  const feature = BuildFeature(false, false, false, false, false);
  assert.equal(feature.BuildConnectionSummaryStatus().tone, "checking");
});

test("connection circle is red when no services are connected", () => {
  const feature = BuildFeature(true, true, false, false, false);
  const status = feature.BuildConnectionSummaryStatus();
  assert.equal(status.tone, "issue");
  assert.equal(status.text, "0 of 3 connected");
  assert.match(status.tooltip, /IMDb, TMDB, OpenAI/);
});

test("connection circle is yellow when some services are connected", () => {
  const feature = BuildFeature(true, true, true, false, true);
  const status = feature.BuildConnectionSummaryStatus();
  assert.equal(status.tone, "attention");
  assert.equal(status.text, "2 of 3 connected");
  assert.match(status.tooltip, /Missing: TMDB/);
});

test("connection circle is green when every service is connected", () => {
  const feature = BuildFeature(true, true, true, true, true);
  const status = feature.BuildConnectionSummaryStatus();
  assert.equal(status.tone, "ready");
  assert.equal(status.text, "3 of 3 connected");
});

function BuildFeature(liveChecked, aiChecked, imdb, tmdb, openAi) {
  const feature = Object.create(StatusUiFeature.prototype);
  feature.State = { live: { checked: liveChecked, configured: imdb, tmdbConfigured: tmdb }, ai: { checked: aiChecked, configured: openAi } };
  return feature;
}

function VerifyPartialQueueCounts() {
  const feature = Object.create(StatusUiFeature.prototype);
  feature.State = { live: { queueCounts: { failed: 3 } } };
  const counts = feature.BuildDisplayedRatingCounts({ pending: 0, failed: 0, retryableImdb: 0 });
  assert.equal(counts.failed, 3);
  assert.equal(counts.retryableImdb, 3);
}
