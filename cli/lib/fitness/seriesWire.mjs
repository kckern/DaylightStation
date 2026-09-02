/**
 * Wire codec for stored timeline series.
 *
 * Session YAML stores each series as a JSON *string* of RLE entries
 * (`'[[90,2],101,[null,15]]'`). `TimelineService` deliberately does not know
 * about that layer — its header says wire/storage parsing belongs to an
 * adapter, and it operates only on semantic arrays.
 *
 * The CLI session-surgery commands read raw YAML, so they sit on the storage
 * side of that line and must cross it themselves. Passing a stored string
 * straight to `decodeSeries` is silently destructive rather than merely wrong:
 * the string is not an array, so it falls through unparsed, and the callers
 * then index into it — `series[i]` yields a CHARACTER. `heal --apply` turned a
 * 400-tick heart-rate series into a 1933-element array of `"["`, `"n"`, `"u"`,
 * `"l"` … and wrote that back over the session.
 *
 * @module cli/lib/fitness/seriesWire
 */

import { decodeSeries, encodeSeries } from '#domains/fitness/services/TimelineService.mjs';

/**
 * Stored series → decoded value arrays.
 *
 * A value that is already an array is passed through, so a caller holding
 * hydrated data (or a fixture written in array form) behaves identically.
 * A string that does not parse to an array is dropped rather than guessed at.
 *
 * @param {Object} stored - `timeline.series` as read from YAML
 * @returns {Object} series key -> number[]
 */
export function decodeStoredSeries(stored = {}) {
  const parsed = {};
  for (const [key, value] of Object.entries(stored || {})) {
    if (typeof value === 'string') {
      let entries;
      try { entries = JSON.parse(value); } catch { continue; }
      if (!Array.isArray(entries)) continue;
      parsed[key] = entries;
    } else {
      parsed[key] = value;
    }
  }
  return decodeSeries(parsed);
}

/**
 * Decoded value arrays → stored series, in the on-disk JSON-string form the
 * app's readers expect.
 *
 * @param {Object} decoded - series key -> number[]
 * @returns {Object} series key -> JSON string of RLE entries
 */
export function encodeStoredSeries(decoded = {}) {
  const encoded = encodeSeries(decoded);
  const out = {};
  for (const [key, entries] of Object.entries(encoded)) {
    out[key] = JSON.stringify(entries);
  }
  return out;
}
