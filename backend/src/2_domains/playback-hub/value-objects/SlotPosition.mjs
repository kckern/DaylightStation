/**
 * SlotPosition Value Object
 * @module domains/playback-hub/value-objects/SlotPosition
 *
 * Represents the physical slot number of a hub device (1-based positive integer).
 * Immutable, value-equality semantics.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';

/**
 * SlotPosition value object — positive integer identifying a hub slot.
 */
export class SlotPosition {
  /** @type {number} */
  #value;

  /**
   * @param {number} value - positive integer (>= 1)
   */
  constructor(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new ValidationError('SlotPosition must be a positive integer', {
        code: 'INVALID_SLOT_POSITION',
        field: 'value',
        value
      });
    }
    this.#value = value;
    Object.freeze(this);
  }

  /** @returns {number} */
  get value() {
    return this.#value;
  }

  /**
   * Value equality.
   * @param {SlotPosition} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof SlotPosition && other.value === this.#value;
  }

  /** @returns {number} */
  toJSON() {
    return this.#value;
  }
}

export default SlotPosition;
