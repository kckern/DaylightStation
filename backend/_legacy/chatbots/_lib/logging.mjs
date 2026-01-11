/**
 * Central logging module for chatbots subsystem
 * 
 * Provides convenience wrappers around the unified backend logging framework.
 * All logs are routed through the centralized LogDispatcher.
 */

import crypto from 'crypto';
import { createLogger as createBackendLogger } from '../../lib/logging/logger.js';

/**
 * Create a logger instance that routes through the backend framework
 * @param {object} context - Context fields to include in all logs
 * @returns {object} Logger instance
 */
export function createLogger(context = {}) {
  const backendLogger = createBackendLogger({
    source: context.subsystem || 'chatbots',
    app: context.app || context.bot || 'unknown',
    context: context
  });

  return {
    child(extra) { 
      return createLogger({ ...context, ...extra }); 
    },
    error(msg, meta = {}) { 
      backendLogger.error(msg, { ...context, ...meta }); 
    },
    warn(msg, meta = {}) { 
      backendLogger.warn(msg, { ...context, ...meta }); 
    },
    info(msg, meta = {}) { 
      backendLogger.info(msg, { ...context, ...meta }); 
    },
    debug(msg, meta = {}) { 
      backendLogger.debug(msg, { ...context, ...meta }); 
    },
    level() { 
      return 'info'; // compatibility method
    }
  };
}

/**
 * Default logger instance for chatbots subsystem
 */
export const logger = createLogger({ subsystem: 'chatbots' });

/**
 * Express middleware to attach traceId and log request lifecycle
 * Routes through the backend logging framework
 */
export function requestLogger(botNameResolver) {
  return function(req, res, next) {
    req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
    const start = performance.now();
    res.setHeader('X-Trace-Id', req.traceId);
    const bot = typeof botNameResolver === 'function' ? botNameResolver(req) : botNameResolver;
    const reqLogger = logger.child({ traceId: req.traceId, bot });
    req.logger = reqLogger; // attach for downstream usage
    reqLogger.debug('request.start', { method: req.method, path: req.originalUrl });
    res.on('finish', () => {
      const ms = Math.round(performance.now() - start);
      reqLogger.info('request.finish', { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: ms });
    });
    next();
  };
}

/**
 * Helper to log unexpected errors uniformly
 */
export function logAndFormatError(err, contextLogger, extra = {}) {
  const safe = {
    name: err.name,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    ...extra
  };
  contextLogger.error('unhandled.error', safe);
  return { error: safe.message, traceId: extra.traceId, code: err.code || 'ERR_UNEXPECTED' };
}

/**
 * Convenience wrapper for async route handlers to reduce try/catch repetition
 */
export function wrapAsync(handler) {
  return async function(req, res) {
    try {
      await handler(req, res);
    } catch (err) {
      const response = logAndFormatError(err, req.logger || logger, { traceId: req.traceId });
      res.status(500).json(response);
    }
  };
}