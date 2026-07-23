import assert from "node:assert/strict";
import test from "node:test";
import { SetupGuideFeature } from "../src/app/features/setup-guide.js";
import { SetupGuideActionIds, SetupGuideFlowIds, SetupGuideFlows } from "../src/app/setup-guide-definitions.js";

const ChooseImdbCsvStepId = "choose-imdb-csv";
const ImdbImportReminderId = "imdb-import";
const ButtonTag = "button";
const SetupGuideFlowSelector = "[data-setup-guide-flow]";
const ReminderTitle = "Need help?";
const ReminderBody = "Import ratings.";

const ElementKeys = [
  "setupGuideDialog", "setupGuidePanel", "setupGuideClose", "setupGuideHome",
  "setupGuideHub", "setupGuideHubList", "setupGuideStep", "setupGuideProgress",
  "setupGuideTitle", "setupGuideSummary", "setupGuideStepTitle", "setupGuideStepBody",
  "setupGuideImage", "setupGuideImageFallback", "setupGuideAction", "setupGuideBack",
  "setupGuideNext", "helpReminder", "helpReminderTitle", "helpReminderBody",
  "helpReminderOpen", "helpReminderLater", "helpReminderHide", "helpReminderSettings"
];

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.focusable = [];
    this.isConnected = true;
    this.focusCount = 0;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "src")
      this.src = "";
  }

  querySelector(selector) {
    if (selector === SetupGuideFlowSelector)
      return this.children.find((child) => child.dataset.setupGuideFlow) || null;
    return null;
  }

  querySelectorAll() {
    return this.focusable;
  }

  contains(element) {
    return this.children.includes(element);
  }

  closest(selector) {
    if (selector === "[hidden]")
      return this.hidden ? this : null;
    if (selector === SetupGuideFlowSelector)
      return this.dataset.setupGuideFlow ? this : null;
    return null;
  }

  focus() {
    this.focusCount += 1;
    document.activeElement = this;
  }
}

function InstallFakeBrowser() {
  globalThis.document = { activeElement: null, createElement: (tagName) => new FakeElement(tagName) };
  globalThis.window = { setTimeout: (callback) => RunTimer(callback) };
}

function RunTimer(callback) {
  callback();
  return 1;
}

function BuildFeature() {
  const feature = new SetupGuideFeature();
  feature.Elements = Object.fromEntries(ElementKeys.map((key) => [key, new FakeElement()]));
  feature.Elements.setupGuideDialog.hidden = true;
  feature.Elements.helpReminder.hidden = true;
  feature.InitializeSetupGuideState();
  return feature;
}

function BuildPreventableEvent(key = "") {
  const event = { key, shiftKey: false, prevented: false, stopped: false };
  event.preventDefault = () => event.prevented = true;
  event.stopPropagation = () => event.stopped = true;
  return event;
}

function TestExactStepOpening() {
  const feature = BuildFeature();
  feature.OpenSetupGuide(SetupGuideFlowIds.importImdbRatings, ChooseImdbCsvStepId);
  assert.equal(feature.IsSetupGuideOpen(), true);
  assert.equal(feature.SetupGuide.position.step.id, ChooseImdbCsvStepId);
  assert.equal(feature.Elements.setupGuideProgress.textContent, "Step 3 of 4");
  assert.equal(feature.Elements.setupGuideAction.dataset.setupGuideAction, SetupGuideActionIds.chooseImdbCsv);
  assert.equal(feature.Elements.setupGuideAction.attributes.get("tabindex"), "0");
  assert.equal(feature.Elements.setupGuideAction.attributes.get("role"), ButtonTag);
}

function TestHubAndBoundaries() {
  const feature = BuildFeature();
  const trigger = new FakeElement(ButtonTag);
  feature.OpenSetupGuide("", "", trigger);
  assert.equal(feature.Elements.setupGuideHubList.children.length, SetupGuideFlows.length);
  feature.OpenSetupGuideStep(SetupGuideFlowIds.connectImdb, "save-imdb-connection", trigger);
  assert.equal(feature.Elements.setupGuideNext.textContent, "Done");
  feature.HandleSetupGuideNext();
  assert.equal(feature.IsSetupGuideOpen(), false);
  assert.equal(document.activeElement, trigger);
}

function TestLocalActionDispatch() {
  const feature = BuildFeature();
  let context = null;
  feature.RegisterSetupGuideAction(SetupGuideActionIds.chooseImdbCsv, (value) => context = value);
  feature.OpenSetupGuideStep(SetupGuideFlowIds.importImdbRatings, ChooseImdbCsvStepId);
  const event = BuildPreventableEvent();
  feature.HandleSetupGuideAction(event);
  assert.equal(event.prevented, true);
  assert.equal(context.action.id, SetupGuideActionIds.chooseImdbCsv);
}

function TestLocalActionKeyboardDispatch() {
  const feature = BuildFeature();
  let dispatchCount = 0;
  feature.RegisterSetupGuideAction(SetupGuideActionIds.chooseImdbCsv, () => dispatchCount += 1);
  feature.OpenSetupGuideStep(SetupGuideFlowIds.importImdbRatings, ChooseImdbCsvStepId);
  const event = BuildPreventableEvent(" ");
  feature.HandleSetupGuideActionKey(event);
  assert.equal(event.prevented, true);
  assert.equal(dispatchCount, 1);
}

function TestReminderDoesNotStealFocus() {
  const feature = BuildFeature();
  const focused = new FakeElement(ButtonTag);
  document.activeElement = focused;
  const shown = feature.ShowHelpReminder({ id: ImdbImportReminderId, title: ReminderTitle, body: ReminderBody, tutorialId: SetupGuideFlowIds.importImdbRatings });
  assert.equal(shown, true);
  assert.equal(document.activeElement, focused);
  assert.equal(feature.Elements.helpReminder.hidden, false);
}

function TestReminderCallbacks() {
  const feature = BuildFeature();
  let snoozedId = "";
  feature.ConfigureHelpReminderActions({ onLater: (id) => snoozedId = id });
  feature.ShowHelpReminder({ id: ImdbImportReminderId, title: ReminderTitle, body: ReminderBody, tutorialId: SetupGuideFlowIds.importImdbRatings });
  feature.DismissHelpReminderUntilLater();
  assert.equal(snoozedId, ImdbImportReminderId);
  assert.equal(feature.Elements.helpReminder.hidden, true);
}

function TestFocusTrapAndEscape() {
  const feature = BuildFeature();
  const event = BuildPreventableEvent("Tab");
  feature.OpenSetupGuide();
  feature.Elements.setupGuideDialog.focusable = [feature.Elements.setupGuideBack, feature.Elements.setupGuideNext];
  document.activeElement = feature.Elements.setupGuideNext;
  feature.HandleSetupGuideKey(event);
  assert.equal(document.activeElement, feature.Elements.setupGuideBack);
  const escape = BuildPreventableEvent("Escape");
  feature.HandleSetupGuideKey(escape);
  assert.equal(escape.prevented && escape.stopped, true);
}

InstallFakeBrowser();
test("setup guide opens a stable flow and step", TestExactStepOpening);
test("setup guide hub and final-step boundary work", TestHubAndBoundaries);
test("setup guide dispatches local actions by stable id", TestLocalActionDispatch);
test("setup guide local actions work from the keyboard", TestLocalActionKeyboardDispatch);
test("help reminders appear without stealing focus", TestReminderDoesNotStealFocus);
test("help reminder actions invoke configured callbacks", TestReminderCallbacks);
test("setup guide traps focus and closes with Escape", TestFocusTrapAndEscape);
