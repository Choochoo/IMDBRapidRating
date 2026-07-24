import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsFeature } from "../src/app/features/analytics.js";

test("authentication tracking waits for analytics startup", VerifyAuthenticationTrackingWaits);

async function VerifyAuthenticationTrackingWaits() {
  let releaseStart;
  let completed = false;
  const feature = BuildAnalyticsFeature(() => new Promise((resolve) => releaseStart = resolve));
  const tracking = AnalyticsFeature.prototype.TrackAuthentication.call(feature, "login").then(() => completed = true);
  await Promise.resolve();
  assert.equal(completed, false);
  releaseStart();
  await tracking;
  assert.equal(completed, true);
}

function BuildAnalyticsFeature(startConfiguredAnalytics) {
  return { StartConfiguredAnalytics: startConfiguredAnalytics, User: { id: "user-id" } };
}
