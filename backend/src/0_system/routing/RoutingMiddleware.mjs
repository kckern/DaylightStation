// backend/src/0_infrastructure/routing/RoutingMiddleware.mjs
import { buildRoutingTable, matchRoute } from './RouteMatcher.mjs';

/**
 * Create routing middleware for toggle-based routing between legacy and new apps
 * @param {Object} options - Configuration options
 * @param {Object} options.config - Routing configuration with default and routing sections
 * @param {Function} options.legacyApp - Legacy Express app/router
 * @param {Function} options.newApp - New Express app/router
 * @param {Object} options.logger - Logger instance
 * @returns {Function} Express middleware
 */
export function createRoutingMiddleware({ config, legacyApp, newApp, logger }) {
  const routingTable = buildRoutingTable(config.routing || {});
  const defaultTarget = config.default;

  return (req, res, next) => {
    const { target } = matchRoute(req.path, routingTable, defaultTarget);

    // Set header to indicate which app served the request
    res.setHeader('x-served-by', target);

    // Route to appropriate app - pass next for Express Router compatibility
    const targetApp = target === 'legacy' ? legacyApp : newApp;
    return targetApp(req, res, next || (() => {}));
  };
}
