/**
 * Domain error classes for business logic errors
 * @module infrastructure/utils/errors/DomainError
 */

/**
 * Base class for all domain errors
 * These represent errors in business logic or validation
 */
import { nowTs24 } from '../index.mjs';

export class DomainError extends Error {
  /**
   * @param {string} message - Error message
   * @param {object} [context] - Additional context
   */
  constructor(message, context = {}) {
    super(message);
    this.name = 'DomainError';
    this.context = context;
    this.timestamp = nowTs24();
    this.httpStatus = 500;

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
      context: this.context,
      timestamp: this.timestamp,
      httpStatus: this.httpStatus,
    };
  }
}

/**
 * Validation error - invalid input data (user error)
 * HTTP 400 Bad Request
 */
export class ValidationError extends DomainError {
  /**
   * @param {string} message - Error message
   * @param {object} [context] - Validation context (field, value, etc.)
   */
  constructor(message, context = {}) {
    super(message, context);
    this.name = 'ValidationError';
    this.httpStatus = 400;
  }

  /**
   * Create from a Zod validation error
   * @param {import('zod').ZodError} zodError
   * @returns {ValidationError}
   */
  static fromZodError(zodError) {
    const issues = zodError.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    return new ValidationError('Validation failed', { issues });
  }
}

/**
 * Not found error - requested entity doesn't exist
 * HTTP 404 Not Found
 */
export class NotFoundError extends DomainError {
  /**
   * @param {string} entityType - Type of entity (e.g., 'NutriLog', 'JournalEntry')
   * @param {string} [identifier] - Entity identifier
   * @param {object} [context] - Additional context
   */
  constructor(entityType, identifier, context = {}) {
    // Handle single-argument case (just a message)
    if (identifier === undefined) {
      super(entityType, context);
    } else {
      super(`${entityType} not found: ${identifier}`, { entityType, identifier, ...context });
    }
    this.name = 'NotFoundError';
    this.httpStatus = 404;
  }
}

/**
 * Conflict error - state conflict (duplicate, concurrent edit)
 * HTTP 409 Conflict
 */
export class ConflictError extends DomainError {
  /**
   * @param {string} message - Error message
   * @param {object} [context] - Conflict context
   */
  constructor(message, context = {}) {
    super(message, context);
    this.name = 'ConflictError';
    this.httpStatus = 409;
  }
}

/**
 * Business rule error - domain logic violation
 * HTTP 422 Unprocessable Entity
 */
export class BusinessRuleError extends DomainError {
  /**
   * @param {string} rule - Rule that was violated
   * @param {string} message - Error message
   * @param {object} [context] - Additional context
   */
  constructor(rule, message, context = {}) {
    super(message, { rule, ...context });
    this.name = 'BusinessRuleError';
    this.rule = rule;
    this.httpStatus = 422;
  }
}

/**
 * Check if an error is a domain error
 * @param {Error} error
 * @returns {boolean}
 */
export function isDomainError(error) {
  return error instanceof DomainError;
}

/**
 * Check if an error is a validation error
 * @param {Error} error
 * @returns {boolean}
 */
export function isValidationError(error) {
  return error instanceof ValidationError;
}

/**
 * Check if an error is a not found error
 * @param {Error} error
 * @returns {boolean}
 */
export function isNotFoundError(error) {
  return error instanceof NotFoundError;
}

export default {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  isDomainError,
  isValidationError,
  isNotFoundError,
};
