/**
 * Tracing Middleware
 * @module adapters/http/middleware/tracing
 * 
 * Assigns trace ID to requests for distributed tracing.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Create tracing middleware
 * @returns {Function} Express middleware
 */
export function tracingMiddleware() {
  return (req, res, next) => {
    // Check for X-Trace-Id header
    let traceId = req.headers['x-trace-id'];

    // If not present, generate UUID
    if (!traceId) {
      traceId = uuidv4();
    }

    // Attach to request
    req.traceId = traceId;

    // Set response header
    res.setHeader('X-Trace-Id', traceId);

    next();
  };
}

export default tracingMiddleware;
