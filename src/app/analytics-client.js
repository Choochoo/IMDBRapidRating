const AnalyticsOptions = Object.freeze({
  defaults: "2026-05-30",
  autocapture: false,
  capture_pageview: "history_change",
  capture_pageleave: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_heatmaps: false,
  capture_performance: false,
  disable_external_dependency_loading: true,
  disable_session_recording: true,
  disable_surveys: true,
  advanced_disable_flags: true,
  opt_out_capturing_by_default: true,
  opt_out_persistence_by_default: true,
  persistence: "localStorage+cookie",
  person_profiles: "identified_only",
  cross_subdomain_cookie: false,
  cookie_expiration: 180,
  respect_dnt: true,
  save_campaign_params: false,
  save_referrer: false,
  mask_all_text: true,
  mask_all_element_attributes: true,
  before_send: SanitizeAnalyticsEvent
});

let AnalyticsClient = null;
let AnalyticsStartPromise = null;

export async function StartAnalytics(config, userId = "") {
  if (AnalyticsClient)
    return AnalyticsClient;
  if (!AnalyticsStartPromise)
    AnalyticsStartPromise = LoadAnalytics(config, userId).catch(HandleAnalyticsStartFailure);
  return await AnalyticsStartPromise;
}

export function StopAnalytics() {
  const client = AnalyticsClient;
  AnalyticsClient = null;
  AnalyticsStartPromise = null;
  if (!client)
    return;
  client.stopSessionRecording();
  client.reset(true);
  client.opt_out_capturing();
}

export function CaptureAnalytics(eventName, properties = {}) {
  if (!AnalyticsClient || AnalyticsClient.has_opted_out_capturing())
    return;
  AnalyticsClient.capture(eventName, properties);
}

export function IdentifyAnalyticsUser(userId) {
  if (!AnalyticsClient || !userId)
    return;
  AnalyticsClient.identify(String(userId));
}

export function ResetAnalyticsUser() {
  if (AnalyticsClient)
    AnalyticsClient.reset(true);
}

export function BuildAnalyticsOptions(host) {
  const secureCookie = window.location.protocol === "https:";
  return { ...AnalyticsOptions, api_host: host, secure_cookie: secureCookie };
}

async function LoadAnalytics(config, userId) {
  const module = await import("posthog-js");
  const client = module.default;
  client.init(config.token, BuildAnalyticsOptions(config.host));
  client.opt_in_capturing();
  AnalyticsClient = client;
  IdentifyAnalyticsUser(userId);
  return client;
}

function HandleAnalyticsStartFailure(error) {
  AnalyticsStartPromise = null;
  throw error;
}

function SanitizeAnalyticsEvent(event) {
  if (!event?.properties)
    return event;
  event.properties.$current_url = `${window.location.origin}${window.location.pathname}`;
  delete event.properties.$referrer;
  delete event.properties.$initial_referrer;
  return event;
}
