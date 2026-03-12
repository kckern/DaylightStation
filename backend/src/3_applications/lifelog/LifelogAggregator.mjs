/**
 * Lifelog Aggregator - Extractor-Based Version
 * @module apps/lifelog/LifelogAggregator
 *
 * Aggregates data from all harvested sources for a specific date using
 * source-specific extractors that know how to parse each format.
 *
 * Lives in the application layer because it orchestrates I/O (file loading)
 * via the injected userLoadFile callback. Pure extractors remain in the domain.
 */

import moment from 'moment-timezone';
import { extractors } from '#domains/lifelog/extractors/index.mjs';

/**
 * Lifelog aggregator using pluggable extractors
 */
export class LifelogAggregator {
  #logger;
  #userLoadFile;

  // Store extractors reference for runtime access
  extractors = extractors;

  /**
   * @param {Object} deps
   * @param {Object} deps.logger - Logger instance
   * @param {Function} deps.userLoadFile - Function to load user files
   */
  constructor(deps = {}) {
    this.#logger = deps.logger;
    this.#userLoadFile = deps.userLoadFile;
  }

  /**
   * Get list of available extractor sources
   * @returns {string[]} Array of source names
   */
  getAvailableSources() {
    return this.extractors.map((e) => e.source);
  }

  /**
   * Aggregate lifelog data for a user on a specific date
   *
   * @param {string} username - System username
   * @param {string} date - ISO date (YYYY-MM-DD) - defaults to yesterday
   * @returns {Object} Aggregated lifelog data with summaries
   */
  async aggregate(username, date = null) {
    const targetDate = date || moment().subtract(1, 'day').format('YYYY-MM-DD');

    this.#logger?.info('lifelog.aggregate.start', { username, date: targetDate });

    const results = {
      date: targetDate,
      sources: {}, // Raw extracted data by source
      summaries: [], // Human-readable summaries for AI prompt
      categories: {}, // Data grouped by category
    };

    // Run each extractor
    for (const extractor of extractors) {
      try {
        // Load the source file
        const data = this.#loadSource(username, extractor.filename);
        if (!data) {
          this.#logger?.debug('lifelog.source.empty', {
            username,
            source: extractor.source,
          });
          continue;
        }

        // Extract data for target date
        const extracted = extractor.extractForDate(data, targetDate);
        if (!extracted) {
          this.#logger?.debug('lifelog.source.no-data-for-date', {
            username,
            source: extractor.source,
            date: targetDate,
          });
          continue;
        }

        // Store raw extracted data
        results.sources[extractor.source] = extracted;

        // Group by category
        if (!results.categories[extractor.category]) {
          results.categories[extractor.category] = {};
        }
        results.categories[extractor.category][extractor.source] = extracted;

        // Generate summary for AI
        const summary = extractor.summarize(extracted);
        if (summary) {
          results.summaries.push({
            source: extractor.source,
            category: extractor.category,
            text: summary,
          });
          this.#logger?.debug('lifelog.source.extracted', {
            username,
            source: extractor.source,
            category: extractor.category,
            summaryLength: summary.length,
          });
        }
      } catch (error) {
        this.#logger?.warn('lifelog.extractor.error', {
          username,
          source: extractor.source,
          error: error.message,
        });
      }
    }

    // Build combined summary text for AI prompt
    results.summaryText = results.summaries.map((s) => s.text).join('\n\n');

    // Meta information
    results._meta = {
      username,
      date: targetDate,
      availableSourceCount: results.summaries.length,
      hasEnoughData: results.summaries.length >= 1,
      sources: results.summaries.map((s) => s.source),
      categories: [...new Set(results.summaries.map((s) => s.category))],
    };

    this.#logger?.info('lifelog.aggregate.complete', {
      username,
      date: targetDate,
      availableSources: results._meta.availableSourceCount,
      sources: results._meta.sources,
      categories: results._meta.categories,
    });

    return results;
  }

  /**
   * Aggregate lifelog data for a user across a date range.
   * Loads each source file once, then iterates dates in memory.
   *
   * @param {string} username - System username
   * @param {string} startDate - Start date (YYYY-MM-DD), inclusive
   * @param {string} endDate - End date (YYYY-MM-DD), inclusive
   * @returns {Object} { startDate, endDate, days: { [date]: { sources, categories, summaries } }, _meta }
   */
  async aggregateRange(username, startDate, endDate) {
    this.#logger?.info('lifelog.aggregateRange.start', { username, startDate, endDate });

    // Load all source files once (each file contains all dates)
    const allSourceData = [];
    for (const extractor of extractors) {
      try {
        const data = this.#loadSource(username, extractor.filename);
        if (data) {
          allSourceData.push({ extractor, data });
        }
      } catch (error) {
        this.#logger?.warn('lifelog.aggregateRange.load-error', {
          source: extractor.source,
          error: error.message,
        });
      }
    }

    // Generate inclusive date range
    const dates = [];
    let current = moment(startDate);
    const end = moment(endDate);
    while (current.isSameOrBefore(end, 'day')) {
      dates.push(current.format('YYYY-MM-DD'));
      current = current.clone().add(1, 'day');
    }

    // Extract per-day from pre-loaded data
    const days = {};
    for (const date of dates) {
      const daySources = {};
      const dayCategories = {};
      const daySummaries = [];

      for (const { extractor, data } of allSourceData) {
        try {
          const extracted = extractor.extractForDate(data, date);
          if (!extracted) continue;

          daySources[extractor.source] = extracted;

          if (!dayCategories[extractor.category]) {
            dayCategories[extractor.category] = {};
          }
          dayCategories[extractor.category][extractor.source] = extracted;

          const summary = extractor.summarize(extracted);
          if (summary) {
            daySummaries.push({
              source: extractor.source,
              category: extractor.category,
              text: summary,
            });
          }
        } catch (error) {
          this.#logger?.warn('lifelog.aggregateRange.extract-error', {
            source: extractor.source,
            date,
            error: error.message,
          });
        }
      }

      days[date] = { sources: daySources, categories: dayCategories, summaries: daySummaries };
    }

    const result = {
      startDate,
      endDate,
      days,
      _meta: {
        username,
        dayCount: dates.length,
        availableSources: allSourceData.map(s => s.extractor.source),
      },
    };

    this.#logger?.info('lifelog.aggregateRange.complete', {
      username,
      startDate,
      endDate,
      dayCount: dates.length,
      sourcesLoaded: allSourceData.length,
    });

    return result;
  }

  /**
   * Load a harvested source file (with error handling)
   * @private
   */
  #loadSource(username, filename) {
    try {
      if (!this.#userLoadFile) {
        this.#logger?.warn('lifelog.source.no-loader', { username, filename });
        return null;
      }
      const data = this.#userLoadFile(username, filename);
      return data || null;
    } catch (error) {
      this.#logger?.debug('lifelog.source.load-error', {
        username,
        filename,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get summary text suitable for AI prompt
   * @param {Object} aggregated - Result from aggregate()
   * @returns {string} Combined summary text
   */
  static getSummaryText(aggregated) {
    return aggregated.summaryText || '';
  }

  /**
   * Get data for a specific source
   * @param {Object} aggregated - Result from aggregate()
   * @param {string} source - Source name (e.g., 'strava', 'weight')
   * @returns {Object|null} Extracted data or null
   */
  static getSourceData(aggregated, source) {
    return aggregated.sources?.[source] || null;
  }

  /**
   * Get all data for a category
   * @param {Object} aggregated - Result from aggregate()
   * @param {string} category - Category name (e.g., 'health', 'fitness')
   * @returns {Object} Object with source data for that category
   */
  static getCategoryData(aggregated, category) {
    return aggregated.categories?.[category] || {};
  }
}

export default LifelogAggregator;
