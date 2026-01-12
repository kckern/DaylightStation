// backend/src/0_infrastructure/routing/RoutingMiddleware.mjs
import { buildRoutingTable, matchRoute } from './RouteMatcher.mjs';

/**
 * Wrap response.json with shim transformation
 * @param {Object} res - Express response object
 * @param {Object} req - Express request object
 * @param {Object} shim - Shim object with transform() method
 * @param {Object} logger - Logger instance
 * @param {Object} metrics - ShimMetrics instance
 */
export function wrapResponseWithShim(res, req, shim, logger, metrics) {
  const originalJson = res.json.bind(res);

  res.json = (data) => {
    try {
      const transformed = shim.transform(data);
      logger.info('shim.applied', {
        path: req.path,
        shim: shim.name,
      });
      if (metrics) {
        metrics.record(shim.name || 'unknown');
      }
      return originalJson(transformed);
    } catch (error) {
      logger.error('shim.failed', {
        path: req.path,
        shim: shim.name,
        error: error.message,
      });
      return originalJson(data);
    }
  };
}

/**
 * Create routing middleware for toggle-based routing between legacy and new apps
 * @param {Object} options - Configuration options
 * @param {Object} options.config - Routing configuration with default and routing sections
 * @param {Function} options.legacyApp - Legacy Express app/router
 * @param {Function} options.newApp - New Express app/router
 * @param {Object} options.shims - Map of shim name to shim object
 * @param {Object} options.logger - Logger instance
 * @param {Object} options.metrics - ShimMetrics instance
 * @returns {Function} Express middleware
 */
export function createRoutingMiddleware({ config, legacyApp, newApp, shims, logger, metrics }) {
  const routingTable = buildRoutingTable(config.routing || {});
  const defaultTarget = config.default;

  return (req, res, next) => {
    const { target, shim: shimName } = matchRoute(req.path, routingTable, defaultTarget);

    // Set header to indicate which app served the request
    res.setHeader('x-served-by', target);

    // If route has a shim, wrap the response
    if (shimName && shims[shimName]) {
      const shim = shims[shimName];
      // Ensure shim has a name property for logging
      if (!shim.name) {
        shim.name = shimName;
      }
      res.setHeader('x-shim-applied', shimName);
      wrapResponseWithShim(res, req, shim, logger, metrics);
    }

    // Route to appropriate app - pass next for Express Router compatibility
    const targetApp = target === 'legacy' ? legacyApp : newApp;
    return targetApp(req, res, next || (() => {}));
  };
}
