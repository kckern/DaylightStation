/**
 * FoodLogService - Food logging operations
 *
 * Service layer for NutriLog domain operations.
 * Note: Nutribot use cases typically work directly with the repository.
 * This service provides higher-level convenience methods.
 *
 * All mutation methods require a timestamp parameter (DDD compliance).
 */

import { NutriLog } from '../entities/NutriLog.mjs';
import { ValidationError, EntityNotFoundError } from '../../core/errors/index.mjs';

export class FoodLogService {
  #store;
  #timezone;

  constructor({ foodLogStore, timezone = 'America/Los_Angeles' }) {
    this.#store = foodLogStore;
    this.#timezone = timezone;
  }

  /**
   * Get logs for a user on a specific date
   * @param {string} userId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<NutriLog[]>}
   */
  async getLogsByDate(userId, date) {
    return this.#store.findByDate(userId, date);
  }

  /**
   * Get a specific log by ID
   * @param {string} userId
   * @param {string} logId
   * @returns {Promise<NutriLog|null>}
   */
  async getLogById(userId, logId) {
    return this.#store.findById(userId, logId);
  }

  /**
   * Create a new food log
   * @param {object} props - NutriLog properties
   * @param {Date} props.timestamp - Current timestamp (required)
   * @returns {Promise<NutriLog>}
   */
  async createLog(props) {
    if (!(props.timestamp instanceof Date) || isNaN(props.timestamp.getTime())) {
      throw new ValidationError('timestamp is required for createLog', {
        field: 'timestamp',
        received: props.timestamp,
      });
    }
    const log = NutriLog.create({
      ...props,
      timezone: props.timezone || this.#timezone,
    });
    return this.#store.save(log);
  }

  /**
   * Accept a pending log
   * @param {string} userId
   * @param {string} logId
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {Promise<NutriLog>}
   */
  async acceptLog(userId, logId, timestamp) {
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
      throw new ValidationError('timestamp is required for acceptLog', {
        field: 'timestamp',
        received: timestamp,
      });
    }
    const log = await this.#store.findById(userId, logId);
    if (!log) {
      throw new EntityNotFoundError('NutriLog', logId);
    }
    const accepted = log.accept(timestamp);
    return this.#store.save(accepted);
  }

  /**
   * Reject a pending log
   * @param {string} userId
   * @param {string} logId
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {Promise<NutriLog>}
   */
  async rejectLog(userId, logId, timestamp) {
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
      throw new ValidationError('timestamp is required for rejectLog', {
        field: 'timestamp',
        received: timestamp,
      });
    }
    const log = await this.#store.findById(userId, logId);
    if (!log) {
      throw new EntityNotFoundError('NutriLog', logId);
    }
    const rejected = log.reject(timestamp);
    return this.#store.save(rejected);
  }

  /**
   * Delete a log (soft delete)
   * @param {string} userId
   * @param {string} logId
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {Promise<NutriLog>}
   */
  async deleteLog(userId, logId, timestamp) {
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
      throw new ValidationError('timestamp is required for deleteLog', {
        field: 'timestamp',
        received: timestamp,
      });
    }
    const log = await this.#store.findById(userId, logId);
    if (!log) {
      throw new EntityNotFoundError('NutriLog', logId);
    }
    const deleted = log.delete(timestamp);
    return this.#store.save(deleted);
  }

  /**
   * Update log items
   * @param {string} userId
   * @param {string} logId
   * @param {object[]} items - New items array
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {Promise<NutriLog>}
   */
  async updateLogItems(userId, logId, items, timestamp) {
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
      throw new ValidationError('timestamp is required for updateLogItems', {
        field: 'timestamp',
        received: timestamp,
      });
    }
    const log = await this.#store.findById(userId, logId);
    if (!log) {
      throw new EntityNotFoundError('NutriLog', logId);
    }
    const updated = log.setItems(items, timestamp);
    return this.#store.save(updated);
  }

  /**
   * Get pending logs for a user
   * @param {string} userId
   * @returns {Promise<NutriLog[]>}
   */
  async getPendingLogs(userId) {
    return this.#store.findPending(userId);
  }

  /**
   * Get accepted logs for a user
   * @param {string} userId
   * @returns {Promise<NutriLog[]>}
   */
  async getAcceptedLogs(userId) {
    return this.#store.findAccepted(userId);
  }

  /**
   * Get logs in date range
   * @param {string} userId
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<NutriLog[]>}
   */
  async getLogsInRange(userId, startDate, endDate) {
    return this.#store.findByDateRange(userId, startDate, endDate);
  }

  /**
   * Get daily summary for a date
   * @param {string} userId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<object>}
   */
  async getDailySummary(userId, date) {
    return this.#store.getDailySummary(userId, date);
  }

  /**
   * Get weekly summary
   * @param {string} userId
   * @param {string} weekStart - YYYY-MM-DD (start of week)
   * @returns {Promise<object>}
   */
  async getWeeklySummary(userId, weekStart) {
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
    const endDateStr = endDate.toISOString().split('T')[0];

    const logs = await this.getLogsInRange(userId, weekStart, endDateStr);
    const acceptedLogs = logs.filter(l => l.isAccepted);

    const totalGrams = acceptedLogs.reduce((sum, l) => sum + l.totalGrams, 0);
    const gramsByColor = { green: 0, yellow: 0, orange: 0 };

    for (const log of acceptedLogs) {
      const logGrams = log.gramsByColor;
      gramsByColor.green += logGrams.green;
      gramsByColor.yellow += logGrams.yellow;
      gramsByColor.orange += logGrams.orange;
    }

    return {
      weekStart,
      weekEnd: endDateStr,
      daysLogged: new Set(acceptedLogs.map(l => l.meal.date)).size,
      totalLogs: acceptedLogs.length,
      totalItems: acceptedLogs.reduce((sum, l) => sum + l.itemCount, 0),
      totalGrams,
      gramsByColor,
      avgGramsPerDay: acceptedLogs.length > 0 ? Math.round(totalGrams / 7) : 0,
    };
  }
}

export default FoodLogService;
