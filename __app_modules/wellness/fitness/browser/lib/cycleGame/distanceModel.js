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
 * Wheel size to race on when equipment config carries no usable
 * `wheel_circumference_m`. A standard 700c road wheel — the same figure the
 * fleet's conventional bikes are configured with — so an unconfigured bike
 * behaves like a normal bike rather than scoring 0 m per revolution (the
 * 2026-09-08 Generic Pedaler race: 186 rpm, 0 m, unusable). Tune the real
 * value in config; this only keeps the race playable until someone does.
 */
export const DEFAULT_WHEEL_CIRCUMFERENCE_M = 2.1;

/**
 * Meters per rotation for a piece of equipment: its configured
 * `wheel_circumference_m` when that is a positive number, else the default.
 * Never returns 0 — a live rider's rotations must always cover ground.
 * @param {{wheel_circumference_m?: number}|null|undefined} equipment
 * @returns {number}
 */
export function resolveWheelCircumferenceM(equipment) {
  const c = equipment?.wheel_circumference_m;
  return Number.isFinite(c) && c > 0 ? c : DEFAULT_WHEEL_CIRCUMFERENCE_M;
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
