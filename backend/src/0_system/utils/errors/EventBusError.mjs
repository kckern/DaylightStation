/**
 * Event bus error - event pub/sub failure
 * @module system/utils/errors/EventBusError
 *
 * NOTE: Keep this module free of any clock/now helper import (audit S-4).
 */

/**
 * Raised for event pub/sub failures (broadcast failure, client disconnect).
 */
export class EventBusError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {object} [opts]
   * @param {string} [opts.code] - Machine-readable code
   * @param {object} [opts.details] - Additional context
   */
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = 'EventBusError';
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default EventBusError;
