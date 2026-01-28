// backend/src/2_adapters/persistence/yaml/YamlWatchStateDatastore.mjs
import path from 'path';
import { WatchState } from '#domains/content/entities/WatchState.mjs';
import {
  ensureDir,
  loadYamlSafe,
  saveYaml,
  deleteYaml
} from '#system/utils/FileIO.mjs';
import { IWatchStateDatastore } from '#apps/content/ports/IWatchStateDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * YAML-based watch state persistence
 */
export class YamlWatchStateDatastore extends IWatchStateDatastore {
  /**
   * @param {Object} config
   * @param {string} config.basePath - Base path for watch state files
   */
  constructor(config) {
    super();
    if (!config.basePath) throw new InfrastructureError('YamlWatchStateDatastore requires basePath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'basePath'
      });
    this.basePath = config.basePath;
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
   * Get watch state for an item
   * @param {string} itemId
   * @param {string} storagePath
   * @returns {Promise<WatchState|null>}
   */
  async get(itemId, storagePath) {
    const data = this._readFile(storagePath);
    const stateData = data[itemId];
    if (!stateData) return null;
    return WatchState.fromJSON({ itemId, ...stateData });
  }

  /**
   * Set watch state for an item
   * @param {WatchState} state
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
   * Get all watch states for a storage path
   * @param {string} storagePath
   * @returns {Promise<WatchState[]>}
   */
  async getAll(storagePath) {
    const data = this._readFile(storagePath);
    return Object.entries(data).map(([itemId, stateData]) =>
      WatchState.fromJSON({ itemId, ...stateData })
    );
  }

  /**
   * Clear all watch states for a storage path
   * @param {string} storagePath
   * @returns {Promise<void>}
   */
  async clear(storagePath) {
    const basePath = this._getBasePath(storagePath);
    deleteYaml(basePath);
  }
}

export default YamlWatchStateDatastore;
