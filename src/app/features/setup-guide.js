import { FindSetupGuideFlow, SetupGuideFlows } from "../setup-guide-definitions.js";
import { BuildSetupGuidePosition, MoveSetupGuidePosition, NextSetupGuideDirection, PreviousSetupGuideDirection } from "../setup-guide-state.js";
import { ClickEvent, KeydownEvent } from "../app-constants.js";
import { AnalyticsEvents } from "../analytics-events.js";

const EscapeKey = "Escape";
const EnterKey = "Enter";
const SpaceKey = " ";
const TabKey = "Tab";
const ButtonElementName = "button";
const ExternalActionKind = "external";
const FlowButtonSelector = "[data-setup-guide-flow]";
const FocusableSelector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const HiddenSelector = "[hidden]";
const DefaultReminderActionLabel = "Yes, show me";
const MissingScreenshotLabel = "Screenshot coming soon. The written step still works.";
const HubTitle = "Setup guides";
const HubSummary = "Choose a quick walkthrough. You can come back whenever you need it.";
const NoOp = () => undefined;
const RoleAttribute = "role";
const TabIndexAttribute = "tabindex";
const FunctionType = "function";

export class SetupGuideFeature {
  InitializeSetupGuideState() {
    this.SetupGuide = {
      flow: null,
      position: null,
      trigger: null,
      actionHandlers: new Map(),
      reminder: null,
      reminderHandlers: BuildHelpReminderHandlers()
    };
  }

  EnsureSetupGuideState() {
    if (this.SetupGuide)
      return;
    this.InitializeSetupGuideState();
  }

  BindSetupGuideEvents() {
    this.EnsureSetupGuideState();
    this.BindSetupGuideControls();
    this.BindHelpReminderControls();
  }

  BindSetupGuideControls() {
    this.Elements.setupGuideClose.addEventListener(ClickEvent, () => this.CloseSetupGuide());
    this.Elements.setupGuideHome.addEventListener(ClickEvent, () => this.HandleSetupGuideHome());
    this.Elements.setupGuideBack.addEventListener(ClickEvent, () => this.HandleSetupGuideBack());
    this.Elements.setupGuideNext.addEventListener(ClickEvent, () => this.HandleSetupGuideNext());
    this.Elements.setupGuideAction.addEventListener(ClickEvent, (event) => this.HandleSetupGuideAction(event));
    this.Elements.setupGuideAction.addEventListener(KeydownEvent, (event) => this.HandleSetupGuideActionKey(event));
    this.Elements.setupGuideHubList.addEventListener(ClickEvent, (event) => this.HandleSetupGuideFlowClick(event));
    this.Elements.setupGuideDialog.addEventListener(ClickEvent, (event) => this.HandleSetupGuideBackdrop(event));
    this.Elements.setupGuideDialog.addEventListener(KeydownEvent, (event) => this.HandleSetupGuideKey(event));
    this.Elements.setupGuideImage.addEventListener("load", () => this.HideSetupGuideImageFallback());
    this.Elements.setupGuideImage.addEventListener("error", () => this.ShowSetupGuideImageFallback());
  }

  BindHelpReminderControls() {
    this.Elements.helpReminderOpen.addEventListener(ClickEvent, () => this.OpenHelpReminderTutorial());
    this.Elements.helpReminderLater.addEventListener(ClickEvent, () => this.DismissHelpReminderUntilLater());
    this.Elements.helpReminderHide.addEventListener(ClickEvent, () => this.DisableHelpRemindersFromCard());
    this.Elements.helpReminderSettings.addEventListener(ClickEvent, () => this.OpenHelpReminderSettings());
  }

  RegisterSetupGuideAction(actionId, callback) {
    this.EnsureSetupGuideState();
    if (!actionId || typeof callback !== FunctionType)
      return false;
    this.SetupGuide.actionHandlers.set(actionId, callback);
    return true;
  }

  ConfigureHelpReminderActions(callbacks = {}) {
    this.EnsureSetupGuideState();
    this.SetupGuide.reminderHandlers = BuildHelpReminderHandlers(callbacks);
  }

