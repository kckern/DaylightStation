const EPS = 1e-9;

/**
 * Split elapsed seconds into fixed-step slices.
 * partial: full steps then one short step for the rest (nothing carried).
 * carry:   only whole steps; the remainder is returned as carryS.
 */
export function planSteps(elapsedS, { stepS, remainder = 'partial', carryS = 0 } = {}) {
  const elapsed = Math.max(0, Number(elapsedS) || 0);
  if (remainder === 'carry') {
    const total = (Number(carryS) || 0) + elapsed;
    const count = Math.floor((total + EPS) / stepS);
    return { dts: Array.from({ length: count }, () => stepS), carryS: Math.max(0, total - count * stepS) };
  }
  const dts = [];
  let remaining = elapsed;
  while (remaining > EPS) {
    const dt = Math.min(stepS, remaining);
    dts.push(dt);
    remaining -= dt;
  }
  return { dts, carryS: 0 };
}

/**
 * Steps owed against a fixed anchor (unit-agnostic). A null anchor owes one step.
 */
export function dueAnchoredSteps({ sinceAnchor, stepsTaken, step, maxSteps = Infinity }) {
  const due = sinceAnchor == null ? 1 : Math.max(0, Math.floor(sinceAnchor / step) - stepsTaken);
  return { due, run: Math.min(due, maxSteps) };
}

/**
 * Run `step` over the planned slices. Keys in `oncePerFrame` are cleared from the
 * input after the first step so presses fire once per frame, not once per sub-step.
 */
export function advance(state, input, elapsedS, {
  step, stepS, remainder, carryS, oncePerFrame = ['actions'],
}) {
  const plan = planSteps(elapsedS, { stepS, remainder, carryS });
  let next = state;
  let stepInput = input;
  for (const dt of plan.dts) {
    next = step(next, stepInput, dt);
    if (stepInput && oncePerFrame.some((k) => stepInput[k])) {
      stepInput = { ...stepInput };
      for (const k of oncePerFrame) if (stepInput[k]) stepInput[k] = undefined;
    }
  }
  return { state: next, carryS: plan.carryS, steps: plan.dts.length };
}
