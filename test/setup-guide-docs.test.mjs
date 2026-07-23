import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SetupGuideFlows } from "../src/app/setup-guide-definitions.js";
import { BuildScreenshotChecklist, RenderSetupGuide, RenderSetupGuideIndex, SetupGuideDocumentName } from "../scripts/setup-guide-docs.mjs";

const TemporaryPrefix = "rapid-rater-setup-";

test("setup docs render helpful placeholders for uncaptured screenshots", VerifyPlaceholderDocs);
test("setup docs link captured screenshots from the same definitions", VerifyCapturedDocs);
test("setup docs index every generated guide and expose a JSON checklist command", VerifyDocsIndex);

async function VerifyPlaceholderDocs(t) {
  const rootPath = await CreateTemporaryRoot(t);
  const checklist = await BuildScreenshotChecklist(SetupGuideFlows, rootPath);
  const markdown = RenderSetupGuide(SetupGuideFlows[0], checklist);
  assert.equal(checklist.summary.total, 26);
  assert.equal(checklist.summary.captured, 0);
  assert.equal(checklist.summary.needed, 26);
  assert.match(markdown, /\*\*Screenshot needed:\*\*/);
  assert.match(markdown, /\*\*Solid-redact:\*\*/);
  assert.doesNotMatch(markdown, /!\[[^\]]+\]\(/);
}

async function VerifyCapturedDocs(t) {
  const rootPath = await CreateTemporaryRoot(t);
  const flow = SetupGuideFlows[0];
  const step = flow.steps[0];
  const screenshotPath = path.join(rootPath, ...step.imageSrc.replace(/^\/+/, "").split("/"));
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, "sanitized screenshot");
  const checklist = await BuildScreenshotChecklist(SetupGuideFlows, rootPath);
  const markdown = RenderSetupGuide(flow, checklist);
  assert.equal(checklist.screenshots[0].status, "captured");
  assert.match(markdown, /!\[IMDb home page with a signed-in account\]\(\.\.\/\.\.\/src\/assets\/setup\//);
}

async function VerifyDocsIndex(t) {
  const rootPath = await CreateTemporaryRoot(t);
  const checklist = await BuildScreenshotChecklist(SetupGuideFlows, rootPath);
  const markdown = RenderSetupGuideIndex(SetupGuideFlows, checklist);
  SetupGuideFlows.forEach((flow) => assert.match(markdown, new RegExp(SetupGuideDocumentName(flow))));
  assert.equal(checklist.command, "npm run --silent setup:screenshots");
  assert.equal(checklist.screenshots[0].lastVerified, null);
  assert.match(checklist.safety.join(" "), /solid opaque blocks/);
}

async function CreateTemporaryRoot(t) {
  const rootPath = await mkdtemp(path.join(tmpdir(), TemporaryPrefix));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  return rootPath;
}
