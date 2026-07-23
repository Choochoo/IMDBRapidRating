import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TextEncoding = "utf8";
const HtmlPath = "index.html";
const ResponsiveCssPath = "src/styles/responsive.css";

test("every browser element lookup exists in the HTML shell", VerifyElementLookups);
test("rating controls start hidden without competing display utilities", VerifyHiddenRatingControls);
test("quick rating and connection controls expose their accessible contracts", VerifyHeaderControlContracts);
test("data credits retain required attribution and the rating footer is desktop-only", VerifyDataCredits);
test("watchlist filters and sync directions use compact expandable contracts", VerifyCompactWorkflowContracts);

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

async function VerifyCompactWorkflowContracts() {
  const [html, responsiveCss] = await Promise.all([readFile(HtmlPath, TextEncoding), readFile(ResponsiveCssPath, TextEncoding)]);
  assert.match(html, /id="recommendation-basis-label">Create from/);
  assert.match(html, /id="recommendation-filter-more"[^>]*title="Open advanced watchlist filters"/);
  assert.match(html, /class="orientation-guard"[^>]*aria-labelledby="orientation-guard-title"/);
  assert.equal((html.match(/<details class="filter-disclosure">/g) || []).length, 3);
  assert.equal((html.match(/<details class="sync-path-row card">/g) || []).length, 3);
  assert.match(html, /IMDb<\/span><b aria-hidden="true">→<\/b><span>IMDb Rapid Rater/);
  assert.match(html, /Letterboxd<\/span><b aria-hidden="true">→<\/b><span>IMDb Rapid Rater/);
  assert.match(html, /IMDb Rapid Rater<\/span><b aria-hidden="true">→<\/b><span>Letterboxd/);
  assert.match(responsiveCss, /@media \(max-width: 950px\) and \(max-height: 520px\) and \(orientation: landscape\)/);
}
