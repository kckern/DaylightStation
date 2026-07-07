/**
 * Deep-merge utility (single source of truth).
 * @module infrastructure/utils/deepMerge
 *
 * Recursively merges `over` onto `base`, returning a new object:
 *   - `undefined` override values are skipped (base value preserved).
 *   - Arrays are replaced wholesale (override wins), never concatenated.
 *   - Non-object / null values replace the base value.
 * Inputs are not mutated.
 *
 * @param {*} base - Base value
 * @param {*} over - Override value
 * @returns {*} Merged result
 */
export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== 'object' || base === null) return over ?? base;
  if (typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = (k in base) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export default deepMerge;
