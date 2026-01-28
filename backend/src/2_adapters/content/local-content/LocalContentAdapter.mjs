// backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs
import path from 'path';
import { generateReference } from 'scripture-guide';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import {
  buildContainedPath,
  loadContainedYaml,
  loadYamlByPrefix,
  listYamlFiles,
  dirExists
} from '#system/utils/FileIO.mjs';

// Threshold for considering an item "watched" (90%)
const WATCHED_THRESHOLD = 90;

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
  }

  get source() {
    return 'local-content';
  }

  get prefixes() {
    return [
      { prefix: 'talk' },
      { prefix: 'scripture' },
      { prefix: 'hymn' },
      { prefix: 'primary' },
      { prefix: 'poem' }
    ];
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
   * Select a random unwatched talk from a folder.
   * If all are watched, clears the folder's watch history and picks randomly.
   * Uses mediaProgressMemory for async watch state loading.
   * @param {string} folderId - Folder ID (e.g., "ldsgc202510")
   * @returns {Promise<string|null>} Selected talk localId or null
   * @private
   */
  async _selectFromFolder(folderId) {
    const folder = await this._getTalkFolder(folderId);
    if (!folder?.children?.length) return null;

    // Build list of all keys and check watch state via mediaProgressMemory
    const allLocalIds = folder.children.map(child => child.localId);
    const unwatchedIds = [];

    // Load watch state for each item via mediaProgressMemory
    for (const localId of allLocalIds) {
      const mediaKey = localId; // Key within 'talks' storage
      let state = null;
      if (this.mediaProgressMemory) {
        try {
          state = await this.mediaProgressMemory.get('talks', mediaKey);
        } catch (err) {
          // Ignore errors, treat as unwatched
        }
      }
      if (!this._isWatched(state)) {
        unwatchedIds.push(localId);
      }
    }

    // If all watched, clear via mediaProgressMemory and pick random from all
    if (unwatchedIds.length === 0) {
      if (this.mediaProgressMemory) {
        for (const localId of allLocalIds) {
          try {
            await this.mediaProgressMemory.delete('talks', localId);
          } catch (err) {
            // Ignore delete errors
          }
        }
      }
      // Pick random from all
      return allLocalIds[Math.floor(Math.random() * allLocalIds.length)];
    }

    // Pick random from unwatched
    return unwatchedIds[Math.floor(Math.random() * unwatchedIds.length)];
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
  getStoragePath(id) {
    const prefix = id.split(':')[0];
    if (prefix === 'talk') return 'talks';
    if (prefix === 'scripture') return 'scripture';
    if (prefix === 'hymn') return 'songs';
    if (prefix === 'primary') return 'songs';
    if (prefix === 'poem') return 'poetry';
    return 'local';
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
    const [prefix, localId] = id.split(':');
    if (!localId) return null;

    if (prefix === 'talk') {
      return this._getTalkFolder(localId);
    }

    return null;
  }

  /**
   * Resolve ID to playable items
   * @param {string} id
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    // Try as single item first
    const item = await this.getItem(id);
    if (item && item.isPlayable && item.isPlayable()) {
      return [item];
    }

    // Try as container
    const list = await this.getList(id);
    if (list && list.children) {
      return list.children.filter(c => c.isPlayable && c.isPlayable());
    }

    return [];
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
    const basePath = path.resolve(this.dataPath, 'songs', collection);
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
   * @returns {Promise<Array>}
   * @private
   */
  async _listTalkFolders() {
    const basePath = path.resolve(this.dataPath, 'talks');
    try {
      if (!dirExists(basePath)) return [];

      const fs = await import('fs');
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      const folders = entries
        .filter(e => e.isDirectory())
        .map(e => ({
          id: `talk:${e.name}`,
          source: 'local-content',
          localId: e.name,
          title: e.name,
          itemType: 'container'
        }));

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
    const basePath = path.resolve(this.dataPath, 'scripture');
    try {
      if (!dirExists(basePath)) return [];

      const fs = await import('fs');
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      const volumes = entries
        .filter(e => e.isDirectory())
        .map(e => ({
          id: `scripture:${e.name}`,
          source: 'local-content',
          localId: e.name,
          title: e.name.toUpperCase(),
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
    const basePath = path.resolve(this.dataPath, 'poetry');
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
   * @private
   */
  async _getTalk(localId) {
    const basePath = path.resolve(this.dataPath, 'talks');
    let metadata = loadContainedYaml(basePath, localId);

    // If not found as file, check if it's a folder and select random unwatched
    if (!metadata) {
      const selectedId = await this._selectFromFolder(localId);
      if (!selectedId) return null;
      metadata = loadContainedYaml(basePath, selectedId);
      if (!metadata) return null;
      localId = selectedId;
    }

    const compoundId = `talk:${localId}`;
    const mediaUrl = `/api/v1/proxy/local-content/stream/talk/${localId}`;

    return new PlayableItem({
      id: compoundId,
      source: this.source,
      localId,
      title: metadata.title || localId,
      type: 'talk',
      mediaType: 'video',
      mediaUrl,
      duration: metadata.duration || 0,
      resumable: true,
      description: metadata.description,
      metadata: {
        speaker: metadata.speaker,
        date: metadata.date,
        description: metadata.description,
        content: metadata.content || [],
        mediaFile: `video/talks/${localId}.mp4`
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
    const basePath = path.resolve(this.dataPath, 'scripture');
    const rawData = loadContainedYaml(basePath, localId);
    if (!rawData) return null;

    // Parse path components: volume/version/verseId
    const pathParts = localId.split('/');
    const volume = rawData.volume || pathParts[0] || null;
    const version = pathParts[1] || null;
    const verseId = rawData.chapter || pathParts[2] || null;

    // Use reference from YAML if present, otherwise generate from verse_id
    let reference = rawData.reference || localId;
    if (!rawData.reference && verseId && /^\d+$/.test(verseId)) {
      try {
        reference = generateReference(verseId).replace(/:1$/, '');
      } catch (e) {
        reference = localId;
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

    const compoundId = `scripture:${localId}`;
    const mediaUrl = `/api/v1/proxy/local-content/stream/scripture/${localId}`;

    return new PlayableItem({
      id: compoundId,
      source: this.source,
      localId,
      title: reference,
      type: 'scripture',
      mediaType: 'audio',
      mediaUrl,
      duration: rawData.duration || 0,
      resumable: true,
      metadata: {
        reference,
        volume,
        version,
        chapter: verseId,
        verses,
        mediaFile: rawData.mediaFile
      }
    });
  }

  /**
   * Get a folder of talks as a ListableItem container
   * @param {string} folderId - Folder name (e.g., "april2024")
   * @returns {Promise<ListableItem|null>}
   * @private
   */
  async _getTalkFolder(folderId) {
    const basePath = path.resolve(this.dataPath, 'talks');
    const folderPath = buildContainedPath(basePath, folderId);
    if (!folderPath) return null;

    try {
      if (!dirExists(folderPath)) {
        return null;
      }

      const talkIds = listYamlFiles(folderPath);
      const children = [];

      for (const talkId of talkIds) {
        const item = await this._getTalk(`${folderId}/${talkId}`);
        if (item) children.push(item);
      }

      return new ListableItem({
        id: `talk:${folderId}`,
        source: this.source,
        localId: folderId,
        title: folderId,
        itemType: 'container',
        children
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
    const basePath = path.resolve(this.dataPath, 'songs', collection);
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
          ? path.join(this.mediaPath, 'audio', 'songs', collection, pref)
          : path.join(this.mediaPath, 'audio', 'songs', collection);
        const mediaFilePath = findMediaFileByPrefix(searchDir, songNumber);
        if (mediaFilePath) {
          const subDir = pref ? `${pref}/` : '';
          mediaFile = `audio/songs/${collection}/${subDir}${path.basename(mediaFilePath)}`;
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
      duration: metadata.duration || 0,
      resumable: false, // songs don't need resume
      metadata: {
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
    const basePath = path.resolve(this.dataPath, 'poetry');
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
        poem_id: localId,
        author: metadata.author,
        condition: metadata.condition,
        also_suitable_for: metadata.also_suitable_for || [],
        verses: metadata.verses || [],
        mediaFile: metadata.mediaFile
      }
    });
  }
}

export default LocalContentAdapter;
