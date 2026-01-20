/**
 * YamlFoodLogStore - YAML-based NutriLog persistence
 *
 * Implements IFoodLogStore port for NutriLog storage.
 *
 * Storage Strategy:
 * - Hot storage: households/{hid}/apps/nutrition/nutrilog.yml (recent 30 days)
 * - Cold storage: households/{hid}/apps/nutrition/archives/nutrilog/{YYYY-MM}.yml
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { NutriLog } from '../../../1_domains/nutrition/entities/NutriLog.mjs';
import { IFoodLogStore } from '../../../1_domains/nutrition/ports/IFoodLogStore.mjs';

const ARCHIVE_RETENTION_DAYS = 30;

export class YamlFoodLogStore extends IFoodLogStore {
  #dataRoot;
  #logger;
  #invalidSeen = new Set();
  #timezone;

  /**
   * @param {Object} options
   * @param {string} options.dataRoot - Base data directory
   * @param {Object} [options.logger] - Logger instance
   * @param {string} [options.timezone='America/Los_Angeles'] - Default timezone
   */
  constructor(options) {
    super();
    if (!options?.dataRoot) {
      throw new Error('YamlFoodLogStore requires dataRoot');
    }
    this.#dataRoot = options.dataRoot;
    this.#logger = options.logger || console;
    this.#timezone = options.timezone || 'America/Los_Angeles';
  }

  // ==================== Path Helpers ====================

  /**
   * Get the main nutrilog file path for a user
   * @param {string} userId
   * @returns {string}
   */
  #getPath(userId) {
    return path.join(
      this.#dataRoot,
      'households',
      userId,
      'apps',
      'nutrition',
      'nutrilog.yml'
    );
  }

  /**
   * Get the archive directory for a user
   * @param {string} userId
   * @returns {string}
   */
  #getArchiveDir(userId) {
    return path.join(
      this.#dataRoot,
      'households',
      userId,
      'apps',
      'nutrition',
      'archives',
      'nutrilog'
    );
  }

  /**
   * Get the archive file path for a specific month
   * @param {string} userId
   * @param {string} yearMonth - YYYY-MM format
   * @returns {string}
   */
  #getArchivePath(userId, yearMonth) {
    return path.join(this.#getArchiveDir(userId), `${yearMonth}.yml`);
  }

  // ==================== File I/O ====================

  /**
   * Ensure directory exists
   * @param {string} dirPath
   */
  #ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Read a YAML file
   * @param {string} filePath
   * @returns {Object}
   */
  #readFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return {};
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) || {};
    } catch (e) {
      this.#logger.warn?.('YamlFoodLogStore.readFile.error', { filePath, error: e.message });
      return {};
    }
  }

  /**
   * Write a YAML file
   * @param {string} filePath
   * @param {Object} data
   */
  #writeFile(filePath, data) {
    this.#ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: -1 }), 'utf8');
  }

  /**
   * Load archive data for a specific month
   * @param {string} userId
   * @param {string} yearMonth
   * @returns {Object}
   */
  #loadArchive(userId, yearMonth) {
    const archivePath = this.#getArchivePath(userId, yearMonth);
    return this.#readFile(archivePath);
  }

  // ==================== Entity Hydration ====================

  /**
   * Hydrate a plain object into a NutriLog entity
   * @param {string} userId
   * @param {Object} entity
   * @returns {NutriLog|null}
   */
  #hydrate(userId, entity) {
    try {
      // Handle legacy format with food_data
      if (entity.food_data && !entity.meal) {
        return NutriLog.fromLegacy(entity, userId, entity.chat_id || userId, this.#timezone);
      }
      return NutriLog.from(entity, this.#timezone);
    } catch (err) {
      const key = entity?.id || 'unknown';
      if (!this.#invalidSeen.has(key)) {
        this.#invalidSeen.add(key);
        this.#logger.warn?.('YamlFoodLogStore.hydrate.failed', {
          userId,
          id: entity?.id,
          status: entity?.status,
          meal: entity?.meal || entity?.food_data?.date,
          error: err.message,
        });
      }
      return null;
    }
  }

  /**
   * Find entity by ID or UUID in data
   * @param {Object} data
   * @param {string} idOrUuid
   * @returns {Object|null}
   */
  #findEntity(data, idOrUuid) {
    if (!idOrUuid) return null;
    if (data[idOrUuid]) return data[idOrUuid];

    const match = Object.values(data).find((entry) => entry?.id === idOrUuid);
    return match || null;
  }

  // ==================== IFoodLogStore Implementation ====================

  /**
   * Save a NutriLog entity
   * @param {NutriLog} nutriLog
   * @returns {Promise<NutriLog>}
   */
  async save(nutriLog) {
    const filePath = this.#getPath(nutriLog.userId);
    const id = nutriLog.id;

    // Load existing data
    const data = this.#readFile(filePath);

    // Add/update entity
    data[id] = nutriLog.toJSON();

    // Save back
    this.#writeFile(filePath, data);

    return nutriLog;
  }

  /**
   * Find a NutriLog by ID
   * Checks hot storage first, then searches monthly archives
   * @param {string} userId
   * @param {string} id
   * @returns {Promise<NutriLog|null>}
   */
  async findById(userId, id) {
    const filePath = this.#getPath(userId);
    const data = this.#readFile(filePath);
    let entity = this.#findEntity(data, id);

    // If not found in hot storage, search archives
    if (!entity) {
      const archiveDir = this.#getArchiveDir(userId);
      if (fs.existsSync(archiveDir)) {
        const archiveFiles = fs.readdirSync(archiveDir)
          .filter(f => f.endsWith('.yml'))
          .sort()
          .reverse(); // Search newest archives first

        for (const file of archiveFiles) {
          const yearMonth = file.replace('.yml', '');
          const archiveData = this.#loadArchive(userId, yearMonth);
          entity = this.#findEntity(archiveData, id);
          if (entity) break;
        }
      }
    }

    if (!entity) return null;
    return this.#hydrate(userId, entity);
  }

  /**
   * Find all NutriLogs for a user
   * @param {string} userId
   * @param {Object} [options]
   * @param {string} [options.status] - Filter by status
   * @param {string} [options.date] - Filter by date (YYYY-MM-DD)
   * @param {string} [options.startDate] - Filter by start date
   * @param {string} [options.endDate] - Filter by end date
   * @returns {Promise<NutriLog[]>}
   */
  async findAll(userId, options = {}) {
    const filePath = this.#getPath(userId);
    const data = this.#readFile(filePath);

    let logs = Object.values(data)
      .map(entity => this.#hydrate(userId, entity))
      .filter(Boolean)
      .filter(log => {
        // Filter to only logs matching this userId or conversationId
        return log.userId === userId || log.conversationId === userId;
      });

    // Apply filters
    if (options.status) {
      logs = logs.filter(log => log.status === options.status);
    }

    if (options.date) {
      logs = logs.filter(log => log.meal.date === options.date);
    }

    if (options.startDate) {
      logs = logs.filter(log => log.meal.date >= options.startDate);
    }

    if (options.endDate) {
      logs = logs.filter(log => log.meal.date <= options.endDate);
    }

    // Sort by date/time descending (newest first)
    logs.sort((a, b) => {
      const dateCompare = b.meal.date.localeCompare(a.meal.date);
      if (dateCompare !== 0) return dateCompare;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return logs;
  }

  /**
   * Find logs by date
   * @param {string} userId
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<NutriLog[]>}
   */
  async findByDate(userId, date) {
    return this.findAll(userId, { date });
  }

  /**
   * Find logs by date range
   * @param {string} userId
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<NutriLog[]>}
   */
  async findByDateRange(userId, startDate, endDate) {
    return this.findAll(userId, { startDate, endDate });
  }

  /**
   * Find pending logs
   * @param {string} userId
   * @returns {Promise<NutriLog[]>}
   */
  async findPending(userId) {
    return this.findAll(userId, { status: 'pending' });
  }

  /**
   * Find accepted logs
   * @param {string} userId
   * @returns {Promise<NutriLog[]>}
   */
  async findAccepted(userId) {
    return this.findAll(userId, { status: 'accepted' });
  }

  /**
   * Delete a NutriLog (soft delete by changing status)
   * @param {string} userId
   * @param {string} id
   * @returns {Promise<NutriLog>}
   */
  async delete(userId, id) {
    const nutriLog = await this.findById(userId, id);
    if (!nutriLog) {
      throw new Error(`NutriLog not found: ${id}`);
    }
    const deleted = nutriLog.delete();
    return this.save(deleted);
  }

  /**
   * Hard delete a NutriLog (remove from storage)
   * @param {string} userId
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async hardDelete(userId, id) {
    const filePath = this.#getPath(userId);
    const data = this.#readFile(filePath);

    if (!data[id]) {
      return false;
    }

    delete data[id];
    this.#writeFile(filePath, data);

    return true;
  }

  /**
   * Count logs for a user
   * @param {string} userId
   * @param {Object} [options]
   * @param {string} [options.status] - Filter by status
   * @returns {Promise<number>}
   */
  async count(userId, options = {}) {
    const logs = await this.findAll(userId, options);
    return logs.length;
  }

  /**
   * Get daily nutrition summary
   * @param {string} userId
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<Object>}
   */
  async getDailySummary(userId, date) {
    const logs = await this.findAll(userId, { date, status: 'accepted' });

    const summary = {
      date,
      logCount: logs.length,
      itemCount: 0,
      totalGrams: 0,
      colorCounts: { green: 0, yellow: 0, orange: 0 },
      gramsByColor: { green: 0, yellow: 0, orange: 0 },
      meals: { morning: [], afternoon: [], evening: [], night: [] },
    };

    for (const log of logs) {
      summary.itemCount += log.itemCount;
      summary.totalGrams += log.totalGrams;

      for (const [color, count] of Object.entries(log.colorCounts)) {
        summary.colorCounts[color] += count;
      }

      for (const [color, grams] of Object.entries(log.gramsByColor)) {
        summary.gramsByColor[color] += grams;
      }

      if (summary.meals[log.meal.time]) {
        summary.meals[log.meal.time].push(log);
      }
    }

    return summary;
  }

  // ==================== Archive Management ====================

  /**
   * Archive old log entries to monthly archive files
   * @param {string} userId
   * @param {number} [retentionDays=30] - Days to keep in hot storage
   * @returns {Promise<Object>}
   */
  async archiveOldLogs(userId, retentionDays = ARCHIVE_RETENTION_DAYS) {
    const filePath = this.#getPath(userId);
    const data = this.#readFile(filePath);

    const now = new Date();
    const cutoffDate = new Date(now.setDate(now.getDate() - retentionDays))
      .toISOString()
      .split('T')[0];

    const hotLogs = {};
    const coldByMonth = {};
    let archived = 0;
    let kept = 0;

    for (const [logId, logEntry] of Object.entries(data)) {
      const entryDate = logEntry?.meal?.date || logEntry?.createdAt?.substring(0, 10);

      if (!entryDate || entryDate >= cutoffDate) {
        // Keep in hot storage
        hotLogs[logId] = logEntry;
        kept++;
      } else {
        // Move to archive
        const yearMonth = entryDate.substring(0, 7);
        if (!coldByMonth[yearMonth]) {
          coldByMonth[yearMonth] = {};
        }
        coldByMonth[yearMonth][logId] = logEntry;
        archived++;
      }
    }

    if (archived === 0) {
      return { archived: 0, kept, months: [] };
    }

    // Write to monthly archives
    const archiveDir = this.#getArchiveDir(userId);
    this.#ensureDir(archiveDir);

    const monthsUpdated = [];
    for (const [yearMonth, monthLogs] of Object.entries(coldByMonth)) {
      const archivePath = this.#getArchivePath(userId, yearMonth);

      // Merge with existing archive
      const existing = this.#readFile(archivePath);
      const merged = { ...existing, ...monthLogs };

      this.#writeFile(archivePath, merged);
      monthsUpdated.push(yearMonth);
    }

    // Update hot storage
    this.#writeFile(filePath, hotLogs);

    return { archived, kept, months: monthsUpdated };
  }

  /**
   * Find a NutriLog by UUID
   * @param {string} uuid - The log UUID
   * @param {string} [userId] - Optional user ID
   * @returns {Promise<NutriLog|null>}
   */
  async findByUuid(uuid, userId = null) {
    if (userId) {
      return this.findById(userId, uuid);
    }
    // Without userId, we can't efficiently search
    return null;
  }

  /**
   * Update the status of a NutriLog
   * @param {string} userId
   * @param {string} id
   * @param {string} newStatus
   * @returns {Promise<NutriLog|null>}
   */
  async updateStatus(userId, id, newStatus) {
    const nutriLog = await this.findById(userId, id);
    if (!nutriLog) return null;

    let updated;
    switch (newStatus) {
      case 'accepted':
        updated = nutriLog.accept();
        break;
      case 'rejected':
        updated = nutriLog.reject();
        break;
      case 'deleted':
        updated = nutriLog.delete();
        break;
      default:
        updated = nutriLog.with({ status: newStatus });
    }

    return this.save(updated);
  }

  /**
   * Update the items of a NutriLog
   * @param {string} userId
   * @param {string} id
   * @param {Array} items
   * @returns {Promise<NutriLog|null>}
   */
  async updateItems(userId, id, items) {
    const nutriLog = await this.findById(userId, id);
    if (!nutriLog) return null;

    const updated = nutriLog.updateItems(items);
    return this.save(updated);
  }
}

export default YamlFoodLogStore;
