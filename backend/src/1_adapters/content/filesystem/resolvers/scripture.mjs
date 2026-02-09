// backend/src/1_adapters/content/filesystem/resolvers/scripture.mjs

/**
 * ScriptureResolver — Class-based resolver for scripture content IDs.
 *
 * Handles multiple input formats:
 *   - Volume names: "bom", "nt"
 *   - Book-chapter references: "alma-32", "john-3"
 *   - Numeric verse IDs: "31103"
 *   - Full paths: "bom/sebom/31103"
 *
 * Uses `scripture-guide` package for reference lookup/generation.
 * The package is loaded lazily on first use to avoid hard dependency
 * in environments where backend/node_modules isn't resolvable.
 */

import { createRequire } from 'module';

const DEFAULT_VOLUME_RANGES = {
  ot: { start: 1, end: 23145 },
  nt: { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc: { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 },
};

// Lazy-loaded scripture-guide functions
let _sgLoaded = false;
let _lookupReference = null;
let _generateReference = null;

function ensureScriptureGuide() {
  if (_sgLoaded) return;
  _sgLoaded = true;
  try {
    const _require = createRequire(import.meta.url);
    const sg = _require('scripture-guide');
    _lookupReference = sg.lookupReference;
    _generateReference = sg.generateReference;
  } catch {
    // scripture-guide not available — reference lookup disabled
  }
}

export class ScriptureResolver {
  #defaults;
  #volumeRanges;

  /**
   * @param {Object} [options]
   * @param {Object} [options.defaults] - Per-volume defaults { bom: { text: 'sebom', audio: 'sebom' } }
   * @param {Object} [options.volumeRanges] - Volume-to-verse-ID range mapping
   */
  constructor({ defaults = {}, volumeRanges = DEFAULT_VOLUME_RANGES } = {}) {
    this.#defaults = defaults;
    this.#volumeRanges = volumeRanges;
  }

  /**
   * Resolve scripture input to structured result.
   * @param {string} input - Scripture identifier (reference, verse ID, volume name, or path)
   * @returns {{ volume?: string, version?: string, verseId?: string, reference?: string, isContainer?: boolean } | null}
   */
  resolve(input) {
    if (!input) return null;

    // Full path passthrough: "bom/sebom/31103"
    if (input.includes('/') && input.split('/').length === 3) {
      const [first, version, last] = input.split('/');
      if (this.#volumeRanges[first] && /^\d+$/.test(last)) {
        return { volume: first, version, verseId: last, reference: input };
      }
    }

    // Volume name only
    if (this.#volumeRanges[input]) {
      return {
        volume: input,
        version: this.#defaults[input]?.text,
        isContainer: true,
      };
    }

    // Numeric verse ID
    if (/^\d+$/.test(input)) {
      const verseId = parseInt(input, 10);
      const volume = this.#volumeFromId(verseId);
      if (!volume) return null;
      return {
        volume,
        version: this.#defaults[volume]?.text,
        verseId: input,
        reference: input,
      };
    }

    // Try scripture-guide lookup for reference strings (e.g., "alma-32")
    ensureScriptureGuide();
    if (_lookupReference) {
      try {
        const result = _lookupReference(input);
        const verseId = result?.verse_ids?.[0];
        if (verseId) {
          const volume = this.#volumeFromId(verseId);
          return {
            volume,
            version: this.#defaults[volume]?.text,
            verseId: String(verseId),
            reference: input,
          };
        }
      } catch { /* not a valid reference */ }
    }

    // Fallback: return reference for unresolved input
    return { reference: input };
  }

  /**
   * Generate a human-readable reference from a verse ID.
   * @param {string|number} verseId
   * @returns {string|null}
   */
  getReference(verseId) {
    ensureScriptureGuide();
    if (!_generateReference) return null;
    try {
      return _generateReference(verseId);
    } catch {
      return null;
    }
  }

  /**
   * @private
   */
  #volumeFromId(verseId) {
    for (const [vol, range] of Object.entries(this.#volumeRanges)) {
      if (verseId >= range.start && verseId <= range.end) return vol;
    }
    return null;
  }

  /** Expose volume ranges for external use */
  static get VOLUME_RANGES() {
    return { ...DEFAULT_VOLUME_RANGES };
  }
}

export default ScriptureResolver;
