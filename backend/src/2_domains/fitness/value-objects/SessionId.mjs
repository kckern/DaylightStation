/**
 * SessionId Value Object - Unique identifier for fitness sessions
 * @module domains/fitness/value-objects/SessionId
 *
 * Format: YYYYMMDDHHmmss (14 digits derived from session start time)
 * Examples: "20260127143022" represents 2026-01-27 14:30:22
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * SessionId value object
 * Immutable identifier for a fitness session derived from start time
 */
export class SessionId {
  /** @type {string} */
  #value;

  /**
   * @param {string} value - 14-digit session ID (YYYYMMDDHHmmss)
   */
  constructor(value) {
    const sanitized = SessionId.sanitize(value);
    if (!sanitized) {
      throw new ValidationError('Invalid SessionId format. Expected 14 digits (YYYYMMDDHHmmss)', {
        code: 'INVALID_SESSION_ID',
        value
      });
    }

    this.#value = sanitized;

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
   * Get session date in YYYY-MM-DD format
   * @returns {string}
   */
  getDate() {
    return `${this.#value.slice(0, 4)}-${this.#value.slice(4, 6)}-${this.#value.slice(6, 8)}`;
  }

  /**
   * Get session time in HH:mm:ss format
   * @returns {string}
   */
  getTime() {
    return `${this.#value.slice(8, 10)}:${this.#value.slice(10, 12)}:${this.#value.slice(12, 14)}`;
  }

  /**
   * Check equality with another SessionId or string
   * @param {SessionId|string} other
   * @returns {boolean}
   */
  equals(other) {
    if (other instanceof SessionId) {
      return this.#value === other.value;
    }
    if (typeof other === 'string') {
      const sanitized = SessionId.sanitize(other);
      return this.#value === sanitized;
    }
    return false;
  }

  /**
   * Generate a SessionId from a Date
   * @param {Date|string} date - Date object or ISO string
   * @returns {SessionId}
   * @throws {ValidationError}
   */
  static generate(date) {
    if (date == null) {
      throw new ValidationError('date required', { code: 'MISSING_DATE', field: 'date' });
    }
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) {
      throw new ValidationError('Invalid date', { code: 'INVALID_DATE', date });
    }
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const value = [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join('');
    return new SessionId(value);
  }

  /**
   * Validate sessionId format (14 digits)
   * @param {string} id
   * @returns {boolean}
   */
  static isValid(id) {
    if (!id) return false;
    const digits = String(id).replace(/\D/g, '');
    return digits.length === 14;
  }

  /**
   * Sanitize sessionId (remove non-digits)
   * @param {string} id
   * @returns {string|null} - Cleaned 14 digits or null if invalid
   */
  static sanitize(id) {
    if (!id) return null;
    const digits = String(id).replace(/\D/g, '');
    return digits.length === 14 ? digits : null;
  }

  /**
   * Create a SessionId from a string or existing SessionId
   * @param {SessionId|string} value
   * @returns {SessionId}
   */
  static from(value) {
    if (value instanceof SessionId) return value;
    return new SessionId(value);
  }
}

export default SessionId;
