// backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import {
  loadYamlSafe,
  saveYaml,
  deleteYaml,
  listYamlFiles,
  dirExists
} from '#system/utils/FileIO.mjs';
import { IMediaProgressMemory } from '#apps/content/ports/IMediaProgressMemory.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { validateCanonicalSchema, LEGACY_TO_CANONICAL, serializeMediaProgress } from './mediaProgressSchema.mjs';

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
    // Guard against undefined storagePath
    if (!storagePath) {
      return `${this.basePath}/default`;
    }
    // Sanitize each path segment but preserve directory structure
    const safePath = storagePath
      .split('/')
      .filter(segment => segment.length > 0)  // Remove empty segments
      .map(segment => segment.replace(/[^a-zA-Z0-9-_]/g, '_'))
      .join('/');
    // Default to 'default' if path is empty after sanitization
    const finalPath = safePath || 'default';
    // Return path WITHOUT extension - FileIO adds .yml automatically
    return `${this.basePath}/${finalPath}`;
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
    // saveYaml handles directory creation internally
    saveYaml(basePath, data);
  }

  /**
   * Convert persisted YAML data to domain entity.
   *
   * CANONICAL FORMAT (after migrate-watch-history.mjs P0 migration):
   *   playhead, duration, percent, playCount, lastPlayed, watchTime
   *
   * @param {string} itemId
   * @param {Object} data - Raw persisted data
   * @returns {MediaProgress}
   * @private
   */
  _toDomainEntity(itemId, data) {
    return new MediaProgress({
      itemId,
      playhead: data.playhead ?? 0,
      duration: data.duration ?? 0,
      percent: data.percent ?? null,
      playCount: data.playCount ?? 0,
      lastPlayed: data.lastPlayed ?? null,
      watchTime: data.watchTime ?? 0,
      bookmark: data.bookmark ?? null
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
    const { itemId, ...rest } = serializeMediaProgress(state);

    // Validate schema before writing
    const validation = validateCanonicalSchema(rest);
    if (!validation.valid) {
      console.warn(
        '[YamlMediaProgressMemory] Attempting to write data with legacy fields',
        {
          itemId,
          storagePath,
          legacyFields: validation.legacyFields,
          hint: 'Use canonical field names: ' +
            validation.legacyFields.map(f => `${f} → ${LEGACY_TO_CANONICAL[f] || 'remove'}`).join(', ')
        }
      );
    }

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
    const sourceDir = `${this.basePath}/${source}`;

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
