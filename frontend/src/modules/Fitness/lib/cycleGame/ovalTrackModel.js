// Oval-track progress model. The oval is a "whole-race track": one full loop
// represents the entire race, not a physical 250m lap. Each rider's marker sits
// at their fraction of the way to the finish.
//
//  - Distance race: the target is the goal; progress is clamped to 1 so a finisher
//    parks at the start/finish line (top of the oval).
//  - Time race: there is no distance goal, so the target is an arbitrary circuit
//    distance (config `oval_circuit_m`); a rider who exceeds it laps the oval
//    (progress > 1 wraps naturally via the periodic ovalPoint mapping).
//
// When laps are enabled (lapLengthM > 0), one full oval revolution = one lap;
// the marker wraps top→top each lap instead of tracking the whole race.
import { lapProgress } from './lapModel.js';

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

/**
 * Oval marker progress (0..1+ around the loop). When laps are enabled the oval is
 * a LAP track: one full revolution = one lap, so progress is the fraction into the
 * current lap (it wraps 1→0 across the top tick each lap). When laps are off it
 * falls back to the whole-race circuit progress (distance race clamps at the line;
 * time race wraps past oval_circuit_m).
 */
export function ovalProgressFor({ winCondition, distanceM, goalM, ovalCircuitM = DEFAULT_OVAL_CIRCUIT_M, lapLengthM = 0 }) {
  if (Number.isFinite(lapLengthM) && lapLengthM > 0) {
    return lapProgress(distanceM, lapLengthM);
  }
  return circuitProgress(
    distanceM,
    circuitTargetFor(winCondition, goalM, ovalCircuitM),
    { clamp: winCondition === 'distance' }
  );
}

export { DEFAULT_OVAL_CIRCUIT_M };
export default { circuitTargetFor, circuitProgress, ovalProgressFor, DEFAULT_OVAL_CIRCUIT_M };
