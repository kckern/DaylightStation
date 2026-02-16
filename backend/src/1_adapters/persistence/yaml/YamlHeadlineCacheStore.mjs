/**
 * YamlHeadlineCacheStore
 *
 * YAML-based cache store for per-source headline data.
 * Implements IHeadlineStore port for headline persistence.
 *
 * User cache path pattern: current/feed/{sourceId}
 * DataService auto-appends .yml extension.
 *
 * Uses DataService for YAML I/O and fs for directory listing
 * (DataService lacks a list method).
 *
 * @module adapters/persistence/yaml/YamlHeadlineCacheStore
 */

import fs from 'fs';
import path from 'path';
import { IHeadlineStore } from '#apps/feed/ports/IHeadlineStore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const CACHE_BASE = 'current/feed';

export class YamlHeadlineCacheStore extends IHeadlineStore {
  #dataService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService for YAML I/O
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) {
      throw new InfrastructureError('YamlHeadlineCacheStore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * Load cached headlines for a single source
   *
   * @param {string} sourceId - Feed source identifier (e.g. 'cnn', 'bbc')
   * @param {string} username - User identifier
   * @returns {Promise<Object|null>} Headline cache data or null if not found
   */
  async loadSource(sourceId, username) {
    const data = this.#dataService.user.read(`${CACHE_BASE}/${sourceId}`, username);
    if (!data) return null;
    return {
      source: data.source || sourceId,
      label: data.label || sourceId,
      lastHarvest: data.last_harvest || null,
      items: data.items || [],
    };
  }

  /**
   * Save headlines for a single source
   *
   * @param {string} sourceId - Feed source identifier
   * @param {Object} data - Headline cache data to persist
   * @param {string} username - User identifier
   * @returns {Promise<boolean>} true on success
   */
  async saveSource(sourceId, data, username) {
    this.#logger.debug?.('headline.cache.save', { sourceId, username, itemCount: data.items?.length });
    return this.#dataService.user.write(`${CACHE_BASE}/${sourceId}`, {
      source: data.source || sourceId,
      label: data.label || sourceId,
      last_harvest: data.lastHarvest || new Date().toISOString(),
      items: data.items || [],
    }, username);
  }

  /**
   * Load cached headlines from all sources for a user
   *
   * Uses fs.readdirSync since DataService lacks a list method.
   *
   * @param {string} username - User identifier
   * @returns {Promise<Object>} Map of sourceId to headline cache data
   */
  async loadAllSources(username) {
    const result = {};
    // Derive cache directory from resolvePath (which adds .yml) by getting dirname of a dummy file
    const dummyPath = this.#dataService.user.resolvePath?.(`${CACHE_BASE}/_probe`, username);
    if (!dummyPath) return result;

    const cacheDir = path.dirname(dummyPath);
    if (!fs.existsSync(cacheDir)) return result;

    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.yml'));
    for (const file of files) {
      const sourceId = file.replace('.yml', '');
      const data = await this.loadSource(sourceId, username);
      if (data) {
        result[sourceId] = data;
      }
    }
    return result;
  }

  /**
   * Remove headlines older than a cutoff date for a source
   *
   * @param {string} sourceId - Feed source identifier
   * @param {Date} cutoff - Remove headlines published before this date
   * @param {string} username - User identifier
   * @returns {Promise<number>} Number of headlines pruned
   */
  async pruneOlderThan(sourceId, cutoff, username) {
    const data = await this.loadSource(sourceId, username);
    if (!data || !data.items?.length) return 0;

    const cutoffTime = cutoff.getTime();
    const before = data.items.length;
    data.items = data.items.filter(item => new Date(item.timestamp).getTime() >= cutoffTime);
    const pruned = before - data.items.length;

    if (pruned > 0) {
      await this.saveSource(sourceId, data, username);
      this.#logger.debug?.('headline.cache.pruned', { sourceId, username, pruned });
    }

    return pruned;
  }
}

export default YamlHeadlineCacheStore;
