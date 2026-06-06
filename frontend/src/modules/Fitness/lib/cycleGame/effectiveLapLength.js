/**
 * The lap length actually used for a race. Normally the configured lap (e.g. 400m),
 * but for a DISTANCE race whose goal is shorter than the lap, one lap = the whole
 * race (so a 100/200/250m race isn't sliced into sub-laps). 0 = laps disabled.
 */
export function effectiveLapLength({ lapLengthM = 0, winCondition = 'distance', goalM = null } = {}) {
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
  if (lap === 0) return 0;
  if (winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0 && goalM < lap) return goalM;
  return lap;
}

export default effectiveLapLength;
