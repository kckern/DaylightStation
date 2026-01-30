/**
 * ICostRepository - Port interface for cost entry persistence
 * @module applications/cost/ports/ICostRepository
 *
 * Defines the contract for adapters that persist and retrieve cost entries.
 * Implementations handle storage concerns (YAML files, databases, etc.).
 *
 * @example
 * class YamlCostRepository extends ICostRepository {
 *   async save(entry) { ... }
 *   async findByPeriod(start, end, filter) { ... }
 * }
 */

/**
 * ICostRepository interface
 * Abstract base class for cost entry persistence adapters
 *
 * @class ICostRepository
 */
export class ICostRepository {
  /**
   * Save a single cost entry
   *
   * @param {CostEntry} entry - The cost entry to save
   * @returns {Promise<void>}
   * @throws {Error} Must be implemented by concrete class
   */
  async save(entry) {
    throw new Error('ICostRepository.save must be implemented');
  }

  /**
   * Save multiple cost entries in a batch
   *
   * More efficient than calling save() multiple times.
   * Implementations should handle atomicity where possible.
   *
   * @param {CostEntry[]} entries - Array of cost entries to save
   * @returns {Promise<void>}
   * @throws {Error} Must be implemented by concrete class
   */
  async saveBatch(entries) {
    throw new Error('ICostRepository.saveBatch must be implemented');
  }

  /**
   * Find cost entries within a date range
   *
   * @param {Date} start - Start of the period (inclusive)
   * @param {Date} end - End of the period (inclusive)
   * @param {Object} [filter] - Optional filter criteria
   * @param {string} [filter.householdId] - Filter by household
   * @param {string} [filter.category] - Filter by category (supports prefix matching)
   * @param {string} [filter.entryType] - Filter by entry type
   * @returns {Promise<CostEntry[]>} Array of matching cost entries
   * @throws {Error} Must be implemented by concrete class
   */
  async findByPeriod(start, end, filter) {
    throw new Error('ICostRepository.findByPeriod must be implemented');
  }

  /**
   * Find cost entries by category
   *
   * @param {string|CostCategory} category - Category to search for (supports prefix matching)
   * @param {Object} [period] - Optional period filter
   * @param {Date} [period.start] - Start of period
   * @param {Date} [period.end] - End of period
   * @returns {Promise<CostEntry[]>} Array of matching cost entries
   * @throws {Error} Must be implemented by concrete class
   */
  async findByCategory(category, period) {
    throw new Error('ICostRepository.findByCategory must be implemented');
  }

  /**
   * Find cost entries by attribution
   *
   * @param {Object} attribution - Attribution criteria to match
   * @param {string} [attribution.householdId] - Household ID
   * @param {string} [attribution.memberId] - Member ID
   * @param {string} [attribution.agentId] - Agent ID
   * @param {Object} [period] - Optional period filter
   * @param {Date} [period.start] - Start of period
   * @param {Date} [period.end] - End of period
   * @returns {Promise<CostEntry[]>} Array of matching cost entries
   * @throws {Error} Must be implemented by concrete class
   */
  async findByAttribution(attribution, period) {
    throw new Error('ICostRepository.findByAttribution must be implemented');
  }

  /**
   * Compact old cost entries
   *
   * Aggregates individual entries older than the threshold into summary entries.
   * Used to reduce storage size while preserving aggregate data.
   *
   * @param {Date} olderThan - Compact entries older than this date
   * @returns {Promise<{ compacted: number, summaries: number }>} Compaction statistics
   * @throws {Error} Must be implemented by concrete class
   */
  async compact(olderThan) {
    throw new Error('ICostRepository.compact must be implemented');
  }

  /**
   * Archive cost entries to a file
   *
   * Exports entries to an archive file for long-term storage or backup.
   *
   * @param {CostEntry[]} entries - Entries to archive
   * @param {string} path - Destination file path
   * @returns {Promise<void>}
   * @throws {Error} Must be implemented by concrete class
   */
  async archive(entries, path) {
    throw new Error('ICostRepository.archive must be implemented');
  }
}

export default ICostRepository;
