/**
 * Home Dashboard State Handler
 * @module api/handlers/home-dashboard/state
 *
 * GET /api/v1/home-dashboard/state
 * Returns the composed dashboard state (rooms + entities + live values).
 */

/**
 * Create home-dashboard state handler
 * @param {Object} deps
 * @param {Object} deps.operation - GetDashboardState use case
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardStateHandler({ operation }) {
  return async (_req, res) => {
    const result = await operation.execute();
    res.json(result);
  };
}

export default homeDashboardStateHandler;
