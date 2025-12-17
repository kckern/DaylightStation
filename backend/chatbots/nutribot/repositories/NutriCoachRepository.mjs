/**
 * NutriCoach Repository
 * @module nutribot/repositories/NutriCoachRepository
 * 
 * Repository for storing and retrieving coaching messages history.
 * Supports multiple coaching messages per day.
 */

import { loadFile, saveFile } from '../../../lib/io.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * NutriCoach repository for coaching message history
 */
export class NutriCoachRepository {
  #config;
  #logger;

  /**
   * @param {Object} options
   * @param {import('../config/NutriBotConfig.mjs').NutriBotConfig} options.config - NutriBot config
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    if (!options?.config) {
      throw new Error('config is required');
    }
    this.#config = options.config;
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'nutricoach' });
  }

  /**
   * Get the storage path for a user's nutricoach
   * @private
   * @param {string} userId
   * @returns {string}
   */
  #getPath(userId) {
    return this.#config.getNutricoachPath(userId);
  }

  /**
   * Save a coaching entry
   * @param {Object} entry
   * @param {string} entry.userId - User ID
   * @param {string} entry.date - Date (YYYY-MM-DD)
   * @param {string} entry.message - Coaching message
   * @param {boolean} [entry.isFirstOfDay] - Whether this is first coaching of the day
   * @param {Object} [entry.context] - Context data (calories, recentItems, etc.)
   * @returns {Promise<void>}
   */
  async save(entry) {
    const { userId, date, message, isFirstOfDay = false, context = {} } = entry;
    const path = this.#getPath(userId);

    this.#logger.debug('nutricoach.save', { path, date, isFirstOfDay });

    // Load existing data
    const data = loadFile(path) || {};

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

    // Save back
    saveFile(path, data);
  }

  /**
   * Get coaching entries for a specific date
   * @param {string} userId
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<Object[]>} - Array of coaching entries
   */
  async getByDate(userId, date) {
    const path = this.#getPath(userId);
    const data = loadFile(path) || {};
    return data[date] || [];
  }

  /**
   * Get count of today's coaching messages
   * @param {string} userId
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<number>}
   */
  async getTodayCount(userId, date) {
    const entries = await this.getByDate(userId, date);
    return entries.length;
  }

  /**
   * Check if this would be the first coaching of the day
   * @param {string} userId
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<boolean>}
   */
  async isFirstOfDay(userId, date) {
    const count = await this.getTodayCount(userId, date);
    return count === 0;
  }

  /**
   * Get recent coaching messages across all dates
   * @param {string} userId
   * @param {number} [count=10] - Number of messages to retrieve
   * @returns {Promise<Object[]>} - Array of coaching entries with dates
   */
  async getRecent(userId, count = 10) {
    const path = this.#getPath(userId);
    const data = loadFile(path) || {};

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
      const timeA = a.timestamp || a.date || '';
      const timeB = b.timestamp || b.date || '';
      // Ensure both are strings before comparing
      const strA = String(timeA);
      const strB = String(timeB);
      return strB.localeCompare(strA);
    });

    // Return most recent
    return allEntries.slice(0, count);
  }

  /**
   * Get coaching history for the last N days
   * @param {string} userId
   * @param {number} [days=14] - Number of days to look back
   * @returns {Promise<Object>} - Object keyed by date
   */
  async getHistory(userId, days = 14) {
    const path = this.#getPath(userId);
    const data = loadFile(path) || {};

    // Calculate date range
    const today = new Date();
    const result = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
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
    const path = this.#getPath(userId);
    return loadFile(path) || {};
  }

  /**
   * Clear all coaching data for a user
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async clear(userId) {
    const path = this.#getPath(userId);
    saveFile(path, {});
    this.#logger.debug('nutricoach.clear', { path });
  }
}

export default NutriCoachRepository;
