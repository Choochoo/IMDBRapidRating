export const AcceptedAnalyticsConsent = "accepted";
export const AnalyticsConsentPolicyVersion = "2026-07-23";
export const AnalyticsConsentStorageKey = "imdb-rapid-rater-analytics-consent-v1";
export const DeclinedAnalyticsConsent = "declined";
export const UnknownAnalyticsConsent = "unknown";

const AnalyticsConsentChoices = new Set([AcceptedAnalyticsConsent, DeclinedAnalyticsConsent]);
const UnknownAnalyticsConsentRecord = Object.freeze({ choice: UnknownAnalyticsConsent, decidedAt: "", policyVersion: AnalyticsConsentPolicyVersion });

export function ReadAnalyticsConsent(storage = window.localStorage) {
  try {
    return ParseAnalyticsConsent(storage.getItem(AnalyticsConsentStorageKey));
  } catch {
    return UnknownAnalyticsConsentRecord;
  }
}

export function WriteAnalyticsConsent(choice, storage = window.localStorage, decidedAt = new Date().toISOString()) {
  const record = BuildAnalyticsConsentRecord(choice, decidedAt);
  try {
    storage.setItem(AnalyticsConsentStorageKey, JSON.stringify(record));
  } catch {
    return record;
  }
  return record;
}

function BuildAnalyticsConsentRecord(choice, decidedAt) {
  const normalized = AnalyticsConsentChoices.has(choice) ? choice : DeclinedAnalyticsConsent;
  return Object.freeze({ choice: normalized, decidedAt, policyVersion: AnalyticsConsentPolicyVersion });
}

function ParseAnalyticsConsent(value) {
  if (!value)
    return UnknownAnalyticsConsentRecord;
  try {
    const record = JSON.parse(value);
    const currentPolicy = record?.policyVersion === AnalyticsConsentPolicyVersion;
    return currentPolicy && AnalyticsConsentChoices.has(record.choice) ? Object.freeze(record) : UnknownAnalyticsConsentRecord;
  } catch {
    return UnknownAnalyticsConsentRecord;
  }
}
