const DisabledAnalyticsConfig = Object.freeze({ enabled: false, token: "", host: "" });
const EnabledValue = "true";
const HttpProtocol = "http:";
const HttpsProtocol = "https:";

export function ReadPublicAnalyticsConfig(environment = process.env) {
  const enabled = String(environment.POSTHOG_ENABLED || "").trim().toLowerCase() === EnabledValue;
  if (!enabled)
    return DisabledAnalyticsConfig;
  const token = String(environment.POSTHOG_PROJECT_TOKEN || "").trim();
  const host = NormalizeAnalyticsHost(environment.POSTHOG_HOST);
  if (!token)
    throw new Error("POSTHOG_PROJECT_TOKEN is required when PostHog analytics are enabled.");
  if (!host)
    throw new Error("POSTHOG_HOST must be an HTTP or HTTPS URL when PostHog analytics are enabled.");
  return Object.freeze({ enabled: true, token, host });
}

export function ReadAnalyticsOrigin(config) {
  if (!config?.enabled)
    return "";
  return new URL(config.host).origin;
}

function NormalizeAnalyticsHost(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (![HttpProtocol, HttpsProtocol].includes(url.protocol))
      return "";
    if (url.username || url.password)
      return "";
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}
