/**
 * BudgetPeriod Value Object - Represents a budget time period
 * @module domains/cost/value-objects/BudgetPeriod
 *
 * Immutable value object for budget period configuration.
 * Supports daily, weekly, monthly, and yearly periods with optional
 * anchor dates for custom period starts.
 *
 * @example
 * const period = new BudgetPeriod('monthly');
 * const start = period.getCurrentPeriodStart(new Date());
 * const end = period.getCurrentPeriodEnd(new Date());
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Valid budget period types
 * @type {readonly string[]}
 */
export const PERIOD_TYPES = Object.freeze(['daily', 'weekly', 'monthly', 'yearly']);

/**
 * BudgetPeriod value object
 * Immutable representation of a budget period configuration
 *
 * @class BudgetPeriod
 */
export class BudgetPeriod {
  /** @type {string} */
  #type;

  /** @type {Date|null} */
  #anchor;

  /**
   * Create a BudgetPeriod instance
   *
   * @param {string} type - Period type ('daily', 'weekly', 'monthly', 'yearly')
   * @param {Date|null} [anchor=null] - Optional anchor date for custom period start
   * @throws {ValidationError} If type is not valid
   */
  constructor(type, anchor = null) {
    if (!PERIOD_TYPES.includes(type)) {
      throw new ValidationError(`Invalid budget period type: ${type}`, {
        code: 'INVALID_PERIOD_TYPE',
        field: 'type',
        value: type,
        details: { validTypes: PERIOD_TYPES }
      });
    }

    this.#type = type;
    this.#anchor = anchor;

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the period type
   * @returns {string}
   */
  get type() {
    return this.#type;
  }

  /**
   * Get the anchor date
   * @returns {Date|null}
   */
  get anchor() {
    return this.#anchor;
  }

  /**
   * Get the start of the current period containing the reference date
   *
   * @param {Date} [referenceDate=new Date()] - Reference date
   * @returns {Date} Start of period (UTC midnight)
   */
  getCurrentPeriodStart(referenceDate = new Date()) {
    const date = new Date(referenceDate);

    switch (this.#type) {
      case 'daily':
        return new Date(Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          0, 0, 0, 0
        ));

      case 'weekly': {
        // Week starts on Sunday (day 0)
        const dayOfWeek = date.getUTCDay();
        const startDate = new Date(Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() - dayOfWeek,
          0, 0, 0, 0
        ));
        return startDate;
      }

      case 'monthly':
        return new Date(Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          1,
          0, 0, 0, 0
        ));

      case 'yearly':
        return new Date(Date.UTC(
          date.getUTCFullYear(),
          0,
          1,
          0, 0, 0, 0
        ));

      default:
        throw new ValidationError(`Unsupported period type: ${this.#type}`, {
          code: 'UNSUPPORTED_PERIOD_TYPE',
          value: this.#type
        });
    }
  }

  /**
   * Get the end of the current period containing the reference date
   *
   * @param {Date} [referenceDate=new Date()] - Reference date
   * @returns {Date} End of period (23:59:59 UTC)
   */
  getCurrentPeriodEnd(referenceDate = new Date()) {
    const date = new Date(referenceDate);

    switch (this.#type) {
      case 'daily':
        return new Date(Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          23, 59, 59, 999
        ));

      case 'weekly': {
        // Week ends on Saturday (day 6)
        const dayOfWeek = date.getUTCDay();
        const daysUntilSaturday = 6 - dayOfWeek;
        return new Date(Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() + daysUntilSaturday,
          23, 59, 59, 999
        ));
      }

      case 'monthly': {
        // Last day of month
        const nextMonth = new Date(Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          0, // Day 0 of next month = last day of current month
          23, 59, 59, 999
        ));
        return nextMonth;
      }

      case 'yearly':
        return new Date(Date.UTC(
          date.getUTCFullYear(),
          11, // December
          31,
          23, 59, 59, 999
        ));

      default:
        throw new ValidationError(`Unsupported period type: ${this.#type}`, {
          code: 'UNSUPPORTED_PERIOD_TYPE',
          value: this.#type
        });
    }
  }

  /**
   * Convert to JSON-serializable object
   *
   * @returns {{ type: string, anchor: string|null }}
   */
  toJSON() {
    return {
      type: this.#type,
      anchor: this.#anchor ? this.#anchor.toISOString() : null
    };
  }

  /**
   * Create a BudgetPeriod from a JSON object
   *
   * @param {Object} data - JSON object with period data
   * @param {string} data.type - Period type
   * @param {string|null} [data.anchor] - Anchor date as ISO string
   * @returns {BudgetPeriod}
   * @throws {ValidationError} If data is invalid
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object' || !data.type) {
      throw new ValidationError('Invalid BudgetPeriod JSON: type is required', {
        code: 'INVALID_BUDGET_PERIOD_JSON',
        value: data
      });
    }

    const anchor = data.anchor ? new Date(data.anchor) : null;
    return new BudgetPeriod(data.type, anchor);
  }
}

export default BudgetPeriod;