  OpenSetupGuide(flowId = "", stepId = "", trigger = document.activeElement) {
    this.EnsureSetupGuideState();
    this.RememberSetupGuideTrigger(trigger);
    this.Elements.setupGuideDialog.hidden = false;
    this.RenderSetupGuideRoute(flowId, stepId);
    this.TrackProductEvent?.(AnalyticsEvents.SetupGuideOpened, { flow_id: flowId || "library" });
    FocusLater(this.Elements.setupGuideClose);
  }

  OpenSetupGuideStep(flowId, stepId = "", trigger = document.activeElement) {
    this.OpenSetupGuide(flowId, stepId, trigger);
  }

  RenderSetupGuideRoute(flowId, stepId) {
    if (flowId && this.RenderSetupGuideFlowStep(flowId, stepId))
      return;
    this.RenderSetupGuideHub();
  }

  RenderSetupGuideHub() {
    this.SetupGuide.flow = null;
    this.SetupGuide.position = null;
    this.SetSetupGuideMode(true);
    this.Elements.setupGuideTitle.textContent = HubTitle;
    this.Elements.setupGuideSummary.textContent = HubSummary;
    const buttons = SetupGuideFlows.map(BuildSetupGuideFlowButton);
    this.Elements.setupGuideHubList.replaceChildren(...buttons);
  }

  RenderSetupGuideFlowStep(flowId, stepId = "") {
    const flow = FindSetupGuideFlow(flowId);
    const position = BuildSetupGuidePosition(flow, stepId);
    if (!flow || !position)
      return false;
    this.SetupGuide.flow = flow;
    this.ApplySetupGuidePosition(position);
    return true;
  }

  ApplySetupGuidePosition(position) {
    this.SetupGuide.position = position;
    this.SetSetupGuideMode(false);
    this.RenderSetupGuideCopy(position);
    this.RenderSetupGuideImage(position.step);
    this.RenderSetupGuideAction(position.step.action);
    this.RenderSetupGuideNavigation(position);
  }

  SetSetupGuideMode(showHub) {
    this.Elements.setupGuideHub.hidden = !showHub;
    this.Elements.setupGuideStep.hidden = showHub;
    this.Elements.setupGuideHome.hidden = showHub;
  }

  RenderSetupGuideCopy(position) {
    const flow = this.SetupGuide.flow;
    this.Elements.setupGuideTitle.textContent = flow.title;
    this.Elements.setupGuideSummary.textContent = flow.summary;
    this.Elements.setupGuideProgress.textContent = position.positionLabel;
    this.Elements.setupGuideStepTitle.textContent = position.step.title;
    this.Elements.setupGuideStepBody.textContent = position.step.body;
  }

  RenderSetupGuideImage(step) {
    this.Elements.setupGuideImage.alt = step.imageAlt || "";
    this.Elements.setupGuideImageFallback.textContent = MissingScreenshotLabel;
    this.HideSetupGuideImageFallback();
    if (!step.imageSrc)
      return this.ShowSetupGuideImageFallback();
    this.Elements.setupGuideImage.src = step.imageSrc;
  }

  HideSetupGuideImageFallback() {
    this.Elements.setupGuideImage.hidden = false;
    this.Elements.setupGuideImageFallback.hidden = true;
  }

  ShowSetupGuideImageFallback() {
    this.Elements.setupGuideImage.hidden = true;
    this.Elements.setupGuideImageFallback.hidden = false;
  }

  RenderSetupGuideAction(action) {
    this.ResetSetupGuideAction();
    if (!action)
      return;
    this.Elements.setupGuideAction.hidden = false;
    this.Elements.setupGuideAction.textContent = action.label;
    this.Elements.setupGuideAction.dataset.setupGuideAction = action.id;
    if (action.kind === ExternalActionKind)
      return this.ConfigureExternalSetupGuideAction(action);
    this.ConfigureLocalSetupGuideAction();
  }

  ResetSetupGuideAction() {
    const element = this.Elements.setupGuideAction;
    element.hidden = true;
    element.removeAttribute("href");
    element.removeAttribute("target");
    element.removeAttribute("rel");
    element.removeAttribute(TabIndexAttribute);
    element.removeAttribute(RoleAttribute);
    delete element.dataset.setupGuideAction;
  }

