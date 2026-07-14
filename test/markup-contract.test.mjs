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
