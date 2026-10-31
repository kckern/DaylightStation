import { HIGH_ALTITUDE, LOW_ALTITUDE } from './flightGeometry.js';
export const boostRules = course => ({
  enabled: course?.rules?.weapons?.enabled !== false,
  duration_s: 2, recharge_s: 8, lift: .13, ...course?.rules?.boost,
});
export const initialBoostState = () => ({ boostRemaining: 0, boostRechargeRemaining: 0, boostsUsed: 0 });
export function activateBoost(state, course) {
  const rules = boostRules(course);
  if (!rules.enabled || state.phase !== 'playing' || state.stalled || state.pausedForSensor || state.boostRechargeRemaining > 0) return state;
  return { ...state, boostRemaining: rules.duration_s, boostRechargeRemaining: rules.recharge_s, boostsUsed: (state.boostsUsed || 0) + 1 };
}
export function advanceBoost(state, dt) {
  const cool = value => Math.max(0, (value || 0) - dt) < 1e-9 ? 0 : value - dt;
  return { ...state, boostRemaining: cool(state.boostRemaining), boostRechargeRemaining: cool(state.boostRechargeRemaining) };
}
export function boostTargetAltitude(state, target, course) {
  return Math.max(HIGH_ALTITUDE, Math.min(LOW_ALTITUDE, target - (state.boostRemaining > 0 ? boostRules(course).lift : 0)));
}
