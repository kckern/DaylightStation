/**
 * Lap math for the cycle game. Laps are a config-gated overlay on top of the
 * existing distance model: lapLengthM = meters per lap (e.g. 100 or 400). A
 * falsy lapLengthM means laps are disabled — every function returns 0.
 */

/**
 * Completed full laps.
 * @param {number} distanceM
 * @param {number} lapLengthM
 * @returns {number}
 */
export function lapCount(distanceM, lapLengthM) {
  if (!Number.isFinite(lapLengthM) || lapLengthM <= 0) return 0;
  const d = Number.isFinite(distanceM) ? distanceM : 0;
  return Math.floor(d / lapLengthM);
}

/**
 * Fraction (0..1) into the current lap.
 * @param {number} distanceM
 * @param {number} lapLengthM
 * @returns {number}
 */
export function lapProgress(distanceM, lapLengthM) {
  if (!Number.isFinite(lapLengthM) || lapLengthM <= 0) return 0;
  const d = Number.isFinite(distanceM) ? distanceM : 0;
  return (d % lapLengthM) / lapLengthM;
}
