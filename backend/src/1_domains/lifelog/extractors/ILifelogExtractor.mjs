/**
 * ILifelogExtractor - Port interface for lifelog data extractors
 *
 * Each extractor handles a specific data source and knows how to:
 * 1. Extract data for a specific date from the source file
 * 2. Format that data as a human-readable summary for AI prompts
 *
 * @module journalist/extractors
 */

/**
 * Extractor categories for grouping
 * @readonly
 * @enum {string}
 */
export const ExtractorCategory = {
  HEALTH: 'health',
  FITNESS: 'fitness',
  CALENDAR: 'calendar',
  PRODUCTIVITY: 'productivity',
  SOCIAL: 'social',
  JOURNAL: 'journal',
  FINANCE: 'finance',
};

/**
 * Base interface for lifelog extractors
 * @interface
 */
export class ILifelogExtractor {
  /**
   * Source identifier (e.g., 'garmin', 'strava')
   * @type {string}
   */
  get source() {
    throw new Error('ILifelogExtractor.source must be implemented');
  }

  /**
   * Category for grouping (e.g., 'health', 'fitness')
   * @type {string}
   */
  get category() {
    throw new Error('ILifelogExtractor.category must be implemented');
  }

  /**
   * Filename relative to user lifelog directory
   * @type {string}
   */
  get filename() {
    throw new Error('ILifelogExtractor.filename must be implemented');
  }

  /**
   * Extract data for a specific date from the source file
   *
   * @param {Object} data - Full source file data
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Object|Array|null} Extracted data or null if no data for date
   */
  extractForDate(data, date) {
    throw new Error('ILifelogExtractor.extractForDate must be implemented');
  }

  /**
   * Format extracted data as human-readable summary for AI prompts
   *
   * @param {Object|Array} entry - Data returned from extractForDate()
   * @returns {string|null} Formatted summary or null
   */
  summarize(entry) {
    throw new Error('ILifelogExtractor.summarize must be implemented');
  }
}

export default ILifelogExtractor;
