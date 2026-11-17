/**
 * Strava JSON — parse without losing 64-bit identifiers.
 *
 * From 2027-06-01 Strava issues activity and athlete ids above 2^53. JSON.parse
 * turns those into the nearest double, so the id we stored, matched and sent
 * back would name a DIFFERENT activity, silently. Strava now also returns an
 * `id_str` copy of each id.
 *
 * Every Strava body goes through this reviver instead:
 * - an integer too large to be exact keeps its digits, as a string (uses the
 *   reviver's source text, Node 21+), which also covers fields Strava has no
 *   `_str` twin for, such as a webhook's `object_id`;
 * - any `x` whose `x_str` sibling disagrees with it takes the `x_str` value
 *   (`id`/`id_str`, `upload_id`/`upload_id_str`), the fallback where source
 *   text is unavailable.
 *
 * Ids small enough to be exact stay numbers, so every id already on disk keeps
 * comparing equal to the same id fetched again.
 *
 * @module adapters/strava/stravaJson
 */

/** JSON.parse reviver that keeps unsafe integers and `_str` twins exact. */
export function stravaJsonReviver(key, value, context) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)
    && typeof context?.source === 'string' && /^-?\d+$/.test(context.source)) {
    return context.source;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (!k.endsWith('_str') || typeof v !== 'string' || !/^\d+$/.test(v)) continue;
      const base = k.slice(0, -4);
      if (base in value && value[base] !== v && String(value[base]) !== v) value[base] = v;
    }
  }
  return value;
}

/** Parse a Strava response or webhook body. */
export function parseStravaJson(text) {
  return JSON.parse(text, stravaJsonReviver);
}

export default parseStravaJson;
