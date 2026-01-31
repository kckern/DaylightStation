/**
 * Thresholds Value Object - Represents budget alert thresholds
 * @module domains/cost/value-objects/Thresholds
 *
 * Immutable value object for budget threshold configuration.
 * Defines warning and critical thresholds as percentages of budget,
 * and whether pace-based alerts are enabled.
 *
 * @example
 * const thresholds = new Thresholds({ warning: 0.75, critical: 0.9, pace: true });
 * thresholds.warning // 0.75 (75% of budget)
 * thresholds.critical // 0.9 (90% of budget)
 * thresholds.pace // true (pace alerts enabled)
 */

/**
 * Thresholds value object
 * Immutable representation of budget alert thresholds
 *
 * @class Thresholds
 */
export class Thresholds {
  /** @type {number} */
  #warning;

  /** @type {number} */
  #critical;

  /** @type {boolean} */
  #pace;

  /**
   * Create a Thresholds instance
   *
   * @param {Object} [config={}] - Threshold configuration
   * @param {number} [config.warning=0.8] - Warning threshold (0-1, percentage of budget)
   * @param {number} [config.critical=1.0] - Critical threshold (0-1, percentage of budget)
   * @param {boolean} [config.pace=true] - Whether to enable pace-based alerts
   */
  constructor({ warning = 0.8, critical = 1.0, pace = true } = {}) {
    this.#warning = warning;
    this.#critical = critical;
    this.#pace = pace;

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the warning threshold
   * @returns {number} Warning threshold as decimal (e.g., 0.8 = 80%)
   */
  get warning() {
    return this.#warning;
  }

  /**
   * Get the critical threshold
   * @returns {number} Critical threshold as decimal (e.g., 1.0 = 100%)
   */
  get critical() {
    return this.#critical;
  }

  /**
   * Get whether pace-based alerts are enabled
   * @returns {boolean}
   */
  get pace() {
    return this.#pace;
  }

  /**
   * Convert to JSON-serializable object
   *
   * @returns {{ warning: number, critical: number, pace: boolean }}
   */
  toJSON() {
    return {
      warning: this.#warning,
      critical: this.#critical,
      pace: this.#pace
    };
  }

  /**
   * Create a Thresholds from a JSON object
   *
   * @param {Object|null} data - JSON object with threshold data
   * @param {number} [data.warning] - Warning threshold
   * @param {number} [data.critical] - Critical threshold
   * @param {boolean} [data.pace] - Pace alerts enabled
   * @returns {Thresholds}
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      return new Thresholds();
    }

    return new Thresholds({
      warning: data.warning ?? 0.8,
      critical: data.critical ?? 1.0,
      pace: data.pace ?? true
    });
  }

  /**
   * Create a Thresholds with default values
   *
   * @returns {Thresholds} Thresholds with warning=0.8, critical=1.0, pace=true
   */
  static defaults() {
    return new Thresholds();
  }
}

export default Thresholds;
