/**
 * Error Handler Middleware
 * @module infrastructure/http/middleware/errorHandler
 *
 * Catches and formats errors for HTTP responses.
 */

import { createLogger } from '../../logging/logger.mjs';
import {
  DomainError,
  ValidationError,
  NotFoundError,
  AuthorizationError,
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
  if (error instanceof AuthorizationError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof DomainError) return 422;
  if (error instanceof InfrastructureError) return 503;
  return 500;
}

/**
 * Map an error to an HTTP status WITHOUT relying on `instanceof`.
 *
 * The domain errors that use cases throw (`#domains/core/errors`:
 * ValidationError, DomainInvariantError, EntityNotFoundError) are DIFFERENT
 * classes from the system errors `getHttpStatus` checks via instanceof, so an
 * instanceof-based mapping would treat every domain error as a 500. This maps
 * by `err.status`/`err.statusCode` and `err.name` instead.
 *
 * @param {Error} error
 * @returns {number}
 */
function getHttpStatusByName(error) {
  const explicit = error?.status ?? error?.statusCode;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;

  switch (error?.name) {
    case 'ValidationError':
      return 400;
    case 'EntityNotFoundError':
    case 'NotFoundError':
      return 404;
    case 'AuthorizationError':
      return 403;
    case 'DomainInvariantError':
    case 'BusinessRuleError':
      return 422;
    case 'ConflictError':
      return 409;
    case 'ConfigurationError':
    case 'InfrastructureError':
    case 'SchedulerError':
    case 'PersistenceError':
    case 'ExternalServiceError':
    case 'TimeoutError':
      return 503;
    default:
      return 500;
  }
}

/**
 * Create error handler middleware
 * @param {Object} options
 * @param {boolean} [options.isWebhook=false] - If true, always return 200
 * @param {'object'|'string'} [options.shape='object'] - Response body shape.
 *   'object' (default, UNCHANGED legacy behavior — playbackHub/nutribot/journalist
 *   depend on it): `{ ok:false, error:{ type, message, code }, traceId }`, status
 *   mapped by `instanceof`.
 *   'string': backward-compatible STRING+CODE contract for client-facing routers.
 *   Status mapped by name/status (not instanceof). Expected errors (status < 500):
 *   `{ error: err.message, code: err.code || undefined }`. Unexpected (status >= 500):
 *   `{ error: 'Internal server error', code: err.code || 'INTERNAL' }` — the real
 *   error is logged server-side, never sent (info-leak fix).
 * @returns {Function} Express error middleware
 */
export function errorHandlerMiddleware(options = {}) {
  const { isWebhook = false, shape = 'object' } = options;

  if (shape === 'string') {
    return (err, req, res, next) => {
      const traceId = req.traceId || 'unknown';

      // If the response has already started (e.g. a streaming proxy failed
      // mid-pipe), we cannot rewrite status/body — delegate to Express's
      // default handler, which aborts the connection cleanly.
      if (res.headersSent) {
        return next(err);
      }

      const status = getHttpStatusByName(err);

      // Always log the REAL error server-side.
      if (status >= 500) {
        logger.error('http.error.unexpected', {
          traceId,
          errorType: err?.constructor?.name || err?.name || 'Error',
          message: err?.message,
          stack: err?.stack,
          status,
        });
      } else {
        logger.warn('http.error.expected', {
          traceId,
          errorType: err?.constructor?.name || err?.name || 'Error',
          message: err?.message,
          code: err?.code,
          status,
        });
      }

      // Expected error (status < 500): surface a safe message + code.
      // Unexpected (status >= 500): hide internals — never leak err.message.
      const body =
        status < 500
          ? { error: err?.message, code: err?.code || undefined }
          : { error: 'Internal server error', code: err?.code || 'INTERNAL' };

      // Webhooks always return 200 to prevent retries, but keep the same body.
      if (isWebhook) {
        logger.debug('http.webhook.errorResponse', {
          traceId,
          actualStatus: status,
          returnedStatus: 200,
        });
        return res.status(200).json(body);
      }

      return res.status(status).json(body);
    };
  }

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
 * Wraps async route handlers to catch errors. Returns the internal promise
 * so unit tests can await full completion — Express ignores middleware
 * return values.
 *
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default errorHandlerMiddleware;
