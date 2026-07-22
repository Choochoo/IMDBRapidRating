import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TextEncoding = "utf8";
const HtmlPath = "index.html";

test("every browser element lookup exists in the HTML shell", VerifyElementLookups);
test("rating controls start hidden without competing display utilities", VerifyHiddenRatingControls);
test("the visible data-credits section includes required TMDB and JustWatch attribution", VerifyDataCredits);

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
  const html = await readFile(HtmlPath, TextEncoding);
  assert.match(html, /<section class="data-credits"/);
  assert.match(html, /src="\/src\/assets\/tmdb-logo\.svg"/);
  assert.match(html, /This product uses the TMDB API but is not endorsed or certified by TMDB\./);
  assert.match(html, /Streaming availability is provided by JustWatch through TMDB\./);
}
