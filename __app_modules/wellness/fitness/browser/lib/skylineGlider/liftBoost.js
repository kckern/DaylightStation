// Boost is forward thrust: for duration_s the course scrolls `speed`× faster,
// easing in and out over ease_s so the scroll never jumps. Altitude is untouched.
export const boostRules = course => ({
  enabled: course?.rules?.weapons?.enabled !== false,
  duration_s: 2, recharge_s: 8, speed: 1.6, ease_s: .3, ...course?.rules?.boost,
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
export function courseSpeed(state, course) {
  const remaining = state.boostRemaining || 0;
  if (!(remaining > 0)) return 1;
  const rules = boostRules(course);
  const ease = Math.max(1e-6, Number(rules.ease_s) || 0);
  const elapsed = rules.duration_s - remaining;
  const t = Math.min(1, elapsed / ease, remaining / ease);
  const smooth = t * t * (3 - 2 * t);
  return 1 + (Math.max(1, Number(rules.speed) || 1) - 1) * smooth;
}
