/**
 * File I/O error - file system operation failure
 * @module system/utils/errors/FileIOError
 *
 * NOTE: Keep this module free of any clock/now helper import (audit S-4).
 */

/**
 * Raised for file system operation failures (read/write, permission denied).
 */
export class FileIOError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {object} [opts]
   * @param {string} [opts.code] - Machine-readable code
   * @param {object} [opts.details] - Additional context
   */
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = 'FileIOError';
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default FileIOError;
