/**
 * YamlCostDatastore - YAML-based cost entry persistence
 * @module adapters/cost/YamlCostDatastore
 *
 * Implements ICostRepository port for cost entry storage using YAML files.
 * Entries are organized by month for efficient querying.
 *
 * Storage structure:
 * ```
 * {dataRoot}/
 *   2026-01/
 *     entries.yml
 *   2026-02/
 *     entries.yml
 * ```
 *
 * @example
 * const datastore = new YamlCostDatastore({ dataRoot: '/data/cost' });
 * await datastore.save(entry);
 * const entries = await datastore.findByPeriod(start, end);
 */

import path from 'path';
import yaml from 'yaml';

import { ICostRepository } from '#apps/cost/ports/ICostRepository.mjs';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { Usage } from '#domains/cost/value-objects/Usage.mjs';
import { SpreadSource } from '#domains/cost/value-objects/SpreadSource.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { ensureDir, readTextFromPath, writeFile } from '#system/utils/FileIO.mjs';

const reconstituteMoney = data => new Money(data.amount, data.currency || 'USD');
const reconstituteCategory = data => typeof data === 'string' ? CostCategory.fromString(data) : new CostCategory(data);
const reconstituteAttribution = data => new Attribution({ householdId: data.householdId, userId: data.userId ?? null, feature: data.feature ?? null, resource: data.resource ?? null, tags: data.tags || {} });
const reconstituteUsage = data => new Usage(data.quantity, data.unit);
function reconstituteSpreadSource(data) {
  return new SpreadSource({
    name: data.name,
    originalAmount: typeof data.originalAmount === 'number' ? data.originalAmount : reconstituteMoney(data.originalAmount),
    spreadMonths: data.spreadMonths,
    startDate: new Date(data.startDate)
  });
}
function reconstituteCostEntry(data) {
  return new CostEntry({
    id: data.id,
    occurredAt: new Date(data.occurredAt),
    amount: reconstituteMoney(data.amount),
    category: reconstituteCategory(data.category),
    entryType: data.entryType,
    attribution: reconstituteAttribution(data.attribution),
    usage: data.usage ? reconstituteUsage(data.usage) : null,
    description: data.description ?? null,
    metadata: data.metadata || {},
    spreadSource: data.spreadSource ? reconstituteSpreadSource(data.spreadSource) : null,
    reconcilesUsage: data.reconcilesUsage ?? false,
    variance: data.variance ? reconstituteMoney(data.variance) : null
  });
}

function dehydrateCostEntry(entry) {
  // The repository also accepts pre-shaped records from import/test callers.
  // Keep that adapter-level compatibility without restoring serialization to
  // the CostEntry domain entity.
  if (!entry.attribution && typeof entry.toJSON === 'function') {
    return entry.toJSON();
  }

  const attribution = { householdId: entry.attribution.householdId };
  if (entry.attribution.userId !== null) attribution.userId = entry.attribution.userId;
  if (entry.attribution.feature !== null) attribution.feature = entry.attribution.feature;
  if (entry.attribution.resource !== null) attribution.resource = entry.attribution.resource;
  if (entry.attribution.tags.size > 0) attribution.tags = Object.fromEntries(entry.attribution.tags);

  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    amount: { amount: entry.amount.amount, currency: entry.amount.currency },
    category: entry.category.toString(),
    entryType: entry.entryType,
    attribution,
    usage: entry.usage ? { quantity: entry.usage.quantity, unit: entry.usage.unit } : null,
    description: entry.description,
    metadata: entry.metadata,
    spreadSource: entry.spreadSource ? {
      name: entry.spreadSource.name,
      originalAmount: { amount: entry.spreadSource.originalAmount.amount, currency: entry.spreadSource.originalAmount.currency },
      spreadMonths: entry.spreadSource.spreadMonths,
      startDate: entry.spreadSource.startDate.toISOString()
    } : null,
    reconcilesUsage: entry.reconcilesUsage,
    variance: entry.variance ? { amount: entry.variance.amount, currency: entry.variance.currency } : null
  };
}

