// Boost is a dash across the screen, not a faster scroll. The camera keeps
// scrolling at 1×; the craft surges `offset_s` course-seconds ahead of its
// anchor over surge_s, holds there until duration_s, then drifts back over
// return_s. `courseTime` stays the craft's own position, so collisions, shots
// and checkpoints follow the craft; the camera sits `boostOffset` behind it.
export const boostRules = course => {
  const rules = {
    enabled: course?.rules?.weapons?.enabled !== false,
    offset_s: 2.8, surge_s: .5, duration_s: 1.6, return_s: 5, recharge_s: 8, ...course?.rules?.boost,
  };
  // Drifting back faster than the scroll would carry the craft backwards along
  // the course, into whatever it just flew past. A smoothstep's steepest slope
  // is 1.5× its average, so keep that under 0.9 of the scroll.
  return { ...rules, return_s: Math.max(Number(rules.return_s) || 0, 1.5 * rules.offset_s / .9) };
};
export const initialBoostState = () => ({ boostRemaining: 0, boostRechargeRemaining: 0, boostsUsed: 0, boostOffset: 0, boostElapsed: null, boostFrom: 0, boostRate: 0 });

const smooth = t => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** How far ahead of its anchor the craft sits `elapsed` seconds into a boost that started at `from`. */
export function boostOffsetAt(elapsed, from, rules) {
  if (elapsed == null) return 0;
  const surge = Math.min(Math.max(1e-6, rules.surge_s), rules.duration_s || 1e-6);
  if (elapsed < surge) return from + (rules.offset_s - from) * smooth(elapsed / surge);
  if (elapsed < rules.duration_s) return rules.offset_s;
  const back = (elapsed - rules.duration_s) / Math.max(1e-6, rules.return_s);
  return back >= 1 ? 0 : rules.offset_s * (1 - smooth(back));
}

export function activateBoost(state, course) {
  const rules = boostRules(course);
  if (!rules.enabled || state.phase !== 'playing' || state.stalled || state.pausedForSensor || state.boostRechargeRemaining > 0) return state;
  // A boost fired while still drifting back surges on from where the craft is.
  return { ...state, boostRemaining: rules.duration_s, boostRechargeRemaining: rules.recharge_s, boostsUsed: (state.boostsUsed || 0) + 1,
    boostElapsed: 0, boostFrom: state.boostOffset || 0 };
}

export function advanceBoost(state, dt, course) {
  const cool = value => Math.max(0, (value || 0) - dt) < 1e-9 ? 0 : value - dt;
  const rules = boostRules(course);
  const before = state.boostOffset || 0;
  let elapsed = state.boostElapsed == null ? null : state.boostElapsed + dt;
  if (elapsed != null && elapsed >= rules.duration_s + rules.return_s) elapsed = null;
  const boostOffset = boostOffsetAt(elapsed, state.boostFrom || 0, rules);
  return { ...state, boostRemaining: cool(state.boostRemaining), boostRechargeRemaining: cool(state.boostRechargeRemaining),
    boostElapsed: elapsed, boostOffset, boostRate: dt > 0 ? (boostOffset - before) / dt : 0 };
}

/** The craft's speed along the course, in course-seconds per second: the scroll plus the dash. */
export function courseSpeed(state) {
  return 1 + (state?.boostRate || 0);
}

/** Where the camera is: the craft's course position minus how far it has dashed ahead. */
export function cameraTime(state) {
  return (Number(state?.courseTime) || 0) - (state?.boostOffset || 0);
}