  ConfigureExternalSetupGuideAction(action) {
    const element = this.Elements.setupGuideAction;
    element.href = action.href;
    element.target = "_blank";
    element.rel = "noopener noreferrer";
  }

  ConfigureLocalSetupGuideAction() {
    this.Elements.setupGuideAction.setAttribute(TabIndexAttribute, "0");
    this.Elements.setupGuideAction.setAttribute(RoleAttribute, ButtonElementName);
    this.Elements.setupGuideAction.href = "#";
  }

  RenderSetupGuideNavigation(position) {
    this.Elements.setupGuideBack.disabled = !position.hasPrevious;
    this.Elements.setupGuideNext.textContent = position.hasNext ? "Next" : "Done";
  }

  HandleSetupGuideFlowClick(event) {
    const button = event.target.closest?.(FlowButtonSelector);
    if (!button || !this.Elements.setupGuideHubList.contains(button))
      return;
    this.RenderSetupGuideFlowStep(button.dataset.setupGuideFlow);
    FocusLater(this.Elements.setupGuideStepTitle);
  }

  HandleSetupGuideHome() {
    this.RenderSetupGuideHub();
    const first = this.Elements.setupGuideHubList.querySelector(FlowButtonSelector);
    FocusLater(first || this.Elements.setupGuideClose);
  }

  HandleSetupGuideBack() {
    this.MoveActiveSetupGuide(PreviousSetupGuideDirection);
  }

  HandleSetupGuideNext() {
    if (!this.SetupGuide.position?.hasNext)
      return this.CloseSetupGuide();
    this.MoveActiveSetupGuide(NextSetupGuideDirection);
  }

  MoveActiveSetupGuide(direction) {
    const flow = this.SetupGuide.flow;
    const stepId = this.SetupGuide.position?.step?.id;
    if (!flow || !stepId)
      return;
    const position = MoveSetupGuidePosition(flow, stepId, direction);
    if (position)
      this.ApplySetupGuidePosition(position);
  }

  HandleSetupGuideAction(event) {
    const action = this.SetupGuide.position?.step?.action;
    if (!action || action.kind === ExternalActionKind)
      return;
    event.preventDefault();
    this.DispatchLocalSetupGuideAction(action);
  }

  HandleSetupGuideActionKey(event) {
    const action = this.SetupGuide.position?.step?.action;
    if (!action || action.kind === ExternalActionKind)
      return;
    if (event.key !== EnterKey && event.key !== SpaceKey)
      return;
    event.preventDefault();
    this.DispatchLocalSetupGuideAction(action);
  }

  DispatchLocalSetupGuideAction(action) {
    const callback = this.SetupGuide.actionHandlers.get(action.id);
    if (callback)
      callback(this.BuildSetupGuideActionContext(action));
  }

  BuildSetupGuideActionContext(action) {
    return {
      flow: this.SetupGuide.flow,
      step: this.SetupGuide.position.step,
      action
    };
  }

  HandleSetupGuideBackdrop(event) {
    if (event.target === this.Elements.setupGuideDialog)
      this.CloseSetupGuide();
  }

  HandleSetupGuideKey(event) {
    if (event.key === EscapeKey)
      return this.CloseSetupGuideFromKey(event);
    if (event.key === TabKey)
      this.TrapSetupGuideFocus(event);
  }

  CloseSetupGuideFromKey(event) {
    event.preventDefault();
    event.stopPropagation();
    this.CloseSetupGuide();
  }

