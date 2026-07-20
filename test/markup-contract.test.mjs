import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("every browser element lookup exists in the HTML shell", async () => {
  const [source, html] = await Promise.all([
    readFile("src/app/elements.js", "utf8"),
    readFile("index.html", "utf8")
  ]);
  const ids = [...source.matchAll(/Element\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test("rating controls start hidden without competing display utilities", async () => {
  const html = await readFile("index.html", "utf8");
  const footer = html.match(/<footer\b[^>]*id="rating-footer"[^>]*>/)?.[0] || "";
  const mobileBar = html.match(/<nav\b[^>]*id="mobile-rating-bar"[^>]*>/)?.[0] || "";

  assert.match(html, /<body>/);
  assert.match(footer, /\shidden(?:\s|>)/);
  assert.match(mobileBar, /\shidden(?:\s|>)/);
  assert.doesNotMatch(footer, /\bd-(?:none|md-grid|md-none)\b/);
  assert.doesNotMatch(mobileBar, /\bd-(?:none|md-grid|md-none)\b/);
});
