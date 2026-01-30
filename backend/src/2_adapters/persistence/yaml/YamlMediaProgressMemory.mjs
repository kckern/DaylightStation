// backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
import path from 'path';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import {
  ensureDir,
  loadYamlSafe,
  saveYaml,
  deleteYaml
} from '#system/utils/FileIO.mjs';
import { IMediaProgressMemory } from '#apps/content/ports/IMediaProgressMemory.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * YAML-based media progress persistence
 */
export class YamlMediaProgressMemory extends IMediaProgressMemory {
  /**
   * @param {Object} config
   * @param {string} config.basePath - Base path for media progress files
   */
  constructor(config) {
    super();
    if (!config.basePath) throw new InfrastructureError('YamlMediaProgressMemory requires basePath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'basePath'
      });
    this.basePath = config.basePath;
    this.mediaKeyResolver = config.mediaKeyResolver || null;
  }

  /**
   * Get base path for a storage path
   * @param {string} storagePath
   * @returns {string}
   */
  _getBasePath(storagePath) {
    // Sanitize each path segment but preserve directory structure
    const safePath = storagePath
      .split('/')
      .filter(segment => segment.length > 0)  // Remove empty segments
      .map(segment => segment.replace(/[^a-zA-Z0-9-_]/g, '_'))
      .join('/');
    // Default to 'default' if path is empty after sanitization
    const finalPath = safePath || 'default';
    return path.join(this.basePath, `${finalPath}.yml`);
  }

  /**
   * Read all states from a file
   * @param {string} storagePath
   * @returns {Object}
   */
  _readFile(storagePath) {
    const basePath = this._getBasePath(storagePath);
    return loadYamlSafe(basePath) || {};
  }

  /**
   * Write all states to a file
   * @param {string} storagePath
   * @param {Object} data
   */
  _writeFile(storagePath, data) {
    const basePath = this._getBasePath(storagePath);
    ensureDir(path.dirname(basePath));
    saveYaml(basePath, data);
  }

  /**
   * Get media progress for an item
   * @param {string} itemId
   * @param {string} storagePath
   * @returns {Promise<MediaProgress|null>}
   */
  async get(itemId, storagePath) {
    const data = this._readFile(storagePath);
    const stateData = data[itemId];
    if (!stateData) return null;
    return MediaProgress.fromJSON({ itemId, ...stateData });
  }

  /**
   * Set media progress for an item
   * @param {MediaProgress} state
   * @param {string} storagePath
   * @returns {Promise<void>}
   */
  async set(state, storagePath) {
    const data = this._readFile(storagePath);
    const { itemId, ...rest } = state.toJSON();
    data[itemId] = rest;
    this._writeFile(storagePath, data);
  }

  /**
   * Get all media progress entries for a storage path
   * @param {string} storagePath
   * @returns {Promise<MediaProgress[]>}
   */
  async getAll(storagePath) {
    const data = this._readFile(storagePath);
    return Object.entries(data).map(([itemId, stateData]) =>
      MediaProgress.fromJSON({ itemId, ...stateData })
    );
  }

  /**
   * Clear all media progress entries for a storage path
   * @param {string} storagePath
   * @returns {Promise<void>}
   */
  async clear(storagePath) {
    const basePath = this._getBasePath(storagePath);
    deleteYaml(basePath);
  }
}

export default YamlMediaProgressMemory;
