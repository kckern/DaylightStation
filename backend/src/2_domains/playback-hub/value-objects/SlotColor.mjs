/**
 * SlotColor Value Object
 * @module domains/playback-hub/value-objects/SlotColor
 *
 * Canonical lowercase color identifier for a hub slot (e.g. 'red', 'yellow', 'white').
 * Immutable, value-equality semantics.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';

/**
 * SlotColor value object — non-empty lowercase string.
 */
export class SlotColor {
  /** @type {string} */
  #value;

  /**
   * @param {string} value - non-empty lowercase string
   */
  constructor(value) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ValidationError('SlotColor must be a non-empty string', {
        code: 'INVALID_SLOT_COLOR',
        field: 'value',
        value
      });
    }
    if (value !== value.toLowerCase()) {
      throw new ValidationError('SlotColor must be lowercase', {
        code: 'INVALID_SLOT_COLOR_CASE',
        field: 'value',
        value
      });
    }
    this.#value = value;
    Object.freeze(this);
  }

  /** @returns {string} */
  get value() {
    return this.#value;
  }

  /**
   * Value equality.
   * @param {SlotColor} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof SlotColor && other.value === this.#value;
  }

  /** @returns {string} */
  toString() {
    return this.#value;
  }

  /** @returns {string} */
  toJSON() {
    return this.#value;
  }
}

export default SlotColor;
