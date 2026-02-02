// backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
import path from 'path';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import {
  ensureDir,
  loadYamlSafe,
  saveYaml,
  deleteYaml,
  listYamlFiles,
  dirExists
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
   * Normalize persisted data to domain entity format
   * Handles legacy formats (e.g., scripture: seconds/percent/time)
   * @param {string} itemId
   * @param {Object} data - Raw persisted data
   * @returns {MediaProgress}
   * @private
   */
  _toDomainEntity(itemId, data) {
    // Normalize field names from legacy formats
    const playhead = data.playhead ?? data.seconds ?? 0;
    const lastPlayed = data.lastPlayed ?? data.time ?? null;

    // If we have percent but no duration, synthesize duration from percent
    // This preserves the percent value when calculated by the domain entity
    // Also check mediaDuration (legacy Plex field name)
    let duration = data.duration ?? data.mediaDuration ?? 0;
    if (!duration && data.percent && playhead > 0) {
      // percent = (playhead / duration) * 100
      // duration = playhead / (percent / 100)
      duration = Math.round(playhead / (data.percent / 100));
    }

    return new MediaProgress({
      itemId,
      playhead,
      duration,
      playCount: data.playCount ?? 0,
      lastPlayed,
      watchTime: data.watchTime ?? 0
    });
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
    return this._toDomainEntity(itemId, stateData);
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
      this._toDomainEntity(itemId, stateData)
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

  /**
   * Get all media progress entries from all library files for a source.
   * Used as fallback when the source is offline and we can't determine the specific library.
   * Scans all files in {basePath}/{source}/ directory (e.g., plex/14_fitness.yml, plex/24_church-series.yml)
   * @param {string} source - Source name (e.g., 'plex')
   * @returns {Promise<MediaProgress[]>}
   */
  async getAllFromAllLibraries(source) {
    const sourceDir = path.join(this.basePath, source);

    if (!dirExists(sourceDir)) {
      return [];
    }

    // Get all YAML files in the source directory (e.g., 14_fitness, 24_church-series)
    const libraryFiles = listYamlFiles(sourceDir, { stripExtension: true });

    const allProgress = [];
    for (const libraryFile of libraryFiles) {
      const storagePath = `${source}/${libraryFile}`;
      const data = this._readFile(storagePath);

      for (const [itemId, stateData] of Object.entries(data)) {
        allProgress.push(this._toDomainEntity(itemId, stateData));
      }
    }

    return allProgress;
  }
}

export default YamlMediaProgressMemory;
