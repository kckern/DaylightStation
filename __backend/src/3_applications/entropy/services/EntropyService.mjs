/**
 * EntropyService
 *
 * Calculates data freshness/staleness for all configured sources.
 * High entropy = stale data, low entropy = fresh data.
 *
 * Located in application layer because it uses infrastructure services
 * (configuration projection, logging) for bootstrapping and configuration.
 *
 * @module entropy/services
 */

import moment from 'moment';
import { EntropyItem, MetricType } from '#domains/entropy/entities/EntropyItem.mjs';
import { UnsupportedOperationError } from '../../common/errors/index.mjs';

function toEntropyRecord(item) {
  return {
    id: item.source,
    source: item.source,
    name: item.name,
    icon: item.icon,
    status: item.status,
    value: item.value,
    label: item.label,
    lastUpdate: item.lastUpdate,
    url: item.url,
    weight: item.weight,
  };
}

/**
 * Service for calculating entropy (data staleness) reports
 */
export class EntropyService {
  #entropyReader;
  #configProjection;
  #logger;

  /**
   * @param {Object} config
   * @param {IEntropyReader} config.entropyReader - Reader for data timestamps
   * @param {Object} config.configProjection - Semantic entropy configuration
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ entropyReader, configProjection, logger = console }) {
    if (!configProjection?.sources) throw new Error('EntropyService requires configProjection');
    this.#entropyReader = entropyReader;
    this.#configProjection = configProjection;
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
      items: items.map(toEntropyRecord),
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
    return toEntropyRecord(item);
  }

  /**
   * Get entropy config for user
   * @private
   */
  #getEntropyConfig(username) {
    return { sources: this.#configProjection.sources(username) };
  }

  /**
   * Evaluate a single source and return EntropyItem
   * @private
   */
  async #evaluateSource(username, sourceId, config) {
    try {
      const { value, lastUpdate, lastItem } = await this.#getMetricValue(
        username,
        sourceId,
        config
      );

      // Resolve URL with data placeholders from last item
      // Supports templates like "https://strava.com/activities/{id}"
      const url = this.#resolveUrl(config.url, { lastUpdate, ...lastItem });

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
        weight: config.weight,
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
   * @returns {Promise<{ value: number, lastUpdate: string | null, lastItem: Object | null }>}
   */
  async #getMetricValue(username, sourceId, config) {
    const datasetId = config.datasetId || sourceId;
    const metric = config.metric || MetricType.DAYS_SINCE;

    if (metric === MetricType.DAYS_SINCE) {
      const result = await this.#entropyReader.readLatestObservation(username, datasetId, {
        dateField: config.dateField,
        filter: config.filter,
        listProperty: config.listProperty,
        checkField: config.checkField,
        dataSource: config.dataSource,
      });

      this.#logger.debug?.('entropy.metric.days_since', {
        sourceId,
        result,
        hasTimestamp: !!result?.timestamp,
        hasDate: !!result?.date,
      });

      const daysSince = this.#calculateDaysSince(result?.timestamp);
      return {
        value: daysSince,
        lastUpdate: result?.date || null,
        lastItem: result?.data || null,
      };
    }

    if (metric === MetricType.COUNT) {
      const result = await this.#entropyReader.readMetricCount(username, datasetId, {
        countField: config.countField,
        listProperty: config.listProperty,
        dataSource: config.dataSource,
      });

      return { value: result.count, lastUpdate: result.lastUpdated, lastItem: null };
    }

    throw new UnsupportedOperationError(
      `metric type: ${metric}`,
      'Supported metric types are DAYS_SINCE and COUNT'
    );
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
