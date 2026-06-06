/**
 * Average speed in km/h from metres covered over seconds elapsed. Returns 0 when
 * either input is non-positive (a dead race, or a participant who never moved).
 * Single source of truth shared by the lobby High Scores and the History rows so
 * the two can't drift.
 */
export function kmh(distanceM, durationS) {
  const d = Number(distanceM);
  const s = Number(durationS);
  if (!(d > 0) || !(s > 0)) return 0;
  return (d / s) * 3.6;
}

/**
 * The duration to use for a participant's average pace: their own finish time when
 * they have one (a distance race they completed), otherwise the race's time cap (a
 * time race nobody "finishes"). 0 when neither is available.
 */
export function participantDurationS(participant, timeCapS) {
  const t = participant?.finalTimeS;
  if (Number.isFinite(t) && t > 0) return t;
  return Number.isFinite(timeCapS) && timeCapS > 0 ? timeCapS : 0;
}

/** Formatted "NN km/h" label (whole numbers — decimals read as false precision on a TV). */
export function kmhLabel(distanceM, durationS) {
  return `${Math.round(kmh(distanceM, durationS))} km/h`;
}
