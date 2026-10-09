/**
 * Cosmetic cadence (RPM) zones for the cycle game. Same contract as
 * buildZoneConfig (types.js): system default is a list of {id,name,min,color};
 * the per-user override is a {id→min} dict; names/colors come from the system
 * default. Purely visual — no scoring effect.
 */

export const DEFAULT_CADENCE_CONFIG = [
  { id: 'warmup',   name: 'Warm-up',  min: 0,  color: '#5b6470' },
  { id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  name: 'Pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   name: 'Sprint',   min: 90, color: '#e74c3c' }
];

const normalizeOverrides = (overrides) => {
  if (!overrides || typeof overrides !== 'object') return {};
  return Object.entries(overrides).reduce((acc, [k, v]) => {
    const key = String(k).trim().toLowerCase();
    const num = Number(v);
    if (key && Number.isFinite(num)) acc[key] = num;
    return acc;
  }, {});
};

/**
 * @param {Array<{id:string,name?:string,min?:number,color?:string}>} systemCadenceZones
 * @param {Object<string,number>} overrides - per-user {bandId → min}
 * @returns {Array<{id:string,name:string,color:string|null,min:number}>}
 */
export const buildCadenceConfig = (systemCadenceZones, overrides) => {
  const source = Array.isArray(systemCadenceZones) && systemCadenceZones.length > 0
    ? systemCadenceZones
    : DEFAULT_CADENCE_CONFIG;
  const ov = normalizeOverrides(overrides);
  const out = source.map((band, i) => {
    const rawId = band?.id || band?.name || `band-${i}`;
    const id = String(rawId).trim() || `band-${i}`;
    const overrideMin = ov[id.toLowerCase()];
    return {
      id,
      name: band?.name || id,
      color: band?.color || null,
      min: Number.isFinite(overrideMin)
        ? overrideMin
        : (Number.isFinite(band?.min) ? band.min : 0)
    };
  }).sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
  return out.length ? out : DEFAULT_CADENCE_CONFIG.map((b) => ({ ...b }));
};

export default buildCadenceConfig;
