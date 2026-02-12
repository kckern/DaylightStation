// backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs
import path from 'path';
import { generateReference } from 'scripture-guide';
import { ScriptureResolver } from '#adapters/content/readalong/resolvers/scripture.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { ItemSelectionService } from '#domains/content/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { parseFile } from 'music-metadata';
import {
  buildContainedPath,
  loadContainedYaml,
  loadYamlByPrefix,
  loadYamlSafe,
  listYamlFiles,
  listEntries,
  dirExists,
  fileExists,
  findMediaFileByPrefix
} from '#system/utils/FileIO.mjs';

// Threshold for considering an item "watched" (90%)
const WATCHED_THRESHOLD = 90;

/**
 * Format a conference folder name to human-readable title
 * @param {string} folderId - e.g., "ldsgc202510"
 * @returns {string} Formatted title, e.g., "General Conference October 2025"
 */
function formatConferenceName(folderId) {
  if (!folderId) return null;

  // Extract date pattern YYYYMM from folder name
  const match = folderId.match(/^([a-z]+)(\d{4})(\d{2})$/i);
  if (!match) return folderId;

  const [, prefix, year, month] = match;
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[parseInt(month, 10) - 1] || month;

  // Map known prefixes to full names
  const prefixMap = {
    ldsgc: 'General Conference',
    ldswc: "Women's Conference"
  };

  const conferenceName = prefixMap[prefix.toLowerCase()] || prefix;
  return `${conferenceName} ${monthName} ${year}`;
}

/**
 * Determine container type from folder structure
 * @param {string} folderId - Folder identifier
 * @param {string} mediaPath - Base path for media files
 * @returns {'series'|'conference'|'folder'} Container type
 */
function resolveContainerType(folderId, mediaPath) {
  if (!folderId) return 'folder';

  // Check for metadata.yml with explicit containerType
  const folderPath = path.join(mediaPath, 'video', 'readalong', 'talks', folderId);
  const metadataPath = path.join(folderPath, 'metadata');
  const metadata = loadYamlSafe(metadataPath);
  if (metadata?.containerType) {
    return metadata.containerType;
  }

  // Pattern detection: conference folders match prefix + YYYYMM
  const conferencePattern = /^[a-z]+\d{6}$/i;
  if (conferencePattern.test(folderId)) {
    return 'conference';
  }

  // Check if folder contains conference subfolders (series pattern)
  if (dirExists(folderPath)) {
    const entries = listEntries(folderPath);
    const hasConferenceSubfolders = entries.some(e => conferencePattern.test(e));
    if (hasConferenceSubfolders) {
      return 'series';
    }
  }

  return 'folder';
}

/**
 * Resolve a folder ID to its full nested path by scanning parent directories.
 * E.g., "ldsgc202510" → "ldsgc/ldsgc202510" if it exists as a child of any folder.
 * Checks both data and media paths.
 * @param {string} folderId - Folder ID to find
 * @param {string} dataBasePath - Base path for talk data
 * @param {string} mediaBasePath - Base path for talk media
 * @returns {string|null} Nested path (e.g., "parent/folderId") or null
 */
function resolveNestedConferencePath(folderId, dataBasePath, mediaBasePath) {
  if (!folderId || folderId.includes('/')) return null;
  for (const base of [dataBasePath, mediaBasePath]) {
    if (!dirExists(base)) continue;
    for (const parent of listEntries(base)) {
      if (dirExists(path.join(base, parent, folderId))) {
        return `${parent}/${folderId}`;
      }
    }
  }
  return null;
}

/**
 * Format a series folder name to human-readable title
 * Uses folder's metadata.yml if available, otherwise formats the folder name
 * @param {string} seriesId - Series folder identifier (e.g., "ldsgc")
 * @param {string} mediaPath - Base path for media files
 * @returns {string} Formatted title
 */
function formatSeriesTitle(seriesId, mediaPath) {
  if (!seriesId) return null;

  // Try loading metadata.yml from series folder
  const metadataPath = path.join(mediaPath, 'video', 'readalong', 'talks', seriesId, 'metadata');
  const metadata = loadYamlSafe(metadataPath);
  if (metadata?.title) {
    return metadata.title;
  }

  // Fallback: format folder name (capitalize, add spaces before caps)
  return seriesId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}

function isTruthyFlag(value) {
  if (value === true) return true;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'live';
  }
  return false;
}

function extractConferenceDate(folderId) {
  const match = (folderId || '').match(/^[a-z]+(\d{4})(\d{2})$/i);
  if (!match) return null;
  const [, year, month] = match;
  const iso = `${year}-${month}-01T00:00:00Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTalkDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{6}$/.test(trimmed)) {
    const year = trimmed.slice(0, 4);
    const month = trimmed.slice(4, 6);
    const parsed = new Date(`${year}-${month}-01T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}-01T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveTalkDateCandidate(child) {
  const meta = child?.metadata || {};
  const directDate = parseTalkDate(meta.date || meta.servedAt || meta.served_at || meta.recordedAt || meta.recorded_at);
  if (directDate) return directDate;

  const parts = (child?.localId || '').split('/');
  const confId = parts.length >= 2 ? parts[parts.length - 2] : null;
  return extractConferenceDate(confId);
}

function isServedLive(meta) {
  if (!meta) return false;
  return Boolean(
    isTruthyFlag(meta.servedLive)
    || isTruthyFlag(meta.served_live)
    || isTruthyFlag(meta.isLive)
    || isTruthyFlag(meta.live)
  );
}

function isSelectedTalk(meta) {
  if (!meta) return false;
  return Boolean(isTruthyFlag(meta.selected) || isTruthyFlag(meta.featured));
}

function selectTalkForThumbnail(children) {
  if (!Array.isArray(children) || children.length === 0) return null;

  const candidates = children.map(child => ({
    child,
    meta: child.metadata || {},
    date: resolveTalkDateCandidate(child)
  }));

  const byMostRecent = (items) => {
    const withDates = items.filter(item => item.date instanceof Date);
    if (withDates.length === 0) return items[0]?.child || null;
    withDates.sort((a, b) => b.date - a.date);
    return withDates[0].child || null;
  };

  const servedLive = candidates.filter(item => isServedLive(item.meta));
  if (servedLive.length > 0) return byMostRecent(servedLive);

  const selected = candidates.filter(item => isSelectedTalk(item.meta));
  if (selected.length > 0) return byMostRecent(selected);

  const mostRecent = candidates.filter(item => item.date instanceof Date);
  if (mostRecent.length > 0) {
    mostRecent.sort((a, b) => b.date - a.date);
    return mostRecent[0].child || null;
  }

  return children[0] || null;
}

function buildLocalThumbnailUrl(relativePath) {
  if (!relativePath) return null;
  return `/api/v1/local/thumbnail/${relativePath}`;
}

