/**
 * Timestamp value object for representing points in time
 * @module domain/value-objects/Timestamp
 */

import { ValidationError } from '../../_lib/errors/index.mjs';

/**
 * Timestamp value object
 * Immutable representation of a point in time
 */
export class Timestamp {
  /** @type {Date} */
  #date;

  /**
   * @param {Date|number|string} value - Date, epoch ms, or ISO string
   */
  constructor(value) {
    if (value instanceof Timestamp) {
      this.#date = new Date(value.toDate());
    } else if (value instanceof Date) {
      this.#date = new Date(value);
    } else if (typeof value === 'number') {
      this.#date = new Date(value);
    } else if (typeof value === 'string') {
      this.#date = new Date(value);
    } else {
      throw new ValidationError('Invalid timestamp value', { value });
    }
    
    if (isNaN(this.#date.getTime())) {
      throw new ValidationError('Invalid date', { value });
    }
    
    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the underlying Date object (returns a copy)
   * @returns {Date}
   */
  toDate() {
    return new Date(this.#date);
  }

  /**
   * Get epoch milliseconds
   * @returns {number}
   */
  toEpochMs() {
    return this.#date.getTime();
  }

  /**
   * Get epoch seconds
   * @returns {number}
   */
  toEpochSec() {
    return Math.floor(this.#date.getTime() / 1000);
  }

  /**
   * Convert to ISO string
   * @returns {string}
   */
  toISOString() {
    return this.#date.toISOString();
  }

  /**
   * Convert to string (ISO format)
   * @returns {string}
   */
  toString() {
    return this.toISOString();
  }

  /**
   * Convert to JSON-serializable value
   * @returns {string}
   */
  toJSON() {
    return this.toISOString();
  }

  /**
   * Format the timestamp
   * @param {string} [format='iso'] - Format: 'iso', 'date', 'time', 'datetime'
   * @param {string} [timezone='America/Los_Angeles'] - Timezone
   * @returns {string}
   */
  format(format = 'iso', timezone = 'America/Los_Angeles') {
    const options = { timeZone: timezone };
    
    switch (format) {
      case 'date':
        return this.#date.toLocaleDateString('en-CA', options); // YYYY-MM-DD
      case 'time':
        return this.#date.toLocaleTimeString('en-US', { 
          ...options, 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false,
        });
      case 'datetime':
        return this.#date.toLocaleString('en-US', {
          ...options,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
      case 'iso':
      default:
        return this.toISOString();
    }
  }

  /**
   * Check equality with another Timestamp
   * @param {Timestamp} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof Timestamp)) return false;
    return this.#date.getTime() === other.toEpochMs();
  }

  /**
   * Check if this timestamp is before another
   * @param {Timestamp} other
   * @returns {boolean}
   */
  isBefore(other) {
    return this.#date.getTime() < other.toEpochMs();
  }

  /**
   * Check if this timestamp is after another
   * @param {Timestamp} other
   * @returns {boolean}
   */
  isAfter(other) {
    return this.#date.getTime() > other.toEpochMs();
  }

  /**
   * Add time to create a new Timestamp
   * @param {number} amount - Amount to add
   * @param {string} unit - Unit: 'ms', 's', 'm', 'h', 'd'
   * @returns {Timestamp}
   */
  add(amount, unit) {
    const multipliers = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    
    const multiplier = multipliers[unit];
    if (!multiplier) {
      throw new ValidationError('Invalid time unit', { unit });
    }
    
    return new Timestamp(this.#date.getTime() + amount * multiplier);
  }

  /**
   * Get the difference from another timestamp in milliseconds
   * @param {Timestamp} other
   * @returns {number}
   */
  diff(other) {
    return this.#date.getTime() - other.toEpochMs();
  }

  /**
   * Get age in minutes from now
   * @returns {number}
   */
  ageInMinutes() {
    return Math.floor((Date.now() - this.#date.getTime()) / (60 * 1000));
  }

  /**
   * Create a Timestamp for the current time
   * @returns {Timestamp}
   */
  static now() {
    return new Timestamp(new Date());
  }

  /**
   * Create a Timestamp from any value
   * @param {Date|number|string|Timestamp} value
   * @returns {Timestamp}
   */
  static from(value) {
    if (value instanceof Timestamp) return value;
    return new Timestamp(value);
  }

  /**
   * Parse an ISO string
   * @param {string} isoString
   * @returns {Timestamp}
   */
  static parse(isoString) {
    return new Timestamp(isoString);
  }

  /**
   * Create from epoch milliseconds
   * @param {number} ms
   * @returns {Timestamp}
   */
  static fromEpochMs(ms) {
    return new Timestamp(ms);
  }

  /**
   * Create from epoch seconds
   * @param {number} sec
   * @returns {Timestamp}
   */
  static fromEpochSec(sec) {
    return new Timestamp(sec * 1000);
  }
}

export default Timestamp;
