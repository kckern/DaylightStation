// __backend/src/1_adapters/content/readalong/resolvers/scripture.mjs
import { lookupReference, generateReference } from 'scripture-guide';
import { listDirs, dirExists, listYamlFiles, loadContainedYaml, fileSignature } from '#system/utils/FileIO.mjs';
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

  // Fast path: a bare all-digits segment is a global verse_id in our VOLUME_RANGES
  // addressing. Resolve it directly and skip lookupReference — scripture-guide returns
  // no match for a numeric string anyway, but the call costs ~150ms and was previously
  // made for every child (×2 per getItem) during a watchlist resolve, dominating the
  // queue-resolve time. Strict /^\d+$/ so compound refs like "1-nephi-1" still fall
  // through to lookupReference below. The lenient parseInt fallback further down is
  // retained unchanged for any non-pure-numeric edge cases.
  if (/^\d+$/.test(segment)) {
    const numericId = parseInt(segment, 10);
    const volume = getVolumeFromVerseId(numericId);
    if (volume) return { volume, verseId: String(numericId) };
  }

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
 * The text version a search reads for one volume: the requested version when
 * this volume has it, else the manifest default, else the first directory.
 * A version that only some volumes carry (nirv is Bible-only) must not hide
 * the volumes that lack it.
 * @param {string} dataPath - Base scripture data path
 * @param {string} volume - Volume name
 * @param {string} [version] - Requested version
 * @param {Object} [defaults] - Per-volume manifest defaults
 * @returns {string|null}
 */
function pickSearchVersion(dataPath, volume, version, defaults = {}) {
  const candidates = [version, defaults[volume]?.text].filter(Boolean);
  for (const slug of candidates) {
    if (isTextDir(dataPath, volume, slug)) return slug;
  }
  return getFirstDir(path.join(dataPath, volume));
}

/**
 * Fold text for book-name matching: lowercase, "&" as "and", punctuation and
 * spaces to single hyphens (the chapter file slug form, e.g. "1-nephi").
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Short forms people type for a book whose slug spells it out. */
const BOOK_ALIASES = {
  'd-and-c': 'doctrine-and-covenants',
  'dc': 'doctrine-and-covenants',
  'dandc': 'doctrine-and-covenants',
  'js-h': 'joseph-smith-history',
  'jsh': 'joseph-smith-history',
  'js-m': 'joseph-smith-matthew',
  'jsm': 'joseph-smith-matthew',
  'aof': 'articles-of-faith',
  'wom': 'words-of-mormon'
};

/**
 * Index every chapter file of every volume, in canonical (verse id) order.
 * File names are `<firstVerseId>-<book-slug>-<chapter>.yml`.
 * @returns {Array<{volume, textVersion, verseId, book, chapter, file, versionDir, localId}>}
 */
function buildChapterIndex(dataPath, version, defaults) {
  const index = [];
  for (const volume of Object.keys(VOLUME_RANGES)) {
    const textVersion = pickSearchVersion(dataPath, volume, version, defaults);
    if (!textVersion) continue;
    const versionDir = path.join(dataPath, volume, textVersion);
    let files = [];
    try { files = listYamlFiles(versionDir); } catch { continue; }
    for (const file of files) {
      if (file === 'manifest.yml') continue;
      const m = file.replace(/\.ya?ml$/, '').match(/^(\d+)-(.+?)(?:-(\d+))?$/);
      if (!m) continue;
      const verseId = parseInt(m[1], 10);
      if (isNaN(verseId)) continue;
      index.push({
        volume,
        textVersion,
        verseId,
        book: m[2],
        chapter: m[3] ? parseInt(m[3], 10) : null,
        file,
        versionDir,
        localId: `scripture/${volume}/${textVersion}/${verseId}`
      });
    }
  }
  index.sort((a, b) => a.verseId - b.verseId);
  return index;
}

/** The chapter whose range holds this verse id (last chapter starting at or before it, same volume). */
function chapterContaining(index, verseId) {
  const volume = getVolumeFromVerseId(verseId);
  if (!volume) return null;
  let found = null;
  for (const chapter of index) {
    if (chapter.volume !== volume) continue;
    if (chapter.verseId > verseId) break;
    found = chapter;
  }
  return found;
}

function toResult(chapter) {
  return {
    localId: chapter.localId,
    title: generateReference(chapter.verseId) || chapter.file.replace(/\.ya?ml$/, ''),
    volume: chapter.volume
  };
}

/**
 * Match the query against book slugs. "nephi" matches 1-nephi … 4-nephi
 * (whole word), "mos" matches mosiah and moses (word prefix, 3+ letters),
 * "alma 32" narrows to that chapter.
 */