/**
 * YAML-based cost entry datastore
 * Implements ICostRepository for file-based persistence
 *
 * @class YamlCostDatastore
 * @extends ICostRepository
 */
export class YamlCostDatastore extends ICostRepository {
  /** @type {string} */
  #dataRoot;

  /** @type {Object} */
  #io;

  /**
   * Create a YamlCostDatastore instance
   *
   * @param {Object} config - Configuration options
   * @param {string} config.dataRoot - Base path to cost data directory (required)
   * @param {Object} [config.io=null] - IO operations interface for testing
   * @param {Function} config.io.read - Read YAML file
   * @param {Function} config.io.write - Write YAML file
   * @param {Function} config.io.ensureDir - Ensure directory exists
   * @throws {InfrastructureError} If dataRoot is not provided
   */
  constructor({ dataRoot, io = null }) {
    super();

    if (!dataRoot) {
      throw new InfrastructureError('dataRoot is required', {
        code: 'MISSING_DATA_ROOT'
      });
    }

    this.#dataRoot = dataRoot;

    // Use provided io or default implementations
    this.#io = io || {
      read: this.#defaultRead.bind(this),
      write: this.#defaultWrite.bind(this),
      ensureDir: this.#defaultEnsureDir.bind(this)
    };
  }

  // ==========================================================================
  // ICostRepository Implementation
  // ==========================================================================

  /**
   * Save a single cost entry
   *
   * Persists the entry to the appropriate month file based on occurredAt.
   * If an entry with the same ID exists, it will be replaced.
   *
   * @param {CostEntry} entry - The cost entry to save
   * @returns {Promise<void>}
   */
  async save(entry) {
    const monthPath = this.#getMonthPath(entry.occurredAt);
    const filePath = path.join(monthPath, 'entries.yml');

    // Ensure directory exists
    await this.#io.ensureDir(monthPath);

    // Read existing entries
    const existing = await this.#readEntriesFile(filePath);
    const entries = existing || [];

    // Replace or add entry
    const entryJson = dehydrateCostEntry(entry);
    const existingIndex = entries.findIndex(e => e.id === entry.id);

    if (existingIndex >= 0) {
      entries[existingIndex] = entryJson;
    } else {
      entries.push(entryJson);
    }

    // Write back
    await this.#io.write(filePath, { entries });
  }

  /**
   * Save multiple cost entries in a batch
   *
   * Groups entries by month and saves each batch to the appropriate file.
   * More efficient than calling save() multiple times.
   *
   * @param {CostEntry[]} entries - Array of cost entries to save
   * @returns {Promise<void>}
   */
  async saveBatch(entries) {
    if (entries.length === 0) {
      return;
    }

    // Group entries by month
    const byMonth = new Map();
    for (const entry of entries) {
      const monthKey = this.#getMonthKey(entry.occurredAt);
      if (!byMonth.has(monthKey)) {
        byMonth.set(monthKey, []);
      }
      byMonth.get(monthKey).push(entry);
    }

    // Save each month's entries
    for (const [monthKey, monthEntries] of byMonth) {
      const monthPath = path.join(this.#dataRoot, monthKey);
      const filePath = path.join(monthPath, 'entries.yml');

      // Ensure directory exists
      await this.#io.ensureDir(monthPath);

      // Read existing entries
      const existing = await this.#readEntriesFile(filePath);
      const existingEntries = existing || [];

      // Build a map of existing entries by ID for efficient lookup
      const existingMap = new Map(existingEntries.map(e => [e.id, e]));

      // Add or replace entries
      for (const entry of monthEntries) {
        existingMap.set(entry.id, dehydrateCostEntry(entry));
      }

      // Write back
      await this.#io.write(filePath, { entries: Array.from(existingMap.values()) });
    }
  }

  /**
   * Find cost entries within a date range
   *
   * @param {Date} start - Start of the period (inclusive)
   * @param {Date} end - End of the period (inclusive)
   * @param {Object} [filter={}] - Optional filter criteria
   * @param {CostCategory} [filter.category] - Filter by category (uses matches())
   * @param {string} [filter.userId] - Filter by user ID
   * @param {string} [filter.householdId] - Filter by household ID
   * @param {boolean} [filter.excludeReconciliation=true] - Exclude reconciliation entries
   * @returns {Promise<CostEntry[]>} Array of matching cost entries
   */
  async findByPeriod(start, end, filter = {}) {
    const months = this.#getMonthsInRange(start, end);
    const allEntries = [];

    // Read entries from all relevant month files
    for (const monthKey of months) {
      const filePath = path.join(this.#dataRoot, monthKey, 'entries.yml');
      const entries = await this.#readEntriesFile(filePath);

      if (entries) {
        allEntries.push(...entries);
      }
    }

    // Apply filters
    const excludeReconciliation = filter.excludeReconciliation !== false;
    const categoryFilter = filter.category;
    const userIdFilter = filter.userId;
    const householdIdFilter = filter.householdId;

    const results = [];
    for (const entryData of allEntries) {
      const occurredAt = new Date(entryData.occurredAt);

      // Date range filter
      if (occurredAt < start || occurredAt > end) {
        continue;
      }

      // Reconciliation filter (default: exclude)
      if (excludeReconciliation && entryData.reconcilesUsage) {
        continue;
      }

      // Category filter using matches()
      if (categoryFilter) {
        const entryCategory = reconstituteCategory(entryData.category);
        if (!categoryFilter.matches(entryCategory)) {
          continue;
        }
      }

      // User ID filter
      if (userIdFilter && entryData.attribution?.userId !== userIdFilter) {
        continue;
      }

      // Household ID filter
      if (householdIdFilter && entryData.attribution?.householdId !== householdIdFilter) {
        continue;
      }

      // Convert to CostEntry entity
      results.push(reconstituteCostEntry(entryData));
    }

    return results;
  }

  /**
   * Find cost entries by category
   *
   * Delegates to findByPeriod with category filter.
   *
   * @param {string|CostCategory} category - Category to search for (supports prefix matching)
   * @param {Object} [period] - Optional period filter
   * @param {Date} [period.start] - Start of period
   * @param {Date} [period.end] - End of period
   * @returns {Promise<CostEntry[]>} Array of matching cost entries
   */
  async findByCategory(category, period) {
    const categoryObj = category instanceof CostCategory
      ? category
      : CostCategory.fromString(category);

    return this.findByPeriod(
      period?.start || new Date(0),
      period?.end || new Date(),
      { category: categoryObj }
    );
  }

  /**
   * Find cost entries by attribution
   *
   * Delegates to findByPeriod with attribution filters.
   *
   * @param {Object} attribution - Attribution criteria to match
   * @param {string} [attribution.householdId] - Household ID
   * @param {string} [attribution.memberId] - Member ID (maps to userId)
   * @param {string} [attribution.agentId] - Agent ID (not yet implemented)
   * @param {Object} [period] - Optional period filter
   * @param {Date} [period.start] - Start of period
   * @param {Date} [period.end] - End of period
   * @returns {Promise<CostEntry[]>} Array of matching cost entries
   */
  async findByAttribution(attribution, period) {
    const filter = {};

    if (attribution.householdId) {
      filter.householdId = attribution.householdId;
    }

    if (attribution.memberId) {
      filter.userId = attribution.memberId;
    }

    return this.findByPeriod(
      period?.start || new Date(0),
      period?.end || new Date(),
      filter
    );
  }

  /**
   * Compact old cost entries into daily/monthly summaries
   *
   * **NOT YET IMPLEMENTED** - Returns zero statistics.
   * Scheduled for Phase 9: CostCompactionService (see design doc).
   *
   * When implemented, this will:
   * - Roll up individual entries into daily summaries
   * - Preserve category and attribution breakdowns
   * - Reduce storage for historical data
   *
   * @param {Date} olderThan - Compact entries older than this date
   * @returns {Promise<{ entriesCompacted: number, summariesCreated: number, bytesReclaimed: number }>}
   *
   * @todo Implement compaction logic in Phase 9
   * @see docs/plans/2026-01-30-cost-domain-design.md
   */
  async compact(olderThan) {
    // TODO(Phase 9): Implement compaction - roll up entries into summaries
    return {
      entriesCompacted: 0,
      summariesCreated: 0,
      bytesReclaimed: 0
    };
  }

  /**
   * Archive cost entries to a compressed file
   *
   * **NOT YET IMPLEMENTED** - No-op.
   * Scheduled for Phase 9: CostCompactionService (see design doc).
   *
   * When implemented, this will:
   * - Write entries to gzipped YAML archive
   * - Support restoration of archived data
   *
   * @param {CostEntry[]} entries - Entries to archive
   * @param {string} archiveId - Semantic archive destination identifier
   * @returns {Promise<void>}
   *
   * @todo Implement archive logic in Phase 9
   * @see docs/plans/2026-01-30-cost-domain-design.md
   */
  async archive(entries, archiveId) {
    // TODO(Phase 9): Implement archive - write to gzipped YAML
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Get the month directory path for a date
   *
   * @param {Date} date - The date to get the month path for
   * @returns {string} Full path to the month directory
   * @private
   */
  #getMonthPath(date) {
    return path.join(this.#dataRoot, this.#getMonthKey(date));
  }

  /**
   * Get the month key (YYYY-MM) for a date
   *
   * Uses UTC to avoid timezone issues.
   *
   * @param {Date} date - The date to get the month key for
   * @returns {string} Month key in YYYY-MM format
   * @private
   */
  #getMonthKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Get all month keys in a date range
   *
   * @param {Date} start - Start of range
   * @param {Date} end - End of range
   * @returns {string[]} Array of month keys (YYYY-MM format)
   * @private
   */
  #getMonthsInRange(start, end) {
    const months = [];
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

    while (current <= endMonth) {
      months.push(this.#getMonthKey(current));
      current.setUTCMonth(current.getUTCMonth() + 1);
    }

    return months;
  }

  /**
   * Read entries from a YAML file
   *
   * @param {string} filePath - Path to the entries file
   * @returns {Promise<Object[]|null>} Array of entry objects or null if file doesn't exist
   * @private
   */
  async #readEntriesFile(filePath) {
    const data = await this.#io.read(filePath);
    return data?.entries || null;
  }

  // ==========================================================================
  // Default IO Operations
  // ==========================================================================

  /**
   * Default read implementation using fs/promises and yaml
   *
   * @param {string} filePath - Path to read
   * @returns {Promise<Object|null>} Parsed YAML content or null if file doesn't exist
   * @private
   */
  async #defaultRead(filePath) {
    try {
      const content = readTextFromPath(filePath);
      return yaml.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw new InfrastructureError(`Failed to read file: ${filePath}`, {
        code: 'FILE_READ_ERROR',
        cause: error
      });
    }
  }

  /**
   * Default write implementation using fs/promises and yaml
   *
   * @param {string} filePath - Path to write
   * @param {Object} data - Data to write
   * @returns {Promise<void>}
   * @private
   */
  async #defaultWrite(filePath, data) {
    try {
      const content = yaml.stringify(data, { indent: 2 });
      writeFile(filePath, content);
    } catch (error) {
      throw new InfrastructureError(`Failed to write file: ${filePath}`, {
        code: 'FILE_WRITE_ERROR',
        cause: error
      });
    }
  }

  /**
   * Default ensureDir implementation using fs/promises
   *
   * @param {string} dirPath - Directory path to ensure exists
   * @returns {Promise<void>}
   * @private
   */
  async #defaultEnsureDir(dirPath) {
    try {
      ensureDir(dirPath);
    } catch (error) {
      throw new InfrastructureError(`Failed to create directory: ${dirPath}`, {
        code: 'DIR_CREATE_ERROR',
        cause: error
      });
    }
  }
}

export default YamlCostDatastore;
