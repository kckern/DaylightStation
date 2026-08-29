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
 * @param {Object} deps.operation - GetDashboardConfig use case
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardConfigHandler({ operation }) {
  return async (_req, res) => {
    const result = await operation.execute();
    res.json(result);
  };
}

export default homeDashboardConfigHandler;
