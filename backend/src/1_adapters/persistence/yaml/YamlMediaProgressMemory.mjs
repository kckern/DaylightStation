// backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import {
  loadYamlSafe,
  saveYaml,
  deleteYaml,
  listYamlFiles,
  dirExists,
  listDirs,
  resolveYamlPath,
  getStats
} from '#system/utils/FileIO.mjs';
import { IMediaProgressMemory } from '#apps/content/ports/IMediaProgressMemory.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { validateCanonicalSchema, LEGACY_TO_CANONICAL } from './mediaProgressSchema.mjs';

function dehydrateMediaProgress(state) {
  const record = {
    contentId: state.contentId,
    playhead: state.playhead,
    duration: state.duration,
    percent: state.percent,
    playCount: state.playCount,
    lastPlayed: state.lastPlayed,
    watchTime: state.watchTime
  };
  if (state.completedAt) record.completedAt = state.completedAt;
  if (state.bookmark) record.bookmark = state.bookmark;
  if (state.spots !== undefined) record.spots = { ...(state.spots || {}) };
  if (state.lastDevice) record.lastDevice = state.lastDevice;
  return record;
}

// Dropbox writes "<name> (<host>'s conflicted copy <date>).yml" beside the
// real file. Those are stale forks, never a namespace of their own.
const CONFLICTED_COPY = /conflicted copy/i;

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
    // mtime-keyed parse cache: storagePath -> { mtimeMs, data }.
    // loadYamlSafe (fs.readFileSync + yaml.load) is otherwise uncached, so hot
    // paths re-parsed the same file repeatedly. mtime keying picks up app writes
    // AND external (Dropbox-synced) edits; writes invalidate explicitly.
    this._readCache = new Map();
  }

  /**
   * Get base path for a storage path
   * @param {string} storagePath
   * @returns {string}
   */
  _getBasePath(storagePath) {
    // Sanitize each path segment but preserve directory structure
    const safePath = (storagePath || '')
      .split('/')
      .filter(segment => segment.length > 0)  // Remove empty segments
      .map(segment => segment.replace(/[^a-zA-Z0-9-_]/g, '_'))
      .join('/');
    // Default to 'default' if path is empty after sanitization
    const finalPath = safePath || 'default';
    // Explicit .yml extension — keep adapter and FileIO in sync regardless of dotted segments
    return `${this.basePath}/${finalPath}.yml`;
  }

  /**
   * Read all states from a file
   * @param {string} storagePath
   * @returns {Object}
   */
  _readFile(storagePath) {
    const basePath = this._getBasePath(storagePath);
    const resolvedPath = resolveYamlPath(basePath);
    if (!resolvedPath) {
      // No file on disk — drop any stale cache entry and return empty.
      this._readCache.delete(storagePath);
      return {};
    }
    const mtimeMs = getStats(resolvedPath)?.mtimeMs ?? 0;
    const cached = this._readCache.get(storagePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.data;
    }
    const data = loadYamlSafe(basePath) || {};
    this._readCache.set(storagePath, { mtimeMs, data });
    return data;
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
    // Invalidate so the next read reloads (the in-process mtime may not advance
    // within the same millisecond as this write).
    this._readCache.delete(storagePath);
  }

  /**
   * Convert persisted YAML data to domain entity.
   *
   * CANONICAL FORMAT (after migrate-watch-history.mjs P0 migration):
   *   playhead, duration, percent, playCount, lastPlayed, watchTime
   *
   * @param {string} contentId
   * @param {Object} data - Raw persisted data
   * @returns {MediaProgress}
   * @private
   */
  _toDomainEntity(contentId, data) {
    return new MediaProgress({
      contentId,
      playhead: data.playhead ?? 0,
      duration: data.duration ?? 0,
      percent: data.percent ?? null,
      playCount: data.playCount ?? 0,
      lastPlayed: data.lastPlayed ?? null,
      watchTime: data.watchTime ?? 0,
      completedAt: data.completedAt ?? null,
      bookmark: data.bookmark ?? null,
      spots: data.spots === undefined ? undefined : (data.spots || {}),
      lastDevice: data.lastDevice ?? null,
      now: Date.now(),
    });
  }

  /**
   * Get media progress for an item
   * @param {string} contentId
   * @param {string} storagePath
   * @returns {Promise<MediaProgress|null>}
   */
  async findProgress(contentId, storagePath) {
    const data = this._readFile(storagePath);
    const stateData = data[contentId];
    if (!stateData) return null;
    return this._toDomainEntity(contentId, stateData);
  }

  /**
   * Set media progress for an item
   * @param {MediaProgress} state
   * @param {string} storagePath
   * @returns {Promise<void>}
   */
  async saveProgress(state, storagePath) {
    const data = this._readFile(storagePath);
    // Keep YAML's canonical record mapping at its persistence boundary.
    const { contentId, ...rest } = dehydrateMediaProgress(state);

    // Validate schema before writing — warn but still persist (non-blocking)
    const validation = validateCanonicalSchema(rest);
    if (!validation.valid) {
      console.warn(
        '[YamlMediaProgressMemory] Attempting to write data with legacy fields',
        {
          contentId,
          storagePath,
          legacyFields: validation.legacyFields,
          hint: 'Use canonical field names: ' +
            validation.legacyFields.map(f => `${f} → ${LEGACY_TO_CANONICAL[f] || 'remove'}`).join(', ')
        }
      );
    }

    // Per-screen spots are owned by spot-aware writers (play/log with a device,
    // mark watched/unwatched). Every other writer rebuilds the entity without
    // them; carry the stored map over so those writes never erase a screen's
    // spot.
    const previous = data[contentId];
    if (rest.spots === undefined && previous?.spots !== undefined) rest.spots = previous.spots;
    if (!rest.lastDevice && previous?.lastDevice) rest.lastDevice = previous.lastDevice;

    data[contentId] = rest;
    this._writeFile(storagePath, data);
  }

  /**
   * Get all media progress entries for a storage path
   * @param {string} storagePath
   * @returns {Promise<MediaProgress[]>}
   */
  async listProgress(storagePath) {
    const data = this._readFile(storagePath);
    return Object.entries(data).map(([contentId, stateData]) =>
      this._toDomainEntity(contentId, stateData)
    );
  }

  /**
   * Clear all media progress entries for a storage path
   * @param {string} storagePath
   * @returns {Promise<void>}
   */
  async clearProgress(storagePath) {
    // _getBasePath returns a path with .yml appended (idempotent with saveYaml/loadYamlSafe).
    // deleteYaml unconditionally appends .yml, so we strip the extension here to avoid
    // silently no-op'ing on a non-existent .yml.yml target.
    const fullPath = this._getBasePath(storagePath);
    const basePath = fullPath.replace(/\.ya?ml$/, '');
    deleteYaml(basePath);
    this._readCache.delete(storagePath);
  }

  /**
   * Get all media progress entries from all library files for a source.
   * Used as fallback when the source is offline and we can't determine the specific library.
   * Scans all files in {basePath}/{source}/ directory (e.g., plex/14_fitness.yml, plex/24_church-series.yml)
   * @param {string} source - Source name (e.g., 'plex')
   * @returns {Promise<MediaProgress[]>}
   */
  async listSourceProgress(source) {
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

      for (const [contentId, stateData] of Object.entries(data)) {
        allProgress.push(this._toDomainEntity(contentId, stateData));
      }
    }

    return allProgress;
  }

  /**
   * Every progress record in every namespace, with the namespace it lives in.
   * Reads go through the mtime parse cache, so repeated household-list reads
   * cost a stat per file once warm. Dropbox conflicted copies are skipped.
   * @returns {Promise<Array<{namespaceId: string, progress: MediaProgress}>>}
   */
  async listAllProgress() {
    if (!dirExists(this.basePath)) return [];
    const namespaces = [];
    for (const name of listYamlFiles(this.basePath, { stripExtension: true })) {
      if (!CONFLICTED_COPY.test(name)) namespaces.push(name);
    }
    for (const dir of listDirs(this.basePath)) {
      for (const name of listYamlFiles(`${this.basePath}/${dir}`, { stripExtension: true })) {
        if (!CONFLICTED_COPY.test(name)) namespaces.push(`${dir}/${name}`);
      }
    }
    const out = [];
    for (const namespaceId of namespaces) {
      const data = this._readFile(namespaceId);
      for (const [contentId, stateData] of Object.entries(data || {})) {
        if (!stateData || typeof stateData !== 'object') continue;
        out.push({ namespaceId, progress: this._toDomainEntity(contentId, stateData) });
      }
    }
    return out;
  }
}

export default YamlMediaProgressMemory;
