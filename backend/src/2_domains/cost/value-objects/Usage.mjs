/**
 * Usage Value Object - Represents a quantity of resource consumption
 * @module domains/cost/value-objects/Usage
 *
 * Immutable value object for usage measurements (e.g., kWh, gallons, therms).
 *
 * @example
 * const electricity = new Usage(150, 'kWh');
 * const water = new Usage(1200, 'gallons');
 * const gas = new Usage(45.5, 'therms');
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Usage value object
 * Immutable representation of resource consumption with quantity and unit
 *
 * @class Usage
 */
export class Usage {
  /** @type {number} */
  #quantity;

  /** @type {string} */
  #unit;

  /**
   * Create a Usage instance
   *
   * @param {number} quantity - The usage quantity (must be >= 0)
   * @param {string} unit - The unit of measurement (required, non-empty)
   * @throws {ValidationError} If quantity is negative
   * @throws {ValidationError} If unit is empty or missing
   */
  constructor(quantity, unit) {
    if (quantity < 0) {
      throw new ValidationError('Quantity cannot be negative', {
        code: 'NEGATIVE_QUANTITY',
        field: 'quantity',
        value: quantity
      });
    }

    if (!unit || typeof unit !== 'string' || unit.trim() === '') {
      throw new ValidationError('Unit is required', {
        code: 'MISSING_UNIT',
        field: 'unit',
        value: unit
      });
    }

    this.#quantity = quantity;
    this.#unit = unit;

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the quantity
   * @returns {number}
   */
  get quantity() {
    return this.#quantity;
  }

  /**
   * Get the unit
   * @returns {string}
   */
  get unit() {
    return this.#unit;
  }

  /**
   * Convert to JSON-serializable object
   *
   * @returns {{ quantity: number, unit: string }}
   */
  toJSON() {
    return {
      quantity: this.#quantity,
      unit: this.#unit
    };
  }

  /**
   * Create a Usage from a JSON object
   *
   * @param {Object} data - JSON object with quantity and unit
   * @param {number} data.quantity - The usage quantity
   * @param {string} data.unit - The unit of measurement
   * @returns {Usage}
   * @throws {ValidationError} If data is invalid
   */
  static fromJSON(data) {
    if (!data || typeof data.quantity !== 'number') {
      throw new ValidationError('Invalid Usage JSON: quantity is required', {
        code: 'INVALID_USAGE_JSON',
        value: data
      });
    }
    return new Usage(data.quantity, data.unit);
  }
}

export default Usage;
