/**
 * Request Logger Middleware
 * @module infrastructure/http/middleware/requestLogger
 *
 * Logs HTTP requests and responses.
 */

import { createLogger } from '../../logging/logger.mjs';

const logger = createLogger({ source: 'http', app: 'middleware' });

/**
 * Create request logger middleware
 * @param {Object} options
 * @param {boolean} [options.logBody=false] - Whether to log request body
 * @returns {Function} Express middleware
 */
export function requestLoggerMiddleware(options = {}) {
  const { logBody = false } = options;

  return (req, res, next) => {
    const startTime = Date.now();

    // Log request
    const requestLog = {
      traceId: req.traceId,
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
    };

    if (logBody && req.body) {
      // Sanitize sensitive data
      requestLog.body = sanitizeBody(req.body);
    }

    logger.debug('http.request', requestLog);

    // Capture response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const duration = Date.now() - startTime;

      logger.info('http.response', {
        traceId: req.traceId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      });

      return originalJson(body);
    };

    next();
  };
}

/**
 * Sanitize body for logging
 * @param {Object} body
 * @returns {Object}
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };

  // Remove/truncate potentially large or sensitive fields
  const sensitiveFields = ['photo', 'voice', 'document', 'audio', 'video', 'sticker'];
  const truncateFields = ['text', 'caption'];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
    if (sanitized.message?.[field]) {
      sanitized.message = { ...sanitized.message, [field]: '[REDACTED]' };
    }
  }

  for (const field of truncateFields) {
    if (sanitized[field] && typeof sanitized[field] === 'string' && sanitized[field].length > 100) {
      sanitized[field] = sanitized[field].slice(0, 100) + '...';
    }
    if (sanitized.message?.[field] && typeof sanitized.message[field] === 'string' && sanitized.message[field].length > 100) {
      sanitized.message = { ...sanitized.message, [field]: sanitized.message[field].slice(0, 100) + '...' };
    }
  }

  return sanitized;
}

export default requestLoggerMiddleware;
