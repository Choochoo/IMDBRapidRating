import assert from "node:assert/strict";
import test from "node:test";
import { FindSetupGuideFlow, FindSetupGuideStep, SetupGuideActionIds, SetupGuideFlowIds, SetupGuideFlows } from "../src/app/setup-guide-definitions.js";
import { BuildSetupGuidePosition, MoveSetupGuidePosition, NextSetupGuideDirection, PreviousSetupGuideDirection } from "../src/app/setup-guide-state.js";

const ExpectedFlowIds = [
  "connect-imdb",
  "connect-openai",
  "import-imdb-ratings",
  "import-letterboxd",
  "rapid-rater-to-letterboxd",
  "letterboxd-to-imdb"
];
const KnownActionIds = new Set(Object.values(SetupGuideActionIds));
const MissingStepId = "missing-step";

test("setup guides expose six stable data-driven flows", VerifySetupGuideDefinitions);
test("setup guide lookups resolve stable flow and step IDs", VerifySetupGuideLookups);
test("setup guide navigation reports first and last boundaries", VerifySetupGuideBoundaries);
test("setup guide navigation moves and clamps without mutating definitions", VerifySetupGuideMovement);

function VerifySetupGuideDefinitions() {
  assert.deepEqual(SetupGuideFlows.map((flow) => flow.id), ExpectedFlowIds);
  assert.deepEqual(Object.values(SetupGuideFlowIds), ExpectedFlowIds);
  assert.equal(new Set(ExpectedFlowIds).size, ExpectedFlowIds.length);
  assert.equal(Object.isFrozen(SetupGuideFlows), true);
  SetupGuideFlows.forEach(VerifyFlow);
  assert.doesNotMatch(JSON.stringify(SetupGuideFlows), /tmdb/i);
}

function VerifySetupGuideLookups() {
  const flow = FindSetupGuideFlow(SetupGuideFlowIds.connectImdb);
  assert.equal(flow, SetupGuideFlows[0]);
  assert.equal(FindSetupGuideStep(flow, "copy-cookie-header")?.title, "Copy the Cookie value");
  assert.equal(FindSetupGuideFlow("missing-flow"), null);
  assert.equal(FindSetupGuideStep(flow, MissingStepId), null);
  assert.equal(FindSetupGuideStep(null, MissingStepId), null);
}

function VerifySetupGuideBoundaries() {
  const flow = SetupGuideFlows[0];
  const first = BuildSetupGuidePosition(flow);
  const last = BuildSetupGuidePosition(flow, flow.steps.at(-1).id);
  assert.deepEqual(ReadPositionSummary(first), [0, true, false, "Step 1 of 5"]);
  assert.deepEqual(ReadPositionSummary(last), [4, false, true, "Step 5 of 5"]);
  assert.equal(BuildSetupGuidePosition(null), null);
}

function VerifySetupGuideMovement() {
  const flow = SetupGuideFlows[0];
  const first = flow.steps[0];
  const second = MoveSetupGuidePosition(flow, first.id, NextSetupGuideDirection);
  const clampedBack = MoveSetupGuidePosition(flow, first.id, PreviousSetupGuideDirection);
  const clampedNext = MoveSetupGuidePosition(flow, flow.steps.at(-1).id, NextSetupGuideDirection);
  assert.equal(second.step, flow.steps[1]);
  assert.equal(clampedBack.step, first);
  assert.equal(clampedNext.step, flow.steps.at(-1));
  assert.equal(MoveSetupGuidePosition(flow, second.step.id, 0).step, second.step);
  assert.equal(BuildSetupGuidePosition(flow, "unknown-step").step, first);
}

function ReadPositionSummary(position) {
  return [position.index, position.hasNext, position.hasPrevious, position.positionLabel];
}

function VerifyAction(action) {
  if (!action)
    return;
  assert.equal(KnownActionIds.has(action.id), true);
  assert.match(action.label, /\S/);
  assert.match(action.kind, /^(external|local)$/);
  if (action.kind === "external")
    assert.match(action.href, /^https:\/\//);
  else
    assert.equal(action.href, undefined);
}

function VerifyFlow(flow) {
  assert.equal(Object.isFrozen(flow), true);
  assert.match(flow.title, /\S/);
  assert.match(flow.summary, /\S/);
  assert.ok(flow.steps.length > 0);
  assert.equal(Object.isFrozen(flow.steps), true);
  assert.equal(new Set(flow.steps.map((step) => step.id)).size, flow.steps.length);
  flow.steps.forEach((step) => VerifyStep(flow, step));
}

function VerifyStep(flow, step) {
  assert.equal(Object.isFrozen(step), true);
  assert.match(step.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.match(step.title, /\S/);
  const hasBody = step.body.length > 0;
  const hasConciseBody = step.body.length < 190;
  assert.ok(hasBody && hasConciseBody);
  assert.match(step.imageSrc, new RegExp(`^/src/assets/setup/${flow.id}/\\d{2}-[a-z0-9-]+\\.webp$`));
  assert.match(step.imageAlt, /\S/);
  assert.match(step.capture, /\S/);
  assert.equal(Array.isArray(step.redact), true);
  VerifyAction(step.action);
}
