/**
 * INutrilistRepository Port
 * @module nutribot/application/ports/INutrilistRepository
 * 
 * Port interface for NutriListItem persistence.
 */

import { IRepository } from '../../../_lib/ports/IRepository.mjs';

/**
 * NutriList repository interface
 * @interface INutrilistRepository
 * @extends IRepository
 */
export class INutrilistRepository extends IRepository {
  /**
   * Find items by date
   * @param {string} chatId
   * @param {string} date - ISO date string (YYYY-MM-DD)
   * @returns {Promise<Array>}
   */
  async findByDate(chatId, date) {
    throw new Error('INutrilistRepository.findByDate must be implemented');
  }

  /**
   * Find items by log UUID
   * @param {string} chatId
   * @param {string} logUuid
   * @returns {Promise<Array>}
   */
  async findByLogUuid(chatId, logUuid) {
    throw new Error('INutrilistRepository.findByLogUuid must be implemented');
  }

  /**
   * Find recent items
   * @param {string} chatId
   * @param {number} days - Number of days
   * @returns {Promise<Array>}
   */
  async findRecent(chatId, days) {
    throw new Error('INutrilistRepository.findRecent must be implemented');
  }

  /**
   * Clear items by log UUID
   * @param {string} chatId
   * @param {string} logUuid
   * @returns {Promise<void>}
   */
  async clearByLogUuid(chatId, logUuid) {
    throw new Error('INutrilistRepository.clearByLogUuid must be implemented');
  }

  /**
   * Save multiple items
   * @param {Array} items
   * @returns {Promise<void>}
   */
  async saveMany(items) {
    throw new Error('INutrilistRepository.saveMany must be implemented');
  }

  /**
   * Get daily macro totals
   * @param {string} chatId
   * @param {string} date - ISO date string
   * @returns {Promise<{calories: number, protein: number, carbs: number, fat: number}>}
   */
  async getDailyTotals(chatId, date) {
    throw new Error('INutrilistRepository.getDailyTotals must be implemented');
  }

  /**
   * Update item portion
   * @param {string} uuid
   * @param {number} factor - Portion factor
   * @returns {Promise<void>}
   */
  async updatePortion(uuid, factor) {
    throw new Error('INutrilistRepository.updatePortion must be implemented');
  }

  /**
   * Move item to different date
   * @param {string} uuid
   * @param {string} newDate
   * @returns {Promise<void>}
   */
  async moveToDate(uuid, newDate) {
    throw new Error('INutrilistRepository.moveToDate must be implemented');
  }
}

export default INutrilistRepository;
