import assert from "node:assert/strict";
import test from "node:test";
import { AcceptedAnalyticsConsent, AnalyticsConsentPolicyVersion, AnalyticsConsentStorageKey, DeclinedAnalyticsConsent, ReadAnalyticsConsent, UnknownAnalyticsConsent, WriteAnalyticsConsent } from "../src/app/analytics-consent.js";

const AcceptedAt = "2026-07-23T18:00:00.000Z";

test("analytics consent starts unknown and persists an explicit choice", VerifyConsentPersistence);
test("analytics consent rejects stale, malformed, and unsupported records", VerifyInvalidConsentRecords);

function VerifyConsentPersistence() {
  const storage = BuildStorage();
  assert.equal(ReadAnalyticsConsent(storage).choice, UnknownAnalyticsConsent);
  const accepted = WriteAnalyticsConsent(AcceptedAnalyticsConsent, storage, AcceptedAt);
  assert.deepEqual(accepted, { choice: AcceptedAnalyticsConsent, decidedAt: AcceptedAt, policyVersion: AnalyticsConsentPolicyVersion });
  assert.deepEqual(ReadAnalyticsConsent(storage), accepted);
  assert.equal(JSON.parse(storage.Read()).choice, AcceptedAnalyticsConsent);
}

function VerifyInvalidConsentRecords() {
  const stale = BuildStorage(JSON.stringify({ choice: AcceptedAnalyticsConsent, policyVersion: "old" }));
  const malformed = BuildStorage("{");
  const unsupported = BuildStorage(JSON.stringify({ choice: "maybe", policyVersion: AnalyticsConsentPolicyVersion }));
  assert.equal(ReadAnalyticsConsent(stale).choice, UnknownAnalyticsConsent);
  assert.equal(ReadAnalyticsConsent(malformed).choice, UnknownAnalyticsConsent);
  assert.equal(ReadAnalyticsConsent(unsupported).choice, UnknownAnalyticsConsent);
  assert.equal(WriteAnalyticsConsent("maybe", BuildStorage()).choice, DeclinedAnalyticsConsent);
}

function BuildStorage(initialValue = "") {
  let value = initialValue;
  return {
    getItem: (key) => key === AnalyticsConsentStorageKey ? value : null,
    setItem: (key, nextValue) => {
      if (key === AnalyticsConsentStorageKey)
        value = nextValue;
    },
    Read: () => value
  };
}
