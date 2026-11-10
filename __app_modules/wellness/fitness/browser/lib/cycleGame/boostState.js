const finiteOr = (n, fallback) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);
const zoneMult = (z) => finiteOr(z.distance_multiplier, 1);
const title = (z) => z.name || String(z.id).replace(/^./, (c) => c.toUpperCase());

/**
 * What the rider's heart-rate zone is doing to their distance, in display terms. Pure.
 * Zones are sorted by distance_multiplier ascending before lookup; input is not mutated.
 * @param {{zoneId?:string|null, zones?:object[]|null, hrlessMultiplier?:number, progress?:number|null}} [args]
 * @returns {{hasStrap:boolean, label:string, mult:number, progress:number|null, next:{label:string,mult:number}|null}}
 *   progress is clamped to 0..1 (null when absent or no strap); no matching zone means no strap, at the strapless multiplier
 */
export function boostState({ zoneId = null, zones = [], hrlessMultiplier = 1, progress = null } = {}) {
  const list = (Array.isArray(zones) ? zones : []).filter((z) => z && z.id)
    .slice().sort((a, b) => zoneMult(a) - zoneMult(b));
  const i = list.findIndex((z) => String(z.id).toLowerCase() === String(zoneId || '').toLowerCase());
  if (i < 0) return { hasStrap: false, label: 'No heart-rate strap', mult: finiteOr(hrlessMultiplier, 1), progress: null, next: null };
  const nz = list[i + 1];
  return {
    hasStrap: true, label: title(list[i]), mult: zoneMult(list[i]),
    progress: Number.isFinite(progress) && progress !== null ? Math.min(1, Math.max(0, progress)) : null,
    next: nz ? { label: title(nz), mult: zoneMult(nz) } : null
  };
}

/**
 * Lowest and highest distance multiplier a rider can have, across all zones and the strapless one.
 * @param {object[]|null} zones
 * @param {number} [hrlessMultiplier=1] non-finite falls back to 1
 * @returns {{min:number, max:number}} with no usable zones, both equal the strapless multiplier
 */
export function boostRange(zones, hrlessMultiplier = 1) {
  const all = [finiteOr(hrlessMultiplier, 1)];
  for (const z of Array.isArray(zones) ? zones : []) {
    if (z && z.id && Number.isFinite(z.distance_multiplier)) all.push(z.distance_multiplier);
  }
  return { min: Math.min(...all), max: Math.max(...all) };
}

/**
 * A distance multiplier as printed: at most one decimal, no trailing ".0"
 * (1 → "1", 1.25 → "1.3", 0.8 → "0.8"). Non-numbers print as "1".
 * @param {number} mult
 * @returns {string}
 */
export function formatMultiplier(mult) {
  return String(Math.round(finiteOr(mult, 1) * 10) / 10);
}
