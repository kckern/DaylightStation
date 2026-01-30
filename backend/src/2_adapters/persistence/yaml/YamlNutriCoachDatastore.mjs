/**
 * YamlNutriCoachDatastore - YAML-based coaching message persistence
 *
 * Implements INutriCoachDatastore port for coaching history storage.
 *
 * Storage path (via ConfigService.getHouseholdPath):
 * - household[-{id}]/apps/nutrition/nutricoach.yml
 * - Data structure: { 'YYYY-MM-DD': [{ message, timestamp, isFirstOfDay, context }] }
 */

import path from 'path';
import {
  ensureDir,
  loadYamlSafe,
  saveYaml
} from '#system/utils/FileIO.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
import { INutriCoachDatastore } from '#apps/nutribot/ports/INutriCoachDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlNutriCoachDatastore extends INutriCoachDatastore {
  #configService;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.configService - ConfigService instance for path resolution
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    super();
    if (!options?.configService) {
      throw new InfrastructureError('YamlNutriCoachDatastore requires configService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'configService'
      });
    }
    this.#configService = options.configService;
    this.#logger = options.logger || console;
  }

  // ==================== Path Helpers ====================

  #getPath(userId) {
    // userId here is actually householdId based on usage
    return this.#configService.getHouseholdPath('apps/nutrition/nutricoach', userId);
  }

  // ==================== File I/O ====================

  #readFile(basePath) {
    try {
      return loadYamlSafe(basePath) || {};
    } catch (e) {
      this.#logger.warn?.('YamlNutriCoachDatastore.readFile.error', { basePath, error: e.message });
      return {};
    }
  }

  #writeFile(basePath, data) {
    ensureDir(path.dirname(basePath));
    saveYaml(basePath, data);
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
      timestamp: nowTs24(),
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

export default YamlNutriCoachDatastore;
