/**
 * Error Handler Middleware
 * @module infrastructure/http/middleware/errorHandler
 *
 * Catches and formats errors for HTTP responses.
 */

import { createLogger } from '../../logging/logger.js';
import {
  DomainError,
  ValidationError,
  NotFoundError,
  InfrastructureError,
} from '../../utils/errors/index.mjs';

const logger = createLogger({ source: 'middleware', app: 'http' });

/**
 * Map domain error to HTTP status
 * @param {Error} error
 * @returns {number}
 */
function getHttpStatus(error) {
  if (error instanceof ValidationError) return 400;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof DomainError) return 422;
  if (error instanceof InfrastructureError) return 503;
  return 500;
}

/**
 * Create error handler middleware
 * @param {Object} options
 * @param {boolean} [options.isWebhook=false] - If true, always return 200
 * @returns {Function} Express error middleware
 */
export function errorHandlerMiddleware(options = {}) {
  const { isWebhook = false } = options;

  return (err, req, res, next) => {
    const traceId = req.traceId || 'unknown';
    const actualStatus = getHttpStatus(err);

    // Log based on error type
    if (err instanceof DomainError) {
      logger.warn('http.error.domain', {
        traceId,
        errorType: err.constructor.name,
        message: err.message,
        code: err.code,
        status: actualStatus,
      });
    } else if (err instanceof InfrastructureError) {
      logger.error('http.error.infrastructure', {
        traceId,
        errorType: err.constructor.name,
        message: err.message,
        stack: err.stack,
        status: actualStatus,
      });
    } else {
      logger.error('http.error.unknown', {
        traceId,
        errorType: err.constructor?.name || 'Error',
        message: err.message,
        stack: err.stack,
        status: actualStatus,
      });
    }

    // Build error response
    const errorResponse = {
      ok: false,
      error: {
        type: err.constructor?.name || 'Error',
        message: err.message,
        code: err.code || undefined,
      },
      traceId,
    };

    // For webhooks, always return 200 to prevent retries
    if (isWebhook) {
      // Log actual status for monitoring
      logger.debug('http.webhook.errorResponse', {
        traceId,
        actualStatus,
        returnedStatus: 200,
      });
      return res.status(200).json({
        ok: true,
        error: errorResponse.error,
        traceId,
      });
    }

    // For regular endpoints, return actual status
    res.status(actualStatus).json(errorResponse);
  };
}

/**
 * Async handler wrapper
 * Wraps async route handlers to catch errors
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default errorHandlerMiddleware;
