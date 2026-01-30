/**
 * CostReportingService - Application service for cost dashboard and reporting
 * @module applications/cost/services/CostReportingService
 *
 * Provides dashboard and reporting capabilities for cost data. Aggregates
 * data from the cost repository and budget service to provide comprehensive
 * spending reports.
 *
 * @example
 * const service = new CostReportingService({
 *   costRepository: yamlCostRepository,
 *   budgetService: costBudgetService,
 *   logger
 * });
 *
 * // Get dashboard summary
 * const dashboard = await service.getDashboard('default', { start, end });
 *
 * // Get spend breakdown by category
 * const byCategory = await service.getSpendByCategory('default', period, 2);
 */

import { CostAnalysisService } from '#domains/cost/index.mjs';

/**
 * CostReportingService
 * Application service for cost dashboard and reporting
 *
 * @class CostReportingService
 */
export class CostReportingService {
  /** @type {ICostRepository} */
  #costRepository;

  /** @type {Object|null} */
  #budgetService;

  /** @type {CostAnalysisService} */
  #analysisService;

  /** @type {Object} */
  #logger;

  /**
   * Create a CostReportingService instance
   *
   * @param {Object} config - Service configuration
   * @param {ICostRepository} config.costRepository - Repository for cost entries (required)
   * @param {Object} [config.budgetService=null] - Budget service for budget statuses (optional)
   * @param {CostAnalysisService} [config.analysisService] - Analysis service (creates new if not provided)
   * @param {Object} [config.logger=console] - Logger instance
   * @throws {Error} If costRepository is not provided
   */
  constructor({ costRepository, budgetService = null, analysisService, logger = console }) {
    if (!costRepository) {
      throw new Error('costRepository is required');
    }

    this.#costRepository = costRepository;
    this.#budgetService = budgetService;
    this.#analysisService = analysisService || new CostAnalysisService();
    this.#logger = logger;
  }

  /**
   * Get dashboard summary for a household
   *
   * Returns comprehensive spending summary including total spend, category
   * breakdown, budget statuses, and entry count for the specified period.
   *
   * @param {string} householdId - Household identifier
   * @param {Object} period - Period for the dashboard
   * @param {Date} period.start - Start date (inclusive)
   * @param {Date} period.end - End date (inclusive)
   * @returns {Promise<Object>} Dashboard summary
   * @returns {Object} return.period - The period object
   * @returns {number} return.totalSpend - Total spend amount
   * @returns {Object} return.categoryBreakdown - Spend by category (object from Map)
   * @returns {Array} return.budgetStatuses - Array of budget status objects
   * @returns {number} return.entryCount - Number of cost entries
   */
  async getDashboard(householdId, period) {
    // Load entries for period
    const entries = await this.#costRepository.findByPeriod(
      period.start,
      period.end,
      { householdId }
    );

    // Calculate total spend
    const totalSpend = this.#analysisService.calculateSpend(entries);

    // Get category breakdown at depth 1 (root level)
    const categoryMap = this.#analysisService.getCategoryBreakdown(entries, 1);
    const categoryBreakdown = Object.fromEntries(categoryMap);

