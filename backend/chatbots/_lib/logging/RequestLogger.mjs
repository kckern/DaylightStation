/**
 * Express request logging middleware
 * @module _lib/logging/RequestLogger
 */

import { createLogger } from './Logger.mjs';

/**
 * Generate a unique request ID
 * @returns {string}
 */
function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Extract relevant request metadata
 * @param {import('express').Request} req
 * @returns {object}
 */
function extractRequestMeta(req) {
  return {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.get('user-agent'),
    contentLength: req.get('content-length'),
    contentType: req.get('content-type'),
  };
}

/**
 * Create request logging middleware
 * @param {object} [options] - Middleware options
 * @param {string} [options.source] - Source identifier
 * @param {string} [options.app] - App name
 * @param {string} [options.level] - Log level
 * @param {boolean} [options.logBody] - Whether to log request body
 * @param {string[]} [options.excludePaths] - Paths to exclude from logging
 * @returns {function} Express middleware
 */
export function createRequestLogger(options = {}) {
  const {
    source = 'chatbot',
    app = 'http',
    level = 'info',
    logBody = false,
    excludePaths = ['/health', '/healthz', '/ready'],
  } = options;

  const logger = createLogger({ source, app, level });

  return (req, res, next) => {
    // Skip excluded paths
    if (excludePaths.includes(req.path)) {
      return next();
    }

    // Generate request ID
    const requestId = generateRequestId();
    req.requestId = requestId;
    
    // Add request ID to response headers
    res.setHeader('X-Request-ID', requestId);

    // Record start time
    const startTime = process.hrtime.bigint();

    // Log request
    const requestMeta = {
      requestId,
      ...extractRequestMeta(req),
    };
    
    if (logBody && req.body && Object.keys(req.body).length > 0) {
      requestMeta.body = req.body;
    }

    logger.info('http.request.start', requestMeta);

    // Capture response
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      res.end = originalEnd;
      res.end(chunk, encoding);

      // Calculate duration
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Log response
      const responseMeta = {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        contentLength: res.get('content-length'),
      };

      if (res.statusCode >= 500) {
        logger.error('http.request.error', responseMeta);
      } else if (res.statusCode >= 400) {
        logger.warn('http.request.clientError', responseMeta);
      } else {
        logger.info('http.request.complete', responseMeta);
      }
    };

    next();
  };
}

/**
 * Create a logger bound to a specific request
 * @param {import('express').Request} req
 * @param {object} [options] - Logger options
 * @returns {import('./Logger.mjs').Logger}
 */
export function getRequestLogger(req, options = {}) {
  const logger = createLogger(options);
  if (req.requestId) {
    logger.setDefaultContext({ requestId: req.requestId });
  }
  return logger;
}

export default {
  createRequestLogger,
  getRequestLogger,
  generateRequestId,
};
