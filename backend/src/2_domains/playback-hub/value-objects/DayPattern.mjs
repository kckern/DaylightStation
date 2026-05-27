/**
 * DayPattern Value Object
 * @module domains/playback-hub/value-objects/DayPattern
 *
 * Schedules days-of-week. Accepts either:
 *   - the string 'all' | 'weekdays' | 'weekends', or
 *   - a non-empty array of lowercase day names ('sun'|'mon'|'tue'|'wed'|'thu'|'fri'|'sat')
 *
 * Provides matches(date) honoring the chosen pattern.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';

const DAY_NAMES = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const STRING_VALUES = Object.freeze(['all', 'weekdays', 'weekends']);
const WEEKDAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri']);
const WEEKENDS = Object.freeze(['sat', 'sun']);

/**
 * DayPattern value object.
 */
export class DayPattern {
  /** @type {string|ReadonlyArray<string>} */
  #value;

  /**
   * @param {'all'|'weekdays'|'weekends'|string[]} value
   */
  constructor(value) {
    if (typeof value === 'string') {
      if (!STRING_VALUES.includes(value)) {
        throw new ValidationError(
          `DayPattern string must be one of ${STRING_VALUES.join('|')}`,
          { code: 'INVALID_DAY_PATTERN', field: 'value', value }
        );
      }
      this.#value = value;
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        throw new ValidationError('DayPattern array must be non-empty', {
          code: 'INVALID_DAY_PATTERN',
          field: 'value',
          value
        });
      }
      for (const d of value) {
        if (typeof d !== 'string' || !DAY_NAMES.includes(d)) {
          throw new ValidationError(
            `DayPattern array entry must be one of ${DAY_NAMES.join('|')}`,
            { code: 'INVALID_DAY_PATTERN', field: 'value', value: d }
          );
        }
      }
      this.#value = Object.freeze([...value]);
    } else {
      throw new ValidationError('DayPattern must be a string or array', {
        code: 'INVALID_DAY_PATTERN',
        field: 'value',
        value
      });
    }
    Object.freeze(this);
  }

  /** @returns {string|ReadonlyArray<string>} */
  get value() {
    return this.#value;
  }

  /**
   * Test whether the given Date matches this pattern.
   * @param {Date} date
   * @returns {boolean}
   */
  matches(date) {
    const dow = DAY_NAMES[date.getDay()];
    if (this.#value === 'all') return true;
    if (this.#value === 'weekdays') return WEEKDAYS.includes(dow);
    if (this.#value === 'weekends') return WEEKENDS.includes(dow);
    return this.#value.includes(dow);
  }

  /** @returns {string|ReadonlyArray<string>} */
  toJSON() {
    return this.#value;
  }
}

export default DayPattern;
