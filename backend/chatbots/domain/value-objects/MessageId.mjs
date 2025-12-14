/**
 * MessageId value object for identifying messages
 * @module domain/value-objects/MessageId
 */

import { ValidationError } from '../../_lib/errors/index.mjs';

/**
 * MessageId value object
 * Immutable identifier for a message in a chat
 */
export class MessageId {
  /** @type {string|number} */
  #value;

  /**
   * @param {string|number} value - Message identifier
   */
  constructor(value) {
    if (value === null || value === undefined) {
      throw new ValidationError('MessageId value is required', { value });
    }
    
    // Normalize to string for consistency
    this.#value = String(value);
    
    if (this.#value.trim() === '') {
      throw new ValidationError('MessageId cannot be empty', { value });
    }
    
    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the raw value
   * @returns {string}
   */
  get value() {
    return this.#value;
  }

  /**
   * Get the numeric value (for Telegram APIs)
   * @returns {number}
   */
  toNumber() {
    return parseInt(this.#value, 10);
  }

  /**
   * Convert to string representation
   * @returns {string}
   */
  toString() {
    return this.#value;
  }

  /**
   * Convert to JSON-serializable value
   * @returns {string}
   */
  toJSON() {
    return this.#value;
  }

  /**
   * Check equality with another MessageId
   * @param {MessageId} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof MessageId)) return false;
    return this.#value === other.value;
  }

  /**
   * Create a MessageId from any value
   * @param {string|number|MessageId} value
   * @returns {MessageId}
   */
  static from(value) {
    if (value instanceof MessageId) return value;
    return new MessageId(value);
  }

  /**
   * Check if a value is a valid MessageId
   * @param {any} value
   * @returns {boolean}
   */
  static isValid(value) {
    try {
      new MessageId(value);
      return true;
    } catch {
      return false;
    }
  }
}

export default MessageId;
