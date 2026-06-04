// Oval-track progress model. The oval is a "whole-race track": one full loop
// represents the entire race, not a physical 250m lap. Each rider's marker sits
// at their fraction of the way to the finish.
//
//  - Distance race: the target is the goal; progress is clamped to 1 so a finisher
//    parks at the start/finish line (top of the oval).
//  - Time race: there is no distance goal, so the target is an arbitrary circuit
//    distance (config `oval_circuit_m`); a rider who exceeds it laps the oval
//    (progress > 1 wraps naturally via the periodic ovalPoint mapping).
const DEFAULT_OVAL_CIRCUIT_M = 1000;

export function circuitTargetFor(winCondition, goalM, ovalCircuitM = DEFAULT_OVAL_CIRCUIT_M) {
  if (winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0) return goalM;
  return Number.isFinite(ovalCircuitM) && ovalCircuitM > 0 ? ovalCircuitM : DEFAULT_OVAL_CIRCUIT_M;
}

export function circuitProgress(distanceM, targetM, { clamp = false } = {}) {
  const t = Number(targetM) > 0 ? Number(targetM) : DEFAULT_OVAL_CIRCUIT_M;
  const f = Math.max(0, (Number(distanceM) || 0) / t);
  return clamp ? Math.min(1, f) : f;
}

export { DEFAULT_OVAL_CIRCUIT_M };
export default { circuitTargetFor, circuitProgress, DEFAULT_OVAL_CIRCUIT_M };
