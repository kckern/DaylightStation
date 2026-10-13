/**
 * Lifelog Aggregator - Extractor-Based Version
 * @module apps/lifelog/LifelogAggregator
 *
 * Aggregates semantic observations supplied by a source registry. Vendor record
 * formats and harvested-file locators remain behind the adapter boundary.
 */

import moment from 'moment-timezone';
/**
 * Lifelog aggregator using pluggable extractors
 */
export class LifelogAggregator {
  #logger;
  #sourceRegistry;

  /**
   * @param {Object} deps
   * @param {Object} deps.logger - Logger instance
   * @param {import('./ports/ILifelogSourceRegistry.mjs').ILifelogSourceRegistry} deps.sourceRegistry
   */
  constructor(deps = {}) {
    if (!deps.sourceRegistry?.readDay || !deps.sourceRegistry?.readRange) {
      throw new TypeError('LifelogAggregator requires sourceRegistry');
    }
    this.#logger = deps.logger;
    this.#sourceRegistry = deps.sourceRegistry;
  }

  /**
   * Get list of available extractor sources
   * @returns {string[]} Array of source names
   */
  getAvailableSources() {
    return this.#sourceRegistry.availableSources();
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

    const entries = await this.#sourceRegistry.readDay(username, targetDate);
    for (const entry of entries) {
      try {
        results.sources[entry.source] = entry.data;

        // Group by category
        if (!results.categories[entry.category]) {
          results.categories[entry.category] = {};
        }
        results.categories[entry.category][entry.source] = entry.data;

        // Generate summary for AI
        if (entry.summary) {
          results.summaries.push({
            source: entry.source,
            category: entry.category,
            text: entry.summary,
          });
          this.#logger?.debug('lifelog.source.extracted', {
            username,
            source: entry.source,
            category: entry.category,
            summaryLength: entry.summary.length,
          });
        }
      } catch (error) {
        this.#logger?.warn('lifelog.extractor.error', {
          username,
          source: entry.source,
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

    // Generate inclusive date range
    const dates = [];
    let current = moment(startDate);
    const end = moment(endDate);
    while (current.isSameOrBefore(end, 'day')) {
      dates.push(current.format('YYYY-MM-DD'));
      current = current.clone().add(1, 'day');
    }

    const projected = await this.#sourceRegistry.readRange(username, dates);
    const days = {};
    for (const date of dates) {
      const daySources = {};
      const dayCategories = {};
      const daySummaries = [];

      for (const entry of projected.days[date] || []) {
        try {
          daySources[entry.source] = entry.data;

          if (!dayCategories[entry.category]) {
            dayCategories[entry.category] = {};
          }
          dayCategories[entry.category][entry.source] = entry.data;

          if (entry.summary) {
            daySummaries.push({
              source: entry.source,
              category: entry.category,
              text: entry.summary,
            });
          }
        } catch (error) {
          this.#logger?.warn('lifelog.aggregateRange.extract-error', {
            source: entry.source,
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
        availableSources: projected.availableSources,
      },
    };

    this.#logger?.info('lifelog.aggregateRange.complete', {
      username,
      startDate,
      endDate,
      dayCount: dates.length,
      sourcesLoaded: projected.availableSources.length,
    });

    return result;
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
   * @param {string} source - Semantic source name
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
