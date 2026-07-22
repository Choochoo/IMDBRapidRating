import assert from "node:assert/strict";
import test from "node:test";
import { CatalogViewFeature } from "../src/app/features/catalog-view.js";

const TitleId = "tt999999996";

test("refreshing streaming metadata schedules a bounded follow-up request", VerifyStreamingRefreshSchedule);
test("streaming follow-up responses are applied to the visible title", VerifyStreamingRefreshApplication);

function VerifyStreamingRefreshSchedule() {
  const calls = [];
  const feature = { QueueStreamingRefresh: (ttId, delay) => calls.push({ ttId, delay }) };
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, TitleId, { stale: true, refreshing: true });
  assert.deepEqual(calls, [{ ttId: TitleId, delay: 750 }]);
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, TitleId, { stale: true, refreshing: false });
  assert.equal(calls.length, 1);
}

async function VerifyStreamingRefreshApplication() {
  const metadata = { streamingAvailability: { stale: false, refreshing: false } };
  const state = { applied: null };
  const feature = { FetchTitleMetadata: async () => metadata, ApplyTitleMetadata: (ttId, value) => { state.applied = { ttId, value }; } };
  await CatalogViewFeature.prototype.RefreshStreamingMetadata.call(feature, TitleId);
  assert.deepEqual(state.applied, { ttId: TitleId, value: metadata });
}
