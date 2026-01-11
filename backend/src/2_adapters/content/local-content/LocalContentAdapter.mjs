// backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { PlayableItem } from '../../../1_domains/content/capabilities/Playable.mjs';
import { ListableItem } from '../../../1_domains/content/capabilities/Listable.mjs';

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
      { prefix: 'scripture' }
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
   * Validate and normalize a path to ensure it stays within containment.
   * @param {string} localId - The local ID/path component
   * @param {string} subdir - Subdirectory within dataPath (e.g., 'talks')
   * @returns {string|null} - Normalized path if valid, null if path escapes containment
   * @private
   */
  _validatePath(localId, subdir) {
    // Normalize the path to resolve any . or .. segments
    const normalizedId = path.normalize(localId).replace(/^(\.\.[/\\])+/, '');
    const basePath = path.resolve(this.dataPath, subdir);
    const candidatePath = path.resolve(basePath, `${normalizedId}.yaml`);

    // Ensure the resolved path stays within the base directory
    if (!candidatePath.startsWith(basePath + path.sep) && candidatePath !== basePath) {
      return null;
    }

    return candidatePath;
  }

  /**
   * @private
   */
  async _getTalk(localId) {
    const yamlPath = this._validatePath(localId, 'talks');
    if (!yamlPath) return null;

    try {
      if (!fs.existsSync(yamlPath)) return null;
      const content = fs.readFileSync(yamlPath, 'utf8');
      const metadata = yaml.load(content);

      const compoundId = `talk:${localId}`;
      const mediaUrl = `/proxy/local-content/stream/talk/${localId}`;

      return new PlayableItem({
        id: compoundId,
        source: this.source,
        title: metadata.title || localId,
        mediaType: 'audio',
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
    } catch (err) {
      return null;
    }
  }

  /**
   * Get scripture item by local ID
   * @param {string} localId - e.g., "cfm/test-chapter"
   * @returns {Promise<PlayableItem|null>}
   * @private
   */
  async _getScripture(localId) {
    const yamlPath = this._validatePath(localId, 'scripture');
    if (!yamlPath) return null;

    try {
      if (!fs.existsSync(yamlPath)) return null;
      const content = fs.readFileSync(yamlPath, 'utf8');
      const metadata = yaml.load(content);

      const compoundId = `scripture:${localId}`;
      const mediaUrl = `/proxy/local-content/stream/scripture/${localId}`;

      return new PlayableItem({
        id: compoundId,
        source: this.source,
        title: metadata.reference || localId,
        type: 'scripture',
        mediaType: 'audio',
        mediaUrl,
        duration: metadata.duration || 0,
        resumable: true,
        metadata: {
          reference: metadata.reference,
          volume: metadata.volume,
          chapter: metadata.chapter,
          verses: metadata.verses || [],
          mediaFile: metadata.mediaFile
        }
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * Get a folder of talks as a ListableItem container
   * @param {string} folderId - Folder name (e.g., "april2024")
   * @returns {Promise<ListableItem|null>}
   * @private
   */
  async _getTalkFolder(folderId) {
    // Validate path stays within data directory
    const normalizedId = path.normalize(folderId).replace(/^(\.\.[/\\])+/, '');
    const basePath = path.resolve(this.dataPath, 'talks');
    const folderPath = path.resolve(basePath, normalizedId);

    if (!folderPath.startsWith(basePath + path.sep) && folderPath !== basePath) {
      return null;
    }

    try {
      if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return null;
      }

      const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.yaml'));
      const children = [];

      for (const file of files) {
        const talkId = file.replace('.yaml', '');
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
}
