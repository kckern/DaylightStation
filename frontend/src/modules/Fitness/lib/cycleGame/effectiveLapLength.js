/**
 * The lap length actually used for a race. Normally the configured lap, but:
 *  - when no lap is configured (0/unset) we default to a standard 400m lap so
 *    races always have laps (the velodrome oval + lap strip need a lap length);
 *  - for a DISTANCE race whose goal is shorter than the lap, one lap = the whole
 *    race (so a 100/200/250m race isn't sliced into sub-laps).
 * Net: laps are always on, at "400m or the race distance, whichever is shorter".
 */
export const DEFAULT_LAP_LENGTH_M = 400;

export function effectiveLapLength({ lapLengthM = 0, winCondition = 'distance', goalM = null } = {}) {
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : DEFAULT_LAP_LENGTH_M;
  if (winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0 && goalM < lap) return goalM;
  return lap;
}

export default effectiveLapLength;
