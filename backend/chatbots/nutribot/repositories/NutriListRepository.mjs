/**
 * NutriList Repository
 * @module nutribot/repositories/NutriListRepository
 * 
 * Repository for the denormalized NutriList (food items for reporting).
 * This is updated whenever a NutriLog is saved/accepted.
 */

import { loadFile, saveFile } from '../../../lib/io.mjs';
import { NotFoundError } from '../../_lib/errors/index.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';
import { TestContext } from '../../_lib/testing/TestContext.mjs';

/**
 * NutriList repository for denormalized food item data
 */
export class NutriListRepository {
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
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'nutrilist' });
  }

  /**
   * Get the storage path for a user's nutrilist
   * @private
   * @param {string} userId
   * @returns {string}
   */
  #getPath(userId) {
    return this.#config.getNutrilistPath(userId);
  }

  /**
   * Sync nutrilist from a NutriLog
   * Updates the denormalized list when a log changes
   * @param {import('../domain/NutriLog.mjs').NutriLog} nutriLog
   * @returns {Promise<void>}
   */
  async syncFromLog(nutriLog) {
    const path = this.#getPath(nutriLog.userId);
    const logId = nutriLog.id;

    this.#logger.debug('nutrilist.sync', { path, logId, status: nutriLog.status });

    // Load existing data - handle both legacy object format and new array format
    let rawData = loadFile(path);
    let items = [];
    
    if (Array.isArray(rawData)) {
      items = rawData;
    } else if (rawData && typeof rawData === 'object') {
      this.#logger.info('nutrilist.convertingLegacyFormat', { path });
      items = Object.values(rawData);
    }

    // Remove existing items for this log
    items = items.filter(item => item.logId !== logId && item.log_uuid !== logId);

    // Add new items if log is accepted
    if (nutriLog.isAccepted) {
      const newItems = nutriLog.toNutriListItems();
      items.push(...newItems);
    }

    // Sort by date descending
    items.sort((a, b) => {
      const dateA = a.createdAt || a.date || '';
      const dateB = b.createdAt || b.date || '';
      return dateB.localeCompare(dateA);
    });

    // Save back (always in array format)
    saveFile(path, items);
  }

  /**
   * Save multiple items at once
   * @param {Object[]} newItems - Items to save
   * @returns {Promise<void>}
   */
  async saveMany(newItems) {
    if (!newItems || newItems.length === 0) return;
    
    // Get userId from first item
    const userId = newItems[0].userId || newItems[0].chatId || 'cli-user';
    const path = this.#getPath(userId);

    this.#logger.debug('nutrilist.saveMany', { path, count: newItems.length });

    // Load existing data - handle both legacy object format and new array format
    let rawData = loadFile(path);
    let items = [];
    
    if (Array.isArray(rawData)) {
      // New array format
      items = rawData;
    } else if (rawData && typeof rawData === 'object') {
      // Legacy object format - convert to array
      this.#logger.info('nutrilist.convertingLegacyFormat', { path });
      items = Object.values(rawData);
    }

    // Add new items
    items.push(...newItems);

    // Sort by date descending
    items.sort((a, b) => {
      const dateA = a.createdAt || a.date || '';
      const dateB = b.createdAt || b.date || '';
      return dateB.localeCompare(dateA);
    });

    // Save back (always in array format)
    saveFile(path, items);
  }

  /**
   * Get all items for a user
   * @param {string} userId
   * @param {Object} [options]
   * @param {string} [options.status] - Filter by status
   * @param {string} [options.color] - Filter by noom color
   * @returns {Promise<Object[]>}
   */
  async findAll(userId, options = {}) {
    const path = this.#getPath(userId);
    
    // Load and handle both legacy object format and new array format
    let rawData = loadFile(path);
    let items = [];
    
    if (Array.isArray(rawData)) {
      items = rawData;
    } else if (rawData && typeof rawData === 'object') {
      items = Object.values(rawData);
    }

    if (options.status) {
      items = items.filter(item => item.status === options.status);
    }

    if (options.color) {
      items = items.filter(item => item.color === options.color || item.noom_color === options.color);
    }

    return items;
  }

  /**
   * Get items by log ID
   * @param {string} userId
   * @param {string} logId
   * @returns {Promise<Object[]>}
   */
  async findByLogId(userId, logId) {
    const items = await this.findAll(userId);
    return items.filter(item => item.logId === logId);
  }

  /**
   * Get items by date
   * @param {string} userId
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<Object[]>}
   */
  async findByDate(userId, date) {
    const items = await this.findAll(userId);
    return items.filter(item => item.date === date);
  }

  /**
   * Get accepted items
   * @param {string} userId
   * @returns {Promise<Object[]>}
   */
  async findAccepted(userId) {
    return this.findAll(userId, { status: 'accepted' });
  }

  /**
   * Get items by color
   * @param {string} userId
   * @param {string} color - green, yellow, or orange
   * @returns {Promise<Object[]>}
   */
  async findByColor(userId, color) {
    return this.findAll(userId, { color });
  }

  /**
   * Get total grams by color
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getGramsByColor(userId) {
    const items = await this.findAccepted(userId);
    
    const result = { green: 0, yellow: 0, orange: 0 };
    for (const item of items) {
      result[item.color] = (result[item.color] || 0) + item.grams;
    }
    
    return result;
  }

  /**
   * Get item count by color
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getCountByColor(userId) {
    const items = await this.findAccepted(userId);
    
    const result = { green: 0, yellow: 0, orange: 0 };
    for (const item of items) {
      result[item.color] = (result[item.color] || 0) + 1;
    }
    
    return result;
  }

  /**
   * Remove all items for a log
   * @param {string} userId
   * @param {string} logId
   * @returns {Promise<number>} - Number of items removed
   */
  async removeByLogId(userId, logId) {
    const path = this.#getPath(userId);
    
    // Load and handle both legacy object format and new array format
    let rawData = loadFile(path);
    let items = [];
    
    if (Array.isArray(rawData)) {
      items = rawData;
    } else if (rawData && typeof rawData === 'object') {
      items = Object.values(rawData);
    }
    
    const before = items.length;
    items = items.filter(item => item.logId !== logId && item.log_uuid !== logId);
    const removed = before - items.length;
    
    if (removed > 0) {
      saveFile(path, items);
      this.#logger.debug('nutrilist.remove', { path, logId, removed });
    }
    
    return removed;
  }

  /**
   * Clear all items for a user
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async clear(userId) {
    const path = this.#getPath(userId);
    saveFile(path, []);
    this.#logger.debug('nutrilist.clear', { path });
  }
}

export default NutriListRepository;
