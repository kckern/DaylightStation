// backend/src/1_adapters/content/narrated/resolvers/scripture.mjs
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
 * Get first directory in a path (for default version/recording)
 * @param {string} basePath - Base path to search
 * @returns {string|null} First directory name or null
 */
function getFirstDir(basePath) {
  try {
    const dirs = listDirs(basePath);
    return dirs[0] || null;
  } catch {
    return null;
  }
}

/**
 * Try to resolve a segment as a scripture reference
 * @param {string} segment - Path segment to test
 * @param {Object} [options] - Resolution options
 * @param {boolean} [options.allowVolumeAsContainer] - If true, volumes return as container (no verseId)
 * @returns {{ volume: string, verseId?: string, isContainer?: boolean }|null} Resolved reference or null
 */
function tryResolveReference(segment, options = {}) {
  const { allowVolumeAsContainer = false } = options;

  // Try as reference string (e.g., "alma-32", "1-nephi-1", "john-1")
  try {
    const ref = lookupReference(segment);
    const verseId = ref?.verse_ids?.[0];
    if (verseId) {
      const volume = getVolumeFromVerseId(verseId);
      if (volume) return { volume, verseId: String(verseId) };
    }
  } catch {
    // Not a valid reference
  }

  // Try as numeric verse_id
  const asNumber = parseInt(segment, 10);
  if (!isNaN(asNumber) && asNumber > 0) {
    const volume = getVolumeFromVerseId(asNumber);
    if (volume) return { volume, verseId: String(asNumber) };
  }

  // Try as volume name
  if (VOLUME_RANGES[segment]) {
    if (allowVolumeAsContainer) {
      // Return as container without resolving to first verse
      return { volume: segment, isContainer: true };
    }
    // Legacy behavior: resolve to first verse
    return { volume: segment, verseId: String(VOLUME_RANGES[segment].start) };
  }

  return null;
}

/**
 * ScriptureResolver - Resolves scripture references to normalized paths
 *
 * Supports format: {textVersion?}/{audioRecording?}/{reference}
 * - scripture/john-1 → uses manifest defaults
 * - scripture/kjvf/john-1 → explicit text, default audio
 * - scripture/kjvf/nirv/john-1 → explicit text and audio
 *
 * Resolution cascade:
 * 1. Explicit in path
 * 2. Manifest defaults (per volume)
 * 3. First directory found
 */
export const ScriptureResolver = {
  /**
   * Resolve scripture input to normalized paths for text and audio
   * @param {string} input - Scripture path (e.g., "john-1", "kjvf/john-1", "kjvf/nirv/john-1", "nt")
   * @param {string} dataPath - Base path to scripture data
   * @param {Object} [options] - Resolution options
   * @param {string} [options.mediaPath] - Base path to scripture audio
   * @param {Object} [options.defaults] - Per-volume defaults { nt: { text: 'kjvf', audio: 'nirv' } }
   * @param {boolean} [options.allowVolumeAsContainer] - If true, volume-only input returns container indicator
   * @returns {{ textPath: string, audioPath: string, volume: string, verseId: string, isContainer?: boolean }|null}
   */
  resolve(input, dataPath, options = {}) {
    const { mediaPath, defaults = {}, allowVolumeAsContainer = false } = options;

    // Full path passthrough (volume/version/verseId format)
    // Only triggers when first segment is a known volume AND last is numeric
    if (input.includes('/') && input.split('/').length === 3) {
      const [first, version, last] = input.split('/');
      const isVolumeFirst = !!VOLUME_RANGES[first];
      const isNumericLast = /^\d+$/.test(last);
      if (isVolumeFirst && isNumericLast) {
        return {
          textPath: input,
          audioPath: input, // Same path for audio
          volume: first,
          textVersion: version,
          audioRecording: version,
          verseId: last
        };
      }
    }

    const segments = input.split('/');

    // Parse from RIGHT to find the reference
    let reference = null;
    let refIndex = -1;

    for (let i = segments.length - 1; i >= 0; i--) {
      reference = tryResolveReference(segments[i], { allowVolumeAsContainer });
      if (reference) {
        refIndex = i;
        break;
      }
    }

    if (!reference) return null;

    const { volume, verseId, isContainer } = reference;

    // If this is a container (volume-only), return early with container indicator
    if (isContainer) {
      const volumeDefaults = defaults[volume] || {};
      return {
        volume,
        isContainer: true,
        textVersion: volumeDefaults.text || getFirstDir(path.join(dataPath, volume)) || 'default',
        audioRecording: volumeDefaults.audio || (mediaPath ? getFirstDir(path.join(mediaPath, volume)) : null)
      };
    }

    const prefixSegments = segments.slice(0, refIndex);

    // Get defaults for this volume
    const volumeDefaults = defaults[volume] || {};

    // Determine text version
    let textVersion;
    if (prefixSegments.length >= 1) {
      textVersion = prefixSegments[0];
    } else if (volumeDefaults.text) {
      textVersion = volumeDefaults.text;
    } else {
      textVersion = getFirstDir(path.join(dataPath, volume)) || 'default';
    }

    // Determine audio recording
    let audioRecording;
    if (prefixSegments.length >= 2) {
      audioRecording = prefixSegments[1];
    } else if (volumeDefaults.audio) {
      audioRecording = volumeDefaults.audio;
    } else if (mediaPath) {
      audioRecording = getFirstDir(path.join(mediaPath, volume)) || textVersion;
    } else {
      audioRecording = textVersion;
    }

    return {
      textPath: `${volume}/${textVersion}/${verseId}`,
      audioPath: `${volume}/${audioRecording}/${verseId}`,
      volume,
      textVersion,
      audioRecording,
      verseId
    };
  },

  /**
   * Legacy resolve method for backwards compatibility
   * Returns just the text path string
   * @param {string} input - Scripture reference
   * @param {string} dataPath - Base path to scripture data
   * @returns {string|null} Normalized text path
   */
  resolveLegacy(input, dataPath) {
    const result = this.resolve(input, dataPath);
    return result?.textPath || null;
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
