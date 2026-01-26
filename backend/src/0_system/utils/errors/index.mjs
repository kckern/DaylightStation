/**
 * Error module barrel export
 * @module infrastructure/utils/errors
 */

export {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  isDomainError,
  isValidationError,
  isNotFoundError,
} from './DomainError.mjs';

export {
  InfrastructureError,
  ExternalServiceError,
  RateLimitError,
  PersistenceError,
  TimeoutError,
  isInfrastructureError,
  isRetryableError,
  isRateLimitError,
} from './InfrastructureError.mjs';

/**
 * Get HTTP status code from an error
 * @param {Error} error
 * @returns {number}
 */
export function getHttpStatus(error) {
  if (error && typeof error.httpStatus === 'number') {
    return error.httpStatus;
  }
  return 500;
}

/**
 * Wrap an error with additional context
 * @param {Error} error - Original error
 * @param {object} context - Additional context to add
 * @returns {Error} - Error with added context
 */
export function wrapError(error, context) {
  if (error && typeof error.context === 'object') {
    error.context = { ...error.context, ...context };
  } else {
    error.context = context;
  }
  return error;
}
