import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BuildAnalyticsOptions } from "../src/app/analytics-client.js";

const AnalyticsHost = "https://us.i.posthog.com";

test("PostHog starts with privacy-sensitive collection disabled", VerifyPrivateAnalyticsOptions);
test("PostHog relies on one automatic initial pageview", VerifySingleInitialPageview);

function VerifyPrivateAnalyticsOptions() {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { protocol: "https:" } };
  try {
    const options = BuildAnalyticsOptions(AnalyticsHost);
    assert.deepEqual(ReadPrivacyOptions(options), ExpectedPrivacyOptions());
  } finally {
    globalThis.window = previousWindow;
  }
}

function ReadPrivacyOptions(options) {
  const names = Object.keys(ExpectedPrivacyOptions());
  return Object.fromEntries(names.map((name) => [name, options[name]]));
}

function ExpectedPrivacyOptions() {
  return { api_host: AnalyticsHost, autocapture: false, disable_external_dependency_loading: true, disable_session_recording: true, opt_out_capturing_by_default: true, opt_out_persistence_by_default: true, secure_cookie: true };
}

async function VerifySingleInitialPageview() {
  const source = await readFile("src/app/analytics-client.js", "utf8");
  assert.match(source, /capture_pageview: "history_change"/);
  assert.doesNotMatch(source, /\.capture\("\\$pageview"\)/);
}
