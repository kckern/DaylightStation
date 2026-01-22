// backend/src/2_adapters/persistence/yaml/YamlWatchStateStore.mjs
import path from 'path';
import { WatchState } from '../../../1_domains/content/entities/WatchState.mjs';
import {
  ensureDir,
  loadYamlFromPath,
  saveYamlToPath,
  deleteFile,
  resolveYamlPath
} from '../../../0_infrastructure/utils/FileIO.mjs';

/**
 * YAML-based watch state persistence
 */
export class YamlWatchStateStore {
  /**
   * @param {Object} config
   * @param {string} config.basePath - Base path for watch state files
   */
  constructor(config) {
    if (!config.basePath) throw new Error('YamlWatchStateStore requires basePath');
    this.basePath = config.basePath;
  }

  /**
   * Get file path for a storage path
   * @param {string} storagePath
   * @returns {string}
   */
  _getFilePath(storagePath) {
    const safePath = storagePath.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.basePath, `${safePath}.yml`);
  }

  /**
   * Read all states from a file
   * @param {string} storagePath
   * @returns {Object}
   */
  _readFile(storagePath) {
    const filePath = this._getFilePath(storagePath);
    // Try both .yml and .yaml
    const basePath = filePath.replace(/\.yml$/, '');
    const resolvedPath = resolveYamlPath(basePath);
    if (!resolvedPath) return {};
    return loadYamlFromPath(resolvedPath) || {};
  }

  /**
   * Write all states to a file
   * @param {string} storagePath
   * @param {Object} data
   */
  _writeFile(storagePath, data) {
    const filePath = this._getFilePath(storagePath);
    ensureDir(path.dirname(filePath));
    saveYamlToPath(filePath, data);
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
    const filePath = this._getFilePath(storagePath);
    // Try both extensions
    const basePath = filePath.replace(/\.yml$/, '');
    deleteFile(`${basePath}.yml`);
    deleteFile(`${basePath}.yaml`);
  }
}
