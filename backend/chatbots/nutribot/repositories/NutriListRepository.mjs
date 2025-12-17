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

    // Sync nutriday for affected dates
    const affectedDate = nutriLog.meal?.date;
    if (affectedDate) {
      await this.syncNutriday(nutriLog.userId, [affectedDate]);
    }
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

    // Transform new items to legacy format for consistency
    // Generate UUID if not present to ensure all items are identifiable
    const { v4: uuidv4 } = await import('uuid');
    const transformedItems = newItems.map(item => ({
      uuid: item.id || item.uuid || uuidv4(),
      icon: item.icon || 'default',
      item: item.label || item.item || item.name || 'Unknown',
      unit: item.unit || 'g',
      amount: item.grams || item.amount || 0,
      noom_color: item.color || item.noom_color || 'yellow',
      // Nutrition fields
      calories: item.calories ?? 0,
      fat: item.fat ?? 0,
      carbs: item.carbs ?? 0,
      protein: item.protein ?? 0,
      fiber: item.fiber ?? 0,
      sugar: item.sugar ?? 0,
      sodium: item.sodium ?? 0,
      cholesterol: item.cholesterol ?? 0,
      // Metadata
      date: item.date,
      log_uuid: item.logUuid || item.log_uuid,
    }));

    // Add new items
    items.push(...transformedItems);

    // Sort by date descending
    items.sort((a, b) => {
      const dateA = a.createdAt || a.date || '';
      const dateB = b.createdAt || b.date || '';
      return dateB.localeCompare(dateA);
    });

    // Save back (always in array format)
    saveFile(path, items);

    // Sync nutriday for affected dates
    const affectedDates = [...new Set(transformedItems.map(i => i.date).filter(Boolean))];
    if (affectedDates.length > 0) {
      await this.syncNutriday(userId, affectedDates);
    }
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

    // Normalize legacy field names to expected format
    items = items.map(item => ({
      ...item,
      // Map legacy fields to expected names
      name: item.name || item.item || item.label || 'Unknown',
      color: item.color || item.noom_color || 'yellow',
      grams: item.grams || item.amount || 0,
      logId: item.logId || item.log_uuid || item.logUuid,
    }));

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
   * Get a single item by UUID
   * @param {string} userId
   * @param {string} uuid - Item UUID
   * @returns {Promise<Object|null>}
   */
  async findByUuid(userId, uuid) {
    const items = await this.findAll(userId);
    return items.find(item => item.uuid === uuid) || null;
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
    
    // Get affected dates before removing
    const affectedDates = [...new Set(
      items
        .filter(item => item.logId === logId || item.log_uuid === logId)
        .map(item => item.date)
        .filter(Boolean)
    )];
    
    const before = items.length;
    items = items.filter(item => item.logId !== logId && item.log_uuid !== logId);
    const removed = before - items.length;
    
    if (removed > 0) {
      saveFile(path, items);
      this.#logger.debug('nutrilist.remove', { path, logId, removed });
      
      // Sync nutriday for affected dates
      if (affectedDates.length > 0) {
        await this.syncNutriday(userId, affectedDates);
      }
    }
    
    return removed;
  }

  /**
   * Update portion/amount for an item by applying a multiplier
   * @param {string} userId
   * @param {string} uuid - Item UUID
   * @param {number} factor - Multiplier to apply (e.g., 0.5 for half)
   * @returns {Promise<boolean>}
   */
  async updatePortion(userId, uuid, factor) {
    const path = this.#getPath(userId);
    
    let rawData = loadFile(path);
    let items = Array.isArray(rawData) ? rawData : Object.values(rawData || {});
    
    const itemIndex = items.findIndex(item => item.uuid === uuid);
    if (itemIndex === -1) {
      this.#logger.warn('nutrilist.updatePortion.notFound', { userId, uuid });
      return false;
    }
    
    const item = items[itemIndex];
    const affectedDate = item.date;
    
    // Apply factor to numeric nutrition fields
    const numericFields = ['amount', 'calories', 'fat', 'protein', 'carbs', 'sugar', 'fiber', 'sodium', 'cholesterol'];
    for (const field of numericFields) {
      if (typeof item[field] === 'number') {
        item[field] = Math.round(item[field] * factor);
      }
    }
    
    // Also update grams if present
    if (typeof item.grams === 'number') {
      item.grams = Math.round(item.grams * factor);
    }
    
    items[itemIndex] = item;
    saveFile(path, items);
    
    this.#logger.info('nutrilist.updatePortion', { userId, uuid, factor, newAmount: item.amount || item.grams });
    
    // Sync nutriday for affected date
    if (affectedDate) {
      await this.syncNutriday(userId, [affectedDate]);
    }
    
    return true;
  }

  /**
   * Delete an item by UUID
   * @param {string} userId
   * @param {string} uuid - Item UUID
   * @returns {Promise<boolean>}
   */
  async deleteById(userId, uuid) {
    const path = this.#getPath(userId);
    
    let rawData = loadFile(path);
    let items = Array.isArray(rawData) ? rawData : Object.values(rawData || {});
    
    // Find the item to get its date before deleting
    const itemToDelete = items.find(item => item.uuid === uuid);
    const affectedDate = itemToDelete?.date;
    
    const before = items.length;
    items = items.filter(item => item.uuid !== uuid);
    
    if (items.length < before) {
      saveFile(path, items);
      this.#logger.info('nutrilist.deleteById', { userId, uuid });
      
      // Sync nutriday for affected date
      if (affectedDate) {
        await this.syncNutriday(userId, [affectedDate]);
      }
      return true;
    }
    
    return false;
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

  // ==================== NutriDay Sync ====================

  /**
   * Get the nutriday storage path for a user
   * @private
   * @param {string} userId
   * @returns {string}
   */
  #getNutridayPath(userId) {
    return this.#config.getNutridayPath(userId);
  }

  /**
   * Sync nutriday summaries from nutrilist
   * Called automatically when nutrilist is updated
   * @param {string} userId
   * @param {string[]} [datesToSync] - Specific dates to sync (optional, syncs all if not provided)
   * @returns {Promise<void>}
   */
  async syncNutriday(userId, datesToSync = null) {
    const nutridayPath = this.#getNutridayPath(userId);
    
    // Load all nutrilist items
    const items = await this.findAll(userId);
    
    // Group items by date
    const itemsByDate = {};
    for (const item of items) {
      const date = item.date;
      if (!date) continue;
      if (datesToSync && !datesToSync.includes(date)) continue;
      
      if (!itemsByDate[date]) {
        itemsByDate[date] = [];
      }
      itemsByDate[date].push(item);
    }

    // Load existing nutriday data
    const nutriday = loadFile(nutridayPath) || {};

    // Calculate daily summaries
    for (const [date, dateItems] of Object.entries(itemsByDate)) {
      const summary = this.#calculateDailySummary(dateItems);
      nutriday[date] = summary;
    }

    // Save nutriday
    saveFile(nutridayPath, nutriday);
    
    const syncedDates = Object.keys(itemsByDate);
    this.#logger.debug('nutriday.sync', { userId, syncedDates: syncedDates.length });
  }

  /**
   * Calculate daily summary from items
   * @private
   * @param {Object[]} items - Food items for the day
   * @returns {Object} - Daily summary
   */
  #calculateDailySummary(items) {
    const NOOM_EMOJI = {
      green: '🟢',
      yellow: '🟡',
      orange: '🟠',
    };

    // Calculate totals
    const totals = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sodium: 0,
      sugar: 0,
      cholesterol: 0,
    };

    const foodItemsList = [];

    for (const item of items) {
      totals.calories += Math.round(item.calories || 0);
      totals.protein += Math.round(item.protein || 0);
      totals.carbs += Math.round(item.carbs || 0);
      totals.fat += Math.round(item.fat || 0);
      totals.fiber += Math.round(item.fiber || 0);
      totals.sodium += Math.round(item.sodium || 0);
      totals.sugar += Math.round(item.sugar || 0);
      totals.cholesterol += Math.round(item.cholesterol || 0);

      // Build food item label
      const color = item.color || item.noom_color || 'yellow';
      const emoji = NOOM_EMOJI[color] || '🟡';
      const name = item.name || item.item || item.label || 'Unknown';
      const amount = item.grams || item.amount || 0;
      const unit = item.unit || 'g';
      const cal = Math.round(item.calories || 0);
      
      foodItemsList.push(`${emoji} ${amount}${unit} ${name} (${cal} cal)`);
    }

    // Sort food items by calories descending
    foodItemsList.sort((a, b) => {
      const calA = parseInt(a.match(/\((\d+) cal\)/)?.[1] || 0);
      const calB = parseInt(b.match(/\((\d+) cal\)/)?.[1] || 0);
      return calB - calA;
    });

    return {
      ...totals,
      food_items: foodItemsList,
    };
  }
}

export default NutriListRepository;
