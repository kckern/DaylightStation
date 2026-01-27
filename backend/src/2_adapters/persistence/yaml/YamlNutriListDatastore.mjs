/**
 * YamlNutriListDatastore - YAML-based denormalized food item persistence
 *
 * Implements INutriListDatastore port for NutriList storage.
 * NutriList stores individual food items for reporting/analytics.
 *
 * Storage Strategy:
 * - Hot storage: users/{userId}/lifelog/nutrition/nutrilist.yml (recent 30 days)
 * - Cold storage: users/{userId}/lifelog/nutrition/archives/nutrilist/{YYYY-MM}.yml
 * - Daily summaries: users/{userId}/lifelog/nutrition/nutriday.yml
 */

import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  ensureDir,
  dirExists,
  listYamlFiles,
  loadYamlSafe,
  saveYaml
} from '../../../0_system/utils/FileIO.mjs';
import { INutriListDatastore } from '../../../3_applications/nutribot/ports/INutriListDatastore.mjs';
import { shortIdFromUuid } from '../../../0_system/utils/shortId.mjs';

const ARCHIVE_RETENTION_DAYS = 30;
const NOOM_EMOJI = { green: '🟢', yellow: '🟡', orange: '🟠' };

export class YamlNutriListDatastore extends INutriListDatastore {
  #userDataService;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.userDataService - UserDataService instance
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    super();
    if (!options?.userDataService) {
      throw new Error('YamlNutriListDatastore requires userDataService');
    }
    this.#userDataService = options.userDataService;
    this.#logger = options.logger || console;
  }

  // ==================== Path Helpers ====================

  #getPath(userId) {
    return this.#userDataService.getUserPath(userId, 'lifelog/nutrition/nutrilist');
  }

  #getArchiveDir(userId) {
    return this.#userDataService.getUserPath(userId, 'lifelog/nutrition/archives/nutrilist');
  }

  #getArchivePath(userId, yearMonth) {
    return path.join(this.#getArchiveDir(userId), yearMonth);
  }

  #getNutridayPath(userId) {
    return this.#userDataService.getUserPath(userId, 'lifelog/nutrition/nutriday');
  }

  // ==================== File I/O ====================

  #readFile(basePath) {
    try {
      const data = loadYamlSafe(basePath);
      // Handle both array and legacy object format
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object') return Object.values(data);
      return [];
    } catch (e) {
      this.#logger.warn?.('YamlNutriListDatastore.readFile.error', { basePath, error: e.message });
      return [];
    }
  }

  #writeFile(basePath, data) {
    ensureDir(path.dirname(basePath));
    saveYaml(basePath, data);
  }

  #readNutriday(userId) {
    const basePath = this.#getNutridayPath(userId);
    return loadYamlSafe(basePath) || {};
  }

  #loadArchive(userId, yearMonth) {
    const basePath = this.#getArchivePath(userId, yearMonth);
    const data = loadYamlSafe(basePath);
    return Array.isArray(data) ? data : [];
  }

  // ==================== Item Normalization ====================

  #normalizeItem(item) {
    return {
      ...item,
      id: item.id || (item.uuid ? shortIdFromUuid(item.uuid) : item.id),
      uuid: item.uuid || (typeof item.id === 'string' && item.id.includes('-') ? item.id : item.uuid),
      name: item.name || item.item || item.label || 'Unknown',
      color: item.color || item.noom_color || 'yellow',
      grams: item.grams || item.amount || 0,
      logId: item.logId || item.log_uuid || item.logUuid,
    };
  }

  // ==================== INutriListStore Implementation ====================

  /**
   * Sync nutrilist from a NutriLog
   * @param {NutriLog} nutriLog
   * @returns {Promise<void>}
   */
  async syncFromLog(nutriLog) {
    const filePath = this.#getPath(nutriLog.userId);
    const logId = nutriLog.id;
    const logUuid = nutriLog.uuid || nutriLog.id;

    // Load existing items
    let items = this.#readFile(filePath);

    // Remove existing items for this log
    items = items.filter(item =>
      item.logId !== logId &&
      item.logId !== logUuid &&
      item.log_uuid !== logId &&
      item.log_uuid !== logUuid
    );

    // Add new items if log is accepted
    if (nutriLog.isAccepted) {
      const newItems = nutriLog.toNutriListItems().map((item) => ({
        ...item,
        id: item.id || (item.uuid ? shortIdFromUuid(item.uuid) : shortIdFromUuid(logUuid)),
        uuid: item.uuid || item.id,
        logId,
        log_uuid: item.log_uuid || logUuid,
        date: nutriLog.meal?.date,
      }));
      items.push(...newItems);
    }

    // Sort by date descending
    items.sort((a, b) => {
      const dateA = a.createdAt || a.date || '';
      const dateB = b.createdAt || b.date || '';
      return dateB.localeCompare(dateA);
    });

    // Save back
    this.#writeFile(filePath, items);

    // Sync nutriday for affected date
    const affectedDate = nutriLog.meal?.date;
    if (affectedDate) {
      await this.syncNutriday(nutriLog.userId, [affectedDate]);
    }
  }

  /**
   * Save multiple items at once
   * @param {Object[]} newItems
   * @returns {Promise<void>}
   */
  async saveMany(newItems) {
    if (!newItems || newItems.length === 0) return;

    const userId = newItems[0].userId || newItems[0].chatId || 'cli-user';
    const filePath = this.#getPath(userId);

    // Load existing items
    let items = this.#readFile(filePath);

    // Transform new items
    const transformedItems = newItems.map(item => {
      const baseUuid = item.uuid || item.id || uuidv4();
      return {
        id: item.id || shortIdFromUuid(baseUuid),
        uuid: baseUuid,
        icon: item.icon || 'default',
        item: item.label || item.item || item.name || 'Unknown',
        unit: item.unit || 'g',
        amount: item.grams || item.amount || 0,
        noom_color: item.color || item.noom_color || 'yellow',
        calories: item.calories ?? 0,
        fat: item.fat ?? 0,
        carbs: item.carbs ?? 0,
        protein: item.protein ?? 0,
        fiber: item.fiber ?? 0,
        sugar: item.sugar ?? 0,
        sodium: item.sodium ?? 0,
        cholesterol: item.cholesterol ?? 0,
        date: item.date,
        logId: item.logId || item.log_uuid || item.logUuid,
        log_uuid: item.log_uuid || item.logUuid,
      };
    });

    items.push(...transformedItems);

    // Sort by date descending
    items.sort((a, b) => {
      const dateA = a.createdAt || a.date || '';
      const dateB = b.createdAt || b.date || '';
      return dateB.localeCompare(dateA);
    });

    this.#writeFile(filePath, items);

    // Sync nutriday for affected dates
    const affectedDates = [...new Set(transformedItems.map(i => i.date).filter(Boolean))];
    if (affectedDates.length > 0) {
      await this.syncNutriday(userId, affectedDates);
    }
  }

  /**
   * Find all items for a user
   * @param {string} userId
   * @param {Object} [options]
   * @returns {Promise<Object[]>}
   */
  async findAll(userId, options = {}) {
    let items = this.#readFile(this.#getPath(userId));
    items = items.map(item => this.#normalizeItem(item));

    if (options.status) {
      items = items.filter(item => item.status === options.status);
    }

    if (options.color) {
      items = items.filter(item =>
        item.color === options.color || item.noom_color === options.color
      );
    }

    return items;
  }

  /**
   * Find items by log ID
   * @param {string} userId
   * @param {string} logId
   * @returns {Promise<Object[]>}
   */
  async findByLogId(userId, logId) {
    const items = await this.findAll(userId);
    return items.filter(item => item.logId === logId || item.log_uuid === logId);
  }

  /**
   * Find a single item by UUID
   * @param {string} userId
   * @param {string} uuid
   * @returns {Promise<Object|null>}
   */
  async findByUuid(userId, uuid) {
    const items = await this.findAll(userId);
    return items.find(item => item.uuid === uuid || item.id === uuid) || null;
  }

  /**
   * Update a single item
   * @param {string} userId
   * @param {string} itemId
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async update(userId, itemId, updates) {
    const filePath = this.#getPath(userId);
    let items = this.#readFile(filePath);

    const index = items.findIndex(item => item.uuid === itemId || item.id === itemId);
    if (index === -1) {
      throw new Error(`Item not found: ${itemId}`);
    }

    items[index] = { ...items[index], ...updates };
    this.#writeFile(filePath, items);

    // Sync nutriday for the item's date
    const itemDate = items[index].date;
    if (itemDate) {
      await this.syncNutriday(userId, [itemDate]);
    }

    return this.#normalizeItem(items[index]);
  }

  /**
   * Find items by date
   * @param {string} userId
   * @param {string} date
   * @returns {Promise<Object[]>}
   */
  async findByDate(userId, date) {
    const items = await this.findAll(userId);
    return items.filter(item => item.date === date);
  }

  /**
   * Find items by date range (includes archives if needed)
   * @param {string} userId
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<Object[]>}
   */
  async findByDateRange(userId, startDate, endDate) {
    let items = await this.findAll(userId);

    // Check if we need archives
    const now = new Date();
    const cutoffDate = new Date(now.setDate(now.getDate() - ARCHIVE_RETENTION_DAYS))
      .toISOString()
      .split('T')[0];

    if (startDate < cutoffDate) {
      const archiveDir = this.#getArchiveDir(userId);
      if (dirExists(archiveDir)) {
        const startMonth = startDate.substring(0, 7);
        const endMonth = endDate.substring(0, 7);

        const archiveFiles = listYamlFiles(archiveDir, { stripExtension: true })
          .filter(ym => ym >= startMonth && ym <= endMonth);

        for (const yearMonth of archiveFiles) {
          const archiveItems = this.#loadArchive(userId, yearMonth);
          items = [...items, ...archiveItems];
        }
      }
    }

    // Filter by date range
    items = items.filter(item => {
      const itemDate = item?.date || item?.createdAt?.substring(0, 10);
      return itemDate && itemDate >= startDate && itemDate <= endDate;
    });

    // Dedupe by uuid
    const seen = new Set();
    items = items.filter(item => {
      const key = item.uuid || item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by date descending
    items.sort((a, b) =>
      (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '')
    );

    return items.map(item => this.#normalizeItem(item));
  }

  /**
   * Remove all items for a log
   * @param {string} userId
   * @param {string} logId
   * @returns {Promise<number>}
   */
  async removeByLogId(userId, logId) {
    const filePath = this.#getPath(userId);
    let items = this.#readFile(filePath);

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
      this.#writeFile(filePath, items);
      if (affectedDates.length > 0) {
        await this.syncNutriday(userId, affectedDates);
      }
    }

    return removed;
  }

  /**
   * Update portion by applying a multiplier
   * @param {string} userId
   * @param {string} uuid
   * @param {number} factor
   * @returns {Promise<boolean>}
   */
  async updatePortion(userId, uuid, factor) {
    const filePath = this.#getPath(userId);
    let items = this.#readFile(filePath);

    const index = items.findIndex(item => item.uuid === uuid || item.id === uuid);
    if (index === -1) return false;

    const item = items[index];
    const affectedDate = item.date;

    // Apply factor to numeric fields
    const numericFields = ['amount', 'grams', 'calories', 'fat', 'protein', 'carbs', 'sugar', 'fiber', 'sodium', 'cholesterol'];
    for (const field of numericFields) {
      if (typeof item[field] === 'number') {
        item[field] = Math.round(item[field] * factor);
      }
    }

    items[index] = item;
    this.#writeFile(filePath, items);

    if (affectedDate) {
      await this.syncNutriday(userId, [affectedDate]);
    }

    return true;
  }

  /**
   * Delete an item by UUID
   * @param {string} userId
   * @param {string} uuid
   * @returns {Promise<boolean>}
   */
  async deleteById(userId, uuid) {
    const filePath = this.#getPath(userId);
    let items = this.#readFile(filePath);

    const itemToDelete = items.find(item => item.uuid === uuid || item.id === uuid);
    const affectedDate = itemToDelete?.date;

    const before = items.length;
    items = items.filter(item => item.uuid !== uuid && item.id !== uuid);

    if (items.length < before) {
      this.#writeFile(filePath, items);
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
    this.#writeFile(this.#getPath(userId), []);
  }

  /**
   * Get total grams by color
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getGramsByColor(userId) {
    const items = await this.findAll(userId, { status: 'accepted' });

    const result = { green: 0, yellow: 0, orange: 0 };
    for (const item of items) {
      const color = item.color || item.noom_color || 'yellow';
      result[color] = (result[color] || 0) + (item.grams || item.amount || 0);
    }

    return result;
  }

  /**
   * Get item count by color
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getCountByColor(userId) {
    const items = await this.findAll(userId, { status: 'accepted' });

    const result = { green: 0, yellow: 0, orange: 0 };
    for (const item of items) {
      const color = item.color || item.noom_color || 'yellow';
      result[color] = (result[color] || 0) + 1;
    }

    return result;
  }

  // ==================== NutriDay Sync ====================

  /**
   * Sync nutriday summaries
   * @param {string} userId
   * @param {string[]} [datesToSync]
   * @returns {Promise<void>}
   */
  async syncNutriday(userId, datesToSync = null) {
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
    const nutriday = this.#readNutriday(userId);

    // Calculate daily summaries
    for (const [date, dateItems] of Object.entries(itemsByDate)) {
      nutriday[date] = this.#calculateDailySummary(dateItems);
    }

    // Save nutriday
    this.#writeFile(this.#getNutridayPath(userId), nutriday);
  }

  #calculateDailySummary(items) {
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

      const color = item.color || item.noom_color || 'yellow';
      const emoji = NOOM_EMOJI[color] || '🟡';
      const name = item.name || item.item || item.label || 'Unknown';
      const amount = item.grams || item.amount || 0;
      const unit = item.unit || 'g';
      const cal = Math.round(item.calories || 0);

      foodItemsList.push(`${emoji} ${amount}${unit} ${name} (${cal} cal)`);
    }

    // Sort by calories descending
    foodItemsList.sort((a, b) => {
      const calA = parseInt(a.match(/\((\d+) cal\)/)?.[1] || 0);
      const calB = parseInt(b.match(/\((\d+) cal\)/)?.[1] || 0);
      return calB - calA;
    });

    return { ...totals, food_items: foodItemsList };
  }

  // ==================== Archive Management ====================

  /**
   * Archive old items
   * @param {string} userId
   * @param {number} [retentionDays=30]
   * @returns {Promise<Object>}
   */
  async archiveOldItems(userId, retentionDays = ARCHIVE_RETENTION_DAYS) {
    const filePath = this.#getPath(userId);
    const items = this.#readFile(filePath);

    const now = new Date();
    const cutoffDate = new Date(now.setDate(now.getDate() - retentionDays))
      .toISOString()
      .split('T')[0];

    const hotItems = [];
    const coldByMonth = {};
    let archived = 0;
    let kept = 0;

    for (const item of items) {
      const itemDate = item?.date || item?.createdAt?.substring(0, 10);

      if (!itemDate || itemDate >= cutoffDate) {
        hotItems.push(item);
        kept++;
      } else {
        const yearMonth = itemDate.substring(0, 7);
        if (!coldByMonth[yearMonth]) {
          coldByMonth[yearMonth] = [];
        }
        coldByMonth[yearMonth].push(item);
        archived++;
      }
    }

    if (archived === 0) {
      return { archived: 0, kept, months: [] };
    }

    // Write to monthly archives
    const archiveDir = this.#getArchiveDir(userId);
    ensureDir(archiveDir);

    const monthsUpdated = [];
    for (const [yearMonth, monthItems] of Object.entries(coldByMonth)) {
      const archivePath = this.#getArchivePath(userId, yearMonth);

      // Merge with existing archive (dedupe by uuid)
      const existing = this.#loadArchive(userId, yearMonth);
      const existingUuids = new Set(existing.map(i => i.uuid || i.id));
      const newItems = monthItems.filter(i => !existingUuids.has(i.uuid) && !existingUuids.has(i.id));
      const merged = [...existing, ...newItems];

      merged.sort((a, b) =>
        (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '')
      );

      this.#writeFile(archivePath, merged);
      monthsUpdated.push(yearMonth);
    }

    // Sort hot items and save
    hotItems.sort((a, b) =>
      (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '')
    );
    this.#writeFile(filePath, hotItems);

    return { archived, kept, months: monthsUpdated };
  }
}

export default YamlNutriListDatastore;
