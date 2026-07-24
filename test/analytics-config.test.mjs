import assert from "node:assert/strict";
import test from "node:test";
import { ReadAnalyticsOrigin, ReadPublicAnalyticsConfig } from "../server/analytics-config.mjs";

const AnalyticsHost = "https://us.i.posthog.com";
const AnalyticsToken = "phc_public_project_token";
const EnabledValue = "true";

test("analytics configuration is disabled unless explicitly enabled", VerifyDisabledAnalytics);
test("enabled analytics exposes only the public token and normalized host", VerifyEnabledAnalytics);
test("enabled analytics rejects incomplete or unsafe configuration", VerifyInvalidAnalytics);

function VerifyDisabledAnalytics() {
  const config = ReadPublicAnalyticsConfig({});
  assert.deepEqual(config, { enabled: false, token: "", host: "" });
  assert.equal(ReadAnalyticsOrigin(config), "");
}

function VerifyEnabledAnalytics() {
  const environment = { POSTHOG_ENABLED: EnabledValue, POSTHOG_PROJECT_TOKEN: AnalyticsToken, POSTHOG_HOST: `${AnalyticsHost}/` };
  const config = ReadPublicAnalyticsConfig(environment);
  assert.deepEqual(config, { enabled: true, token: AnalyticsToken, host: AnalyticsHost });
  assert.equal(ReadAnalyticsOrigin(config), AnalyticsHost);
}

function VerifyInvalidAnalytics() {
  assert.throws(() => ReadPublicAnalyticsConfig({ POSTHOG_ENABLED: EnabledValue, POSTHOG_HOST: AnalyticsHost }));
  assert.throws(() => ReadPublicAnalyticsConfig({ POSTHOG_ENABLED: EnabledValue, POSTHOG_PROJECT_TOKEN: AnalyticsToken, POSTHOG_HOST: "javascript:alert(1)" }));
  assert.throws(() => ReadPublicAnalyticsConfig({ POSTHOG_ENABLED: EnabledValue, POSTHOG_PROJECT_TOKEN: AnalyticsToken, POSTHOG_HOST: "https://user:secret@posthog.example" }));
}