    // Get budget statuses if service available
    let budgetStatuses = [];
    if (this.#budgetService) {
      try {
        budgetStatuses = await this.#budgetService.evaluateBudgets(householdId);
      } catch (error) {
        this.#logger.warn?.('cost.dashboard.budget.error', {
          householdId,
          error: error.message
        });
      }
    }

    return {
      period,
      totalSpend: totalSpend.amount,
      categoryBreakdown,
      budgetStatuses,
      entryCount: entries.length
    };
  }

  /**
   * Get spend breakdown by category
   *
   * Returns array of categories with their spend amounts, sorted by amount
   * descending.
   *
   * @param {string} householdId - Household identifier
   * @param {Object} period - Period for the report
   * @param {Date} period.start - Start date (inclusive)
   * @param {Date} period.end - End date (inclusive)
   * @param {number} [depth=2] - Category path depth for aggregation
   * @returns {Promise<Array<{category: string, amount: number}>>} Sorted category breakdown
   */
  async getSpendByCategory(householdId, period, depth = 2) {
    // Load entries for period
    const entries = await this.#costRepository.findByPeriod(
      period.start,
      period.end,
      { householdId }
    );

    // Get breakdown at specified depth
    const breakdown = this.#analysisService.getCategoryBreakdown(entries, depth);

    // Convert to array and sort by amount descending
    return this.#mapToSortedArray(breakdown, 'category');
  }

  /**
   * Get spend breakdown by user
   *
   * Returns array of users with their spend amounts, sorted by amount
   * descending. Entries without a userId are attributed to 'system'.
   *
   * @param {string} householdId - Household identifier
   * @param {Object} period - Period for the report
   * @param {Date} period.start - Start date (inclusive)
   * @param {Date} period.end - End date (inclusive)
   * @returns {Promise<Array<{userId: string, amount: number}>>} Sorted user breakdown
   */
  async getSpendByUser(householdId, period) {
    // Load entries for period
    const entries = await this.#costRepository.findByPeriod(
      period.start,
      period.end,
      { householdId }
    );

    // Get user breakdown
    const breakdown = this.#analysisService.getUserBreakdown(entries);

    // Convert to array and sort by amount descending
    return this.#mapToSortedArray(breakdown, 'userId');
  }

  /**
   * Get spend breakdown by resource
   *
   * Returns array of resources with their spend amounts, sorted by amount
   * descending. Entries without a resource are excluded.
   *
   * @param {string} householdId - Household identifier
   * @param {Object} period - Period for the report
   * @param {Date} period.start - Start date (inclusive)
   * @param {Date} period.end - End date (inclusive)
   * @returns {Promise<Array<{resource: string, amount: number}>>} Sorted resource breakdown
   */
  async getSpendByResource(householdId, period) {
    // Load entries for period
    const entries = await this.#costRepository.findByPeriod(
      period.start,
      period.end,
      { householdId }
    );

    // Get resource breakdown
    const breakdown = this.#analysisService.getResourceBreakdown(entries);

    // Convert to array and sort by amount descending
    return this.#mapToSortedArray(breakdown, 'resource');
  }

  /**
   * Get paginated cost entries
   *
   * Returns a page of cost entries matching the filter criteria, with
   * pagination metadata.
   *
   * @param {Object} filter - Filter criteria
   * @param {string} [filter.householdId] - Filter by household
   * @param {Date} [filter.start] - Start date (inclusive)
   * @param {Date} [filter.end] - End date (inclusive)
   * @param {string} [filter.category] - Filter by category
   * @param {string} [filter.entryType] - Filter by entry type
   * @param {Object} [pagination={ page: 1, limit: 50 }] - Pagination options
   * @param {number} [pagination.page=1] - Page number (1-indexed)
   * @param {number} [pagination.limit=50] - Items per page
   * @returns {Promise<Object>} Paginated entries response
   * @returns {Array} return.entries - Array of toJSON'd cost entries
   * @returns {number} return.total - Total number of matching entries
   * @returns {number} return.page - Current page number
   * @returns {number} return.limit - Items per page
   */
  async getEntries(filter, pagination = { page: 1, limit: 50 }) {
    const { page = 1, limit = 50 } = pagination;

    // Build repository filter
    const repoFilter = {};
    if (filter.householdId) {
      repoFilter.householdId = filter.householdId;
    }
    if (filter.category) {
      repoFilter.category = filter.category;
    }
    if (filter.entryType) {
      repoFilter.entryType = filter.entryType;
    }

    // Get all entries for the period (repository handles date filtering)
    const allEntries = await this.#costRepository.findByPeriod(
      filter.start,
      filter.end,
      repoFilter
    );

    const total = allEntries.length;

    // Calculate pagination slice
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const pageEntries = allEntries.slice(startIndex, endIndex);

    // Convert to JSON
    const entries = pageEntries.map(entry => entry.toJSON());

    return {
      entries,
      total,
      page,
      limit
    };
  }

  /**
   * Convert a Map to a sorted array of objects
   *
   * @private
   * @param {Map<string, number>} map - Map to convert
   * @param {string} keyName - Name for the key field in output objects
   * @returns {Array<Object>} Sorted array with keyName and amount fields
   */
  #mapToSortedArray(map, keyName) {
    return Array.from(map.entries())
      .map(([key, amount]) => ({ [keyName]: key, amount }))
      .sort((a, b) => b.amount - a.amount);
  }
}

export default CostReportingService;
