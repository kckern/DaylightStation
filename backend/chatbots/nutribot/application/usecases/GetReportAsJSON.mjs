/**
 * Get Report as JSON Use Case
 * @module nutribot/application/usecases/GetReportAsJSON
 * 
 * Returns nutrition data as structured JSON for API consumption.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * @typedef {Object} GetReportAsJSONInput
 * @property {string} userId - User ID
 * @property {string} [date] - Date (YYYY-MM-DD), defaults to today
 */

/**
 * @typedef {Object} ReportJSON
 * @property {string} date
 * @property {Object[]} items - Food items for the day
 * @property {Object} totals - Aggregated totals
 * @property {number} pending - Count of pending logs
 */

/**
 * Get report as JSON use case
 */
export class GetReportAsJSON {
  #nutriLogRepository;
  #nutriListRepository;
  #config;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('../../repositories/NutriLogRepository.mjs').NutriLogRepository} deps.nutriLogRepository
   * @param {import('../../repositories/NutriListRepository.mjs').NutriListRepository} deps.nutriListRepository
   * @param {import('../../config/NutriBotConfig.mjs').NutriBotConfig} deps.config
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    if (!deps.nutriLogRepository) throw new Error('nutriLogRepository is required');
    if (!deps.nutriListRepository) throw new Error('nutriListRepository is required');
    if (!deps.config) throw new Error('config is required');

    this.#nutriLogRepository = deps.nutriLogRepository;
    this.#nutriListRepository = deps.nutriListRepository;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {GetReportAsJSONInput} input
   * @returns {Promise<ReportJSON>}
   */
  async execute(input) {
    const { userId } = input;
    const date = input.date || this.#getTodayDate(userId);

    this.#logger.debug('report.json.start', { userId, date });

    // Get pending count
    const pendingLogs = await this.#nutriLogRepository.findPending(userId);
    const pending = pendingLogs.length;

    // Get accepted logs for date
    const logs = await this.#nutriLogRepository.findByDate(userId, date);
    const acceptedLogs = logs.filter(log => log.isAccepted);

    // Build items array
    const items = [];
    const totals = {
      grams: 0,
      greenGrams: 0,
      yellowGrams: 0,
      orangeGrams: 0,
      itemCount: 0,
    };

    for (const log of acceptedLogs) {
      for (const item of log.items) {
        items.push({
          id: item.id,
          logId: log.id,
          label: item.label,
          icon: item.icon,
          grams: item.grams,
          unit: item.unit,
          amount: item.amount,
          color: item.color,
          meal: log.meal,
          createdAt: log.createdAt,
        });

        totals.grams += item.grams;
        totals.itemCount += 1;
        
        if (item.color === 'green') totals.greenGrams += item.grams;
        else if (item.color === 'yellow') totals.yellowGrams += item.grams;
        else if (item.color === 'orange') totals.orangeGrams += item.grams;
      }
    }

    // Sort items by calories descending
    items.sort((a, b) => (b.calories || 0) - (a.calories || 0));

    // Calculate percentages
    if (totals.grams > 0) {
      totals.greenPercent = Math.round((totals.greenGrams / totals.grams) * 100);
      totals.yellowPercent = Math.round((totals.yellowGrams / totals.grams) * 100);
      totals.orangePercent = Math.round((totals.orangeGrams / totals.grams) * 100);
    } else {
      totals.greenPercent = 0;
      totals.yellowPercent = 0;
      totals.orangePercent = 0;
    }

    this.#logger.debug('report.json.complete', { userId, date, itemCount: items.length, pending });

    return {
      date,
      items,
      totals,
      pending,
    };
  }

  /**
   * Get today's date in user's timezone
   * @private
   */
  #getTodayDate(userId) {
    const timezone = this.#config.getUserTimezone(userId);
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }
}

export default GetReportAsJSON;
