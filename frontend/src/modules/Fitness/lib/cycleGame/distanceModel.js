/**
 * Distance scoring for the cycle game. Distance is the rider's own work:
 *   distanceDelta = rotationsDelta × wheelCircumference(m) × zoneMultiplier
 * Zone multiplier comes from the rider's current HR zone; a rider with no HR
 * (no strap → no zone) uses hrlessMultiplier.
 */

/**
 * @param {string|null} zoneId - current HR zone id, or null/undefined if no HR
 * @param {Array<{id:string, distance_multiplier:number}>} zones
 * @param {number} [hrlessMultiplier=1]
 * @returns {number}
 */
export function zoneMultiplierFor(zoneId, zones, hrlessMultiplier = 1) {
  if (!zoneId) return hrlessMultiplier;
  const list = Array.isArray(zones) ? zones : [];
  const target = String(zoneId).toLowerCase();
  const match = list.find((z) => z && String(z.id).toLowerCase() === target);
  const mult = match && Number.isFinite(match.distance_multiplier)
    ? match.distance_multiplier
    : null;
  return mult != null ? mult : hrlessMultiplier;
}

/**
 * Resolve a zone's display color from config by id (case-insensitive). Lets a
 * ghost rebuild its recorded zone color from `zone_series` ids, the same way a
 * live rider reads it from vitals.
 * @param {string|null} zoneId
 * @param {Array<{id:string, color:string}>} zones
 * @returns {string|null}
 */
export function zoneColorFor(zoneId, zones) {
  if (!zoneId) return null;
  const list = Array.isArray(zones) ? zones : [];
  const target = String(zoneId).toLowerCase();
  const match = list.find((z) => z && String(z.id).toLowerCase() === target);
  return match && match.color ? match.color : null;
}

/**
 * @param {number} rotationsDelta - rotations this tick (> 0)
 * @param {number} wheelCircumferenceM - meters per rotation
 * @param {number} zoneMultiplier
 * @returns {number} meters covered this tick
 */
export function computeDistanceDelta(rotationsDelta, wheelCircumferenceM, zoneMultiplier) {
  const r = Number.isFinite(rotationsDelta) && rotationsDelta > 0 ? rotationsDelta : 0;
  const c = Number.isFinite(wheelCircumferenceM) && wheelCircumferenceM > 0 ? wheelCircumferenceM : 0;
  const m = Number.isFinite(zoneMultiplier) && zoneMultiplier > 0 ? zoneMultiplier : 0;
  return r * c * m;
}
