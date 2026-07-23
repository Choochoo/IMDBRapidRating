import assert from "node:assert/strict";
import test from "node:test";
import { CatalogViewFeature } from "../src/app/features/catalog-view.js";

const TitleId = "tt999999996";

test("refreshing streaming metadata schedules a bounded follow-up request", VerifyStreamingRefreshSchedule);
test("streaming metadata schedules only one pending timer per title", VerifySingleStreamingRefreshTimer);
test("streaming metadata does not schedule while a request is in flight", VerifySingleStreamingRefreshRequest);
test("streaming metadata clears its refreshing state after retry exhaustion", VerifyStreamingRefreshExhaustion);
test("late streaming responses are ignored after fresher metadata arrives", VerifyLateStreamingResponseIgnored);
test("streaming follow-up responses are applied to the visible title", VerifyStreamingRefreshApplication);
test("rate cards defer streaming provider requests to the watchlist", VerifyRaterStreamingDeferred);

function VerifyStreamingRefreshSchedule() {
  const calls = [];
  const feature = BuildStreamingRefreshFeature(calls);
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, TitleId, { stale: true, refreshing: true });
  assert.deepEqual(calls, [{ ttId: TitleId, delay: 750 }]);
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, TitleId, { stale: true, refreshing: false });
  assert.equal(calls.length, 1);
}

function VerifySingleStreamingRefreshTimer() {
  const calls = [];
  const feature = BuildStreamingRefreshFeature(calls);
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, `${TitleId}1`, { refreshing: true });
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, `${TitleId}1`, { refreshing: true });
  assert.equal(calls.length, 1);
  CatalogViewFeature.prototype.ClearStreamingRefresh.call(feature, `${TitleId}1`);
}

function VerifySingleStreamingRefreshRequest() {
  const calls = [];
  const feature = BuildStreamingRefreshFeature(calls, () => {});
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, `${TitleId}3`, { refreshing: true });
  CatalogViewFeature.prototype.BeginStreamingRefresh.call(feature, `${TitleId}3`);
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, `${TitleId}3`, { refreshing: true });
  assert.equal(calls.length, 1);
  CatalogViewFeature.prototype.ClearStreamingRefresh.call(feature, `${TitleId}3`);
}

function VerifyStreamingRefreshExhaustion() {
  const calls = [];
  const feature = BuildStreamingRefreshFeature(calls, CompleteStreamingRefreshRequest);
  const availability = { refreshing: true };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, `${TitleId}2`, availability);
    CatalogViewFeature.prototype.BeginStreamingRefresh.call(feature, `${TitleId}2`);
  }
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, `${TitleId}2`, availability);
  assert.equal(availability.refreshing, false);
  assert.equal(calls.length, 4);
}

async function VerifyLateStreamingResponseIgnored() {
  const gate = CreateDeferred();
  const state = { metadata: {}, applied: false };
  const feature = BuildAsyncStreamingRefreshFeature(state, gate);
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, `${TitleId}4`, { refreshing: true });
  const refresh = CatalogViewFeature.prototype.BeginStreamingRefresh.call(feature, `${TitleId}4`);
  CatalogViewFeature.prototype.ScheduleStreamingRefresh.call(feature, `${TitleId}4`, { refreshing: false });
  gate.resolve({ streamingAvailability: { refreshing: true } });
  await refresh;
  assert.equal(state.applied, false);
}

function BuildStreamingRefreshFeature(calls, refresh = CompleteStreamingRefreshRequest) {
  return {
    ClearStreamingRefresh: CatalogViewFeature.prototype.ClearStreamingRefresh,
    StopStreamingRefresh: CatalogViewFeature.prototype.StopStreamingRefresh,
    QueueStreamingRefresh: (ttId, delay) => {
      calls.push({ ttId, delay });
      return {};
    },
    RefreshStreamingMetadata: refresh
  };
}

function CompleteStreamingRefreshRequest(_ttId, state) {
  state.inFlight = false;
}

function BuildAsyncStreamingRefreshFeature(state, gate) {
  const feature = {
    State: state,
    FetchTitleMetadata: () => gate.promise,
    ApplyTitleMetadata: () => { state.applied = true; },
    QueueStreamingRefresh: () => ({})
  };
  feature.ClearStreamingRefresh = CatalogViewFeature.prototype.ClearStreamingRefresh;
  feature.StopFailedStreamingRefresh = CatalogViewFeature.prototype.StopFailedStreamingRefresh;
  feature.RefreshStreamingMetadata = CatalogViewFeature.prototype.RefreshStreamingMetadata;
  return feature;
}

function CreateDeferred() {
  const deferred = {};
  deferred.promise = new Promise((resolve) => { deferred.resolve = resolve; });
  return deferred;
}

async function VerifyStreamingRefreshApplication() {
  const metadata = { streamingAvailability: { stale: false, refreshing: false } };
  const state = { applied: null };
  const feature = { FetchTitleMetadata: async () => metadata, ApplyTitleMetadata: (ttId, value) => { state.applied = { ttId, value }; } };
  await CatalogViewFeature.prototype.RefreshStreamingMetadata.call(feature, TitleId);
  assert.deepEqual(state.applied, { ttId: TitleId, value: metadata });
}

function VerifyRaterStreamingDeferred() {
  const calls = [];
  const feature = { EnrichTitleMetadata: (...parameters) => calls.push(parameters) };
  CatalogViewFeature.prototype.EnrichVisibleMovies.call(feature, [{ ttId: TitleId }]);
  assert.deepEqual(calls, [[TitleId]]);
}
