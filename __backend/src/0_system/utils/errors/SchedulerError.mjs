/**
 * Scheduler error - scheduler/job registration or execution failure
 * @module system/utils/errors/SchedulerError
 *
 * NOTE: Keep this module free of any clock/now helper import (audit S-4).
 */

/**
 * Raised for scheduler/job registration or execution failures.
 */
export class SchedulerError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {object} [opts]
   * @param {string} [opts.code] - Machine-readable code (e.g. 'TASK_DUPLICATE')
   * @param {object} [opts.details] - Additional context
   */
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = 'SchedulerError';
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default SchedulerError;
