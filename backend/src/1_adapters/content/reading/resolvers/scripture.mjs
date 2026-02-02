// backend/src/1_adapters/content/reading/resolvers/scripture.mjs
import { lookupReference, generateReference } from 'scripture-guide';
import { listDirs } from '#system/utils/FileIO.mjs';
import path from 'path';

/**
 * Volume to verse_id range mapping
 * Used to determine which volume a verse_id belongs to
 */
const VOLUME_RANGES = {
  ot: { start: 1, end: 23145 },
  nt: { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc: { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 }
};

/**
 * Get volume name from verse_id
 * @param {string|number} verseId - The verse_id to look up
 * @returns {string|null} Volume name (ot, nt, bom, dc, pgp) or null
 */
function getVolumeFromVerseId(verseId) {
  const id = parseInt(verseId, 10);
  for (const [volume, range] of Object.entries(VOLUME_RANGES)) {
    if (id >= range.start && id <= range.end) {
      return volume;
    }
  }
  return null;
}

/**
 * Get default version for a volume (first directory found)
 * @param {string} dataPath - Base data path
 * @param {string} volume - Volume name
 * @returns {string} Version name or 'default' fallback
 */
function getDefaultVersion(dataPath, volume) {
  try {
    const volumePath = path.join(dataPath, volume);
    const dirs = listDirs(volumePath);
    return dirs[0] || 'default';
  } catch {
    return 'default';
  }
}

/**
 * ScriptureResolver - Resolves scripture references to normalized paths
 *
 * Supports multiple input formats:
 * - Full path passthrough: "bom/sebom/31103"
 * - Reference string: "alma-32" -> lookup verse_ids -> build path
 * - Numeric verse_id: "37707" -> determine volume -> build path
 * - Volume name: "bom" -> first verse in volume
 */
export const ScriptureResolver = {
  /**
   * Resolve scripture input to normalized path
   * @param {string} input - Scripture reference (e.g., "alma-32", "37707", "bom", "bom/sebom/31103")
   * @param {string} dataPath - Base path to scripture data
   * @returns {string|null} Normalized path like "bom/sebom/34541" or null if invalid
   */
  resolve(input, dataPath) {
    // Full path passthrough (volume/version/verseId)
    if (input.includes('/') && input.split('/').length === 3) {
      return input;
    }

    // Try as reference string (e.g., "alma-32", "1-nephi-1")
    try {
      const ref = lookupReference(input);
      const verseId = ref?.verse_ids?.[0];
      if (verseId) {
        const volume = getVolumeFromVerseId(verseId);
        const version = getDefaultVersion(dataPath, volume);
        return `${volume}/${version}/${verseId}`;
      }
    } catch {
      // Continue to next resolution method
    }

    // Try as numeric verse_id
    const asNumber = parseInt(input, 10);
    if (!isNaN(asNumber) && asNumber > 0) {
      const volume = getVolumeFromVerseId(asNumber);
      if (volume) {
        const version = getDefaultVersion(dataPath, volume);
        return `${volume}/${version}/${asNumber}`;
      }
    }

    // Try as volume name (return first verse in that volume)
    if (VOLUME_RANGES[input]) {
      const version = getDefaultVersion(dataPath, input);
      return `${input}/${version}/${VOLUME_RANGES[input].start}`;
    }

    return null;
  },

  /**
   * Re-export generateReference for convenience
   * Used to generate human-readable reference strings from verse_ids
   */
  generateReference,

  /**
   * Get volume ranges (useful for validation)
   */
  VOLUME_RANGES
};

export default ScriptureResolver;
