// backend/src/4_api/v1/utils/stripEmpty.mjs

/**
 * True for values we treat as "empty" and remove from API responses:
 * null, undefined, [], and {}. Deliberately keeps 0, false, and '' —
 * those carry meaning (a zero count, an explicit false flag, an empty title).
 * @param {*} v
 * @returns {boolean}
 */
function isEmpty(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/**
 * Recursively remove empty members from objects and arrays to trim response
 * payloads. Returns a new structure; does not mutate the input. Primitives are
 * returned as-is.
 * @param {*} value
 * @returns {*}
 */
export function stripEmpty(value) {
  if (Array.isArray(value)) {
    return value
      .map(stripEmpty)
      .filter(v => !isEmpty(v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const stripped = stripEmpty(v);
      if (!isEmpty(stripped)) out[k] = stripped;
    }
    return out;
  }
  return value;
}

export default stripEmpty;