function searchByBookName(index, text) {
  let slug = slugify(text);
  let chapterNo = null;
  const withChapter = slug.match(/^(.*[a-z].*?)-(\d+)$/);
  if (withChapter) {
    slug = withChapter[1];
    chapterNo = parseInt(withChapter[2], 10);
  }
  if (!slug || !/[a-z]/.test(slug)) return [];
  slug = BOOK_ALIASES[slug] || slug;

  const rank = (book) => {
    if (book === slug) return 3;
    const padded = `-${book}-`;
    if (padded.includes(`-${slug}-`)) return 2;
    if (slug.replace(/[^a-z]/g, '').length >= 3 && padded.includes(`-${slug}`)) return 1;
    return 0;
  };

  const books = new Map();
  for (const chapter of index) {
    if (!books.has(chapter.book)) books.set(chapter.book, rank(chapter.book));
  }
  const best = Math.max(0, ...books.values());
  if (!best) return [];
  const matched = new Set([...books].filter(([, r]) => r === best).map(([b]) => b));

  const chapters = index.filter(c => matched.has(c.book)
    && (chapterNo == null || c.chapter === chapterNo));
  if (matched.size < 2 || chapterNo != null) return chapters;

  const leads = [];
  const rest = [];
  const led = new Set();
  for (const c of chapters) {
    if (led.has(c.book)) { rest.push(c); continue; }
    led.add(c.book);
    leads.push(c);
  }
  return [...leads, ...rest];
}

/**
 * Chapter headings per version directory, kept across searches. Every search
 * of every scope that includes readalong falls through to the headings when no
 * book name matches, and reading (or even stat'ing) ~1,600 chapter files on
 * the data mount costs ~0.7 s each time. One stat of the directory says whether
 * the cache is current: an atomic rewrite renames a file into place, which
 * changes the directory's mtime.
 */
const headingCache = new Map();

function chapterHeadings(chapter) {
  const dirSignature = fileSignature(chapter.versionDir);
  let dirCache = headingCache.get(chapter.versionDir);
  if (!dirCache || !dirSignature || dirCache.signature !== dirSignature) {
    dirCache = { signature: dirSignature, files: new Map() };
    if (dirSignature) headingCache.set(chapter.versionDir, dirCache);
  }
  const cached = dirCache.files.get(chapter.file);
  if (cached) return cached;
  const data = loadContainedYaml(chapter.versionDir, chapter.file.replace(/\.ya?ml$/, ''));
  const firstVerse = Array.isArray(data) ? data[0] : data;
  const entry = {
    title: String(firstVerse?.headings?.title || '').toLowerCase(),
    heading: String(firstVerse?.headings?.heading || '').toLowerCase()
  };
  dirCache.files.set(chapter.file, entry);
  return entry;
}

/** Last resort: chapter heading titles that contain the query. */
function searchHeadings(index, text, take) {
  const queryLower = text.toLowerCase();
  const results = [];
  for (const chapter of index) {
    const { title, heading } = chapterHeadings(chapter);
    if (title.includes(queryLower) || heading.includes(queryLower)) {
      results.push(toResult(chapter));
      if (results.length >= take) break;
    }
  }
  return results;
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
   * Search scripture by reference or book name, across every volume.
   *
   * - A full reference ("Genesis 1", "D&C 4", "Alma 32:21") resolves through
   *   scripture-guide to the chapter(s) holding those verses.
   * - A book name with or without a chapter ("Nephi", "1 Nephi", "Alma",
   *   "Doctrine and Covenants", "Moses 1") matches the book slugs in each
   *   volume's chapter files, whole word or word prefix. When several books
   *   match ("Nephi" -> 1, 2, 3, 4 Nephi) each book's first chapter leads,
   *   then the remaining chapters in canonical order.
   * - Otherwise chapter headings are searched.
   *
   * A requested text version applies only to volumes that have it; any
   * other volume falls back to its manifest default, then its first
   * directory (see pickSearchVersion). A version never drops a volume.
   *
   * @param {string} query - Search text
   * @param {string} dataPath - Base scripture data path
   * @param {Object} [options]
   * @param {string} [options.version] - Preferred text version (e.g., 'nirv')
   * @param {Object} [options.defaults] - Per-volume defaults from manifest
   * @param {number} [options.take=20] - Max results
   * @returns {Array<{localId: string, title: string, volume: string}>}
   */
  search(query, dataPath, options = {}) {
    const { version, defaults = {}, take = 20 } = options;
    const text = String(query || '').trim();
    if (!text) return [];

    const index = buildChapterIndex(dataPath, version, defaults);

    // 1. A full reference (scripture-guide only answers when a chapter is given).
    let ref = null;
    try { ref = lookupReference(text); } catch { ref = null; }
    if (ref?.verse_ids?.length > 0) {
      const seen = new Set();
      const results = [];
      for (const verseId of ref.verse_ids) {
        const chapter = chapterContaining(index, Number(verseId));
        if (!chapter || seen.has(chapter.localId)) continue;
        seen.add(chapter.localId);
        results.push(toResult(chapter));
        if (results.length >= take) break;
      }
      if (results.length > 0) return results;
    }

    // 2. Book name, optionally followed by a chapter number.
    const byBook = searchByBookName(index, text);
    if (byBook.length > 0) return byBook.slice(0, take).map(toResult);

    // 3. Fallback: chapter headings (handles non-standard references).
    return searchHeadings(index, text, take);
  },

  VOLUME_RANGES,
  WATCHED_THRESHOLD,
  getVolumeFromVerseId,
  selectVersion,
  buildVersionedStorageKey
};

export default ScriptureResolver;