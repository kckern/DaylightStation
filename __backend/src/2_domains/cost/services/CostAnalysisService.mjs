/**
 * CostAnalysisService - Domain service for cost analysis calculations
 * @module domains/cost/services/CostAnalysisService
 *
 * Stateless domain service for analyzing cost entries. Provides methods
 * for filtering, aggregating, and breaking down costs by various dimensions.
 *
 * @example
 * const service = new CostAnalysisService();
 * const spendEntries = service.filterForSpend(entries);
 * const totalSpend = service.calculateSpend(entries);
 * const byCategory = service.getCategoryBreakdown(entries, 1);
 */

import { Money } from '../value-objects/Money.mjs';

/**
 * CostAnalysisService - Pure domain service for cost calculations
 *
 * @class CostAnalysisService
 */
export class CostAnalysisService {
  /**
   * Create a CostAnalysisService instance
   *
   * This is a stateless service with no dependencies.
   */
  constructor() {
    // Stateless service - no dependencies needed
    Object.freeze(this);
  }

  /**
   * Filter entries to only those that count toward spend
   *
   * Excludes entries where countsInSpend() returns false (e.g., transactions,
   * reconciliation entries).
   *
   * @param {CostEntry[]} entries - Array of cost entries to filter
   * @returns {CostEntry[]} Entries that count toward spend
   */
  filterForSpend(entries) {
    return entries.filter(entry => entry.countsInSpend());
  }

  /**
   * Calculate total spend from entries
   *
   * Automatically filters to only include entries that count in spend.
   * Optionally filters by category.
   *
   * @param {CostEntry[]} entries - Array of cost entries
   * @param {Object} [options={}] - Calculation options
   * @param {CostCategory} [options.category] - Only include entries matching this category
   * @returns {Money} Total spend amount
   */
  calculateSpend(entries, options = {}) {
    let filtered = this.filterForSpend(entries);

    // Filter by category if provided
    if (options.category) {
      filtered = filtered.filter(entry =>
        options.category.matches(entry.category)
      );
    }

    // Sum amounts
    return filtered.reduce(
      (total, entry) => total.add(entry.amount),
      Money.zero()
    );
  }

  /**
   * Get spend breakdown by category at a specific depth
   *
   * @param {CostEntry[]} entries - Array of cost entries
   * @param {number} [depth=1] - Category path depth (1 = root, 2 = second level, etc.)
   * @returns {Map<string, number>} Map of category path to total amount
   */
  getCategoryBreakdown(entries, depth = 1) {
    const breakdown = new Map();
    const filtered = this.filterForSpend(entries);

    for (const entry of filtered) {
      const categoryPath = entry.category.path;
      // Get path up to specified depth, or full path if shorter
      const pathAtDepth = categoryPath.slice(0, depth).join('/');
      const currentAmount = breakdown.get(pathAtDepth) || 0;
      breakdown.set(pathAtDepth, currentAmount + entry.amount.amount);
    }

    return breakdown;
  }

  /**
   * Get spend breakdown by user
   *
   * @param {CostEntry[]} entries - Array of cost entries
   * @returns {Map<string, number>} Map of userId (or 'system' for null) to total amount
   */
  getUserBreakdown(entries) {
    const breakdown = new Map();
    const filtered = this.filterForSpend(entries);

    for (const entry of filtered) {
      const userId = entry.attribution.userId || 'system';
      const currentAmount = breakdown.get(userId) || 0;
      breakdown.set(userId, currentAmount + entry.amount.amount);
    }

    return breakdown;
  }

  /**
   * Get spend breakdown by feature
   *
   * @param {CostEntry[]} entries - Array of cost entries
   * @returns {Map<string, number>} Map of feature (or 'unattributed') to total amount
   */
  getFeatureBreakdown(entries) {
    const breakdown = new Map();
    const filtered = this.filterForSpend(entries);

    for (const entry of filtered) {
      const feature = entry.attribution.feature || 'unattributed';
      const currentAmount = breakdown.get(feature) || 0;
      breakdown.set(feature, currentAmount + entry.amount.amount);
    }

    return breakdown;
  }

  /**
   * Get spend breakdown by resource
   *
   * Entries without a resource are skipped (not included in breakdown).
   *
   * @param {CostEntry[]} entries - Array of cost entries
   * @returns {Map<string, number>} Map of resource to total amount
   */
  getResourceBreakdown(entries) {
    const breakdown = new Map();
    const filtered = this.filterForSpend(entries);

    for (const entry of filtered) {
      const resource = entry.attribution.resource;
      // Skip entries without resource
      if (resource === null) {
        continue;
      }
      const currentAmount = breakdown.get(resource) || 0;
      breakdown.set(resource, currentAmount + entry.amount.amount);
    }

    return breakdown;
  }

  /**
   * Get spend breakdown by a specific tag
   *
   * Only includes entries that have the specified tag.
   *
   * @param {CostEntry[]} entries - Array of cost entries
   * @param {string} tagName - Name of the tag to breakdown by
   * @returns {Map<string, number>} Map of tag value to total amount
   */
  getTagBreakdown(entries, tagName) {
    const breakdown = new Map();
    const filtered = this.filterForSpend(entries);

    for (const entry of filtered) {
      const tagValue = entry.attribution.tags.get(tagName);
      // Skip entries without the specified tag
      if (tagValue === undefined) {
        continue;
      }
      const currentAmount = breakdown.get(tagValue) || 0;
      breakdown.set(tagValue, currentAmount + entry.amount.amount);
    }

    return breakdown;
  }
}

export default CostAnalysisService;
