/**
 * YamlNutriCoachStore - YAML-based coaching message persistence
 *
 * Implements INutriCoachStore port for coaching history storage.
 *
 * Storage:
 * - households/{hid}/apps/nutrition/nutricoach.yml
 * - Data structure: { 'YYYY-MM-DD': [{ message, timestamp, isFirstOfDay, context }] }
 */

import path from 'path';
import {
  ensureDir,
  loadYamlFromPath,
  saveYamlToPath,
  resolveYamlPath
} from '../../../0_infrastructure/utils/FileIO.mjs';
import { INutriCoachStore } from '../../../1_domains/nutrition/ports/INutriCoachStore.mjs';

export class YamlNutriCoachStore extends INutriCoachStore {
  #dataRoot;
  #logger;

  /**
   * @param {Object} options
   * @param {string} options.dataRoot - Base data directory
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    super();
    if (!options?.dataRoot) {
      throw new Error('YamlNutriCoachStore requires dataRoot');
    }
    this.#dataRoot = options.dataRoot;
    this.#logger = options.logger || console;
  }

  // ==================== Path Helpers ====================

  #getPath(userId) {
    return path.join(
      this.#dataRoot,
      'households',
      userId,
      'apps',
      'nutrition',
      'nutricoach.yml'
    );
  }

  // ==================== File I/O ====================

  #readFile(filePath) {
    try {
      const basePath = filePath.replace(/\.yml$/, '');
      const resolvedPath = resolveYamlPath(basePath);
      if (!resolvedPath) return {};
      return loadYamlFromPath(resolvedPath) || {};
    } catch (e) {
      this.#logger.warn?.('YamlNutriCoachStore.readFile.error', { filePath, error: e.message });
      return {};
    }
  }

  #writeFile(filePath, data) {
    ensureDir(path.dirname(filePath));
    saveYamlToPath(filePath, data);
  }

  // ==================== INutriCoachStore Implementation ====================

  /**
   * Save a coaching entry
   * @param {Object} entry
   * @returns {Promise<void>}
   */
  async save(entry) {
    const { userId, date, message, isFirstOfDay = false, context = {} } = entry;
    const filePath = this.#getPath(userId);

    const data = this.#readFile(filePath);

    // Initialize date array if needed
    if (!data[date]) {
      data[date] = [];
    }

    // Append new coaching entry
    data[date].push({
      message,
      timestamp: new Date().toISOString(),
      isFirstOfDay,
      context,
    });

    this.#writeFile(filePath, data);
  }

  /**
   * Get coaching entries for a specific date
   * @param {string} userId
   * @param {string} date
   * @returns {Promise<Object[]>}
   */
  async getByDate(userId, date) {
    const data = this.#readFile(this.#getPath(userId));
    return data[date] || [];
  }

  /**
   * Get count of today's coaching messages
   * @param {string} userId
   * @param {string} date
   * @returns {Promise<number>}
   */
  async getTodayCount(userId, date) {
    const entries = await this.getByDate(userId, date);
    return entries.length;
  }

  /**
   * Check if this would be the first coaching of the day
   * @param {string} userId
   * @param {string} date
   * @returns {Promise<boolean>}
   */
  async isFirstOfDay(userId, date) {
    const count = await this.getTodayCount(userId, date);
    return count === 0;
  }

  /**
   * Get recent coaching messages across all dates
   * @param {string} userId
   * @param {number} [count=10]
   * @returns {Promise<Object[]>}
   */
  async getRecent(userId, count = 10) {
    const data = this.#readFile(this.#getPath(userId));

    // Flatten and add date to each entry
    const allEntries = [];
    for (const [date, entries] of Object.entries(data)) {
      // Handle both array format (new) and object format (legacy)
      const entriesArray = Array.isArray(entries) ? entries : [entries];
      for (const entry of entriesArray) {
        if (entry && typeof entry === 'object') {
          allEntries.push({
            ...entry,
            date,
          });
        }
      }
    }

    // Sort by timestamp descending
    allEntries.sort((a, b) => {
      const timeA = String(a.timestamp || a.date || '');
      const timeB = String(b.timestamp || b.date || '');
      return timeB.localeCompare(timeA);
    });

    return allEntries.slice(0, count);
  }

  /**
   * Get coaching history for the last N days
   * @param {string} userId
   * @param {number} [days=14]
   * @returns {Promise<Object>}
   */
  async getHistory(userId, days = 14) {
    const data = this.#readFile(this.#getPath(userId));

    // Calculate date range
    const today = new Date();
    const result = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      if (data[dateStr]) {
        result[dateStr] = data[dateStr];
      }
    }

    return result;
  }

  /**
   * Get all coaching data for a user
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getAll(userId) {
    return this.#readFile(this.#getPath(userId));
  }

  /**
   * Clear all coaching data for a user
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async clear(userId) {
    this.#writeFile(this.#getPath(userId), {});
  }
}

export default YamlNutriCoachStore;
