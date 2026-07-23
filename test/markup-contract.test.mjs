import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TextEncoding = "utf8";
const HtmlPath = "index.html";
const FoundationCssPath = "src/styles/foundation.css";
const ResponsiveCssPath = "src/styles/responsive.css";

test("every browser element lookup exists in the HTML shell", VerifyElementLookups);
test("rating controls start hidden without competing display utilities", VerifyHiddenRatingControls);
test("quick rating and connection controls expose their accessible contracts", VerifyHeaderControlContracts);
test("signed-in header controls compact before they can overlap", VerifyResponsiveHeaderContract);
test("data credits retain required attribution and the rating footer is desktop-only", VerifyDataCredits);
test("watchlist filters and sync directions use compact expandable contracts", VerifyCompactWorkflowContracts);
test("desktop rating actions are visible and keyboard shortcuts are explained", VerifyDesktopRatingContracts);
test("settings provide dynamic keyboard and connection sections", VerifySettingsContract);
test("viewing region replaces per-user TMDB credentials", VerifyViewingRegionContract);
test("AI setup is a dedicated provider-neutral model-discovery page", VerifyAiSetupContract);
test("signup and legacy accounts expose a permanent one-time username choice", VerifyUsernameContract);
test("startup loading prevents the sign-in screen from flashing during session restoration", VerifyStartupLoadingContract);