  TrapSetupGuideFocus(event) {
    const focusable = this.ReadSetupGuideFocusable();
    if (!focusable.length)
      return event.preventDefault();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!focusable.includes(document.activeElement))
      return MoveFocus(event, first);
    if (event.shiftKey && document.activeElement === first)
      return MoveFocus(event, last);
    if (!event.shiftKey && document.activeElement === last)
      MoveFocus(event, first);
  }

  ReadSetupGuideFocusable() {
    const elements = this.Elements.setupGuideDialog.querySelectorAll(FocusableSelector);
    return [...elements].filter(CanFocusSetupGuideElement);
  }

  RememberSetupGuideTrigger(trigger) {
    this.SetupGuide.trigger = typeof trigger?.focus === FunctionType ? trigger : null;
  }

  CloseSetupGuide() {
    if (this.Elements.setupGuideDialog.hidden)
      return;
    this.Elements.setupGuideDialog.hidden = true;
    this.Elements.setupGuideImage.removeAttribute("src");
    const trigger = this.SetupGuide.trigger;
    this.SetupGuide.trigger = null;
    RestoreSetupGuideFocus(trigger);
  }

  IsSetupGuideOpen() {
    return !this.Elements.setupGuideDialog.hidden;
  }

  ShowHelpReminder(reminder) {
    this.EnsureSetupGuideState();
    const normalized = NormalizeHelpReminder(reminder);
    if (!normalized)
      return false;
    this.SetupGuide.reminder = normalized;
    this.RenderHelpReminder(normalized);
    this.Elements.helpReminder.hidden = false;
    return true;
  }

  RenderHelpReminder(reminder) {
    this.Elements.helpReminderTitle.textContent = reminder.title;
    this.Elements.helpReminderBody.textContent = reminder.body;
    this.Elements.helpReminderOpen.textContent = reminder.actionLabel;
  }

  HideHelpReminder() {
    this.Elements.helpReminder.hidden = true;
    this.SetupGuide.reminder = null;
  }

  OpenHelpReminderTutorial() {
    const reminder = this.SetupGuide.reminder;
    if (!reminder)
      return;
    this.SetupGuide.reminderHandlers.onTutorial(reminder);
    this.HideHelpReminder();
    this.OpenSetupGuide(reminder.tutorialId, reminder.stepId);
  }

  DismissHelpReminderUntilLater() {
    const reminder = this.SetupGuide.reminder;
    if (!reminder)
      return;
    this.HideHelpReminder();
    this.SetupGuide.reminderHandlers.onLater(reminder.id);
  }

  DisableHelpRemindersFromCard() {
    if (!this.SetupGuide.reminder)
      return;
    this.HideHelpReminder();
    this.SetupGuide.reminderHandlers.onHide();
  }

  OpenHelpReminderSettings() {
    if (!this.SetupGuide.reminder)
      return;
    this.HideHelpReminder();
    this.SetupGuide.reminderHandlers.onSettings();
  }
}

function BuildSetupGuideFlowButton(flow) {
  const button = document.createElement(ButtonElementName);
  const title = document.createElement("strong");
  const summary = document.createElement("span");
  button.type = ButtonElementName;
  button.className = "setup-guide-flow";
  button.dataset.setupGuideFlow = flow.id;
  title.textContent = flow.title;
  summary.textContent = flow.summary;
  button.append(title, summary);
  return button;
}

function BuildHelpReminderHandlers(callbacks = {}) {
  return {
    onLater: ReadCallback(callbacks.onLater),
    onHide: ReadCallback(callbacks.onHide),
    onSettings: ReadCallback(callbacks.onSettings),
    onTutorial: ReadCallback(callbacks.onTutorial)
  };
}

function NormalizeHelpReminder(reminder) {
  if (!reminder?.id || !reminder?.title || !reminder?.body || !reminder?.tutorialId)
    return null;
  return {
    id: reminder.id,
    title: reminder.title,
    body: reminder.body,
    tutorialId: reminder.tutorialId,
    stepId: reminder.stepId || "",
    actionLabel: reminder.actionLabel || DefaultReminderActionLabel
  };
}

function ReadCallback(value) {
  return typeof value === FunctionType ? value : NoOp;
}

function FocusLater(element) {
  if (typeof element?.focus !== FunctionType)
    return;
  window.setTimeout(() => element.focus(), 0);
}

function CanFocusSetupGuideElement(element) {
  return !element.disabled && !element.closest(HiddenSelector);
}

function MoveFocus(event, element) {
  event.preventDefault();
  element.focus();
}

function RestoreSetupGuideFocus(trigger) {
  if (!trigger?.isConnected || trigger.closest?.(HiddenSelector))
    return;
  trigger.focus();
}
