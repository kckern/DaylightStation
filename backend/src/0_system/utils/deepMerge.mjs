/**
 * Deep-merge utility (single source of truth).
 * @module infrastructure/utils/deepMerge
 *
 * Recursively merges `over` onto `base`, returning a new object:
 *   - `undefined` override values are skipped (base value preserved).
 *   - Arrays are replaced wholesale (override wins), never concatenated.
 *   - Non-null, non-object override values replace the base value.
 *   - A `null` override does NOT overwrite an existing base value: because the
 *     merge uses `over ?? base`, null is treated like absent for keys already
 *     present in base. A null override only takes effect for keys NOT present
 *     in base (where it lands as the value). Consequence: overlay/override
 *     files cannot use `key: null` to CLEAR an inherited base value.
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
