/**
 * Home Dashboard Config Handler
 * @module api/handlers/home-dashboard/config
 *
 * GET /api/v1/home-dashboard/config
 * Returns the raw dashboard config (summary + rooms) from YAML.
 */

/**
 * Create home-dashboard config handler
 * @param {Object} deps
 * @param {Object} deps.container - HomeAutomationContainer
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardConfigHandler({ container, logger = console }) {
  return async (_req, res) => {
    const result = await container.getDashboardConfig().execute();
    res.json(result);
  };
}

export default homeDashboardConfigHandler;
