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
   * @private
   */
  async _getTalk(localId) {
    const yamlPath = path.join(this.dataPath, 'talks', `${localId}.yaml`);

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
