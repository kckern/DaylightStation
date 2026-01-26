/**
 * BuxferHarvester
 *
 * Harvests financial transactions from Buxfer API.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Transaction fetching with date range
 * - Account balance snapshots
 * - Incremental sync support
 *
 * @module harvester/finance/BuxferHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '../../../0_system/config/index.mjs';

const DEFAULT_DAYS_BACK = 30;

/**
 * Buxfer financial transaction harvester
 * @implements {IHarvester}
 */
export class BuxferHarvester extends IHarvester {
  #buxferAdapter;
  #lifelogStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.buxferAdapter - BuxferAdapter instance
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date formatting
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    buxferAdapter,
    lifelogStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!buxferAdapter) {
      throw new Error('BuxferHarvester requires buxferAdapter');
    }
    if (!lifelogStore) {
      throw new Error('BuxferHarvester requires lifelogStore');
    }

    this.#buxferAdapter = buxferAdapter;
    this.#lifelogStore = lifelogStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'buxfer';
  }

  get category() {
    return HarvesterCategory.FINANCE;
  }

  /**
   * Get available harvest parameters
   * @returns {HarvesterParam[]}
   */
  getParams() {
    return [
      { name: 'daysBack', type: 'number', default: DEFAULT_DAYS_BACK, description: 'Days of transaction history to fetch' },
      { name: 'accounts', type: 'string', default: null, description: 'Comma-separated account names (default: all)' },
    ];
  }

  /**
   * Harvest transactions from Buxfer
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.daysBack=30] - Days of history to fetch
   * @param {string} [options.accounts] - Comma-separated account names
   * @returns {Promise<{ count: number, status: string }>}
   */
  async harvest(username, options = {}) {
    const { daysBack = DEFAULT_DAYS_BACK, accounts } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('buxfer.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        count: 0,
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('buxfer.harvest.start', { username, daysBack, accounts });

      // Calculate date range
      const endDate = moment().tz(this.#timezone).format('YYYY-MM-DD');
      const startDate = moment().tz(this.#timezone).subtract(daysBack, 'days').format('YYYY-MM-DD');

      // Parse accounts if provided
      const accountList = accounts ? accounts.split(',').map(a => a.trim()) : null;

      // Fetch transactions
      const transactions = await this.#buxferAdapter.getTransactions({
        startDate,
        endDate,
        accounts: accountList,
      });

      // Group transactions by date
      const byDate = this.#groupByDate(transactions);

      // Load existing data and merge
      const existing = await this.#lifelogStore.load(username, 'buxfer') || {};
      const merged = this.#mergeByDate(existing, byDate);

      // Save to lifelog
      await this.#lifelogStore.save(username, 'buxfer', merged);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const dateCount = Object.keys(byDate).length;
      this.#logger.info?.('buxfer.harvest.complete', {
        username,
        transactionCount: transactions.length,
        dateCount,
      });

      return {
        count: transactions.length,
        status: 'success',
        dateCount,
      };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 401 || statusCode === 429) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('buxfer.harvest.error', {
        username,
        error: error.message,
        statusCode,
        circuitState: this.#circuitBreaker.getStatus().state,
      });

      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Group transactions by date
   * @private
   */
  #groupByDate(transactions) {
    const byDate = {};

    for (const txn of transactions) {
      const date = txn.date || moment().format('YYYY-MM-DD');

      if (!byDate[date]) {
        byDate[date] = [];
      }

      byDate[date].push({
        id: txn.id,
        description: txn.description,
        amount: txn.amount,
        type: txn.type,
        accountId: txn.accountId,
        accountName: txn.accountName,
        tags: txn.tags || [],
      });
    }

    return byDate;
  }

  /**
   * Merge new data with existing, preserving older entries
   * @private
   */
  #mergeByDate(existing, incoming) {
    const merged = { ...existing };

    for (const [date, transactions] of Object.entries(incoming)) {
      if (!merged[date]) {
        merged[date] = [];
      }

      // Add new transactions (by ID) that don't exist
      const existingIds = new Set(merged[date].map(t => t.id));
      for (const txn of transactions) {
        if (!existingIds.has(txn.id)) {
          merged[date].push(txn);
        }
      }
    }

    // Sort by date (newest first)
    const sortedDates = Object.keys(merged).sort((a, b) => new Date(b) - new Date(a));
    const sorted = {};
    for (const date of sortedDates) {
      sorted[date] = merged[date];
    }

    return sorted;
  }
}

export default BuxferHarvester;
