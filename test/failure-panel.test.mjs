import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FoundationStylesPath = "src/styles/foundation.css";
const HtmlPath = "index.html";
const TextEncoding = "utf8";

test("failure panel starts hidden without a competing display utility", VerifyFailurePanelMarkup);

async function VerifyFailurePanelMarkup() {
  const html = await readFile(HtmlPath, TextEncoding);
  const styles = await readFile(FoundationStylesPath, TextEncoding);
  const panel = html.match(/<section\b[^>]*id="failure-panel"[^>]*>/)?.[0] || "";
  assert.match(panel, /\shidden(?:\s|>)/);
  assert.doesNotMatch(panel, /\bd-grid\b/);
  assert.match(styles, /\.failure-panel\s*\{[^}]*display:\s*grid;/s);
}
