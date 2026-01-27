/**
 * Infrastructure error classes for external service and I/O errors
 * @module infrastructure/utils/errors/InfrastructureError
 */

/**
 * Base class for all infrastructure errors
 * These represent errors in external services or I/O operations
 */
import { nowTs24 } from '../index.mjs';

export class InfrastructureError extends Error {
  /** @type {string} Default error code for this class */
  static defaultCode = 'INFRASTRUCTURE_ERROR';

  /**
   * @param {string} message - Error message
   * @param {object} [context] - Additional context
   */
  constructor(message, context = {}) {
    super(message);
    this.name = 'InfrastructureError';
    this.context = context;
    this.code = context.code || this.constructor.defaultCode;
    this.timestamp = nowTs24();
    this.httpStatus = 500;
    this.retryable = false;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to JSON-serializable object
   * @returns {object}
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
    };
  }
}

/**
 * External service error - Telegram, OpenAI, UPC APIs failed
 * HTTP 502 Bad Gateway
 */
export class ExternalServiceError extends InfrastructureError {
  /** @type {string} Default error code for this class */
  static defaultCode = 'EXTERNAL_SERVICE_ERROR';

  /**
   * @param {string} service - Name of the external service
   * @param {string} message - Error message
   * @param {object} [context] - Additional context (statusCode, response, etc.)
   */
  constructor(service, message, context = {}) {
    super(`${service} error: ${message}`, { service, ...context });
    this.name = 'ExternalServiceError';
    this.service = service;
    this.httpStatus = 502;
    this.retryable = true;
  }

  /**
   * Create from an Axios error
   * @param {string} service - Service name
   * @param {Error} axiosError - Axios error
   * @returns {ExternalServiceError}
   */
  static fromAxiosError(service, axiosError) {
    const context = {
      statusCode: axiosError.response?.status,
      statusText: axiosError.response?.statusText,
      url: axiosError.config?.url,
      method: axiosError.config?.method,
    };

    const message = axiosError.response?.data?.message
      || axiosError.response?.data?.error
      || axiosError.message;

    return new ExternalServiceError(service, message, context);
  }
}

/**
 * Rate limit error - too many requests to external service
 * HTTP 429 Too Many Requests
 */
export class RateLimitError extends InfrastructureError {
  /** @type {string} Default error code for this class */
  static defaultCode = 'RATE_LIMIT_EXCEEDED';

  /**
   * @param {string} service - Name of the rate-limited service
   * @param {number} [retryAfter] - Seconds to wait before retrying
   * @param {object} [context] - Additional context
   */
  constructor(service, retryAfter = null, context = {}) {
    const message = retryAfter
      ? `Rate limit exceeded for ${service}. Retry after ${retryAfter}s`
      : `Rate limit exceeded for ${service}`;

    super(message, { service, retryAfter, ...context });
    this.name = 'RateLimitError';
    this.service = service;
    this.retryAfter = retryAfter;
    this.httpStatus = 429;
    this.retryable = true;
  }
}

/**
 * Persistence error - file I/O, database failure
 * HTTP 500 Internal Server Error
 */
export class PersistenceError extends InfrastructureError {
  /** @type {string} Default error code for this class */
  static defaultCode = 'PERSISTENCE_ERROR';

  /**
   * @param {string} operation - Operation that failed (read, write, delete)
   * @param {string} message - Error message
   * @param {object} [context] - Additional context (path, etc.)
   */
  constructor(operation, message, context = {}) {
    super(`Persistence ${operation} failed: ${message}`, { operation, ...context });
    this.name = 'PersistenceError';
    this.operation = operation;
    this.httpStatus = 500;
    this.retryable = operation === 'read'; // Reads might succeed on retry
  }
}

/**
 * Timeout error - operation timed out
 * HTTP 504 Gateway Timeout
 */
export class TimeoutError extends InfrastructureError {
  /** @type {string} Default error code for this class */
  static defaultCode = 'TIMEOUT';

  /**
   * @param {string} operation - Operation that timed out
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {object} [context] - Additional context
   */
  constructor(operation, timeoutMs, context = {}) {
    super(`Operation timed out after ${timeoutMs}ms: ${operation}`, {
      operation,
      timeoutMs,
      ...context
    });
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
    this.httpStatus = 504;
    this.retryable = true;
  }
}

/**
 * Check if an error is an infrastructure error
 * @param {Error} error
 * @returns {boolean}
 */
export function isInfrastructureError(error) {
  return error instanceof InfrastructureError;
}

/**
 * Check if an error is retryable
 * @param {Error} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  if (error instanceof InfrastructureError) {
    return error.retryable;
  }
  return false;
}

/**
 * Check if an error is a rate limit error
 * @param {Error} error
 * @returns {boolean}
 */
export function isRateLimitError(error) {
  return error instanceof RateLimitError;
}