/**
 * Adapter for local content (talks, scriptures)
 */
export class LocalContentAdapter {
  /**
   * @param {Object} config
   * @param {string} config.dataPath - Path to data files (YAML metadata)
   * @param {string} config.mediaPath - Path to media files
   * @param {Object} [config.mediaProgressMemory] - Media progress memory instance (IMediaProgressMemory)
   */
  constructor(config) {
    if (!config.dataPath) throw new InfrastructureError('LocalContentAdapter requires dataPath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataPath'
      });
    if (!config.mediaPath) throw new InfrastructureError('LocalContentAdapter requires mediaPath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'mediaPath'
      });
    this.dataPath = config.dataPath;
    this.mediaPath = config.mediaPath;
    this.mediaProgressMemory = config.mediaProgressMemory || null;
    this.contentRegistry = config.contentRegistry || null;
    this._durationCache = new Map();
  }

  get source() {
    return 'local-content';
  }

  get prefixes() {
    return [
      { prefix: 'talk', idTransform: (id) => `talk:${id}` },
      { prefix: 'scripture', idTransform: (id) => `scripture:${id}` },
      { prefix: 'hymn', idTransform: (id) => `hymn:${id}` },
      { prefix: 'primary', idTransform: (id) => `primary:${id}` },
      { prefix: 'poem', idTransform: (id) => `poem:${id}` }
    ];
  }

  /**
   * Derive capabilities for a local content item.
   * Domain knowledge: local content knows which of its types are queueable.
   *
   * @param {Object} item - The item to analyze
   * @returns {string[]} Array of capability strings
   */
  getCapabilities(item) {
    const capabilities = [];
    const itemType = item.metadata?.type || item.type;

    // playable: has media URL
    if (item.mediaUrl) {
      capabilities.push('playable');
    }

    // displayable: has visual representation
    if (item.thumbnail || item.imageUrl) {
      capabilities.push('displayable');
    }

    // listable: is a container with children
    const isListable = item.items || item.itemType === 'container';
    if (isListable) {
      capabilities.push('listable');
    }

    // queueable: local content containers that resolve to playable items
    // Domain knowledge: series and conference types have playable children
    if (isListable) {
      const queueableTypes = ['series', 'conference'];
      if (queueableTypes.includes(itemType)) {
        capabilities.push('queueable');
      }
    }

    return capabilities;
  }

  /**
   * Build a thumbnail URL for a song collection if an icon exists.
   * @param {string} collection - Collection name (e.g., 'hymn', 'primary')
   * @returns {string|null}
   * @private
   */
  _songCollectionThumbnail(collection) {
    const iconPath = path.resolve(this.dataPath, 'singalong', collection, 'icon.svg');
    return fileExists(iconPath) ? `/api/v1/local-content/collection-icon/local-content/${collection}` : null;
  }

  /**
   * Resolve collection icon path on disk for song collections.
   * @param {string} collection - Collection name (e.g., 'hymn', 'primary')
   * @returns {string|null} Absolute file path or null
   */
  resolveCollectionIcon(collection) {
    const iconPath = path.resolve(this.dataPath, 'singalong', collection, 'icon.svg');
    return fileExists(iconPath) ? iconPath : null;
  }

  /**
   * Check if an item is considered watched (>= threshold)
   * @param {Object} state - Watch state { percent }
   * @returns {boolean}
   * @private
   */
  _isWatched(state) {
    return (state?.percent || 0) >= WATCHED_THRESHOLD;
  }

  /**
   * Build a watch map from talk.yml history with multi-format key matching.
   * Normalizes keys to "conferenceId/talkNum" for consistent lookup.
   * @returns {Promise<Map<string, number>>} Map of normalized talk ID → best percent
   * @private
   */
  async _buildTalkWatchMap() {
    if (!this.mediaProgressMemory) return new Map();

    const allProgress = await this.mediaProgressMemory.getAll('talk');
    const watchMap = new Map();

    for (const p of allProgress) {
      const key = p.itemId || '';
      let talkId = null;
      if (key.startsWith('plex:video/talks/')) {
        talkId = key.replace('plex:video/talks/', '');
      } else if (key.startsWith('plex:talks/')) {
        talkId = key.replace('plex:talks/', '');
      } else if (key.startsWith('talk:')) {
        talkId = key.replace('talk:', '');
      }
      if (talkId) {
        const parts = talkId.split('/');
        if (parts.length >= 2) {
          const normalized = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
          const existing = watchMap.get(normalized) || 0;
          const percent = p.percent || 0;
          if (percent > existing) {
            watchMap.set(normalized, percent);
          }
        }
      }
    }

    return watchMap;
  }

  /**
   * Normalize a talk localId to "conferenceId/talkNum" for watch map lookup.
   * E.g., "ldsgc/ldsgc202510/12" → "ldsgc202510/12"
   * @param {string} localId
   * @returns {string}
   * @private
   */
  _normalizeTalkId(localId) {
    const parts = (localId || '').split('/');
    const confId = parts[parts.length - 2] || '';
    const talkNum = parts[parts.length - 1] || '';
    return `${confId}/${talkNum}`;
  }

  /**
   * Select a random unwatched talk from a folder using ItemSelectionService.
   * If all are watched, picks randomly from all.
   * Uses mediaProgressMemory for async watch state loading.
   * @param {string} folderId - Folder ID (e.g., "ldsgc202510")
   * @returns {Promise<string|null>} Selected talk localId or null
   * @private
   */
  async _selectFromFolder(folderId) {
    const folder = await this._getTalkFolder(folderId);
    if (!folder?.children?.length) return null;

    // Build watch map with multi-format key matching
    const watchMap = await this._buildTalkWatchMap();

    const enrichedItems = folder.children.map(child => {
      const normalized = this._normalizeTalkId(child.localId);
      const percent = watchMap.get(normalized) || 0;
      return { ...child, percent, watched: percent >= WATCHED_THRESHOLD };
    });

    // Use ItemSelectionService: filter watched, random sort, pick first
    const context = { containerType: 'talk', now: new Date() };
    let selected = ItemSelectionService.select(enrichedItems, context, {
      strategy: 'discovery',  // random sort, pick first
      filter: 'none'          // we handle watched filter below
    });

    // Apply watched filter manually
    selected = selected.filter(item => !item.watched);

    // If all watched, re-select from all
    if (selected.length === 0) {
      selected = ItemSelectionService.select(enrichedItems, context, {
        strategy: 'discovery',
        filter: 'none'
      });
    }

    return selected.length > 0 ? selected[0].localId : null;
  }

  /**
   * @param {string} id - Compound ID (e.g., "talk:general/2024-04-talk1")
   * @returns {boolean}
   */
  canResolve(id) {
    const prefix = id.split(':')[0];
    return this.prefixes.some(p => p.prefix === prefix);
  }

  /**
   * Get storage path for watch state
   * @param {string} id
   * @returns {string}
   */
  /**
   * Get container type for selection strategy inference.
   * Delegates to resolveContainerType() for talk containers.
   * @param {string} id - Compound ID, e.g., "talk:ldsgc202510"
   * @returns {string} Container type (conference, series, folder, etc.)
   */
  getContainerType(id) {
    const [prefix, localId] = id.split(':');
    if (prefix === 'talk' && localId) {
      // Strip any leading path segments to get the folder ID
      const parts = localId.split('/');
      const folderId = parts[parts.length - 1];
      return resolveContainerType(folderId, this.mediaPath);
    }
    return 'folder';
  }

  getStoragePath(id) {
    const prefix = id.split(':')[0];
    const localId = id.split(':').slice(1).join(':');

    if (this.contentRegistry) {
      const resolved = this.contentRegistry.resolveFromPrefix(prefix, localId);
      if (resolved?.adapter && resolved.adapter !== this && typeof resolved.adapter.getStoragePath === 'function') {
        return resolved.adapter.getStoragePath(`${resolved.adapter.source}:${resolved.localId}`);
      }
    }

    return prefix;
  }

  /**
   * Get item by compound ID
   * @param {string} id - e.g., "talk:general/test-talk"
   * @returns {Promise<PlayableItem|ListableItem|null>}
   */
  async getItem(id) {
    const [prefix, localId] = id.split(':');
    if (!localId) return null;

    if (prefix === 'talk') {
      return this._getTalk(localId);
    }

    if (prefix === 'scripture') {
      return this._getScripture(localId);
    }

    if (prefix === 'hymn') {
      return this._getSong('hymn', localId);
    }

    if (prefix === 'primary') {
      return this._getSong('primary', localId);
    }

    if (prefix === 'poem') {
      return this._getPoem(localId);
    }

    return null;
  }

  /**
   * Get list of items in a container
   * @param {string} id - e.g., "talk:april2024"
   * @returns {Promise<ListableItem|null>}
   */
  async getList(id) {
    // Strip source prefix if present (e.g., "local-content:talk:" → "talk:")
    const strippedId = id.replace(/^local-content:/, '');
    const [prefix, localId] = strippedId.split(':');

    // Handle "talk:" - return all talk folders (series)
    if (prefix === 'talk' && !localId) {
      return this._listTalkFolders();
    }

    if (prefix === 'talk' && localId) {
      return this._getTalkFolder(localId);
    }

    return null;
  }

  /**
   * Resolve ID to playable items
   * Recursively flattens containers (series → conferences → talks)
   * Similar to PlexAdapter's Artist → Albums → Tracks resolution
   * @param {string} id
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    // Try as single item first
    const item = await this.getItem(id);
    if (item && item.isPlayable && item.isPlayable()) {
      return [item];
    }

    // Try as container and recursively resolve
    const list = await this.getList(id);
    if (!list) return [];

    const playables = [];

    // Check direct children
    if (list.children) {
      for (const child of list.children) {
        if (child.isPlayable && child.isPlayable()) {
          // Leaf item - add directly
          playables.push(child);
        } else if (child.itemType === 'container') {
          // Container - recurse into it
          const childId = child.id || `talk:${child.localId}`;
          const childPlayables = await this.resolvePlayables(childId);
          playables.push(...childPlayables);
        }
      }
    }

    return playables;
  }

  /**
   * List all items in a collection (hymn, primary, talk, scripture, poem)
   * @param {string} collection - Collection name (e.g., 'hymn', 'primary')
   * @returns {Promise<Array>}
   */
  async listCollection(collection) {
    if (collection === 'hymn' || collection === 'primary') {
      return this._listSongs(collection);
    }

    if (collection === 'talk') {
      return this._listTalkFolders();
    }

    if (collection === 'scripture') {
      return this._listScriptureVolumes();
    }

    if (collection === 'poem') {
      return this._listPoemCollections();
    }

    return [];
  }

  /**
   * List folders/subsources for a parent type (used by item router)
   * @param {string} type - Parent type (e.g., 'talk')
   * @returns {Promise<Array>}
   */
  async listFolders(type) {
    if (type === 'talk') {
      return this._listTalkFolders();
    }
    return [];
  }

  /**
   * List all playable items in a collection
   * @param {string} collection - Collection name
   * @returns {Promise<PlayableItem[]>}
   */
  async listCollectionPlayables(collection) {
    const items = await this.listCollection(collection);
    // For hymn/primary, items are already playable
    if (collection === 'hymn' || collection === 'primary') {
      return items;
    }
    // For talk, need to recurse into folders
    return [];
  }

  /**
   * List all songs in a collection
   * @param {string} collection - 'hymn' or 'primary'
   * @returns {Promise<Array>}
   * @private
   */
  async _listSongs(collection) {
    const basePath = path.resolve(this.dataPath, 'singalong', collection);
    try {
      const files = listYamlFiles(basePath);
      const items = [];

      for (const file of files) {
        // Extract number from filename (e.g., "0002-the-spirit-of-god.yml" → "2")
        const match = file.match(/^0*(\d+)/);
        if (match) {
          const number = match[1];
          const item = await this._getSong(collection, number);
          if (item) items.push(item);
        }
      }

      return items;
    } catch (err) {
      return [];
    }
  }

  /**
   * List talk folders
   * Returns both series (from media path) and conference folders (from data path)
   * @returns {Promise<Array>}
   * @private
   */
  async _listTalkFolders() {
    const dataBasePath = path.resolve(this.dataPath, 'readalong', 'talks');
    const mediaBasePath = path.resolve(this.mediaPath, 'video', 'readalong', 'talks');
    const folders = [];
    const seenIds = new Set();

    try {
      // First check media path for series folders (nested structure)
      if (dirExists(mediaBasePath)) {
        const mediaEntries = listEntries(mediaBasePath);
        const conferencePattern = /^[a-z]+\d{6}$/i;

        for (const entry of mediaEntries) {
          if (entry.startsWith('.') || entry.startsWith('_')) continue;

          const entryPath = path.join(mediaBasePath, entry);
          const stats = await import('fs').then(fs => fs.statSync(entryPath));

          if (stats.isDirectory()) {
            const containerType = resolveContainerType(entry, this.mediaPath);

            // Check if series (contains conference subfolders)
            if (containerType === 'series') {
              seenIds.add(entry);
              folders.push({
                id: `talk:${entry}`,
                source: 'local-content',
                localId: entry,
                title: formatSeriesTitle(entry, this.mediaPath),
                type: 'series',
                itemType: 'container'
              });
            }
          }
        }
      }

      // Then check data path for conference folders
      if (dirExists(dataBasePath)) {
        const fs = await import('fs');
        const entries = fs.readdirSync(dataBasePath, { withFileTypes: true });

        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;

          // Skip if already covered by a series folder
          const prefixMatch = e.name.match(/^([a-z]+)\d/i);
          if (prefixMatch && seenIds.has(prefixMatch[1].toLowerCase())) {
            continue;
          }

          const containerType = resolveContainerType(e.name, this.mediaPath);
          folders.push({
            id: `talk:${e.name}`,
            source: 'local-content',
            localId: e.name,
            title: formatConferenceName(e.name) || e.name,
            type: containerType,
            itemType: 'container'
          });
        }
      }

      return folders;
    } catch (err) {
      return [];
    }
  }

  /**
   * List scripture volumes
   * @returns {Promise<Array>}
   * @private
   */
  async _listScriptureVolumes() {
    const basePath = path.resolve(this.dataPath, 'readalong', 'scripture');
    try {
      if (!dirExists(basePath)) return [];

      const manifest = loadYamlSafe(path.join(basePath, 'manifest')) || {};
      const volumeTitles = manifest.volumeTitles || {};

      const fs = await import('fs');
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      const volumes = entries
        .filter(e => e.isDirectory())
        .map(e => ({
          id: `scripture:${e.name}`,
          source: 'local-content',
          localId: e.name,
          title: volumeTitles[e.name] || e.name.toUpperCase(),
          itemType: 'container'
        }));

      return volumes;
    } catch (err) {
      return [];
    }
  }

  /**
   * List poem collections
   * @returns {Promise<Array>}
   * @private
   */
  async _listPoemCollections() {
    const basePath = path.resolve(this.dataPath, 'readalong', 'poetry');
    try {
      if (!dirExists(basePath)) return [];

      const fs = await import('fs');
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      const collections = entries
        .filter(e => e.isDirectory())
        .map(e => ({
          id: `poem:${e.name}`,
          source: 'local-content',
          localId: e.name,
          title: e.name,
          itemType: 'container'
        }));

      return collections;
    } catch (err) {
      return [];
    }
  }

  /**
   * Resolve a talk folder alias (e.g., "ldsgc") to the latest matching folder.
   * Select an ambient track URL using ItemSelectionService discovery strategy.
   * @returns {string} Ambient stream URL
   * @private
   */
  _selectAmbientUrl() {
    const tracks = Array.from({ length: 115 }, (_, i) => ({ id: i + 1 }));
    const [selected] = ItemSelectionService.applyPick(
      ItemSelectionService.applySort(tracks, 'random'),
      'first'
    );
    const trackNum = String(selected.id).padStart(3, '0');
    return `/api/v1/stream/ambient/${trackNum}`;
  }

  /**
   * Similar to freshvideo logic - finds folders matching the prefix and returns the most recent.
   * @param {string} alias - Folder alias (e.g., "ldsgc")
   * @returns {string|null} Latest matching folder ID (e.g., "ldsgc202510") or null
   * @private
   */
  _resolveLatestFolder(alias) {
    const basePath = path.resolve(this.dataPath, 'readalong', 'talks');
    if (!dirExists(basePath)) return null;

    const entries = listEntries(basePath);

    // Filter folders matching the alias prefix followed by YYYYMM pattern
    const pattern = new RegExp(`^${alias}(\\d{6})$`);
    const matches = entries
      .filter(entry => pattern.test(entry))
      .map(entry => {
        const match = entry.match(pattern);
        return { folder: entry, date: match[1] };
      });

    if (matches.length === 0) return null;

    // Sort by date descending (latest first)
    matches.sort((a, b) => b.date.localeCompare(a.date));

    return matches[0].folder;
  }

  /**
   * @private
   */
  async _getTalk(localId) {
    const basePath = path.resolve(this.dataPath, 'readalong', 'talks');
    let metadata = loadContainedYaml(basePath, localId);

    // If not found as file, check if it's a folder/series reference
    if (!metadata) {
      // Check if localId refers to a series folder in media path
      const mediaBasePath = path.resolve(this.mediaPath, 'video', 'readalong', 'talks');
      const seriesPath = path.join(mediaBasePath, localId);

      if (dirExists(seriesPath)) {
        // Check if it's a series (contains conference subfolders)
        const containerType = resolveContainerType(localId, this.mediaPath);
        if (containerType === 'series' || containerType === 'conference') {
          // Return as container, not auto-select a talk
          const folder = await this._getTalkFolder(localId);
          return folder;
        }
      }

      // Check if localId is nested under a parent folder (e.g., "ldsgc202510" → "ldsgc/ldsgc202510")
      const nestedPath = resolveNestedConferencePath(localId, basePath, mediaBasePath);
      if (nestedPath) {
        const folder = await this._getTalkFolder(nestedPath);
        if (folder) return folder;
      }

      // Check if localId is an alias for a dated folder
      const resolvedFolder = this._resolveLatestFolder(localId);
      const folderId = resolvedFolder || localId;

      // Check if the resolved folder is a conference folder
      const resolvedContainerType = resolveContainerType(folderId, this.mediaPath);
      if (resolvedContainerType === 'conference') {
        const folder = await this._getTalkFolder(folderId);
        return folder;
      }

      const selectedId = await this._selectFromFolder(folderId);
      if (!selectedId) return null;
      metadata = loadContainedYaml(basePath, selectedId);
      if (!metadata) return null;
      localId = selectedId;
    }

    const compoundId = `talk:${localId}`;
    const videoUrl = `/api/v1/proxy/local-content/stream/talk/${localId}`;

    // Extract parent folder from localId (e.g., "ldsgc202510/13" → "ldsgc202510")
    const pathParts = localId.split('/');
    const folderId = pathParts.length > 1 ? pathParts[0] : null;
    const parentTitle = formatConferenceName(folderId);

    // Load talk manifest for style/cssType config
    const manifest = loadYamlSafe(path.join(basePath, 'manifest')) || {};
    const ambientUrl = manifest.ambient ? this._selectAmbientUrl() : null;

    // Probe video file for duration if not in YAML metadata (cached)
    let duration = metadata.duration || 0;
    if (!duration) {
      const videoPath = path.resolve(this.mediaPath, 'video', 'readalong', 'talks', `${localId}.mp4`);
      if (this._durationCache.has(videoPath)) {
        duration = this._durationCache.get(videoPath);
      } else {
        try {
          const probedMeta = await parseFile(videoPath, { duration: true });
          duration = probedMeta?.format?.duration ? Math.round(probedMeta.format.duration) : 0;
        } catch (err) { /* leave as 0 */ }
        this._durationCache.set(videoPath, duration);
      }
    }

    return new PlayableItem({
      id: compoundId,
      source: this.source,
      localId,
      title: metadata.title || localId,
      type: manifest.cssType || 'talk',
      mediaType: 'video',
      mediaUrl: videoUrl,
      videoUrl,
      ambientUrl,
      duration,
      resumable: true,
      description: metadata.description,
      style: manifest.style || null,
      metadata: {
        type: manifest.cssType || 'talk',
        contentFormat: 'readalong',
        cssType: manifest.cssType || 'talk',
        speaker: metadata.speaker,
        date: metadata.date,
        servedLive: metadata.servedLive ?? metadata.served_live ?? metadata.live ?? metadata.isLive ?? null,
        selected: metadata.selected ?? metadata.featured ?? null,
        description: metadata.description,
        content: metadata.content || [],
        mediaFile: `video/readalong/talks/${localId}.mp4`,
        // Parent info for UI display
        parentTitle: parentTitle,
        grandparentTitle: metadata.speaker
      }
    });
  }

  /**
   * Get scripture item by local ID
   * @param {string} localId - e.g., "bom/sebom/31103" (volume/version/verseId)
   * @returns {Promise<PlayableItem|null>}
   * @private
   */
  async _getScripture(localId) {
    const basePath = path.resolve(this.dataPath, 'readalong', 'scripture');
    const mediaBasePath = path.resolve(this.mediaPath, 'audio', 'readalong', 'scripture');
    const manifest = loadYamlSafe(path.join(basePath, 'manifest')) || {};

    const parts = localId.split('/');
      const isExplicitPath = parts.length === 3 && /^\d+$/.test(parts[2]);
    let resolvedLocalId = localId;
    let resolvedAudioPath = null;

    if (!isExplicitPath) {
      const resolved = ScriptureResolver.resolve(localId, basePath, {
        mediaPath: mediaBasePath,
        defaults: manifest.defaults || {},
        allowVolumeAsContainer: true
      });
      if (!resolved) return null;

      if (resolved.isContainer && resolved.volume) {
        const volumeTitles = manifest.volumeTitles || {};
        const title = volumeTitles[resolved.volume] || resolved.volume.toUpperCase();
        return new ListableItem({
          id: `scripture:${resolved.volume}`,
          source: this.source,
          localId: resolved.volume,
          title,
          type: 'scripture',
          itemType: 'container',
          childCount: null,
          metadata: {
            type: 'scripture',
            volume: resolved.volume,
            volumeTitle: title,
            librarySectionTitle: 'Scripture'
          }
        });
      }

      if (!resolved.textPath) return null;
      resolvedLocalId = resolved.textPath;
      resolvedAudioPath = resolved.audioPath || resolved.textPath;
    }

    const pathParts = resolvedLocalId.split('/');
    const requestedVolume = pathParts[0] || null;
    const requestedVersion = pathParts[1] || null;
    const requestedVerseId = pathParts[2] || null;
    const audioParts = (resolvedAudioPath || resolvedLocalId).split('/');
    const audioVersion = audioParts[1] || requestedVersion;
    const audioVerseId = audioParts[2] || requestedVerseId;

    // Try loading YAML for requested version, fall back to other versions
    let rawData = loadContainedYaml(basePath, resolvedLocalId);
    let resolvedVersion = requestedVersion;
    if (!rawData && requestedVolume && requestedVersion && requestedVerseId) {
      const volumeDir = path.join(basePath, requestedVolume);
      if (dirExists(volumeDir)) {
        for (const altVersion of listEntries(volumeDir)) {
          if (altVersion === requestedVersion) continue;
          const altId = `${requestedVolume}/${altVersion}/${requestedVerseId}`;
          rawData = loadContainedYaml(basePath, altId);
          if (rawData) {
            resolvedVersion = altVersion;
            break;
          }
        }
      }
    }
    if (!rawData) return null;

    // Parse path components: volume/version/verseId
    const volume = rawData.volume || requestedVolume;
    const version = requestedVersion;
    const verseId = rawData.chapter || requestedVerseId;

    // Use reference from YAML if present, otherwise generate from verse_id
    let reference = rawData.reference || resolvedLocalId;
    if (!rawData.reference && verseId && /^\d+$/.test(verseId)) {
      try {
        reference = generateReference(verseId).replace(/:1$/, '');
      } catch (e) {
        reference = resolvedLocalId;
      }
    }

    // Handle array format (actual scripture files are arrays of verse objects)
    let verses = [];
    if (Array.isArray(rawData)) {
      verses = rawData.map(v => ({
        verse_id: v.verse_id,
        verse: v.verse,
        text: v.text,
        format: v.format,
        headings: v.headings
      }));
    } else if (rawData.verses) {
      verses = rawData.verses;
    }

    // Construct media file path if not in YAML
    let mediaFile = rawData.mediaFile;
    if (!mediaFile && volume && verseId) {
      // Try requested version with any audio extension
      const versionDir = path.join(this.mediaPath, 'audio', 'readalong', 'scripture', volume, audioVersion || '');
      const found = audioVersion ? findMediaFileByPrefix(versionDir, audioVerseId) : null;

      if (found) {
        mediaFile = path.relative(this.mediaPath, found);
      } else {
        // Version fallback: scan other version dirs in this volume
        const volumeDir = path.join(this.mediaPath, 'audio', 'readalong', 'scripture', volume);
        if (dirExists(volumeDir)) {
          for (const altVersion of listEntries(volumeDir)) {
            if (altVersion === version) continue;
            const altDir = path.join(volumeDir, altVersion);
            const altFound = findMediaFileByPrefix(altDir, verseId);
            if (altFound) {
              mediaFile = path.relative(this.mediaPath, altFound);
              break;
            }
          }
        }
      }
      // Final fallback: hardcoded .mp3 path (for legacy compat)
      if (!mediaFile) {
        mediaFile = `audio/readalong/scripture/${volume}/${audioVersion}/${audioVerseId}.mp3`;
      }
    }

    const compoundId = `scripture:${resolvedLocalId}`;
    const mediaUrl = `/api/v1/proxy/local-content/stream/scripture/${resolvedLocalId}`;
    const ambientUrl = manifest.ambient ? this._selectAmbientUrl() : null;

    return new PlayableItem({
      id: compoundId,
      source: this.source,
      localId: resolvedLocalId,
      title: reference,
      type: 'scripture',
      mediaType: 'audio',
      mediaUrl,
      ambientUrl,
      duration: rawData.duration || 0,
      resumable: true,
      metadata: {
        contentFormat: 'readalong',
        reference,
        volume,
        version,
        chapter: verseId,
        verses,
        mediaFile
      }
    });
  }

  /**
   * Get a folder of talks as a ListableItem container
   * Handles nested hierarchy: Series → Conferences → Talks
   * @param {string} folderId - Folder name (e.g., "ldsgc202510"), alias (e.g., "ldsgc"), or nested path (e.g., "ldsgc/ldsgc202510")
   * @returns {Promise<ListableItem|null>}
   * @private
   */
  async _getTalkFolder(folderId) {
    const basePath = path.resolve(this.dataPath, 'readalong', 'talks');
    const mediaBasePath = path.resolve(this.mediaPath, 'video', 'readalong', 'talks');

    // Check for nested path first (series/conference pattern in media)
    const nestedMediaPath = path.join(mediaBasePath, folderId);
    const isNestedPath = folderId.includes('/');

    // Determine container type
    const containerType = resolveContainerType(folderId, this.mediaPath);

    // Handle series folder (contains conferences, not talks directly)
    if (containerType === 'series') {
      return this._getSeriesFolder(folderId);
    }

    // Try alias resolution first (e.g., "ldsgc" → "ldsgc202510" or check nested media)
    let actualFolderId = folderId;
    let parentSeriesId = null;

    if (!isNestedPath) {
      // Check if this is a series alias that should resolve to latest conference
      const resolvedFolder = this._resolveLatestFolder(folderId);
      if (resolvedFolder) {
        actualFolderId = resolvedFolder;
      } else {
        // Check if folderId is nested under a parent folder
        const nestedPath = resolveNestedConferencePath(folderId, basePath, mediaBasePath);
        if (nestedPath) {
          return this._getTalkFolder(nestedPath);
        }
      }
    } else {
      // Parse nested path: series/conference
      const parts = folderId.split('/');
      parentSeriesId = parts[0];
      actualFolderId = parts[parts.length - 1];
    }

    // Try data path first (where YAML metadata lives)
    let folderPath = buildContainedPath(basePath, actualFolderId);

    // If not in data path, check nested media path structure
    if (!folderPath || !dirExists(folderPath)) {
      const nestedDataPath = path.join(basePath, parentSeriesId || '', actualFolderId);
      if (dirExists(nestedDataPath)) {
        folderPath = nestedDataPath;
      }
    }

    if (!folderPath || !dirExists(folderPath)) {
      return null;
    }

    try {
      const talkIds = listYamlFiles(folderPath);
      const children = [];

      for (const talkId of talkIds) {
        const talkPath = parentSeriesId
          ? `${parentSeriesId}/${actualFolderId}/${talkId}`
          : `${actualFolderId}/${talkId}`;
        // Skip talks that have no corresponding media file
        const mediaFilePath = path.join(mediaBasePath, `${talkPath}.mp4`);
        if (!fileExists(mediaFilePath)) continue;
        const item = await this._getTalk(talkPath);
        if (item) children.push(item);
      }

      // Load metadata from media path for title/parentTitle
      const mediaMetadataPath = path.join(mediaBasePath, folderId, 'metadata');
      const metadata = loadYamlSafe(mediaMetadataPath);

      // Build title: from metadata, or format from folder name
      let title = metadata?.title || formatConferenceName(actualFolderId) || actualFolderId;

      // Build parentTitle: from parent series metadata
      let parentTitle = null;
      if (parentSeriesId) {
        parentTitle = formatSeriesTitle(parentSeriesId, this.mediaPath);
      } else {
        // Extract prefix from folder name and try to get series title
        const prefixMatch = actualFolderId.match(/^([a-z]+)\d/i);
        if (prefixMatch) {
          const prefix = prefixMatch[1].toLowerCase();
          parentTitle = formatSeriesTitle(prefix, this.mediaPath);
        }
      }

      // Build thumbnail URL with cascading fallback (self → parent series)
      let thumbnail = null;
      const fs = await import('fs');
      const imgNames = ['cover.jpg', 'show.jpg', 'cover.png', 'show.png'];

      // Check own folder first
      const folderMediaPath = path.join(mediaBasePath, folderId);
      if (dirExists(folderMediaPath)) {
        for (const imgName of imgNames) {
          if (fs.existsSync(path.join(folderMediaPath, imgName))) {
            thumbnail = `/api/v1/local/stream/video/readalong/talks/${folderId}/${imgName}`;
            break;
          }
        }
      }

      // Fallback to parent series folder
      if (!thumbnail && parentSeriesId) {
        const seriesMediaPath = path.join(mediaBasePath, parentSeriesId);
        if (dirExists(seriesMediaPath)) {
          for (const imgName of imgNames) {
            if (fs.existsSync(path.join(seriesMediaPath, imgName))) {
              thumbnail = `/api/v1/local/stream/video/readalong/talks/${parentSeriesId}/${imgName}`;
              break;
            }
          }
        }
      }

      // Fallback using prefix extraction (e.g., ldsgc202510 → ldsgc)
      if (!thumbnail && !parentSeriesId) {
        const prefixMatch = actualFolderId.match(/^([a-z]+)\d/i);
        if (prefixMatch) {
          const seriesId = prefixMatch[1].toLowerCase();
          const seriesMediaPath = path.join(mediaBasePath, seriesId);
          if (dirExists(seriesMediaPath)) {
            for (const imgName of imgNames) {
              if (fs.existsSync(path.join(seriesMediaPath, imgName))) {
                thumbnail = `/api/v1/local/stream/video/readalong/talks/${seriesId}/${imgName}`;
                break;
              }
            }
          }
        }
      }

      if (!thumbnail) {
        // Filter children to only those with valid video files
        const childrenWithMedia = children.filter(child => {
          const mediaFile = child.metadata?.mediaFile || (child.localId ? `video/readalong/talks/${child.localId}.mp4` : null);
          if (!mediaFile) return false;
          const fullMediaPath = path.join(this.mediaPath, mediaFile);
          return fileExists(fullMediaPath);
        });

        const selectedChild = selectTalkForThumbnail(childrenWithMedia);
        if (selectedChild) {
          const mediaFile = selectedChild.metadata?.mediaFile || `video/readalong/talks/${selectedChild.localId}.mp4`;
          thumbnail = buildLocalThumbnailUrl(mediaFile);
        }
      }

      return new ListableItem({
        id: `talk:${folderId}`,  // Keep original path in ID for consistency
        source: this.source,
        localId: actualFolderId, // Use resolved folder for actual path
        title,
        type: containerType,
        thumbnail,
        itemType: 'container',
        childCount: children.length,
        children,
        metadata: {
          type: containerType,
          parentTitle,
          librarySectionTitle: parentTitle || 'Talks',
          childCount: children.length
        }
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * Get a series folder containing conference subfolders
   * @param {string} seriesId - Series folder name (e.g., "ldsgc")
   * @returns {Promise<ListableItem|null>}
   * @private
   */
  async _getSeriesFolder(seriesId) {
    const mediaBasePath = path.resolve(this.mediaPath, 'video', 'readalong', 'talks');
    const seriesPath = path.join(mediaBasePath, seriesId);

    if (!dirExists(seriesPath)) return null;

    try {
      // List conference subfolders
      const entries = listEntries(seriesPath);
      const conferencePattern = /^[a-z]+\d{6}$/i;
      const conferenceIds = entries.filter(e => conferencePattern.test(e));

      const children = [];
      for (const confId of conferenceIds) {
        const confPath = `${seriesId}/${confId}`;
        const confItem = await this._getTalkFolder(confPath);
        if (confItem) {
          // Convert PlayableItem children to ListableItem references
          children.push(new ListableItem({
            id: `talk:${confPath}`,
            source: this.source,
            localId: confId,
            title: confItem.title,
            type: 'conference',
            thumbnail: confItem.thumbnail,
            itemType: 'container',
            childCount: confItem.childCount,
            metadata: confItem.metadata
          }));
        }
      }

      // Load series title from metadata or format folder name
      const title = formatSeriesTitle(seriesId, this.mediaPath);

      // Build thumbnail URL (check cover.jpg, show.jpg)
      let thumbnail = null;
      const fs = await import('fs');
      for (const imgName of ['cover.jpg', 'show.jpg', 'cover.png', 'show.png']) {
        if (fs.existsSync(path.join(seriesPath, imgName))) {
          thumbnail = `/api/v1/local/stream/video/readalong/talks/${seriesId}/${imgName}`;
          break;
        }
      }

      return new ListableItem({
        id: `talk:${seriesId}`,
        source: this.source,
        localId: seriesId,
        title,
        type: 'series',
        thumbnail,
        itemType: 'container',
        childCount: children.length,
        children,
        metadata: {
          type: 'series',
          librarySectionTitle: 'Talks',
          childCount: children.length
        }
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * Get song item by collection and number
   * @param {string} collection - Song collection ('hymn' or 'primary')
   * @param {string} number - Song number
   * @returns {Promise<PlayableItem|null>}
   * @private
   */
  async _getSong(collection, number) {
    // Song files are named with zero-padded prefixes: "0304-title.yml"
    // Use loadYamlByPrefix to find by numeric prefix
    // dataPath is already the content directory (e.g., /data/content)
    const basePath = path.resolve(this.dataPath, 'singalong', collection);
    const metadata = loadYamlByPrefix(basePath, number);
    if (!metadata) return null;

    const compoundId = `${collection}:${number}`;
    const mediaUrl = `/api/v1/proxy/local-content/stream/${collection}/${number}`;

    // Handle different YAML field names for song number
    // YAML may have: number, hymn_num, song_num, or we parse from path
    const songNumber = metadata.number || metadata.hymn_num || metadata.song_num || parseInt(number, 10);

    // Find the actual media file if not specified in YAML
    // Try _ldsgc subdirectory first (General Conference recordings), then root
    let mediaFile = metadata.mediaFile;
    if (!mediaFile && this.mediaPath) {
      const { findMediaFileByPrefix } = await import('../../../0_system/utils/FileIO.mjs');
      const preferences = collection === 'hymn' ? ['_ldsgc', ''] : [''];
      for (const pref of preferences) {
        const searchDir = pref
          ? path.join(this.mediaPath, 'audio', 'singalong', collection, pref)
          : path.join(this.mediaPath, 'audio', 'singalong', collection);
        const mediaFilePath = findMediaFileByPrefix(searchDir, songNumber);
        if (mediaFilePath) {
          const subDir = pref ? `${pref}/` : '';
          mediaFile = `audio/singalong/${collection}/${subDir}${path.basename(mediaFilePath)}`;
          break;
        }
      }
    }

    return new PlayableItem({
      id: compoundId,
      source: this.source,
      localId: number,
      title: metadata.title || `${collection} ${number}`,
      type: collection,
      mediaType: 'audio',
      mediaUrl,
      thumbnail: this._songCollectionThumbnail(collection),
      duration: metadata.duration || 0,
      resumable: false, // songs don't need resume
      metadata: {
        contentFormat: 'singalong',
        number: songNumber,
        collection: metadata.collection || collection,
        verses: metadata.verses || [],
        lyrics: metadata.lyrics,
        mediaFile
      }
    });
  }

  /**
   * Get poem item by local ID
   * @param {string} localId - e.g., "remedy/01"
   * @returns {Promise<PlayableItem|null>}
   * @private
   */
  async _getPoem(localId) {
    const basePath = path.resolve(this.dataPath, 'readalong', 'poetry');
    const metadata = loadContainedYaml(basePath, localId);
    if (!metadata) return null;

    const compoundId = `poem:${localId}`;
    const mediaUrl = `/api/v1/proxy/local-content/stream/poem/${localId}`;

    return new PlayableItem({
      id: compoundId,
      source: this.source,
      localId,
      title: metadata.title || localId,
      type: 'poem',
      mediaType: 'audio',
      mediaUrl,
      duration: metadata.duration || 0,
      resumable: false, // poems don't track progress
      metadata: {
        contentFormat: 'readalong',
        poem_id: localId,
        author: metadata.author,
        condition: metadata.condition,
        also_suitable_for: metadata.also_suitable_for || [],
        verses: metadata.verses || [],
        mediaFile: metadata.mediaFile
      }
    });
  }

  /**
   * Search local content (talks, hymns, poems).
   * Scriptures use reference parsing, not text search.
   * @param {Object} query
   * @param {string} query.text - Search text (min 2 chars)
   * @param {string} [query.mediaType] - Filter by media type
   * @param {number} [query.take=50] - Max results
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search({ text, mediaType, take = 50 }) {
    if (!text || text.length < 2) return { items: [], total: 0 };

    const searchLower = text.toLowerCase();
    const results = [];

    // Search talks (by title, speaker in metadata)
    if (!mediaType || mediaType === 'video') {
      const talkResults = await this._searchTalks(searchLower, take - results.length);
      results.push(...talkResults);
    }

    // Search hymns (by title, number)
    if (!mediaType || mediaType === 'audio') {
      if (results.length < take) {
        const hymnResults = await this._searchSongs('hymn', searchLower, take - results.length);
        results.push(...hymnResults);
      }

      // Search primary songs
      if (results.length < take) {
        const primaryResults = await this._searchSongs('primary', searchLower, take - results.length);
        results.push(...primaryResults);
      }

      // Search poems (by title, author)
      if (results.length < take) {
        const poemResults = await this._searchPoems(searchLower, take - results.length);
        results.push(...poemResults);
      }
    }

    return { items: results, total: results.length };
  }

  /**
   * Search talks by title and speaker
   * @param {string} searchText - Lowercase search text
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   * @private
   */
  async _searchTalks(searchText, limit) {
    if (limit <= 0) return [];

    const basePath = path.resolve(this.dataPath, 'readalong', 'talks');
    const mediaBasePath = path.resolve(this.mediaPath, 'video', 'readalong', 'talks');
    const results = [];

    if (!dirExists(basePath)) return [];

    try {
      const fs = await import('fs');

      // Helper to search a conference folder
      const searchFolder = async (folderId, folderPath) => {
        if (results.length >= limit) return;

        const talkFiles = listYamlFiles(folderPath);
        for (const talkId of talkFiles) {
          if (results.length >= limit) break;

          const talkPath = `${folderId}/${talkId}`;
          const metadata = loadContainedYaml(basePath, talkPath);
          if (!metadata) continue;

          const title = (metadata.title || '').toLowerCase();
          const speaker = (metadata.speaker || '').toLowerCase();

          if (title.includes(searchText) || speaker.includes(searchText)) {
            const item = await this._getTalk(talkPath);
            if (item) results.push(item);
          }
        }
      };

      // Search nested structure (series → conferences)
      if (dirExists(mediaBasePath)) {
        const seriesEntries = listEntries(mediaBasePath);
        const conferencePattern = /^[a-z]+\d{6}$/i;

        for (const entry of seriesEntries) {
          if (results.length >= limit) break;
          if (entry.startsWith('.') || entry.startsWith('_')) continue;

          const entryPath = path.join(mediaBasePath, entry);
          if (!fs.statSync(entryPath).isDirectory()) continue;

          // Check if series folder (contains conferences)
          const subEntries = listEntries(entryPath);
          const isSeriesFolder = subEntries.some(e => conferencePattern.test(e));

          if (isSeriesFolder) {
            // Search each conference subfolder
            for (const confEntry of subEntries) {
              if (results.length >= limit) break;
              if (!conferencePattern.test(confEntry)) continue;

              const confDataPath = path.join(basePath, entry, confEntry);
              if (dirExists(confDataPath)) {
                await searchFolder(`${entry}/${confEntry}`, confDataPath);
              }
            }
          }
        }
      }

      // Search flat conference folders in data path
      const dataEntries = fs.readdirSync(basePath, { withFileTypes: true });
      for (const e of dataEntries) {
        if (results.length >= limit) break;
        if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;

        const folderPath = path.join(basePath, e.name);
        await searchFolder(e.name, folderPath);
      }
    } catch (err) {
      // Ignore errors, return what we found
    }

    return results;
  }

  /**
   * Search songs by title and number
   * @param {string} collection - 'hymn' or 'primary'
   * @param {string} searchText - Lowercase search text
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   * @private
   */
  async _searchSongs(collection, searchText, limit) {
    if (limit <= 0) return [];

    const basePath = path.resolve(this.dataPath, 'singalong', collection);
    const results = [];

    try {
      const files = listYamlFiles(basePath);

      for (const file of files) {
        if (results.length >= limit) break;

        // Extract number from filename
        const match = file.match(/^0*(\d+)/);
        if (!match) continue;

        const number = match[1];

        // Check if search matches number directly
        if (number === searchText || number.startsWith(searchText)) {
          const item = await this._getSong(collection, number);
          if (item) results.push(item);
          continue;
        }

        // Load metadata to search title
        const metadata = loadYamlByPrefix(basePath, number);
        if (!metadata) continue;

        const title = (metadata.title || '').toLowerCase();
        if (title.includes(searchText)) {
          const item = await this._getSong(collection, number);
          if (item) results.push(item);
        }
      }
    } catch (err) {
      // Ignore errors
    }

    return results;
  }

  /**
   * Search poems by title and author
   * @param {string} searchText - Lowercase search text
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   * @private
   */
  async _searchPoems(searchText, limit) {
    if (limit <= 0) return [];

    const basePath = path.resolve(this.dataPath, 'poetry');
    const results = [];

    if (!dirExists(basePath)) return [];

    try {
      const fs = await import('fs');
      const collections = fs.readdirSync(basePath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);

      for (const collection of collections) {
        if (results.length >= limit) break;

        const collectionPath = path.join(basePath, collection);
        const files = listYamlFiles(collectionPath);

        for (const file of files) {
          if (results.length >= limit) break;

          const localId = `${collection}/${file}`;
          const metadata = loadContainedYaml(basePath, localId);
          if (!metadata) continue;

          const title = (metadata.title || '').toLowerCase();
          const author = (metadata.author || '').toLowerCase();

          if (title.includes(searchText) || author.includes(searchText)) {
            const item = await this._getPoem(localId);
            if (item) results.push(item);
          }
        }
      }
    } catch (err) {
      // Ignore errors
    }

    return results;
  }

  /**
   * Get search capabilities for ContentQueryService
   * @returns {{canonical: string[], specific: string[]}}
   */
  getSearchCapabilities() {
    return {
      canonical: ['text', 'mediaType'],
      specific: ['speaker', 'collection']
    };
  }

  /**
   * Get query mappings for ContentQueryService
   * @returns {Object}
   */
  getQueryMappings() {
    return {
      creator: 'speaker',
      person: 'speaker'
    };
  }

  // ---------------------------------------------------------------------------
  // Sibling resolution (ISiblingsCapable)
  // ---------------------------------------------------------------------------

  /** @type {Set<string>} Collections that support root-level sibling listing */
  static #COLLECTIONS = new Set(['scripture', 'hymn', 'primary', 'talk', 'poem']);
  /** @type {Set<string>} Scripture volume codes treated as collection roots */
  static #SCRIPTURE_VOLUMES = new Set(['ot', 'nt', 'bom', 'dc', 'pgp']);

  /**
   * Resolve siblings for local content items.
   * Handles collection roots (all hymns, all talks, scripture volumes).
   * Returns null for deep items to let the default fallback handle them.
   *
   * @param {string} compoundId - e.g., "hymn:123", "talk:", "scripture:ot"
   * @returns {Promise<{parent: Object, items: Array}|null>}
   */
  async resolveSiblings(compoundId) {
    const [prefix, localId] = compoundId.split(':');

    if (!LocalContentAdapter.#COLLECTIONS.has(prefix)) {
      return null; // Not a known collection, use default fallback
    }

    // Scripture: only volume roots (ot, nt, bom, dc, pgp) are treated as collection siblings
    if (prefix === 'scripture') {
      const isVolumeRoot = localId
        && !localId.includes('/')
        && LocalContentAdapter.#SCRIPTURE_VOLUMES.has(localId.toLowerCase());
      if (!isVolumeRoot) {
        return null; // Deep scripture item, use default fallback
      }
    }

    // Collection root — list all items in this collection
    const items = await this.listCollection(prefix);
    const titleized = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    const parent = {
      id: `${prefix}:`,
      title: titleized,
      source: prefix,
      thumbnail: items[0]?.thumbnail || null,
      parentId: null,
      libraryId: null
    };

    return {
      parent,
      items,
      sourceOverride: prefix
    };
  }
}

export default LocalContentAdapter;
