/**
 * EntropyService
 *
 * Calculates data freshness/staleness for all configured sources.
 * High entropy = stale data, low entropy = fresh data.
 *
 * @module entropy/services
 */

import moment from 'moment';
import { EntropyItem, MetricType } from '../entities/EntropyItem.mjs';

/**
 * Service for calculating entropy (data staleness) reports
 */
export class EntropyService {
  #entropyReader;
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {IEntropyReader} config.entropyReader - Reader for data timestamps
   * @param {Object} config.configService - Config service for app config
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ entropyReader, configService, logger = console }) {
    this.#entropyReader = entropyReader;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Generate entropy report for all configured sources
   *
   * @param {string} username - User identifier
   * @returns {Promise<{ items: EntropyItem[], summary: { green: number, yellow: number, red: number } }>}
   */
  async getReport(username) {
    const config = this.#getEntropyConfig(username);

    if (!config?.sources || Object.keys(config.sources).length === 0) {
      this.#logger.warn?.('entropy.config.missing', { username });
      return { items: [], summary: { green: 0, yellow: 0, red: 0 } };
    }

    // Process all sources in parallel
    const items = await Promise.all(
      Object.entries(config.sources).map(([sourceId, sourceConfig]) =>
        this.#evaluateSource(username, sourceId, sourceConfig)
      )
    );

    // Build summary
    const summary = items.reduce(
      (acc, item) => {
        acc[item.status]++;
        return acc;
      },
      { green: 0, yellow: 0, red: 0 }
    );

    this.#logger.info?.('entropy.report.generated', {
      username,
      itemCount: items.length,
      summary,
    });

    return {
      items: items.map((item) => item.toJSON()),
      summary,
    };
  }

  /**
   * Get entropy for a single source
   *
   * @param {string} username - User identifier
   * @param {string} sourceId - Source identifier
   * @returns {Promise<EntropyItem | null>}
   */
  async getSourceEntropy(username, sourceId) {
    const config = this.#getEntropyConfig(username);
    const sourceConfig = config?.sources?.[sourceId];

    if (!sourceConfig) {
      return null;
    }

    const item = await this.#evaluateSource(username, sourceId, sourceConfig);
    return item.toJSON();
  }

  /**
   * Get entropy config for user
   * @private
   */
  #getEntropyConfig(username) {
    // Try user profile first, then fall back to app config
    return this.#configService.getAppConfig?.('entropy') || {};
  }

  /**
   * Evaluate a single source and return EntropyItem
   * @private
   */
  async #evaluateSource(username, sourceId, config) {
    try {
      const { value, lastUpdate } = await this.#getMetricValue(
        username,
        sourceId,
        config
      );

      // Resolve URL with data placeholders
      const url = this.#resolveUrl(config.url, { lastUpdate });

      return new EntropyItem({
        source: sourceId,
        name: config.name || sourceId,
        icon: config.icon || '',
        metricType: config.metric || MetricType.DAYS_SINCE,
        value,
        thresholds: config.thresholds || { green: 3, yellow: 14 },
        direction: config.direction || 'lower_is_better',
        lastUpdate,
        url,
      });
    } catch (error) {
      this.#logger.error?.('entropy.source.error', {
        username,
        sourceId,
        error: error.message,
      });
      return EntropyItem.createError(sourceId, config);
    }
  }

  /**
   * Get metric value for a source
   * @private
   */
  async #getMetricValue(username, sourceId, config) {
    const dataPath = config.dataPath || sourceId;
    const metric = config.metric || MetricType.DAYS_SINCE;

    if (metric === MetricType.DAYS_SINCE) {
      const result = await this.#entropyReader.getLastUpdated(username, dataPath, {
        dateField: config.dateField,
        filter: config.filter,
        listProperty: config.listProperty,
        checkField: config.checkField,
      });

      const daysSince = this.#calculateDaysSince(result?.timestamp);
      return { value: daysSince, lastUpdate: result?.date || null };
    }

    if (metric === MetricType.COUNT) {
      const result = await this.#entropyReader.getCount(username, dataPath, {
        countField: config.countField,
        listProperty: config.listProperty,
      });

      return { value: result.count, lastUpdate: result.lastUpdated };
    }

    throw new Error(`Unknown metric type: ${metric}`);
  }

  /**
   * Calculate days since a timestamp
   * @private
   */
  #calculateDaysSince(timestamp) {
    if (!timestamp) return 999;

    const lastDate = moment.unix(timestamp).format('YYYY-MM-DD');
    const today = moment().format('YYYY-MM-DD');
    return Math.max(0, moment(today).diff(moment(lastDate), 'days'));
  }

  /**
   * Resolve URL with placeholders
   * @private
   */
  #resolveUrl(urlTemplate, data) {
    if (!urlTemplate) return null;

    return urlTemplate.replace(/{(\w+)}/g, (_, key) => {
      return data[key] || '';
    });
  }
}

export default EntropyService;
