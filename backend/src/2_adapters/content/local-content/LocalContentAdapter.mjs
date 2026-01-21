// backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs
import path from 'path';
import { generateReference } from 'scripture-guide';
import { PlayableItem } from '../../../1_domains/content/capabilities/Playable.mjs';
import { ListableItem } from '../../../1_domains/content/capabilities/Listable.mjs';
import {
  buildContainedPath,
  loadContainedYaml,
  loadYamlByPrefix,
  listYamlFiles,
  dirExists
} from '../../../0_infrastructure/utils/FileIO.mjs';

/**
 * Adapter for local content (talks, scriptures)
 */
export class LocalContentAdapter {
  /**
   * @param {Object} config
   * @param {string} config.dataPath - Path to data files (YAML metadata)
   * @param {string} config.mediaPath - Path to media files
   */
  constructor(config) {
    if (!config.dataPath) throw new Error('LocalContentAdapter requires dataPath');
    if (!config.mediaPath) throw new Error('LocalContentAdapter requires mediaPath');
    this.dataPath = config.dataPath;
    this.mediaPath = config.mediaPath;
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
   * @private
   */
  async _getTalk(localId) {
    const basePath = path.resolve(this.dataPath, 'talks');
    const metadata = loadContainedYaml(basePath, localId);
    if (!metadata) return null;

    const compoundId = `talk:${localId}`;
    const mediaUrl = `/proxy/local-content/stream/talk/${localId}`;

    return new PlayableItem({
      id: compoundId,
      source: this.source,
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
        description: metadata.description
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
    const mediaUrl = `/proxy/local-content/stream/scripture/${localId}`;

    return new PlayableItem({
      id: compoundId,
      source: this.source,
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
    const mediaUrl = `/proxy/local-content/stream/${collection}/${number}`;

    // Handle different YAML field names for song number
    // YAML may have: number, hymn_num, song_num, or we parse from path
    const songNumber = metadata.number || metadata.hymn_num || metadata.song_num || parseInt(number, 10);

    return new PlayableItem({
      id: compoundId,
      source: this.source,
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
        mediaFile: metadata.mediaFile
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
    const mediaUrl = `/proxy/local-content/stream/poem/${localId}`;

    return new PlayableItem({
      id: compoundId,
      source: this.source,
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
