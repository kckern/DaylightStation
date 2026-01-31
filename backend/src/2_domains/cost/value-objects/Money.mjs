/**
 * Money Value Object - Represents a monetary amount with currency
 * @module domains/cost/value-objects/Money
 *
 * Immutable value object for monetary values. Amounts are always rounded
 * to 2 decimal places (cents).
 *
 * @example
 * const price = new Money(42.50, 'USD');
 * const total = price.add(new Money(10, 'USD'));
 * const doubled = price.multiply(2);
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Money value object
 * Immutable representation of a monetary amount with currency
 *
 * @class Money
 */
export class Money {
  /** @type {number} */
  #amount;

  /** @type {string} */
  #currency;

  /**
   * Create a Money instance
   *
   * @param {number} amount - The monetary amount (must be >= 0)
   * @param {string} [currency='USD'] - ISO 4217 currency code
   * @throws {ValidationError} If amount is negative
   */
  constructor(amount, currency = 'USD') {
    const rounded = Money.#roundToCents(amount);

    if (rounded < 0) {
      throw new ValidationError('Amount cannot be negative', {
        code: 'NEGATIVE_AMOUNT',
        field: 'amount',
        value: amount
      });
    }

    this.#amount = rounded;
    this.#currency = currency;

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the amount
   * @returns {number}
   */
  get amount() {
    return this.#amount;
  }

  /**
   * Get the currency code
   * @returns {string}
   */
  get currency() {
    return this.#currency;
  }

  /**
   * Add another Money to this one
   *
   * @param {Money} other - Money to add
   * @returns {Money} New Money with sum
   * @throws {ValidationError} If currencies don't match
   */
  add(other) {
    this.#assertSameCurrency(other);
    return new Money(this.#amount + other.amount, this.#currency);
  }

  /**
   * Subtract another Money from this one
   *
   * @param {Money} other - Money to subtract
   * @returns {Money} New Money with difference
   * @throws {ValidationError} If currencies don't match or result would be negative
   */
  subtract(other) {
    this.#assertSameCurrency(other);
    return new Money(this.#amount - other.amount, this.#currency);
  }

  /**
   * Multiply by a factor
   *
   * @param {number} factor - Multiplication factor (must be >= 0)
   * @returns {Money} New Money with product
   * @throws {ValidationError} If factor is negative
   */
  multiply(factor) {
    if (factor < 0) {
      throw new ValidationError('Factor cannot be negative', {
        code: 'NEGATIVE_FACTOR',
        field: 'factor',
        value: factor
      });
    }
    return new Money(this.#amount * factor, this.#currency);
  }

  /**
   * Check equality with another Money
   *
   * @param {Money|null|undefined} other - Money to compare
   * @returns {boolean} True if amount and currency match
   */
  equals(other) {
    if (!(other instanceof Money)) {
      return false;
    }
    return this.#amount === other.amount && this.#currency === other.currency;
  }

  /**
   * Convert to string representation
   *
   * @returns {string} Format: "amount currency" (e.g., "42.50 USD")
   */
  toString() {
    return `${this.#amount.toFixed(2)} ${this.#currency}`;
  }

  /**
   * Convert to JSON-serializable object
   *
   * @returns {{ amount: number, currency: string }}
   */
  toJSON() {
    return {
      amount: this.#amount,
      currency: this.#currency
    };
  }

  /**
   * Assert that another Money has the same currency
   *
   * @param {Money} other - Money to check
   * @throws {ValidationError} If currencies don't match
   */
  #assertSameCurrency(other) {
    if (this.#currency !== other.currency) {
      throw new ValidationError('Currency mismatch', {
        code: 'CURRENCY_MISMATCH',
        details: {
          expected: this.#currency,
          actual: other.currency
        }
      });
    }
  }

  /**
   * Round a number to 2 decimal places (cents)
   *
   * @param {number} value - Value to round
   * @returns {number} Rounded value
   */
  static #roundToCents(value) {
    return Math.round(value * 100) / 100;
  }

  /**
   * Create a Money from a JSON object
   *
   * @param {Object} data - JSON object with amount and optional currency
   * @param {number} data.amount - The monetary amount
   * @param {string} [data.currency='USD'] - ISO 4217 currency code
   * @returns {Money}
   * @throws {ValidationError} If data is invalid
   */
  static fromJSON(data) {
    if (!data || typeof data.amount !== 'number') {
      throw new ValidationError('Invalid Money JSON: amount is required', {
        code: 'INVALID_MONEY_JSON',
        value: data
      });
    }
    return new Money(data.amount, data.currency || 'USD');
  }

  /**
   * Create a zero Money
   *
   * @param {string} [currency='USD'] - ISO 4217 currency code
   * @returns {Money} Money with zero amount
   */
  static zero(currency = 'USD') {
    return new Money(0, currency);
  }
}

export default Money;
