/**
 * INutrilogRepository Port
 * @module nutribot/application/ports/INutrilogRepository
 * 
 * Port interface for NutriLog persistence.
 */

import { IRepository } from '../../../_lib/ports/IRepository.mjs';

/**
 * NutriLog repository interface
 * @interface INutrilogRepository
 * @extends IRepository
 */
export class INutrilogRepository extends IRepository {
  /**
   * Find logs by status
   * @param {string} chatId
   * @param {string} status - NutriLog status (INIT, PENDING, CONFIRMED, DISCARDED)
   * @returns {Promise<Array>}
   */
  async findByStatus(chatId, status) {
    throw new Error('INutrilogRepository.findByStatus must be implemented');
  }

  /**
   * Find logs by date
   * @param {string} chatId
   * @param {string} date - ISO date string (YYYY-MM-DD)
   * @returns {Promise<Array>}
   */
  async findByDate(chatId, date) {
    throw new Error('INutrilogRepository.findByDate must be implemented');
  }

  /**
   * Find recent logs
   * @param {string} chatId
   * @param {number} days - Number of days
   * @returns {Promise<Array>}
   */
  async findRecent(chatId, days) {
    throw new Error('INutrilogRepository.findRecent must be implemented');
  }

  /**
   * Get pending logs count
   * @param {string} chatId
   * @returns {Promise<number>}
   */
  async getPendingCount(chatId) {
    throw new Error('INutrilogRepository.getPendingCount must be implemented');
  }

  /**
   * Update log status
   * @param {string} uuid
   * @param {string} newStatus
   * @returns {Promise<void>}
   */
  async updateStatus(uuid, newStatus) {
    throw new Error('INutrilogRepository.updateStatus must be implemented');
  }

  /**
   * Update log items
   * @param {string} uuid
   * @param {Array} items - Updated food items
   * @returns {Promise<void>}
   */
  async updateItems(uuid, items) {
    throw new Error('INutrilogRepository.updateItems must be implemented');
  }
}

export default INutrilogRepository;
