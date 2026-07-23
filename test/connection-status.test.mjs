import assert from "node:assert/strict";
import test from "node:test";
import { EventBindingsFeature } from "../src/app/features/event-bindings.js";
import { StatusUiFeature } from "../src/app/features/status-ui.js";

const AccountRefreshCall = "account";
const LiveRefreshCall = "live";

test("durable queue failures remain visible when another failure status is absent", VerifyPartialQueueCounts);
test("opening connections refreshes the account queue and live service status", VerifyConnectionMenuRefresh);
test("connection circle is gray while service checks are incomplete", VerifyCheckingStatus);
test("connection circle is red when no services are connected", VerifyDisconnectedStatus);
test("connection circle is yellow when some services are connected", VerifyPartialStatus);
test("connection circle is green when every service is connected", VerifyConnectedStatus);

function VerifyCheckingStatus() {
  const feature = BuildFeature({ liveChecked: false, aiChecked: false, imdbConfigured: false, aiConfigured: false });
  assert.equal(feature.BuildConnectionSummaryStatus().tone, "checking");
}

function VerifyDisconnectedStatus() {
  const feature = BuildFeature({ liveChecked: true, aiChecked: true, imdbConfigured: false, aiConfigured: false });
  const status = feature.BuildConnectionSummaryStatus();
  assert.equal(status.tone, "issue");
  assert.equal(status.text, "0 of 2 connected");
  assert.match(status.tooltip, /IMDb, AI/);
}

function VerifyPartialStatus() {
  const feature = BuildFeature({ liveChecked: true, aiChecked: true, imdbConfigured: true, aiConfigured: false });
  const status = feature.BuildConnectionSummaryStatus();
  assert.equal(status.tone, "attention");
  assert.equal(status.text, "1 of 2 connected");
  assert.match(status.tooltip, /Missing: AI/);
}

function VerifyConnectedStatus() {
  const feature = BuildFeature({ liveChecked: true, aiChecked: true, imdbConfigured: true, aiConfigured: true });
  const status = feature.BuildConnectionSummaryStatus();
  assert.equal(status.tone, "ready");
  assert.equal(status.text, "2 of 2 connected");
}

function BuildFeature(options) {
  const feature = Object.create(StatusUiFeature.prototype);
  feature.State = { live: { checked: options.liveChecked, configured: options.imdbConfigured }, ai: { checked: options.aiChecked, configured: options.aiConfigured } };
  return feature;
}

function VerifyPartialQueueCounts() {
  const feature = Object.create(StatusUiFeature.prototype);
  feature.State = { live: { queueCounts: { failed: 3 } } };
  const counts = feature.BuildDisplayedRatingCounts({ pending: 0, failed: 0, retryableImdb: 0 });
  assert.equal(counts.failed, 3);
  assert.equal(counts.retryableImdb, 3);
}

async function VerifyConnectionMenuRefresh() {
  const calls = [];
  const feature = BuildConnectionMenuFeature(calls);
  const menus = [feature.Elements.quickRateMenu, feature.Elements.dataMenu, feature.Elements.connectionMenu];
  feature.HandleHeaderToggle(feature.Elements.connectionMenu, menus);
  await Promise.resolve();
  assert.deepEqual(calls.sort(), [AccountRefreshCall, LiveRefreshCall]);
  assert.equal(feature.Elements.quickRateMenu.open, false);
  assert.equal(feature.Elements.dataMenu.open, false);
}

function BuildConnectionMenuFeature(calls) {
  const feature = Object.create(EventBindingsFeature.prototype);
  feature.User = { email: "user@example.com" };
  feature.Elements = { quickRateMenu: { open: true }, dataMenu: { open: true }, connectionMenu: { open: true } };
  feature.RefreshAccountStateFromServer = async () => calls.push(AccountRefreshCall);
  feature.RefreshLiveStatus = async () => calls.push(LiveRefreshCall);
  return feature;
}
