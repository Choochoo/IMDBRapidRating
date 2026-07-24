export const AnalyticsConsentMarkup = `
  <section class="analytics-consent card" id="analytics-consent" role="dialog" aria-modal="false" aria-labelledby="analytics-consent-title" hidden>
    <div class="analytics-consent-heading">
      <div>
        <span>Privacy choice</span>
        <h2 id="analytics-consent-title">Help improve Rapid Rater?</h2>
      </div>
      <button type="button" class="analytics-consent-close btn btn-sm btn-outline-secondary" id="analytics-consent-close" hidden>Close</button>
    </div>
    <p>Rapid Rater always uses one necessary session cookie for sign-in and security. With your permission, optional PostHog analytics will tell us which features are useful.</p>
    <details class="analytics-consent-details">
      <summary>What would be stored and collected?</summary>
      <p><strong>Necessary:</strong> a first-party, rolling 30-day session cookie used for authentication and CSRF protection.</p>
      <p><strong>Optional analytics:</strong> a PostHog cookie and local storage used for page views and a small set of feature events. We do not send emails, movie titles, credentials, friend identities, or form text.</p>
    </details>
    <div class="analytics-consent-actions">
      <button type="button" class="btn btn-outline-primary" id="analytics-consent-decline">Use necessary only</button>
      <button type="button" class="btn btn-outline-primary" id="analytics-consent-accept">Allow analytics</button>
    </div>
  </section>`;

export function BuildAnalyticsConsentElements(root) {
  return {
    prompt: root.querySelector("#analytics-consent"),
    close: root.querySelector("#analytics-consent-close"),
    accept: root.querySelector("#analytics-consent-accept"),
    decline: root.querySelector("#analytics-consent-decline")
  };
}
