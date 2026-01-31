// tests/integration/api/_utils/CAPTURE_MANIFEST.mjs
/**
 * Capture manifest for baseline generation.
 *
 * Maps legacy endpoints to new endpoints for migration verification.
 * This file is COMMITTED to git (contains only paths, no data).
 *
 * Format:
 *   legacy: Legacy endpoint path (for baseline capture before teardown)
 *   new: New Content Domain API path
 *   name: Baseline filename (without .json extension)
 *   description: Human-readable description
 */

export const CAPTURE_MANIFEST = {
  /**
   * LocalContent endpoints - scripture, hymns, talks, poems
   *
   * NOTE: Scripture paths use actual file structure (volume/version/verseId),
   * NOT legacy human-readable paths. The legacy shim handles path mapping.
   */
  'local-content': [
    {
      legacy: '/data/scripture/bom/sebom/31103',
      new: '/api/local-content/scripture/bom/sebom/31103',
      name: 'scripture-1-nephi-1',
      description: 'Book of Mormon 1 Nephi 1 (verse_id 31103)'
    },
    {
      legacy: '/data/scripture/bom/sebom/31593',
      new: '/api/local-content/scripture/bom/sebom/31593',
      name: 'scripture-alma-32',
      description: 'Book of Mormon Alma 32 (verse_id 31593)'
    },
    {
      legacy: '/data/hymn/113',
      new: '/api/local-content/hymn/113',
      name: 'hymn-113',
      description: "Our Savior's Love hymn"
    },
    {
      legacy: '/data/hymn/2',
      new: '/api/local-content/hymn/2',
      name: 'hymn-2',
      description: 'The Spirit of God hymn'
    },
    {
      legacy: '/data/primary/10',
      new: '/api/local-content/primary/10',
      name: 'primary-10',
      description: 'Primary song - I Am a Child of God'
    },
    {
      legacy: '/data/talk/ldsgc202410/20',
      new: '/api/local-content/talk/ldsgc202410/20',
      name: 'talk-ldsgc202410-20',
      description: 'General conference talk Oct 2024'
    },
    {
      legacy: '/data/poetry/remedy/01',
      new: '/api/local-content/poem/remedy/01',
      name: 'poem-remedy-01',
      description: 'Poetry content'
    }
  ],

  /**
   * Folder/list endpoints - playlists and content containers
   */
  'folder': [
    {
      legacy: '/data/list/morning-shows',
      new: '/api/list/folder/morning-shows',
      name: 'folder-morning-shows',
      description: 'Morning shows playlist container'
    },
    {
      legacy: '/data/list/morning-shows/playable',
      new: '/api/list/folder/morning-shows/playable',
      name: 'folder-morning-shows-playable',
      description: 'Morning shows resolved to playable items'
    },
    {
      legacy: '/data/list/cartoons',
      new: '/api/list/folder/cartoons',
      name: 'folder-cartoons',
      description: 'Cartoons playlist'
    },
    {
      legacy: '/data/list/scriptures',
      new: '/api/list/folder/scriptures',
      name: 'folder-scriptures',
      description: 'Scripture reading playlist'
    },
    {
      legacy: '/data/list/background-music',
      new: '/api/list/folder/background-music',
      name: 'folder-background-music',
      description: 'Background music playlist'
    }
  ],

  /**
   * Plex endpoints - library browsing and playback
   * These require a live Plex server connection
   */
  'plex': [
    {
      legacy: '/media/plex/list/81061',
      new: '/api/list/plex/81061',
      name: 'plex-list-81061',
      description: 'Christmas movies collection'
    },
    {
      legacy: '/media/plex/list/456724',
      new: '/api/list/plex/456724',
      name: 'plex-list-456724',
      description: 'Veggietales series'
    },
    {
      legacy: '/media/plex/info/660440',
      new: '/api/play/plex/660440',
      name: 'plex-play-660440',
      description: 'Direct video play info'
    },
    {
      legacy: '/media/plex/list/622894',
      new: '/api/list/plex/622894',
      name: 'plex-list-622894',
      description: 'Classical music library'
    },
    {
      legacy: '/media/plex/list/154382',
      new: '/api/list/plex/154382',
      name: 'plex-list-154382',
      description: 'Tabernacle Choir music'
    }
  ],

  /**
   * Filesystem/media endpoints - direct file access
   */
  'filesystem': [
    {
      legacy: '/media/info/audio/hymns/113.mp3',
      new: '/api/play/filesystem/audio/hymns/113.mp3',
      name: 'filesystem-hymn-audio',
      description: 'Direct hymn audio file'
    }
  ]
};

/**
 * Get all entries across all categories.
 */
export function getAllManifestEntries() {
  const entries = [];
  for (const [category, items] of Object.entries(CAPTURE_MANIFEST)) {
    for (const item of items) {
      entries.push({ ...item, category });
    }
  }
  return entries;
}

/**
 * Get entries for a specific category.
 */
export function getManifestEntries(category) {
  return CAPTURE_MANIFEST[category] || [];
}

/**
 * Get categories.
 */
export function getCategories() {
  return Object.keys(CAPTURE_MANIFEST);
}

export default CAPTURE_MANIFEST;
