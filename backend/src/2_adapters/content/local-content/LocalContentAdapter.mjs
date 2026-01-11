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

  get name() {
    return 'local-content';
  }

  get prefixes() {
    return ['talk', 'scripture'];
  }

  /**
   * @param {string} id - Compound ID (e.g., "talk:general/2024-04-talk1")
   * @returns {boolean}
   */
  canResolve(id) {
    const prefix = id.split(':')[0];
    return this.prefixes.includes(prefix);
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

    return null;
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
        source: this.name,
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
}
