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
}
