/**
 * SpreadSource Value Object - Represents a cost spread across multiple months
 * @module domains/cost/value-objects/SpreadSource
 *
 * Immutable value object for tracking costs that are spread over time,
 * such as annual subscriptions or equipment depreciation.
 *
 * @example
 * const source = new SpreadSource({
 *   name: 'Annual Software License',
 *   originalAmount: 120,
 *   spreadMonths: 12,
 *   startDate: new Date('2026-01-01')
 * });
 * source.getMonthlyAmount() // Money(10, 'USD')
 * source.getMonthsRemaining(new Date('2026-04-01')) // 9
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { Money } from './Money.mjs';

/**
 * SpreadSource value object
 * Immutable representation of a cost spread across multiple months
 *
 * @class SpreadSource
 */
export class SpreadSource {
  /** @type {string} */
  #name;

  /** @type {Money} */
  #originalAmount;

  /** @type {number} */
  #spreadMonths;

  /** @type {Date} */
  #startDate;

  /** @type {Date} */
  #endsAt;

  /**
   * Create a SpreadSource instance
   *
   * @param {Object} config - SpreadSource configuration
   * @param {string} config.name - Name/description of the spread source
   * @param {Money|number} config.originalAmount - Total amount to spread
   * @param {number} config.spreadMonths - Number of months to spread over (>= 1)
   * @param {Date} config.startDate - Start date of the spread period
   * @throws {ValidationError} If name is missing or spreadMonths < 1
   */
  constructor({ name, originalAmount, spreadMonths, startDate }) {
    if (!name) {
      throw new ValidationError('name is required', {
        code: 'MISSING_NAME',
        field: 'name'
      });
    }

    if (!spreadMonths || spreadMonths < 1) {
      throw new ValidationError('spreadMonths must be >= 1', {
        code: 'INVALID_SPREAD_MONTHS',
        field: 'spreadMonths',
        value: spreadMonths
      });
    }

    this.#name = name;
    this.#spreadMonths = spreadMonths;
    this.#startDate = new Date(startDate);

    // Convert to Money if needed
    if (originalAmount instanceof Money) {
      this.#originalAmount = originalAmount;
    } else {
      this.#originalAmount = new Money(originalAmount);
    }

    // Calculate end date (startDate + spreadMonths)
    this.#endsAt = new Date(this.#startDate);
    this.#endsAt.setUTCMonth(this.#endsAt.getUTCMonth() + spreadMonths);

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the name/description
   * @returns {string}
   */
  get name() {
    return this.#name;
  }

  /**
   * Get the original total amount
   * @returns {Money}
   */
  get originalAmount() {
    return this.#originalAmount;
  }

  /**
   * Get the number of months to spread over
   * @returns {number}
   */
  get spreadMonths() {
    return this.#spreadMonths;
  }

  /**
   * Get the start date
   * @returns {Date}
   */
  get startDate() {
    return this.#startDate;
  }

  /**
   * Get the end date (calculated from startDate + spreadMonths)
   * @returns {Date}
   */
  get endsAt() {
    return this.#endsAt;
  }

  /**
   * Calculate the monthly amount
   *
   * @returns {Money} Original amount divided by spread months
   */
  getMonthlyAmount() {
    const monthlyValue = this.#originalAmount.amount / this.#spreadMonths;
    return new Money(monthlyValue, this.#originalAmount.currency);
  }

  /**
   * Calculate months remaining from a given date
   *
   * @param {Date} [asOf=new Date()] - Reference date
   * @returns {number} Number of months remaining (0 if past endsAt)
   */
  getMonthsRemaining(asOf = new Date()) {
    const reference = new Date(asOf);

    // If before start date, return full spread
    if (reference < this.#startDate) {
      return this.#spreadMonths;
    }

    // If past end date, return 0
    if (reference >= this.#endsAt) {
      return 0;
    }

    // Calculate months elapsed
    const startYear = this.#startDate.getUTCFullYear();
    const startMonth = this.#startDate.getUTCMonth();
    const refYear = reference.getUTCFullYear();
    const refMonth = reference.getUTCMonth();

    const monthsElapsed = (refYear - startYear) * 12 + (refMonth - startMonth);
    return Math.max(0, this.#spreadMonths - monthsElapsed);
  }

  /**
   * Convert to JSON-serializable object
   *
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.#name,
      originalAmount: this.#originalAmount.toJSON(),
      spreadMonths: this.#spreadMonths,
      startDate: this.#startDate.toISOString()
    };
  }

  /**
   * Create a SpreadSource from a JSON object
   *
   * @param {Object} data - JSON object with spread source data
   * @param {string} data.name - Name/description
   * @param {Object|number} data.originalAmount - Amount as Money JSON or number
   * @param {number} data.spreadMonths - Number of months
   * @param {string} data.startDate - Start date as ISO string
   * @returns {SpreadSource}
   * @throws {ValidationError} If data is invalid
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object' || !data.name) {
      throw new ValidationError('Invalid SpreadSource JSON: name is required', {
        code: 'INVALID_SPREAD_SOURCE_JSON',
        value: data
      });
    }

    // Handle originalAmount as Money JSON or number
    let originalAmount;
    if (typeof data.originalAmount === 'number') {
      originalAmount = data.originalAmount;
    } else if (data.originalAmount && typeof data.originalAmount === 'object') {
      originalAmount = Money.fromJSON(data.originalAmount);
    } else {
      throw new ValidationError('Invalid SpreadSource JSON: originalAmount is required', {
        code: 'INVALID_SPREAD_SOURCE_JSON',
        value: data
      });
    }

    return new SpreadSource({
      name: data.name,
      originalAmount,
      spreadMonths: data.spreadMonths,
      startDate: new Date(data.startDate)
    });
  }
}

export default SpreadSource;
