/**
 * SlotClass Value Object
 * @module domains/playback-hub/value-objects/SlotClass
 *
 * Enum-style value object: 'private' | 'public'. Public devices broadcast over
 * a Home-Assistant-managed speaker; private devices are personal headsets.
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

const ALLOWED = Object.freeze(['private', 'public']);

/**
 * SlotClass value object — restricted enum.
 */
export class SlotClass {
  /** @type {string} */
  #value;

  /**
   * @param {'private'|'public'} value
   */
  constructor(value) {
    if (!ALLOWED.includes(value)) {
      throw new ValidationError(`SlotClass must be one of ${ALLOWED.join('|')}`, {
        code: 'INVALID_SLOT_CLASS',
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

  /** @returns {boolean} */
  get isPrivate() {
    return this.#value === 'private';
  }

  /** @returns {boolean} */
  get isPublic() {
    return this.#value === 'public';
  }

  /**
   * Value equality.
   * @param {SlotClass} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof SlotClass && other.value === this.#value;
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

export default SlotClass;
