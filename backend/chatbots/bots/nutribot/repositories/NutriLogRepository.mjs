/**
 * NutriLog Repository
 * @module nutribot/repositories/NutriLogRepository
 * 
 * Repository for persisting and querying NutriLog entities.
 * Supports both file-based storage and in-memory for testing.
 * 
 * Archive Support:
 * - Hot storage: nutrition/nutrilog.yml (recent 30 days)
 * - Cold storage: nutrition/archives/nutrilog/YYYY-MM.yml (monthly archives)
 */

import fs from 'fs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { loadFile, saveFile } from '../../../../lib/io.mjs';
import { NutriLog } from '../domain/NutriLog.mjs';
import { formatLocalTimestamp } from '../../../_lib/time.mjs';
import { NotFoundError } from '../../../_lib/errors/index.mjs';
import { createLogger } from '../../../_lib/logging/index.mjs';
import { TestContext } from '../../../_lib/testing/TestContext.mjs';

const ARCHIVE_RETENTION_DAYS = 30;

/**
 * NutriLog repository for persisting food logs
 */
export class NutriLogRepository {
  #config;
  #logger;
  #invalidSeen = new Set();

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
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'nutrilog' });
  }

  /**
   * Get the storage path for a user's nutrilog
   * @private
   * @param {string} userId
   * @returns {string}
   */
  #getPath(userId) {
    return this.#config.getNutrilogPath(userId);
  }

  /**
   * Get the archive directory path for a user's nutrilog archives
   * @private
   * @param {string} userId
   * @returns {string}
   */
  #getArchiveDir(userId) {
    const basePath = this.#getPath(userId);
    // nutrilog.yml -> nutrition/archives/nutrilog/
    const dir = basePath.replace(/\/nutrilog\.yml$/, '/archives/nutrilog');
    return dir;
  }

  /**
   * Get the archive file path for a specific month
   * @private
   * @param {string} userId
   * @param {string} yearMonth - YYYY-MM format
   * @returns {string}
   */
  #getArchivePath(userId, yearMonth) {
    return `${this.#getArchiveDir(userId)}/${yearMonth}.yml`;
  }

  /**
   * Load archive data for a specific month
   * @private
   * @param {string} userId
   * @param {string} yearMonth - YYYY-MM format
   * @returns {Object}
   */
  #loadArchive(userId, yearMonth) {
    const archivePath = this.#getArchivePath(userId, yearMonth);
    // Use raw fs for archives (not going through io.mjs)
    if (fs.existsSync(archivePath)) {
      try {
        return yaml.load(fs.readFileSync(archivePath, 'utf8')) || {};
      } catch (e) {
        this.#logger.warn('nutrilog.loadArchive.error', { archivePath, error: e.message });
        return {};
      }
    }
    return {};
  }

  #loadData(path) {
    return loadFile(path) || {};
  }

  #hydrate(userId, entity) {
    try {
      const timezone = this.#config.getUserTimezone(userId);
      if (entity.food_data && !entity.meal) {
        return NutriLog.fromLegacy(entity, userId, entity.chat_id || userId, timezone);
      }
      return NutriLog.from(entity, timezone);
    } catch (err) {
      const key = entity?.id || 'unknown';
      if (!this.#invalidSeen.has(key)) {
        this.#invalidSeen.add(key);
        this.#logger.warn('nutrilog.hydrate.failed', {
          userId,
          id: entity?.id,
          status: entity?.status,
          meal: entity?.meal || entity?.food_data?.date,
          error: err.message,
          details: err?.errors || undefined
        });
      }
      return null;
    }
  }

  #findEntity(data, idOrUuid) {
    if (!idOrUuid) return null;
    if (data[idOrUuid]) return data[idOrUuid];

    const match = Object.values(data).find((entry) => entry?.id === idOrUuid);
    return match || null;
  }

  /**
   * Save a NutriLog entity
   * @param {NutriLog} nutriLog
   * @returns {Promise<NutriLog>}
   */
  async save(nutriLog) {
    const path = this.#getPath(nutriLog.userId);
    const id = nutriLog.id;

    this.#logger.debug('nutrilog.save', { path, id, status: nutriLog.status });

    // Load existing data
    const data = this.#loadData(path);

    // Add/update entity
    data[id] = nutriLog.toJSON();

    // Save back
    saveFile(path, data);

    return nutriLog;
  }

  /**
   * Find a NutriLog by ID
   * Checks hot storage first, then searches monthly archives if not found
   * @param {string} userId
   * @param {string} id
   * @returns {Promise<NutriLog|null>}
   */
  async findById(userId, id) {
    const path = this.#getPath(userId);
    const data = this.#loadData(path);
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
          if (entity) {
            this.#logger.debug('nutrilog.findById.fromArchive', { id, yearMonth });
            break;
          }
        }
      }
    }

    if (!entity) return null;

    return this.#hydrate(userId, entity);
  }

  /**
   * Find a NutriLog by UUID (searches all users if userId not provided)
   * @param {string} uuid - The log UUID
   * @param {string} [userId] - Optional user ID to search within
   * @returns {Promise<NutriLog|null>}
   */
  async findByUuid(uuid, userId = null) {
    // If userId is provided, search only that user's logs
    if (userId) {
      return this.findById(userId, uuid);
    }
    
    // Otherwise search all - for CLI this is fine since there's typically one user
    // In production, userId should always be provided
    const path = this.#getPath('cli-user');
    const data = this.#loadData(path);
    const entity = this.#findEntity(data, uuid);
    if (!entity) return null;

    return this.#hydrate(entity.userId || userId || 'cli-user', entity);
  }

  /**
   * Find a NutriLog by ID, throwing if not found
   * @param {string} userId
   * @param {string} id
   * @returns {Promise<NutriLog>}
   * @throws {NotFoundError}
   */
  async getById(userId, id) {
    const nutriLog = await this.findById(userId, id);
    if (!nutriLog) {
      throw new NotFoundError(`NutriLog not found: ${id}`);
    }
    return nutriLog;
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
    const path = this.#getPath(userId);
    const data = this.#loadData(path);

    let logs = Object.values(data)
      .map(entity => this.#hydrate(userId, entity))
      .filter(Boolean)
      .filter(log => {
        // Filter to only logs matching this userId or conversationId
        // This handles legacy data with old userId formats
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
   * Find logs for a specific date
   * @param {string} userId
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<NutriLog[]>}
   */
  async findByDate(userId, date) {
    return this.findAll(userId, { date });
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
    const nutriLog = await this.getById(userId, id);
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
    const path = this.#getPath(userId);
    const data = loadFile(path) || {};

    if (!data[id]) {
      return false;
    }

    delete data[id];
    saveFile(path, data);

    this.#logger.debug('nutrilog.hardDelete', { path, id });
    return true;
  }

  /**
   * Update the status of a NutriLog
   * @param {string} uuid - The log UUID
   * @param {string} newStatus - The new status ('pending', 'accepted', 'rejected', 'deleted')
   * @param {string} [userId='cli-user'] - Optional user ID
   * @returns {Promise<NutriLog|null>}
   */
  async updateStatus(uuid, newStatus, userId = 'cli-user') {
    const nutriLog = await this.findByUuid(uuid, userId);
    if (!nutriLog) {
      this.#logger.warn('nutrilog.updateStatus.notFound', { uuid, userId });
      return null;
    }

    // Use the appropriate domain method based on status
    let updated;
    switch (newStatus) {
      case 'accepted':
        updated = nutriLog.accept();
        break;
      case 'rejected':
      case 'deleted':
        updated = nutriLog.delete();
        break;
      default:
        // For other statuses, create a new log with updated status
        const timezone = this.#config.getUserTimezone(userId);
        updated = NutriLog.from({
          ...nutriLog.toJSON(),
          status: newStatus,
          updatedAt: formatLocalTimestamp(new Date(), timezone),
        });
    }

    return this.save(updated);
  }

  /**
   * Update the items of a NutriLog
   * @param {string} uuid - The log UUID
   * @param {Array} items - The new items
   * @param {string} [userId='cli-user'] - Optional user ID
   * @returns {Promise<NutriLog|null>}
   */
  async updateItems(uuid, items, userId = 'cli-user') {
    const nutriLog = await this.findByUuid(uuid, userId);
    if (!nutriLog) {
      this.#logger.warn('nutrilog.updateItems.notFound', { uuid, userId });
      return null;
    }

    // Use the domain method to update items
    const updated = nutriLog.updateItems(items);
    
    this.#logger.debug('nutrilog.updateItems', { 
      uuid, 
      oldItemCount: nutriLog.items.length,
      newItemCount: items.length 
    });

    return this.save(updated);
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

      summary.meals[log.meal.time].push(log);
    }

    return summary;
  }

  /**
   * Archive old log entries to monthly archive files
   * Moves entries older than retentionDays from hot storage to cold archives
   * @param {string} userId
   * @param {number} [retentionDays=30] - Days to keep in hot storage
   * @returns {Promise<Object>} - { archived: number, kept: number, months: string[] }
   */
  async archiveOldLogs(userId, retentionDays = ARCHIVE_RETENTION_DAYS) {
    const path = this.#getPath(userId);
    const data = this.#loadData(path);
    const cutoffDate = moment().subtract(retentionDays, 'days').format('YYYY-MM-DD');
    
    const hotLogs = {};
    const coldByMonth = {}; // { 'YYYY-MM': { logId: {...} } }
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
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    
    const monthsUpdated = [];
    for (const [yearMonth, monthLogs] of Object.entries(coldByMonth)) {
      const archivePath = this.#getArchivePath(userId, yearMonth);
      
      // Merge with existing archive
      let existing = {};
      if (fs.existsSync(archivePath)) {
        existing = yaml.load(fs.readFileSync(archivePath, 'utf8')) || {};
      }
      
      const merged = { ...existing, ...monthLogs };
      fs.writeFileSync(archivePath, yaml.dump(merged, { lineWidth: -1 }), 'utf8');
      monthsUpdated.push(yearMonth);
      
      this.#logger.info('nutrilog.archive.wrote', { 
        userId, 
        yearMonth, 
        count: Object.keys(monthLogs).length,
        total: Object.keys(merged).length 
      });
    }
    
    // Update hot storage
    saveFile(path, hotLogs);
    
    this.#logger.info('nutrilog.archive.complete', { userId, archived, kept, months: monthsUpdated });
    
    return { archived, kept, months: monthsUpdated };
  }
}

export default NutriLogRepository;
