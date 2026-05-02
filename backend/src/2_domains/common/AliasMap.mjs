/**
 * AliasMap — a frozen, case-insensitive whole-string alias lookup.
 *
 * Maps a set of "spoken" terms to their canonical equivalents, e.g.
 * "beyonce" → "Beyoncé" or "big room" → "light.living_room_main_lights".
 * Lookup is case-insensitive and whitespace-trimmed; stored values are
 * returned verbatim, preserving original casing and special characters.
 *
 * Pure domain value object — no I/O, no logger, no config layer.
 */

export class AliasMap {
  /** @type {Map<string, string>} normalized-key → value */
  #lookup;

  /** @type {Array<[string, string]>} original-key → value, insertion order */
  #originals;

  /**
   * @param {Object|null|undefined} entries
   *   A plain object mapping alias keys to canonical values.
   *   Pass null or undefined for an empty map.
   * @throws {Error} if entries is not a plain object (or null/undefined)
   * @throws {Error} if any key is empty after trim
   * @throws {Error} if any value is not a string
   */
  constructor(entries) {
    // Accept null / undefined as empty.
    if (entries == null) {
      this.#lookup = new Map();
      this.#originals = [];
      Object.freeze(this);
      return;
    }

    // Reject anything that is not a plain object (arrays, strings, numbers, etc.).
    if (
      typeof entries !== 'object' ||
      Array.isArray(entries) ||
      Object.getPrototypeOf(entries) !== Object.prototype
    ) {
      throw new Error('AliasMap: entries must be a plain object');
    }

    this.#lookup = new Map();
    this.#originals = [];

    for (const [key, value] of Object.entries(entries)) {
      if (key.trim() === '') {
        throw new Error('AliasMap: entries cannot have empty keys');
      }
      if (typeof value !== 'string') {
        throw new Error(`AliasMap: entries.${key} must map to a string`);
      }
      const normalized = key.trim().toLowerCase();
      this.#lookup.set(normalized, value);
      this.#originals.push([key, value]);
    }

    Object.freeze(this);
  }

  /**
   * Look up a query string against the alias map.
   *
   * @param {string} query
   * @returns {string|null} The canonical value, or null on miss / invalid input.
   */
  lookup(query) {
    if (typeof query !== 'string') return null;
    const normalized = query.trim().toLowerCase();
    if (normalized === '') return null;
    const hit = this.#lookup.get(normalized);
    return hit !== undefined ? hit : null;
  }

  /**
   * Returns all entries as [originalKey, value] tuples in insertion order.
   * Returns a fresh array each call.
   *
   * @returns {Array<[string, string]>}
   */
  entries() {
    return this.#originals.map(pair => [pair[0], pair[1]]);
  }

  /**
   * Number of entries in the map.
   * @type {number}
   */
  get size() {
    return this.#lookup.size;
  }

  /**
   * Iterates [originalKey, value] tuples in insertion order.
   */
  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }
}

export default AliasMap;
