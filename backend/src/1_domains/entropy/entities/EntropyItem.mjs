/**
 * EntropyItem Entity
 *
 * Represents the staleness/freshness status of a single data source.
 * High entropy = stale/disorder, low entropy = fresh/ordered.
 *
 * @module entropy/entities
 */

/**
 * Metric types for entropy calculation
 * @readonly
 * @enum {string}
 */
export const MetricType = {
  DAYS_SINCE: 'days_since',
  COUNT: 'count',
};

/**
 * Threshold direction for status calculation
 * @readonly
 * @enum {string}
 */
export const Direction = {
  LOWER_IS_BETTER: 'lower_is_better',
  HIGHER_IS_BETTER: 'higher_is_better',
};

/**
 * Status levels
 * @readonly
 * @enum {string}
 */
export const Status = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
};

/**
 * Entropy item representing freshness status of a data source
 */
export class EntropyItem {
  static MetricType = MetricType;
  static Direction = Direction;
  static Status = Status;

  /**
   * @param {Object} config
   * @param {string} config.source - Source identifier
   * @param {string} config.name - Display name
   * @param {string} config.icon - Icon filename or emoji
   * @param {string} config.metricType - 'days_since' or 'count'
   * @param {number} config.value - Metric value
   * @param {Object} config.thresholds - { green, yellow } threshold values
   * @param {string} [config.direction='lower_is_better'] - Threshold direction
   * @param {string} [config.lastUpdate] - Last update date
   * @param {string} [config.url] - Link URL
   */
  constructor({
    source,
    name,
    icon,
    metricType,
    value,
    thresholds,
    direction = Direction.LOWER_IS_BETTER,
    lastUpdate = null,
    url = null,
  }) {
    this.source = source;
    this.name = name;
    this.icon = icon;
    this.metricType = metricType;
    this.value = value;
    this.lastUpdate = lastUpdate;
    this.url = url;
    this.status = this.#calculateStatus(value, thresholds, direction);
    this.label = this.#formatLabel(metricType, value);
  }

  /**
   * Calculate status based on value and thresholds
   * @private
   */
  #calculateStatus(value, thresholds, direction) {
    const { green, yellow } = thresholds;
    const lowerIsBetter = direction !== Direction.HIGHER_IS_BETTER;

    if (lowerIsBetter) {
      // Low = green (inbox count, days since workout)
      if (value <= green) return Status.GREEN;
      if (value <= yellow) return Status.YELLOW;
      return Status.RED;
    } else {
      // High = green (days since accident)
      if (value >= green) return Status.GREEN;
      if (value >= yellow) return Status.YELLOW;
      return Status.RED;
    }
  }

  /**
   * Format value as human-readable label
   * @private
   */
  #formatLabel(metricType, value) {
    if (metricType === MetricType.DAYS_SINCE) {
      if (value === 0) return 'Today';
      if (value === 1) return '1 day ago';
      if (value >= 999) return 'No data';
      return `${value} days ago`;
    }
    return `${value}`;
  }

  /**
   * Create an error entropy item
   * @param {string} sourceId - Source identifier
   * @param {Object} config - Source config with name, icon
   * @returns {EntropyItem}
   */
  static createError(sourceId, config) {
    return new EntropyItem({
      source: sourceId,
      name: config.name || sourceId,
      icon: config.icon || '',
      metricType: MetricType.DAYS_SINCE,
      value: -1,
      thresholds: { green: 0, yellow: 0 },
      direction: Direction.LOWER_IS_BETTER,
      lastUpdate: null,
      url: null,
    });
  }

  /**
   * Convert to plain object for API response
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.source,
      source: this.source,
      name: this.name,
      icon: this.icon,
      status: this.status,
      value: this.value,
      label: this.label,
      lastUpdate: this.lastUpdate,
      url: this.url,
    };
  }
}

export default EntropyItem;
