const FirstStepIndex = 0;
export const PreviousSetupGuideDirection = -1;
export const NextSetupGuideDirection = 1;

export function BuildSetupGuidePosition(flow, stepId = "") {
  if (!flow?.steps?.length)
    return null;
  const index = ReadSetupGuideIndex(flow, stepId);
  return BuildPositionAtIndex(flow, index);
}

export function MoveSetupGuidePosition(flow, currentStepId, direction) {
  const current = BuildSetupGuidePosition(flow, currentStepId);
  if (!current)
    return null;
  const offset = Math.sign(Number(direction) || 0);
  const index = ClampStepIndex(flow, current.index + offset);
  return BuildPositionAtIndex(flow, index);
}

function BuildPositionAtIndex(flow, index) {
  const stepCount = flow.steps.length;
  return {
    index,
    step: flow.steps[index],
    stepNumber: index + 1,
    stepCount,
    hasPrevious: index > FirstStepIndex,
    hasNext: index < stepCount - 1,
    positionLabel: `Step ${index + 1} of ${stepCount}`
  };
}

function ReadSetupGuideIndex(flow, stepId) {
  const index = flow.steps.findIndex((step) => step.id === stepId);
  return index < FirstStepIndex ? FirstStepIndex : index;
}

function ClampStepIndex(flow, index) {
  return Math.min(Math.max(index, FirstStepIndex), flow.steps.length - 1);
}
