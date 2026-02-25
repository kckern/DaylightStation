/**
 * Verse ID ranges per scripture volume.
 * Duplicated from ScriptureResolver to avoid cross-adapter coupling.
 */
const VOLUME_RANGES = {
  ot:  { start: 1,     end: 23145 },
  nt:  { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc:  { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 }
};

const WATCHED_THRESHOLD = 90;

/**
 * Get scripture volume from verse ID.
 * @param {number|string} verseId
 * @returns {string|null} Volume name (ot, nt, bom, dc, pgp)
 */
export function getVolumeFromVerseId(verseId) {
  const id = parseInt(verseId, 10);
  if (isNaN(id)) return null;
  for (const [volume, range] of Object.entries(VOLUME_RANGES)) {
    if (id >= range.start && id <= range.end) return volume;
  }
  return null;
}

/**
 * Select the next version to play based on watch history.
 * @param {string[]} versionPrefs - Ordered preference list
 * @param {string[]} watchedVersions - Versions already watched (>=90%)
 * @returns {{ version: string|null, watchState: 'unwatched'|'partial'|'complete' }}
 */
export function selectVersion(versionPrefs, watchedVersions) {
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
export function buildVersionedStorageKey(verseId, volume, version) {
  return `readalong:scripture/${volume}/${version}/${verseId}`;
}

/**
 * Query which versions of a chapter have been watched.
 * @param {Object} mediaProgressMemory - Progress memory instance
 * @param {string} verseId - Bare verse ID
 * @param {string} volume - Scripture volume
 * @param {string[]} versionPrefs - Versions to check
 * @returns {Promise<string[]>} Watched version slugs
 */
export async function getWatchedVersions(mediaProgressMemory, verseId, volume, versionPrefs) {
  if (!mediaProgressMemory || !versionPrefs?.length) return [];

  const watched = [];
  for (const version of versionPrefs) {
    const key = buildVersionedStorageKey(verseId, volume, version);
    const state = await mediaProgressMemory.get(key, 'scriptures');
    if (state && (state.percent || 0) >= WATCHED_THRESHOLD) {
      watched.push(version);
    }
  }
  return watched;
}
