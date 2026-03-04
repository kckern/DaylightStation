// backend/src/1_adapters/content/readalong/resolvers/scripture.mjs
import { lookupReference, generateReference } from 'scripture-guide';
import { listDirs, dirExists, listYamlFiles, loadContainedYaml } from '#system/utils/FileIO.mjs';
import path from 'path';

/**
 * Volume to verse_id range mapping
 * Used to determine which volume a verse_id belongs to
 */
const VOLUME_RANGES = {
  ot: { start: 1, end: 23145 },
  nt: { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc: { start: 37707, end: 41360 },
  pgp: { start: 41361, end: 42663 }
};

/** Minimum progress percentage to consider a version "watched" */
const WATCHED_THRESHOLD = 90;

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
 * Resolve an audio alias, supporting both flat strings and per-volume objects
 * @param {Object} audioDefaults - Map of edition → audio slug or { volume: slug }
 * @param {string} key - The audio key to resolve
 * @param {string} volume - The volume context (ot, nt, bom, dc, pgp)
 * @returns {string} Resolved audio slug
 */
function resolveAudioAlias(audioDefaults, key, volume) {
  const alias = audioDefaults[key];
  if (!alias) return key;
  if (typeof alias === 'string') return alias;
  // Per-volume object: { nt: 'niv-maxmclean' }
  // If volume not listed, return key unchanged (e.g., ot/niv stays as 'niv')
  return alias[volume] || key;
}

/**
 * Check if a slug is a text edition directory for a given volume
 * @param {string} dataPath - Base data path (e.g., .../scripture)
 * @param {string} volume - Volume name (ot, nt, bom, dc, pgp)
 * @param {string} slug - Directory slug to check
 * @returns {boolean}
 */
function isTextDir(dataPath, volume, slug) {
  return dirExists(path.join(dataPath, volume, slug));
}

/**
 * Check if a slug is an audio recording directory for a given volume
 * @param {string} mediaPath - Base media path (e.g., .../scripture)
 * @param {string} volume - Volume name (ot, nt, bom, dc, pgp)
 * @param {string} slug - Directory slug to check
 * @returns {boolean}
 */
function isAudioDir(mediaPath, volume, slug) {
  if (!mediaPath) return false;
  return dirExists(path.join(mediaPath, volume, slug));
}

/**
 * Derive a text edition slug from an audio recording slug.
 * Convention: strip common audio suffixes (-music, -dramatized) and check
 * if the base slug has a matching text directory.
 * @param {string} audioSlug - Audio recording slug (e.g., 'esv-music')
 * @param {string} dataPath - Base data path
 * @param {string} volume - Volume name (ot, nt, etc.)
 * @returns {string|null} Matching text slug, or null if no match found
 */
function deriveTextFromAudio(audioSlug, dataPath, volume) {
  const base = audioSlug.replace(/-(music|dramatized)$/, '');
  if (base !== audioSlug && isTextDir(dataPath, volume, base)) {
    return base;
  }
  return null;
}

/**
 * Select the next version to play based on watch history.
 * @param {string[]} versionPrefs - Ordered preference list
 * @param {string[]} watchedVersions - Versions already watched (>=90%)
 * @returns {{ version: string|null, watchState: 'unwatched'|'partial'|'complete' }}
 */
function selectVersion(versionPrefs, watchedVersions) {
  if (!versionPrefs?.length) {
    return { version: null, watchState: 'unwatched' };
  }

  const watchedSet = new Set(watchedVersions || []);

  if (watchedSet.size === 0) {
    return { version: versionPrefs[0], watchState: 'unwatched' };
  }

  const nextVersion = versionPrefs.find(v => !watchedSet.has(v));
  if (nextVersion) {
    return { version: nextVersion, watchState: 'partial' };
  }

  return { version: versionPrefs[0], watchState: 'complete' };
}

/**
 * Build the media progress storage key for a versioned scripture chapter.
 * @param {string} verseId - Bare verse ID
 * @param {string} volume - Volume name (ot, pgp, etc.)
 * @param {string} version - Audio/text version slug
 * @returns {string} Storage key like 'readalong:scripture/ot/esv-music/1'
 */
function buildVersionedStorageKey(verseId, volume, version) {
  return `readalong:scripture/${volume}/${version}/${verseId}`;
}

/**
 * ScriptureResolver - Resolves scripture references to normalized paths
 *
 * Flexible segment interpretation:
 * - scripture/john-1 → 1 segment: all defaults from manifest
 * - scripture/niv/john-1 → 2 segments: smart detection (audio-only? text? both?)
 * - scripture/kjvf/kjv-maxmclean/john-1 → 3 segments: explicit version/audio/reference
 *
 * 2-segment smart detection:
 * - If slug is audio-only dir (not a text dir): audio override, text from defaults
 * - If slug is text dir (not audio-only): version override, audio from audioDefaults
 * - If slug is both: treat as version (text), audio from audioDefaults
 *
 * Resolution cascade:
 * 1. Explicit in path
 * 2. Manifest defaults (per volume)
 * 3. First directory found
 */
export const ScriptureResolver = {
  /**
   * Resolve scripture input to normalized paths for text and audio
   * @param {string} input - Scripture path (e.g., "john-1", "niv/john-1", "kjvf/kjv-maxmclean/john-1", "nt")
   * @param {string} dataPath - Base path to scripture data
   * @param {Object} [options] - Resolution options
   * @param {string} [options.mediaPath] - Base path to scripture audio
   * @param {Object} [options.defaults] - Per-volume defaults { nt: { text: 'kjvf', audio: 'nirv' } }
   * @param {Object} [options.audioDefaults] - Map text editions to audio directories { kjvf: 'kjv' }
   * @param {boolean} [options.allowVolumeAsContainer] - If true, volume-only input returns container indicator
   * @returns {{ textPath: string, audioPath: string, volume: string, verseId: string, isContainer?: boolean }|null}
   */
  resolve(input, dataPath, options = {}) {
    const { mediaPath, defaults = {}, audioDefaults = {}, allowVolumeAsContainer = false } = options;

    // Full path passthrough (volume/version/verseId format)
    // Only triggers when first segment is a known volume AND last is numeric
    if (input.includes('/') && input.split('/').length === 3) {
      const [first, version, last] = input.split('/');
      const isVolumeFirst = !!VOLUME_RANGES[first];
      const isNumericLast = /^\d+$/.test(last);
      if (isVolumeFirst && isNumericLast) {
        const resolvedAudio = resolveAudioAlias(audioDefaults, version, first);
        return {
          textPath: input,
          audioPath: `${first}/${resolvedAudio}/${last}`,
          volume: first,
          textVersion: version,
          audioRecording: resolvedAudio,
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
      const rawAudio = volumeDefaults.audio || (mediaPath ? getFirstDir(path.join(mediaPath, volume)) : null);
      return {
        volume,
        isContainer: true,
        textVersion: volumeDefaults.text || getFirstDir(path.join(dataPath, volume)) || 'default',
        audioRecording: resolveAudioAlias(audioDefaults, rawAudio, volume)
      };
    }

    const prefixSegments = segments.slice(0, refIndex);

    // Get defaults for this volume
    const volumeDefaults = defaults[volume] || {};

    let textVersion;
    let audioRecording;

    if (prefixSegments.length >= 2) {
      // 3+ segments: explicit version/audio/reference
      textVersion = prefixSegments[0];
      audioRecording = prefixSegments[1];
    } else if (prefixSegments.length === 1) {
      // 2 segments: smart detection — is the prefix a text dir, audio dir, or both?
      const slug = prefixSegments[0];
      const slugIsText = isTextDir(dataPath, volume, slug);
      const slugIsAudio = isAudioDir(mediaPath, volume, slug);

      if (slugIsAudio && !slugIsText) {
        // Audio-only dir (e.g., "kjv-maxmclean/john-1") → audio override, derive text or fall back to defaults
        const derivedText = deriveTextFromAudio(slug, dataPath, volume);
        textVersion = derivedText || volumeDefaults.text || getFirstDir(path.join(dataPath, volume)) || 'default';
        audioRecording = slug;
      } else {
        // Text dir (or both text+audio, or unknown) → version override, audio from audioDefaults
        textVersion = slug;
        audioRecording = slug;
      }
    } else {
      // 1 segment: just a reference → all defaults
      textVersion = volumeDefaults.text || getFirstDir(path.join(dataPath, volume)) || 'default';
      audioRecording = volumeDefaults.audio || (mediaPath ? getFirstDir(path.join(mediaPath, volume)) : textVersion);
    }

    // Apply audio alias (e.g., kjvf → kjv-maxmclean, lds → per-volume mapping)
    const resolvedAudio = resolveAudioAlias(audioDefaults, audioRecording, volume);

    return {
      textPath: `${volume}/${textVersion}/${verseId}`,
      audioPath: `${volume}/${resolvedAudio}/${verseId}`,
      volume,
      textVersion,
      audioRecording: resolvedAudio,
      verseId
    };
  },

  /**
   * Get reference from verse_id
   * Used for subtitle generation
   * @param {string|number} verseId - The verse_id to look up
   * @returns {string|null} Reference string (e.g., "John 3:16")
   */
  getReference(verseId) {
    try {
      return generateReference(verseId);
    } catch {
      return null;
    }
  },

  /**
   * Search scripture by reference text (e.g., "genesis 1", "psalm 23", "john").
   * Returns matching chapter IDs as resolved paths ready for getItem().
   * @param {string} query - Search text
   * @param {string} dataPath - Base scripture data path
   * @param {Object} [options]
   * @param {string} [options.version] - Preferred text version (e.g., 'nirv')
   * @param {Object} [options.defaults] - Per-volume defaults from manifest
   * @param {Object} [options.audioDefaults] - Audio alias mappings
   * @param {string} [options.mediaPath] - Media base path
   * @param {number} [options.take=20] - Max results
   * @returns {Array<{localId: string, title: string, volume: string}>}
   */
  search(query, dataPath, options = {}) {
    const { version, defaults = {}, audioDefaults = {}, mediaPath, take = 20 } = options;

    const results = [];

    // 1. Try scripture-guide reference lookup (fast, indexed)
    const ref = lookupReference(query);

    if (ref?.verse_ids?.length > 0) {
      // Specific chapter(s) matched — find chapter files by verse ID
      const seenChapters = new Set();
      for (const verseId of ref.verse_ids) {
        const volume = getVolumeFromVerseId(verseId);
        if (!volume) continue;

        const textVersion = version
          || defaults[volume]?.text
          || getFirstDir(path.join(dataPath, volume))
          || 'default';
        const versionDir = path.join(dataPath, volume, textVersion);
        if (!dirExists(versionDir)) continue;

        try {
          const files = listYamlFiles(versionDir);
          for (const file of files) {
            if (file === 'manifest.yml') continue;
            const prefix = parseInt(file.split('-')[0], 10);
            if (isNaN(prefix)) continue;
            if (prefix > verseId) break;
            const chapterKey = `${volume}/${textVersion}/${prefix}`;
            if (!seenChapters.has(chapterKey)) {
              seenChapters.add(chapterKey);
              const chapterRef = generateReference(prefix);
              results.push({
                localId: `scripture/${volume}/${textVersion}/${prefix}`,
                title: chapterRef || file.replace('.yml', ''),
                volume
              });
            }
          }
        } catch { /* skip */ }
        if (results.length >= take) break;
      }
      return results.slice(0, take);
    }

    if (ref?.ref) {
      // Book name matched but no verse IDs — list chapters of the book
      const bookName = ref.ref.toLowerCase().replace(/\s+/g, '-');
      for (const [vol] of Object.entries(VOLUME_RANGES)) {
        const textVersion = version
          || defaults[vol]?.text
          || getFirstDir(path.join(dataPath, vol))
          || 'default';
        const versionDir = path.join(dataPath, vol, textVersion);
        if (!dirExists(versionDir)) continue;

        try {
          const files = listYamlFiles(versionDir);
          for (const file of files) {
            if (file === 'manifest.yml') continue;
            const namePart = file.replace(/^\d+-/, '').replace('.yml', '');
            if (!namePart.startsWith(bookName)) continue;
            const prefix = parseInt(file.split('-')[0], 10);
            if (isNaN(prefix)) continue;
            const chapterRef = generateReference(prefix);
            results.push({
              localId: `scripture/${vol}/${textVersion}/${prefix}`,
              title: chapterRef || namePart,
              volume: vol
            });
            if (results.length >= take) break;
          }
        } catch { /* skip */ }
        if (results.length >= take) break;
      }
      if (results.length > 0) return results.slice(0, take);
    }

    // 2. Fallback: search YAML heading content (handles non-standard references)
    const queryLower = query.toLowerCase();
    for (const [vol] of Object.entries(VOLUME_RANGES)) {
      const textVersion = version
        || defaults[vol]?.text
        || getFirstDir(path.join(dataPath, vol))
        || 'default';
      const versionDir = path.join(dataPath, vol, textVersion);
      if (!dirExists(versionDir)) continue;

      try {
        const files = listYamlFiles(versionDir);
        for (const file of files) {
          if (file === 'manifest.yml') continue;
          const filePath = file.replace('.yml', '');
          const data = loadContainedYaml(versionDir, filePath);
          if (!data) continue;
          const firstVerse = Array.isArray(data) ? data[0] : data;
          const title = firstVerse?.headings?.title?.toLowerCase() || '';
          const heading = firstVerse?.headings?.heading?.toLowerCase() || '';
          if (title.includes(queryLower) || heading.includes(queryLower)) {
            const prefix = parseInt(file.split('-')[0], 10);
            const chapterRef = isNaN(prefix) ? null : generateReference(prefix);
            results.push({
              localId: `scripture/${vol}/${textVersion}/${prefix || filePath}`,
              title: chapterRef || filePath,
              volume: vol
            });
            if (results.length >= take) break;
          }
        }
      } catch { /* skip */ }
      if (results.length >= take) break;
    }

    return results.slice(0, take);
  },

  VOLUME_RANGES,
  WATCHED_THRESHOLD,
  getVolumeFromVerseId,
  selectVersion,
  buildVersionedStorageKey
};

export default ScriptureResolver;