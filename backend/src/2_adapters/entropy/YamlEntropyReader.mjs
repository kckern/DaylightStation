/**
 * YamlEntropyReader
 *
 * Implements IEntropyReader for YAML-based lifelog data.
 * Uses fast path for archive-enabled services (reading only hot storage).
 *
 * @module entropy/adapters
 */

import moment from 'moment';

/**
 * YAML-based entropy data reader
 *
 * @implements {IEntropyReader}
 */
export class YamlEntropyReader {
  #io;
  #archiveService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.io - IO functions { userLoadFile, userLoadCurrent }
   * @param {Object} [config.archiveService] - Archive service for fast path
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ io, archiveService = null, logger = console }) {
    if (!io?.userLoadFile) {
      throw new Error('YamlEntropyReader requires io.userLoadFile');
    }
    this.#io = io;
    this.#archiveService = archiveService;
    this.#logger = logger;
  }

  /**
   * Get the most recent timestamp from a data source
   *
   * @param {string} username - User identifier
   * @param {string} dataPath - Path to data file (relative to user lifelog)
   * @param {Object} [options] - Additional options
   * @param {string} [options.dateField='date'] - Field name containing date
   * @param {Object} [options.filter] - Filter criteria { field, operator, value }
   * @param {string} [options.listProperty] - Nested property containing list
   * @param {string} [options.checkField] - Field that must exist for valid entry
   * @param {string} [options.dataSource='lifelog'] - 'lifelog' or 'current'
   * @returns {Promise<{ timestamp: number, date: string, data: any } | null>}
   */
  async getLastUpdated(username, dataPath, options = {}) {
    const {
      dateField = 'date',
      filter = null,
      listProperty = null,
      checkField = null,
      dataSource = 'lifelog',
    } = options;

    // Fast path: Use ArchiveService for archive-enabled services
    if (
      dataSource === 'lifelog' &&
      this.#archiveService?.isArchiveEnabled?.(dataPath) &&
      !filter &&
      !checkField
    ) {
      const fastResult = this.#archiveService.getMostRecentTimestamp(
        username,
        dataPath
      );
      if (fastResult) {
        return fastResult;
      }
    }

    // Slow path: Load full data
    const data = this.#loadData(username, dataPath, dataSource);
    if (!data) return null;

    let itemsToProcess = data;

    // Handle nested list property
    if (listProperty && data[listProperty]) {
      itemsToProcess = data[listProperty];
    }

    // Handle filtering for arrays
    if (filter && Array.isArray(itemsToProcess)) {
      itemsToProcess = this.#applyFilter(itemsToProcess, filter);
    }

    if (Array.isArray(itemsToProcess)) {
      return this.#findMostRecentInArray(itemsToProcess, dateField);
    }

    if (itemsToProcess && typeof itemsToProcess === 'object') {
      return this.#findMostRecentInDateKeyed(
        itemsToProcess,
        filter,
        checkField
      );
    }

    return null;
  }

  /**
   * Get count from a data source
   *
   * @param {string} username - User identifier
   * @param {string} dataPath - Path to data file (relative to user lifelog)
   * @param {Object} [options] - Additional options
   * @param {string} [options.countField] - Field containing count value
   * @param {string} [options.listProperty] - Nested property containing list
   * @param {string} [options.dataSource='current'] - 'lifelog' or 'current'
   * @returns {Promise<{ count: number, lastUpdated: string | null }>}
   */
  async getCount(username, dataPath, options = {}) {
    const {
      countField = 'count',
      listProperty = null,
      dataSource = 'current',
    } = options;

    const data = this.#loadData(username, dataPath, dataSource);

    if (!data) {
      return { count: 0, lastUpdated: null };
    }

    // Object with count field
    if (typeof data === 'object' && !Array.isArray(data)) {
      const count = data[countField] ?? 0;
      const lastUpdated = data.lastUpdated
        ? moment(data.lastUpdated).format('YYYY-MM-DD')
        : null;
      return { count, lastUpdated };
    }

    // Array - return length
    if (Array.isArray(data)) {
      return {
        count: data.length,
        lastUpdated: moment().format('YYYY-MM-DD'),
      };
    }

    return { count: 0, lastUpdated: null };
  }

  /**
   * Load data from appropriate source
   * @private
   */
  #loadData(username, dataPath, dataSource) {
    if (dataSource === 'current') {
      return this.#io.userLoadCurrent?.(username, dataPath) || null;
    }
    return this.#io.userLoadFile(username, dataPath);
  }

  /**
   * Apply filter to array of items
   * @private
   */
  #applyFilter(items, filter) {
    const { field, operator, value } = filter;
    return items.filter((item) => {
      const itemValue = item[field];
      if (operator === 'ne') return itemValue !== value;
      if (operator === 'eq') return itemValue === value;
      return true;
    });
  }

  /**
   * Find most recent entry in an array
   * @private
   */
  #findMostRecentInArray(items, dateField) {
    const dateFormats = ['YYYY-MM-DD', 'DD MMM YYYY, HH:mm', moment.ISO_8601];
    const datedItems = items
      .filter((item) => item && item[dateField])
      .map((item) => ({ item, ts: moment(item[dateField], dateFormats) }))
      .filter((entry) => entry.ts.isValid());

    if (datedItems.length === 0) {
      this.#logger.warn?.('entropy.reader.noValidDates', {
        itemCount: items.length,
        dateField,
      });
      return null;
    }

    datedItems.sort((a, b) => b.ts.diff(a.ts));
    const most = datedItems[0];

    return {
      timestamp: most.ts.unix(),
      date: most.item[dateField],
      data: most.item,
    };
  }

  /**
   * Find most recent entry in date-keyed object
   * @private
   */
  #findMostRecentInDateKeyed(data, filter, checkField) {
    // Filter to valid date keys
    const validDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let dates = Object.keys(data).filter((d) => validDateRegex.test(d));

    // Sort newest first
    dates.sort((a, b) => moment(b).diff(moment(a)));

    for (const dateKey of dates) {
      const dayData = data[dateKey];
      if (!dayData) continue;

      if (Array.isArray(dayData)) {
        // Array of items for this day
        const match = this.#findMatchInDayArray(dayData, filter);
        if (match) {
          return {
            timestamp: moment(dateKey).unix(),
            date: dateKey,
            data: match,
          };
        }
      } else {
        // Object data
        if (this.#isValidEntry(dayData, checkField)) {
          return {
            timestamp: moment(dateKey).unix(),
            date: dateKey,
            data: dayData,
          };
        }
      }
    }

    return null;
  }

  /**
   * Find matching item in day array
   * @private
   */
  #findMatchInDayArray(dayArray, filter) {
    if (filter) {
      return dayArray.find((item) => {
        const { field, operator, value } = filter;
        const itemValue = item[field];
        if (operator === 'ne') return itemValue !== value;
        if (operator === 'eq') return itemValue === value;
        return true;
      });
    }
    // No filter - return last item (assuming chronological order)
    return dayArray[dayArray.length - 1];
  }

  /**
   * Check if entry is valid based on checkField
   * @private
   */
  #isValidEntry(entry, checkField) {
    if (checkField) {
      return entry[checkField] !== undefined;
    }
    // Legacy support for weight measurement field
    if (entry.measurement !== undefined) {
      return true;
    }
    // Default: existence is enough
    return true;
  }
}

export default YamlEntropyReader;
