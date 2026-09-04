/**
 * Micronutrient provenance
 * @module nutrition/services/micros
 *
 * A stored food row ALWAYS carries `fiber/sugar/sodium/cholesterol` as numbers
 * — `validateFoodItem` defaults each one `?? 0`. So a `sodium: 0` on disk is
 * indistinguishable from a sodium reading that was genuinely zero: the values
 * cannot answer "did anyone measure this?".
 *
 * `microsSource` is that answer, and it is the ONLY one. It records where a
 * row's micros came from ('ai' — an AI capture estimated them; 'catalog' — a
 * catalog entry carried them) or `null` when nothing did. Every consumer that
 * needs to know whether micros are real reads this field, never the numbers.
 *
 * Pure: no clock, no IO.
 */

/** The micronutrients this app tracks. Macros (protein/carbs/fat) are not here. */
export const MICRO_KEYS = ['fiber', 'sugar', 'sodium', 'cholesterol'];

/**
 * True when `source` carries at least one usable micronutrient number.
 *
 * STRICT about the type: `Number(null)` is 0, so a coercing check would read a
 * `fiber: null` placeholder as measured data and claim provenance for it. Only
 * a real finite number counts — and a real `0` DOES count, because a measured
 * zero is data.
 */
export function hasMicroData(source) {
  if (!source || typeof source !== 'object') return false;
  return MICRO_KEYS.some((key) => typeof source[key] === 'number' && Number.isFinite(source[key]));
}

/**
 * Provenance for a freshly parsed AI item.
 *
 * `'ai'` only when the model actually returned micronutrient numbers. A model
 * that answered without them (an older prompt, a truncated response the JSON
 * repair salvaged) leaves the row's structural zeros unclaimed — stamping 'ai'
 * on them would assert measurement that never happened, which is the exact
 * dishonesty the coverage indicator exists to prevent.
 *
 * @param {Object} rawItem - the model's item, BEFORE micro defaults are applied
 * @returns {'ai'|null}
 */
export function aiMicrosSource(rawItem) {
  return hasMicroData(rawItem) ? 'ai' : null;
}

/** Pick just the micro fields present on `source`, as a plain object. */
export function pickMicros(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of MICRO_KEYS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