async function VerifyElementLookups() {
  const [source, html] = await Promise.all([readFile("src/app/elements.js", TextEncoding), readFile(HtmlPath, TextEncoding)]);
  const ids = [...source.matchAll(/Element\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
}

async function VerifyHiddenRatingControls() {
  const html = await readFile(HtmlPath, TextEncoding);
  const footer = html.match(/<footer\b[^>]*id="rating-footer"[^>]*>/)?.[0] || "";
  const mobileBar = html.match(/<nav\b[^>]*id="mobile-rating-bar"[^>]*>/)?.[0] || "";
  assert.match(html, /<body>/);
  assert.match(footer, /\shidden(?:\s|>)/);
  assert.match(mobileBar, /\shidden(?:\s|>)/);
  assert.doesNotMatch(footer, /\bd-(?:none|md-grid|md-none)\b/);
  assert.doesNotMatch(mobileBar, /\bd-(?:none|md-grid|md-none)\b/);
}

async function VerifyDataCredits() {
  const [html, responsiveCss] = await Promise.all([readFile(HtmlPath, TextEncoding), readFile(ResponsiveCssPath, TextEncoding)]);
  assert.match(html, /<section class="data-credits"/);
  assert.match(html, /src="\/src\/assets\/tmdb-logo\.svg"/);
  assert.match(html, /This product uses the TMDB API but is not endorsed or certified by TMDB\./);
  assert.match(html, /Streaming availability is provided by JustWatch through TMDB\./);
  assert.match(responsiveCss, /@media \(max-width: 720px\)[\s\S]*?\.footer \{\s*display: none;/);
}

async function VerifyHeaderControlContracts() {
  const html = await readFile(HtmlPath, TextEncoding);
  assert.match(html, /id="quick-rate-search"[^>]*role="combobox"[^>]*aria-controls="quick-rate-results"/);
  assert.match(html, /id="quick-rate-rating"[^>]*min="1"[^>]*max="10"/);
  assert.match(html, /id="quick-rate-submit"[^>]*disabled>Rate here and on IMDb/);
  assert.match(html, /id="configure-filters"[^>]*aria-label="Filter ratings and recommendations"/);
  assert.match(html, /class="connection-icon"[^>]*data-lucide="plug"[^>]*aria-hidden="true"/);
  assert.match(html, /id="connection-summary-label"[^>]*>Checking connections/);
  assert.doesNotMatch(html, /mobile-header-toggle|Show progress/);
}

async function VerifyResponsiveHeaderContract() {
  const [foundationCss, responsiveCss] = await Promise.all([readFile(FoundationCssPath, TextEncoding), readFile(ResponsiveCssPath, TextEncoding)]);
  assert.match(foundationCss, /#account-badge \{[\s\S]*?max-width: clamp\(96px, 12vw, 180px\);[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(responsiveCss, /@media \(max-width: 2180px\) \{[\s\S]*?\.header-action-label,[\s\S]*?display: none;/);
  assert.match(responsiveCss, /#configure-filters,[\s\S]*?\.logout-action \{[\s\S]*?width: 38px;[\s\S]*?min-width: 38px;/);
}

async function VerifyCompactWorkflowContracts() {
  const [html, responsiveCss] = await Promise.all([readFile(HtmlPath, TextEncoding), readFile(ResponsiveCssPath, TextEncoding)]);
  VerifyWatchlistContracts(html);
  VerifySyncContracts(html, responsiveCss);
}

function VerifyWatchlistContracts(html) {
  assert.match(html, /id="recommendation-basis-label">Create from/);
  assert.match(html, /id="recommendation-filter-more"[^>]*title="Open advanced watchlist filters"/);
  assert.match(html, /<details class="recommendation-generator"[^>]*id="recommendation-generator">/);
  assert.match(html, /id="recommendation-min-year"[^>]*type="number"/);
  assert.match(html, /id="recommendation-max-year"[^>]*type="number"/);
  VerifyGeneratorPlacement(html);
  assert.doesNotMatch(html, /Ready with gpt-5\.6-sol|active filter shape the rating queue and watchlist/);
  assert.match(html, /id="recommendation-sort"[\s\S]*?<option value="addedAt">By Date Added/);
  assert.match(html, /id="recommendation-details"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.doesNotMatch(html, /toggle-recommendation-posters|data-recommendation-row-toggle/);
  assert.match(html, /class="orientation-guard"[^>]*aria-labelledby="orientation-guard-title"/);
  assert.equal((html.match(/<details class="filter-disclosure">/g) || []).length, 3);
}

function VerifyGeneratorPlacement(html) {
  const generatorId = 'id="recommendation-generator"';
  assert.ok(html.indexOf(generatorId) > html.indexOf('id="recommendation-title"'));
  assert.ok(html.indexOf(generatorId) < html.indexOf('id="watchlist-title"'));
}

async function VerifyDesktopRatingContracts() {
  const html = await readFile(HtmlPath, TextEncoding);
  assert.equal((html.match(/data-desktop-rating="\d+"/g) || []).length, 10);
  assert.match(html, /use your assigned keys\. Backspace = go back/);
  assert.match(html, /id="desktop-not-seen"[^>]*data-shortcut-action="skip"/);
  assert.match(html, /id="desktop-undo"[^>]*data-shortcut-action="undo"/);
  assert.equal((html.match(/data-shortcut-label/g) || []).length, 11);
}

async function VerifySettingsContract() {
  const html = await readFile(HtmlPath, TextEncoding);
  assert.match(html, /id="open-settings"[^>]*title="Open account settings"/);
  assert.match(html, /id="settings-view"[^>]*aria-labelledby="settings-title"/);
  assert.match(html, /id="shortcut-settings-list"/);
  assert.match(html, /id="shortcut-settings-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="connection-settings-panel"[^>]*hidden/);
}

async function VerifyViewingRegionContract() {
  const html = await readFile(HtmlPath, TextEncoding);
  assert.match(html, /id="configure-region"/);
  assert.match(html, /id="region-country-input"/);
  assert.doesNotMatch(html, /id="tmdb-key-input"|id="configure-tmdb"/);
}

async function VerifyAiSetupContract() {
  const html = await readFile(HtmlPath, TextEncoding);
  assert.match(html, /id="settings-view"[^>]*aria-labelledby="settings-title"/);
  assert.match(html, /id="ai-base-url"[^>]*type="url"/);
  assert.match(html, /id="ai-api-key"[^>]*type="password"/);
  assert.match(html, /id="ai-find-models"[^>]*>Find models/);
  assert.match(html, /id="ai-model-select"[^>]*size="7"/);
  assert.match(html, /id="ai-save"[^>]*disabled>Test and save/);
  assert.doesNotMatch(html, /id="ai-dialog"|Add OpenAI API Key|Set OpenAI Key|value="gpt-/);
}

async function VerifyUsernameContract() {
  const html = await readFile(HtmlPath, TextEncoding);
  assert.match(html, /id="signup-username"[^>]*autocomplete="username"[^>]*pattern="\[a-z0-9\]\[a-z0-9\._-\]\{2,31\}"[^>]*required/);
  assert.match(html, /id="profile-handle"[^>]*disabled/);
  assert.match(html, /id="username-dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="username-title"[^>]*hidden/);
  assert.match(html, /your username cannot be changed after it is saved/);
}

async function VerifyStartupLoadingContract() {
  const html = await readFile(HtmlPath, TextEncoding);
  assert.match(html, /id="startup-loading"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="auth-landing"[^>]*aria-labelledby="auth-title"[^>]*hidden/);
  assert.ok(html.indexOf('id="startup-loading"') < html.indexOf('id="auth-landing"'));
}

function VerifySyncContracts(html, responsiveCss) {
  assert.equal((html.match(/<details class="sync-path-row card">/g) || []).length, 3);
  assert.match(html, /IMDb<\/span><b aria-hidden="true">→<\/b><span>IMDb Rapid Rater/);
  assert.match(html, /Letterboxd<\/span><b aria-hidden="true">→<\/b><span>IMDb Rapid Rater/);
  assert.match(html, /IMDb Rapid Rater<\/span><b aria-hidden="true">→<\/b><span>Letterboxd/);
  assert.match(responsiveCss, /@media \(max-width: 950px\) and \(max-height: 520px\) and \(orientation: landscape\)/);
}
